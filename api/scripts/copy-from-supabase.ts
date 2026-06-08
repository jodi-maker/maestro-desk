// One-time data copy: Supabase (source) -> Neon (destination).
//
// Migration to Neon — Step 3, PR 3.0. Copies row data for every structural
// table from the legacy Supabase DB into Neon, so the rewritten routes have
// real data to read. Reusable for the final pre-cutover resync.
//
// Usage (from api/):  bun scripts/copy-from-supabase.ts
// Requires SUPABASE_DB_URL (source) and DATABASE_URL (Neon dest) in api/.env.
//
// FK strategy (handles self-references AND cross-table cycles like
// tickets <-> inbox_messages):
//   - A FK whose columns are ALL NOT NULL is a "hard" edge — it dictates load
//     order (parent before child), and such edges form a DAG (a NOT NULL FK
//     cycle would be unloadable anyway).
//   - A FK with any NULLABLE column can be deferred: we insert those columns
//     as NULL, then patch them from the source in a second pass. Under MATCH
//     SIMPLE, nulling one referencing column switches the whole FK check off,
//     so this breaks every cycle.
//   - Only columns present in BOTH databases are copied (Neon's extra
//     Better-Auth columns on `users` keep their defaults).
import postgres from 'postgres';

const SRC = process.env.SUPABASE_DB_URL;
const DST = process.env.DATABASE_URL;
if (!SRC || !DST) {
  console.error('✗ Need SUPABASE_DB_URL (source) and DATABASE_URL (dest) in api/.env');
  process.exit(1);
}

const SKIP = new Set(['schema_migrations', 'session', 'account', 'verification']);

const src = postgres(SRC, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });
const dst = postgres(DST, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });

async function columns(sql: postgres.Sql, table: string): Promise<string[]> {
  const r = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position`;
  return r.map((x) => x.column_name as string);
}

async function pkColumns(table: string): Promise<string[]> {
  const r = await dst`
    select a.attname as col
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${'public.' + table}::regclass and i.indisprimary
    order by a.attnum`;
  return r.map((x) => x.col as string);
}

async function main() {
  const tablesRes = await dst`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`;
  const tables = tablesRes.map((r) => r.table_name as string).filter((t) => !SKIP.has(t));
  const set = new Set(tables);

  // FK constraints with per-FK nullability of their referencing columns.
  const fks = await dst`
    select c.conrelid::regclass::text as child,
           c.confrelid::regclass::text as parent,
           bool_and(a.attnotnull) as all_notnull,
           array_agg(a.attname) filter (where not a.attnotnull) as nullable_cols
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    group by c.conrelid, c.confrelid, c.oid`;
  const clean = (s: string) => s.replace(/^public\./, '').replace(/"/g, '');

  const hard = new Map<string, Set<string>>(tables.map((t) => [t, new Set()])); // child -> parents
  const deferred = new Map<string, Set<string>>(tables.map((t) => [t, new Set()])); // table -> nullable FK cols
  for (const f of fks) {
    const child = clean(f.child), parent = clean(f.parent);
    if (!set.has(child)) continue;
    if (f.all_notnull && child !== parent && set.has(parent)) {
      hard.get(child)!.add(parent);
    } else {
      for (const col of (f.nullable_cols || [])) deferred.get(child)!.add(col as string);
    }
  }

  // Topological order on hard (NOT NULL) edges only.
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...hard.get(t)!].every((p) => done.has(p)));
    if (ready.length === 0) throw new Error(`Unresolvable hard-FK cycle among: ${tables.filter((t) => !done.has(t)).join(', ')}`);
    for (const t of ready.sort()) { order.push(t); done.add(t); }
  }

  console.log(`Copying ${order.length} tables, Supabase -> Neon…`);
  await dst.unsafe(`truncate ${order.map((t) => `"${t}"`).join(', ')} restart identity cascade`);

  const summary: { table: string; rows: number; patched: number }[] = [];
  // Tables needing a deferred-FK patch in phase 2 (after ALL inserts, so the
  // referenced parent rows — possibly later in the order — already exist).
  const toPatch: { table: string; deferCols: string[]; rows: readonly postgres.Row[]; pk: string[] }[] = [];

  // Phase 1 — insert every table (deferred nullable-FK columns nulled).
  for (const table of order) {
    const [srcCols, dstCols] = await Promise.all([columns(src, table), columns(dst, table)]);
    const common = srcCols.filter((c) => dstCols.includes(c));
    if (common.length === 0) { summary.push({ table, rows: 0, patched: 0 }); continue; }

    const rows = await src.unsafe(`select ${common.map((c) => `"${c}"`).join(', ')} from public."${table}"`);
    if (rows.length === 0) { summary.push({ table, rows: 0, patched: 0 }); continue; }

    const deferCols = [...deferred.get(table)!].filter((c) => common.includes(c));
    const insertRows = deferCols.length
      ? rows.map((r) => { const c = { ...r } as Record<string, unknown>; for (const d of deferCols) c[d] = null; return c; })
      : rows;
    for (let i = 0; i < insertRows.length; i += 500) {
      await dst`insert into ${dst(table)} ${dst(insertRows.slice(i, i + 500) as any, ...common)}`;
    }

    let patchCount = 0;
    if (deferCols.length) {
      const pk = await pkColumns(table);
      if (pk.length === 0) throw new Error(`${table} has deferred FK cols but no primary key to patch on`);
      const needsPatch = rows.filter((r) => deferCols.some((d) => r[d] != null));
      if (needsPatch.length) { toPatch.push({ table, deferCols, rows: needsPatch, pk }); patchCount = needsPatch.length; }
    }
    summary.push({ table, rows: rows.length, patched: patchCount });
  }

  // Phase 2 — restore deferred FK columns now that every table is populated.
  for (const { table, deferCols, rows, pk } of toPatch) {
    for (const r of rows) {
      const setObj: Record<string, unknown> = {}; for (const d of deferCols) setObj[d] = r[d];
      let q = dst`update ${dst(table)} set ${dst(setObj)} where`;
      pk.forEach((k, idx) => { q = idx === 0 ? dst`${q} ${dst(k)} = ${r[k]}` : dst`${q} and ${dst(k)} = ${r[k]}`; });
      await q;
    }
  }

  const copied = summary.filter((s) => s.rows > 0);
  console.log(`✓ Done. ${copied.reduce((a, s) => a + s.rows, 0)} rows across ${copied.length} non-empty tables:`);
  for (const s of copied) console.log(`  ${s.table}: ${s.rows}${s.patched ? ` (+${s.patched} FK-patched)` : ''}`);
}

try {
  await main();
} catch (err) {
  console.error('✗ Copy failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await src.end();
  await dst.end();
}

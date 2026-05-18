// ─── Chart helper ────────────────────────────────────────────────────────────
// Render a categorical breakdown as bar / donut / list. Used by the dashboard
// and report widgets that have a `charts:['bar','donut','list']` registry
// entry. Pure rendering — no shared state, no side effects.
//
// `items` is an array of [key, value] pairs; `colorFor(key)` returns the
// CSS colour string for that key; `chart` is 'list' | 'donut' | 'bar'
// (anything else falls through to the bar default).
//
// escHtml is still in app.js as an app-wide utility; reached via window
// to match the pattern used elsewhere in this folder.

export function renderCategoricalChart(items, colorFor, chart) {
  const total = items.reduce((sum, [, v]) => sum + v, 0);
  const legend = items.map(([k, v]) => `<div class="donut-row" style="font-size:11px"><span class="donut-dot" style="background:${colorFor(k)}"></span><span style="flex:1;text-transform:capitalize;color:var(--ink2)">${window.escHtml(k)}</span><span style="font-family:'DM Mono',monospace;color:var(--ink3)">${v}</span></div>`).join('');
  if (chart === 'list') return legend || '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:16px 0">No data</div>';
  if (chart === 'donut') {
    if (!total) return `<div style="color:var(--ink3);font-size:12px;text-align:center;padding:16px 0">No data</div>${legend}`;
    const r = 36, c = 2 * Math.PI * r;
    let off = 0;
    const arcs = items.map(([k, v]) => {
      const len = (v / total) * c;
      const seg = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${colorFor(k)}" stroke-width="14" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`;
      off += len;
      return seg;
    }).join('');
    return `
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:8px">
        <svg width="100" height="100" viewBox="0 0 100 100" style="flex-shrink:0">${arcs}<text x="50" y="55" text-anchor="middle" font-family="Inter" font-size="14" font-weight="600" fill="var(--ink)">${total}</text></svg>
        <div style="flex:1">${legend}</div>
      </div>`;
  }
  // Default: stacked horizontal bar + legend below.
  const segs = items.map(([k, v]) => {
    const pct = total ? (v / total) * 100 : 0;
    return `<div title="${window.escHtml(k)}: ${v}" style="background:${colorFor(k)};width:${pct}%"></div>`;
  }).join('');
  return `<div class="r-stack">${segs}</div><div style="margin-top:12px">${legend}</div>`;
}

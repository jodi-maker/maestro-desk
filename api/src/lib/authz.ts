import type { Context } from 'hono';
import { getDb } from './db.js';

// Per-route authorization helpers (migration to Neon — Step 3).
//
// These replace the Supabase RLS policies. The auth middleware already
// verifies the caller is a member of the active workspace (or a platform
// admin) and stamps `userId` + `workspaceId` on the context; these helpers
// add the finer-grained checks that specific RLS policies used to enforce.
//
// All reads hit Neon directly. A route uses them like:
//   const denied = await requireWorkspaceAdmin(c);
//   if (denied) return denied;   // 403 response, already shaped
//
// Returning the Response (rather than throwing) keeps the call sites explicit
// and matches the existing route style.

// Allows the request only if the caller is an admin in the active workspace,
// OR a platform admin (the cross-workspace escape hatch the RLS policies
// carried as `or is_platform_admin`). Replaces the `is_workspace_admin` RPC +
// the admin-write RLS policies (e.g. ticket_categories_admin_write,
// workspace_members_admin_update).
export async function requireWorkspaceAdmin(c: Context): Promise<Response | null> {
  const sql = getDb();
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  const [row] = await sql<{ ws_admin: boolean; platform_admin: boolean }[]>`
    select
      coalesce((
        select bool_or(r.is_admin)
        from workspace_members wm
        join roles r on r.id = wm.role_id
        where wm.user_id = ${userId}
          and wm.workspace_id = ${workspaceId}
          and wm.active = true
      ), false) as ws_admin,
      coalesce((
        select u.is_platform_admin from users u where u.id = ${userId}
      ), false) as platform_admin
  `;

  if (row?.ws_admin || row?.platform_admin) return null;
  return c.json({ error: 'Admin permission required' }, 403);
}

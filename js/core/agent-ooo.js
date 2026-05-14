// ─── Agent out-of-office ────────────────────────────────────────────────────
// Agents flag themselves OOO with a from/to date range and an optional note.
// Assignment rules (round-robin and least-busy) skip OOO agents so tickets
// don't queue up against someone on leave. Direct "specific agent" rules and
// manual assignment still allow assigning to an OOO agent (an admin may
// intentionally page them) but the agent's tile shows the OOO state clearly.
//
// Cross-cutting concern — read from the Tickets sidebar, Agents page, Profile
// page, and Assignment Rules engine. Lives under js/core/ because it's not
// itself a feature page.
//
// External reaches (interim, via window): isAdmin, showModal, closeModal,
// escAttr, escHtml, renderPage — all still in app.js.
//
// AGENTS comes from data.js; SESSION + CURRENT_PAGE from state.js (global
// lex env, so bare refs work from the module).

export function isAgentOOO(name, atDate) {
  const a = AGENTS.find(x => x.name === name);
  if (!a || !a.oooFrom) return false;
  // Use local date — `<input type="date">` returns local YYYY-MM-DD, so
  // comparing in the same frame avoids a half-day off-by-one around midnight UTC.
  const d = atDate ? new Date(atDate) : new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return today >= a.oooFrom && (!a.oooTo || today <= a.oooTo);
}

// Auth guard: only the agent themselves or an admin may mutate OOO state.
// Surface buttons gate this too, but checking on the mutators keeps it safe
// against console / macro / future automation callers.
function canEditAgentOOO(name) {
  return SESSION && (SESSION.name === name || window.isAdmin());
}

function setAgentOOO(name, from, to, note) {
  if (!canEditAgentOOO(name)) return;
  const a = AGENTS.find(x => x.name === name);
  if (!a) return;
  if (!from) { delete a.oooFrom; delete a.oooTo; delete a.oooNote; return; }
  a.oooFrom = from;
  a.oooTo = to || null;
  a.oooNote = (note || '').trim() || null;
}

export function clearAgentOOO(name) {
  if (!canEditAgentOOO(name)) return;
  setAgentOOO(name, null);
}

export function showAgentOOOModal(name) {
  if (!canEditAgentOOO(name)) {
    alert('Only the agent themselves or an admin can edit OOO status.');
    return;
  }
  const a = AGENTS.find(x => x.name === name);
  if (!a) return;
  const today = new Date().toISOString().slice(0, 10);
  window.showModal(`Out of office · ${window.escHtml(name)}`, `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:14px;line-height:1.5">While ${window.escHtml(a.name.split(' ')[0])} is OOO, the assignment rules engine skips them in round-robin and least-busy modes. Direct assignment still works — admins may intentionally page someone on leave.</div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">From</label><input class="form-input" type="date" id="ooo-from" value="${window.escAttr(a.oooFrom || today)}"/></div>
      <div class="form-row"><label class="form-label">Until</label><input class="form-input" type="date" id="ooo-to" value="${window.escAttr(a.oooTo || '')}"/></div>
    </div>
    <div class="form-row"><label class="form-label">Auto-reply note (optional)</label>
      <input class="form-input" id="ooo-note" value="${window.escAttr(a.oooNote || '')}" placeholder="e.g. Annual leave — back Friday"/>
    </div>
    ${a.oooFrom ? `<div style="margin-top:14px;text-align:right"><button class="btn btn-sm btn-danger" onclick="clearAgentOOO('${window.escAttr(name)}');closeModal();renderPage(CURRENT_PAGE)">Clear OOO</button></div>` : ''}
  `, () => {
    const from = document.getElementById('ooo-from').value;
    const to   = document.getElementById('ooo-to').value;
    const note = document.getElementById('ooo-note').value;
    if (!from) { alert('Pick a start date.'); return; }
    if (to && to < from) { alert('End date must be on or after the start date.'); return; }
    setAgentOOO(name, from, to, note);
    window.closeModal();
    window.renderPage(CURRENT_PAGE);
  }, 'Save');
}

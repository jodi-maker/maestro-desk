// ─── Modal helpers ─────────────────────────────────────────────────────────────
// Singleton modal renderer. Every modal in the app — confirm dialogs, forms,
// pickers — paints into the #modal-container <div> and is dismissed by either
// the × button, a background click, or an explicit closeModal() call.
//
// Quirk worth knowing: the confirm callback gets serialised with
// onConfirm.toString() and re-invoked from the inline onclick handler. That
// re-evaluation happens in the global window scope, so the callback can't
// rely on closure variables — every existing caller reads form values from
// the DOM by id rather than from captured locals. Don't refactor a caller
// to capture state in a closure without also moving away from the
// .toString() pattern.

export function showModal(title, body, onConfirm, confirmLabel='Save', isLarge=false) {
  document.getElementById('modal-container').innerHTML = `
    <div class="modal-bg" onclick="closeModal()">
      <div class="${isLarge?'modal modal-lg':'modal'}" onclick="event.stopPropagation()">
        <div class="modal-head">
          <div class="modal-title">${title}</div>
          <div class="modal-close" onclick="closeModal()">×</div>
        </div>
        <div class="modal-body">${body}</div>
        ${onConfirm?`<div class="modal-foot">
          <button class="btn" onclick="closeModal()">Cancel</button>
          <button class="btn btn-solid" onclick="(${onConfirm.toString()})()">${confirmLabel}</button>
        </div>`:''}
      </div>
    </div>`;
}

export function closeModal() { document.getElementById('modal-container').innerHTML=''; }

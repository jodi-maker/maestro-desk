// ─── Customisable widget shell (dashboard + reports) ───────────────────────
// Each widget on the dashboard or reports page is wrapped with a chrome that
// provides a drag handle, a "..." menu (hide + chart-type switcher where
// available), and an aria-friendly hide button. Layouts (order, hidden set,
// per-widget chart choice) persist in localStorage so each agent's
// customisations stick across reloads.
//
// External reaches (interim, via window): escAttr, escHtml, renderPage —
// app.js utilities. DASH_WIDGETS / DEFAULT_DASH_LAYOUT come from
// `js/dashboard/index.js` (re-bridged through app.js); REPORT_WIDGETS /
// DEFAULT_REPORT_LAYOUT come from app.js (still alongside Reports).
//
// DASH_LAYOUT and REPORT_LAYOUT live in core/state.js so this module and
// app.js (top-level hydration + reports renderers) share one binding.

import { showModal, closeModal } from './modal.js';

export function loadLayout(key, fallback) {
  // Always deep-clone the fallback so any mutation through the returned
  // object can't bleed into DEFAULT_*_LAYOUT (or affect a sibling page using
  // the same fallback).
  const cloneFallback = () => ({
    order:  [...fallback.order],
    hidden: [...fallback.hidden],
    charts: { ...fallback.charts },
  });
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw || typeof raw !== 'object') return cloneFallback();
    return {
      order:  Array.isArray(raw.order)  ? raw.order  : [...fallback.order],
      hidden: Array.isArray(raw.hidden) ? raw.hidden : [...fallback.hidden],
      charts: (raw.charts && typeof raw.charts === 'object') ? raw.charts : { ...fallback.charts },
    };
  } catch (e) { return cloneFallback(); }
}
export function saveLayout(key, layout) {
  // Quota errors (private mode / disk full) shouldn't crash the page. Log so
  // a developer can see it in console, but let the in-memory layout keep
  // working for the rest of the session.
  try { localStorage.setItem(key, JSON.stringify(layout)); }
  catch (e) { console.warn('[layout] persist failed', key, e); }
}

// New widgets added in code releases need to land at the end of the order so
// they're discoverable without nuking the agent's existing arrangement.
export function reconcileLayout(layout, widgets) {
  const ids = widgets.map(w => w.id);
  layout.order = layout.order.filter(id => ids.includes(id));
  ids.forEach(id => { if (!layout.order.includes(id)) layout.order.push(id); });
  layout.hidden = layout.hidden.filter(id => ids.includes(id));
  return layout;
}

function widgetChrome(scope, w, innerHtml, chartType) {
  // Strip the outer .card wrapper from each widget's existing render so we
  // can put our chrome around it. Widget render functions historically wrap
  // their body in `<div class="card ...">...</div>`; we extract the inner
  // content so the chrome can include a drag handle + menu.
  const m = innerHtml.match(/^\s*<div class="card([^"]*)"([^>]*)>([\s\S]*)<\/div>\s*$/);
  let spanClass = '';
  let body = innerHtml;
  if (m) {
    spanClass = (m[1] || '').trim();
    body = m[3];
    // Strip the widget's own "card-title" so the chrome shows the title.
    body = body.replace(/^\s*<div class="card-title"[^>]*>[\s\S]*?<\/div>\s*/, '');
  } else if (w.span) {
    spanClass = w.span;
  }
  // scope and widget id flow into inline onclick attributes; escAttr neutralises
  // single quotes so a malicious id can't close the JS string and inject code.
  // Today every id is machine-generated, but defense-in-depth keeps the layout
  // engine safe against future widgets sourced from user input.
  const sid = window.escAttr(scope);
  const wid = window.escAttr(w.id);
  const chartMenu = (w.charts && w.charts.length > 1) ? `<button title="Chart type" onclick="event.stopPropagation();showWidgetMenu(this,'${sid}','${wid}','chart')">📊</button>` : '';
  return `
    <div class="widget card ${window.escAttr(spanClass)}" data-widget-scope="${sid}" data-widget-id="${wid}" draggable="true"
         ondragstart="widgetDragStart(event,'${sid}','${wid}')"
         ondragend="widgetDragEnd(event)"
         ondragover="widgetDragOver(event,'${sid}','${wid}')"
         ondragleave="widgetDragLeave(event)"
         ondrop="widgetDragDrop(event,'${sid}','${wid}')">
      <div class="widget-head" title="Drag to reorder">
        <span class="widget-handle">⋮⋮</span>
        <span class="widget-title">${window.escHtml(w.title)}${chartType ? ` · <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink3);font-style:italic">${window.escHtml(chartType)}</span>` : ''}</span>
        <div class="widget-actions">
          ${chartMenu}
          <button title="Hide widget" onclick="event.stopPropagation();hideWidgetById('${sid}','${wid}')">×</button>
        </div>
      </div>
      <div class="widget-body">${body}</div>
    </div>`;
}

export function renderWidgetGrid(scope, gridClass, widgets, layout, stats) {
  const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
  const items = layout.order
    .filter(id => !layout.hidden.includes(id))
    .map(id => byId[id])
    .filter(Boolean);
  const hiddenN = layout.hidden.length;
  const cards = items.map(w => widgetChrome(scope, w, w.render(stats), layout.charts[w.id])).join('');
  return `
    <div class="${gridClass}" data-widget-scope="${scope}">${cards}</div>
    <div style="margin-top:14px;display:flex;justify-content:flex-end">
      <button class="btn btn-sm" onclick="showManageWidgetsModal('${scope}')">⚙ Manage widgets${hiddenN ? ` · ${hiddenN} hidden` : ''}</button>
    </div>`;
}

let _widgetDragging = null;
export function widgetDragStart(ev, scope, id) {
  _widgetDragging = { scope, id };
  ev.target.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  // Some browsers require setData() to actually start a drag.
  try { ev.dataTransfer.setData('text/plain', id); } catch(e) {}
}
export function widgetDragEnd(ev) {
  ev.target.classList.remove('dragging');
  document.querySelectorAll('.widget.drop-target-before,.widget.drop-target-after').forEach(el => {
    el.classList.remove('drop-target-before','drop-target-after');
  });
  _widgetDragging = null;
}
export function widgetDragOver(ev, scope, id) {
  if (!_widgetDragging || _widgetDragging.scope !== scope) return;
  if (_widgetDragging.id === id) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  const target = ev.currentTarget;
  const rect = target.getBoundingClientRect();
  const before = (ev.clientX - rect.left) < rect.width / 2;
  target.classList.toggle('drop-target-before', before);
  target.classList.toggle('drop-target-after', !before);
}
export function widgetDragLeave(ev) {
  ev.currentTarget.classList.remove('drop-target-before','drop-target-after');
}
export function widgetDragDrop(ev, scope, targetId) {
  if (!_widgetDragging || _widgetDragging.scope !== scope) return;
  ev.preventDefault();
  const target = ev.currentTarget;
  const rect = target.getBoundingClientRect();
  const before = (ev.clientX - rect.left) < rect.width / 2;
  target.classList.remove('drop-target-before','drop-target-after');
  reorderWidget(scope, _widgetDragging.id, targetId, before);
}

function reorderWidget(scope, srcId, targetId, before) {
  const layout = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  const i = layout.order.indexOf(srcId);
  if (i < 0) return;
  layout.order.splice(i, 1);
  let j = layout.order.indexOf(targetId);
  if (j < 0) j = layout.order.length;
  if (!before) j += 1;
  layout.order.splice(j, 0, srcId);
  saveLayout(scope === 'dash' ? 'dash_layout' : 'report_layout', layout);
  window.renderPage(scope === 'dash' ? 'dashboard' : 'reports');
}

export function hideWidgetById(scope, id) {
  const layout = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  if (!layout.hidden.includes(id)) layout.hidden.push(id);
  saveLayout(scope === 'dash' ? 'dash_layout' : 'report_layout', layout);
  window.renderPage(scope === 'dash' ? 'dashboard' : 'reports');
}
export function showWidgetById(scope, id) {
  const layout = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  layout.hidden = layout.hidden.filter(x => x !== id);
  saveLayout(scope === 'dash' ? 'dash_layout' : 'report_layout', layout);
  window.renderPage(scope === 'dash' ? 'dashboard' : 'reports');
}
export function setWidgetChart(scope, id, chartType) {
  const layout = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  layout.charts = layout.charts || {};
  layout.charts[id] = chartType;
  saveLayout(scope === 'dash' ? 'dash_layout' : 'report_layout', layout);
  document.querySelectorAll('.widget-menu').forEach(el => el.remove());
  window.renderPage(scope === 'dash' ? 'dashboard' : 'reports');
}
export function resetWidgetLayout(scope) {
  const isDash = scope === 'dash';
  const src = isDash ? window.DEFAULT_DASH_LAYOUT : window.DEFAULT_REPORT_LAYOUT;
  const layout = { order: [...src.order], hidden: [...src.hidden], charts: { ...src.charts } };
  if (isDash) DASH_LAYOUT = layout; else REPORT_LAYOUT = layout;
  saveLayout(isDash ? 'dash_layout' : 'report_layout', layout);
  closeModal();
  window.renderPage(isDash ? 'dashboard' : 'reports');
}

export function showWidgetMenu(anchor, scope, id, kind) {
  document.querySelectorAll('.widget-menu').forEach(el => el.remove());
  const widgets = scope === 'dash' ? window.DASH_WIDGETS : window.REPORT_WIDGETS;
  const layout  = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  const w = widgets.find(x => x.id === id);
  if (!w || kind !== 'chart' || !w.charts) return;
  const current = layout.charts[id] || w.charts[0];
  const menu = document.createElement('div');
  menu.className = 'widget-menu';
  menu.innerHTML = `
    <div class="widget-menu-head">Chart type</div>
    ${w.charts.map(c => `<div class="widget-menu-item ${c===current?'active':''}" onclick="setWidgetChart('${scope}','${id}','${c}')">${c === current ? '✓' : '·'} ${window.escHtml(c)}</div>`).join('')}`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, r.right - 160)}px`;
  // Dismiss on outside click
  setTimeout(() => {
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 0);
}

export function showManageWidgetsModal(scope) {
  const widgets = scope === 'dash' ? window.DASH_WIDGETS : window.REPORT_WIDGETS;
  const layout  = scope === 'dash' ? DASH_LAYOUT : REPORT_LAYOUT;
  const body = widgets.map(w => {
    const visible = !layout.hidden.includes(w.id);
    return `
      <div class="settings-row">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--ink)">${window.escHtml(w.title)}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:2px;font-family:'DM Mono',monospace">${window.escHtml(w.id)}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${visible?'checked':''} onchange="this.checked ? showWidgetById('${scope}','${w.id}') : hideWidgetById('${scope}','${w.id}')">
          <span class="toggle-slider"></span>
        </label>
      </div>`;
  }).join('');
  showModal(scope === 'dash' ? 'Manage dashboard widgets' : 'Manage report widgets', `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:14px;line-height:1.5">Toggle a widget off to remove it from the layout. Drag the widget headers on the page to rearrange. Order and visibility are saved per browser.</div>
    ${body}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--rule);text-align:right">
      <button class="btn btn-sm btn-danger" onclick="resetWidgetLayout('${scope}')">Reset to default</button>
    </div>
  `, null, null);
}

// ─── Customer modals ─────────────────────────────────────────────────────────
// Four modal stubs that were physically wedged in app.js next to other
// inline-onclick stubs, but all touch customer data:
//   - showGDPRModal       (triggered from ticket detail's customer-info panel)
//   - openCustomerModal   (compact customer card, opened from search results)
//   - showCSVModal        (CSV import affordance on the customers list)
//   - showNewCustomerModal (creates a new CUSTOMERS row + refreshes the table)
//
// CUSTOMERS comes from data.js via the global lexical env. refreshCustTable
// is imported from the customers list module.

import { showModal, closeModal } from '../core/modal.js';
import { refreshCustTable } from './index.js';

export function showGDPRModal(id) {
  showModal('GDPR actions', `
    <div class="gdpr-action"><div class="gdpr-action-title">Request erasure</div><div class="gdpr-action-desc">Permanently delete this customer's personal data under Article 17.</div><button class="btn btn-sm btn-danger" onclick="closeModal()">Request erasure</button></div>
    <div class="gdpr-action"><div class="gdpr-action-title">Redact in-thread data</div><div class="gdpr-action-desc">Mask PII in this ticket's messages.</div><button class="btn btn-sm" onclick="closeModal()">Redact</button></div>
    <div class="gdpr-action"><div class="gdpr-action-title">SAR export</div><div class="gdpr-action-desc">Export all data held about this customer.</div><button class="btn btn-sm" onclick="closeModal()">Export</button></div>
  `, null, null);
}

export function openCustomerModal(custId) {
  const c = CUSTOMERS.find(x => x.id === custId); if (!c) return;
  showModal(`${c.first} ${c.last}`, `
    <div class="ts-row"><span class="ts-key">Customer ID</span><span class="ts-val">${c.id}</span></div>
    <div class="ts-row"><span class="ts-key">Email</span><span class="ts-val">${c.email}</span></div>
    <div class="ts-row"><span class="ts-key">Mobile</span><span class="ts-val">${c.mobile}</span></div>
    <div class="ts-row"><span class="ts-key">Brand</span><span class="ts-val">${c.brand}</span></div>
    <div class="ts-row"><span class="ts-key">VIP</span><span class="vip-badge vip-${c.vip.toLowerCase()}">${c.vip}</span></div>
    <div class="ts-row"><span class="ts-key">Jurisdiction</span><span class="ts-val">${c.jurisdiction}</span></div>
    <div class="ts-row"><span class="ts-key">KYC</span><span class="ts-val">${c.kyc}</span></div>
    <div class="ts-row"><span class="ts-key">Customer since</span><span class="ts-val">${c.since}</span></div>
  `, null, null);
}

export function showCSVModal() {
  showModal('CSV import', `<div class="attach-zone">Drop a CSV file or click to upload</div><div style="font-size:11px;color:var(--ink3);margin-top:10px">Expected columns: id, first, last, email, brand, vip, jurisdiction</div>`, () => closeModal(), 'Import');
}

export function showNewCustomerModal() {
  showModal('New customer', `
    <div class="form-grid">
      <div class="form-row"><label class="form-label">First name</label><input class="form-input" id="nc-first"/></div>
      <div class="form-row"><label class="form-label">Last name</label><input class="form-input" id="nc-last"/></div>
    </div>
    <div class="form-row"><label class="form-label">Email</label><input class="form-input" id="nc-email" type="email"/></div>
    <div class="form-row"><label class="form-label">Brand</label><input class="form-input" id="nc-brand"/></div>
  `, () => {
    const first = document.getElementById('nc-first').value.trim();
    const last  = document.getElementById('nc-last').value.trim();
    if (!first || !last) return;
    const id = 'M' + String(CUSTOMERS.length + 1).padStart(3,'0');
    CUSTOMERS.push({id,first,last,username:(first[0]+last).toLowerCase(),email:document.getElementById('nc-email').value,mobile:'',brand:document.getElementById('nc-brand').value,vip:'Bronze',jurisdiction:'UK',consent:true,kyc:'Pending',since:new Date().toISOString().slice(0,10),bo:'',custom:{}});
    closeModal(); refreshCustTable(CUSTOMERS);
  }, 'Create');
}

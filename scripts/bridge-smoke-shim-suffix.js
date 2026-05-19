// Appended AFTER the bundle. Bundle has just executed in script scope, so
// state.js declarations are bare-name visible. The bridge populated window.
// Exercise every route to catch missing-export / dead-reference bugs.

if (typeof window.renderPage !== 'function') {
  console.error('renderPage is not on window — bridge broken');
  process.exit(1);
}
console.log('init OK — bridge populated');

const _routes = [
  'dashboard', 'tickets', 'reports', 'customers',
  'agents', 'kb', 'inbox', 'channels', 'webhooks',
  'workflows', 'tags', 'roles', 'settings', 'help',
  'notifications', 'profile', 'layouts', 'custom-fields',
  'ticket-templates', 'kb-integration', 'business-hours',
  'sla-policies', 'assignment-rules', 'templates', 'macros',
];

let _failed = 0;
for (const _r of _routes) {
  try {
    window.renderPage(_r);
    console.log(`  renderPage('${_r}') OK`);
  } catch (e) {
    _failed++;
    console.error(`  renderPage('${_r}') FAILED: ${e.message}`);
  }
}

if (_failed > 0) {
  console.error(`\n${_failed}/${_routes.length} routes failed`);
  process.exit(1);
}
console.log(`\nALL ${_routes.length} routes rendered without throwing.`);

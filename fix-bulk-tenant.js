const fs = require('fs');
let js = fs.readFileSync('public/js/admin-dashboard.js', 'utf8');

// Perbaiki bulk generate function
js = js.replace(
  "tenant_id: window.currentTenantId,",
  "// Get first available tenant or all for admin\n     const tenantId = window.currentTenantId || await (async () => {\n       const res = await fetch('/api/tenants', { headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` } });\n       const data = await res.json();\n       return data.data?.[0]?.tenant_id || '';\n     })();\n     if (!tenantId) { Swal.fire('Error', 'Tidak ada tenant tersedia', 'error'); return; }\n     const tenant_id = tenantId;"
);

fs.writeFileSync('public/js/admin-dashboard.js', js);
console.log('Fixed');
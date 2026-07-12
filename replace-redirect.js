const fs = require('fs');
const c = fs.readFileSync('public/js/admin-dashboard.js', 'utf8');
const c2 = c.replace(/window\.location\.replace\('login\.html'\)/g, '// window.location.replace("login.html")')
           .replace(/window\.location\.href = 'login\.html'/g, '// window.location.href = "login.html"')
           .replace(/window\.location\.replace\('\/login\.html'\)/g, '// window.location.replace("/login.html")');
fs.writeFileSync('public/js/admin-dashboard.js', c2);
console.log('done');
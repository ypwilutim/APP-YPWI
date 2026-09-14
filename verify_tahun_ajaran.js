const fs = require('fs');
const path = require('path');

const BASE = '/run/media/akbar-irwansya/Home/APP-YPWI/APP-YPWI';
let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

console.log('=== Verification: Tahun Ajaran Implementation ===\n');

// 1. JS Syntax Checks
console.log('--- JS Syntax Checks ---');
const jsFiles = [
  'server.js',
  'src/utils/billing.js',
  'src/routes/tahun-ajaran.js',
  'src/routes/treasurer.js',
  'src/routes/admin.js'
];
for (const f of jsFiles) {
  const fp = path.join(BASE, f);
  try {
    require('child_process').execSync(`node -c "${fp}"`, { stdio: 'pipe' });
    check(`${f}: syntax OK`, true);
  } catch (e) {
    check(`${f}: syntax OK`, false);
  }
}

// 2. Server.js Route Registration
console.log('\n--- Server.js Route Registration ---');
const serverJs = fs.readFileSync(path.join(BASE, 'server.js'), 'utf8');
check('server.js: requires tahun-ajaran route', serverJs.includes("require('./src/routes/tahun-ajaran')"));
check('server.js: mounts tahunAjaranRoutes', serverJs.includes('app.use(\'/api\', tahunAjaranRoutes)'));
check('server.js: tahunAjaranRoutes variable declared', serverJs.includes('const tahunAjaranRoutes'));

// 3. Billing.js Functions
console.log('\n--- Billing.js Functions ---');
const billingJs = fs.readFileSync(path.join(BASE, 'src/utils/billing.js'), 'utf8');
const billingFns = [
  'getActiveTahunAjaran',
  'getTahunAjaranById',
  'getSemesterByTahunAjaran',
  'generateBillingByTahunAjaran',
  'generateBillingBySemester',
  'getMonthsInRange'
];
for (const fn of billingFns) {
  check(`billing.js: ${fn} defined`, billingJs.includes(`async function ${fn}`) || billingJs.includes(`function ${fn}`));
}
check('billing.js: exports TA functions', billingJs.includes('getActiveTahunAjaran') && billingJs.includes('generateBillingByTahunAjaran'));
check('billing.js: tahun_ajaran_id in billing_payment ALTER', billingJs.includes('tahun_ajaran_id') && billingJs.includes('semester_id'));

// 4. Tahun Ajaran Route
console.log('\n--- Tahun Ajaran Route ---');
const taRoute = fs.readFileSync(path.join(BASE, 'src/routes/tahun-ajaran.js'), 'utf8');
const taEndpoints = [
  { pattern: "router.get('/admin/tahun-ajaran'", desc: 'GET list' },
  { pattern: "router.get('/admin/tahun-ajaran/:id'", desc: 'GET detail' },
  { pattern: "router.post('/admin/tahun-ajaran'", desc: 'POST create' },
  { pattern: "router.put('/admin/tahun-ajaran/:id'", desc: 'PUT update' },
  { pattern: "router.delete('/admin/tahun-ajaran/:id'", desc: 'DELETE' },
  { pattern: "router.get('/admin/tahun-ajaran/current'", desc: 'GET current' }
];
for (const ep of taEndpoints) {
  check(`tahun-ajaran.js: ${ep.desc} endpoint`, taRoute.includes(ep.pattern));
}
check('tahun-ajaran.js: uses authenticateOperator', taRoute.includes('authenticateOperator'));
check('tahun-ajaran.js: queries tahun_ajaran table', taRoute.includes('tahun_ajaran'));
check('tahun-ajaran.js: queries semester table', taRoute.includes('semester'));

// 5. Treasurer.js Generate by TA
console.log('\n--- Treasurer.js ---');
const trJs = fs.readFileSync(path.join(BASE, 'src/routes/treasurer.js'), 'utf8');
check('treasurer.js: requires billing module', trJs.includes("require('../utils/billing')"));
check('treasurer.js: generateBillingByTahunAjaran call', trJs.includes('generateBillingByTahunAjaran'));

// 6. Admin.js Auto-billing
console.log('\n--- Admin.js Auto-billing ---');
const adminJs = fs.readFileSync(path.join(BASE, 'src/routes/admin.js'), 'utf8');
check('admin.js: requires billing module', adminJs.includes("require('../utils/billing')"));
check('admin.js: generateBillingByTahunAjaran call', adminJs.includes('generateBillingByTahunAjaran'));
check('admin.js: req.body.tahun_ajaran_id check', adminJs.includes('tahun_ajaran_id'));

// 7. SQL Files
console.log('\n--- SQL Files ---');
const hostingSql = fs.readFileSync(path.join(BASE, 'struktur_db_hosting.sql'), 'utf8');
const localSql = fs.readFileSync(path.join(BASE, 'struktur_db_local.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(BASE, 'migrations/add_tahun_ajaran.sql'), 'utf8');

check('hosting.sql: tahun_ajaran CREATE TABLE', hostingSql.includes('CREATE TABLE `tahun_ajaran`'));
check('hosting.sql: semester CREATE TABLE', hostingSql.includes('CREATE TABLE `semester`'));
check('hosting.sql: ALTER classes (tahun_ajaran_id)', hostingSql.includes('ALTER TABLE `classes`') && hostingSql.includes('tahun_ajaran_id'));
check('hosting.sql: ALTER students (tahun_ajaran_id)', hostingSql.includes('ALTER TABLE `students`') && hostingSql.includes('tahun_ajaran_id'));
check('hosting.sql: ALTER billing_payment (tahun_ajaran_id)', hostingSql.includes('ALTER TABLE `billing_payment`') && hostingSql.includes('tahun_ajaran_id'));
check('hosting.sql: ALTER student_attendance (tahun_ajaran_id)', hostingSql.includes('ALTER TABLE `student_attendance`') && hostingSql.includes('tahun_ajaran_id'));
check('hosting.sql: ALTER student_education_history (tahun_ajaran_id)', hostingSql.includes('student_education_history') && hostingSql.includes('tahun_ajaran_id'));

check('local.sql: tahun_ajaran CREATE TABLE IF NOT EXISTS', localSql.includes('CREATE TABLE IF NOT EXISTS `tahun_ajaran`'));
check('local.sql: semester CREATE TABLE IF NOT EXISTS', localSql.includes('CREATE TABLE IF NOT EXISTS `semester`'));
check('local.sql: ALTER classes (tahun_ajaran_id)', localSql.includes('tahun_ajaran_id') && localSql.includes('classes'));
check('local.sql: ALTER students (tahun_ajaran_id)', localSql.includes('tahun_ajaran_id') && localSql.includes('students'));

check('migration.sql: all 17 sections present', migrationSql.includes('CREATE TABLE IF NOT EXISTS `tahun_ajaran`') && migrationSql.includes('CREATE TABLE IF NOT EXISTS `semester`') && migrationSql.includes('ALTER TABLE `classes`') && migrationSql.includes('ALTER TABLE `students`') && migrationSql.includes('ALTER TABLE `billing_payment`'));

// 8. Cross-reference consistency
console.log('\n--- Cross-reference Consistency ---');
check('billing.js exports match route usage', 
  billingJs.includes('module.exports') && 
  billingJs.includes('getActiveTahunAjaran') &&
  billingJs.includes('generateBillingByTahunAjaran')
);
check('tahun-ajaran.js imports db', taRoute.includes("require('../../db')"));
check('tahun-ajaran.js imports auth middleware', taRoute.includes('require(../middleware/auth') || taRoute.includes("require('../middleware/auth')"));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

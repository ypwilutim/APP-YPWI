require('../db').initializeDatabase().then(async () => {
  const db = require('../db');

  // Test exact same query as in route
  let tenantId = 'SDITIR';
  let incomeQuery = `
    SELECT 
      s.tenant_id,
      COALESCE(SUM(CASE WHEN ip.status = 'Success' THEN ip.total_amount ELSE 0 END), 0) as total_pemasukan
    FROM incoming_payments ip
    LEFT JOIN students s ON ip.matched_student_id = s.id
  `;
  let incomeParams = [];

  if (tenantId) {
    incomeQuery += ' WHERE s.tenant_id = ?';
    incomeParams.push(tenantId);
  }

  incomeQuery += ' GROUP BY s.tenant_id';

  console.log('SQL:', incomeQuery);
  console.log('Params:', incomeParams);
  const incomeData = await db.query(incomeQuery, incomeParams);
  console.log('Income result:', incomeData);
  console.log('Income length:', incomeData.length);

  process.exit(0);
});
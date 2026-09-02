const mysql=require('mysql2/promise');
(async()=>{
  let c;
  try{
    c=await mysql.createConnection({host:'localhost',port:3306,user:'ypwh2917_developer',password:'@Ypwi123',database:'ypwh2917_ypwi_absensi'});
    let [r]=await c.execute("SELECT teacher_id, jabatan_di_unit FROM teacher_assignments WHERE tenant_id='YPWILUTIM' AND LOWER(jabatan_di_unit) LIKE '%ketua%'");
    console.log('KETUA@YPWILUTIM:', JSON.stringify(r));
    [r]=await c.execute("SELECT DISTINCT jabatan_di_unit FROM teacher_assignments WHERE tenant_id='YPWILUTIM'");
    console.log('ALL YPWILUTIM jabatan:', JSON.stringify(r));
    [r]=await c.execute("SELECT id, username, role FROM users WHERE role='admin' LIMIT 20");
    console.log('ADMIN users:', JSON.stringify(r));
  }catch(e){console.log('DBERR',e.message);}
  finally{if(c)await c.end();}
})();

const jwt=require('jsonwebtoken');
const http=require('http');
const SECRET='ypwi-secret-key-2026';
const now=Math.floor(Date.now()/1000);
const BASE='http://localhost:3000';
function tok(p){return jwt.sign({...p,iat:now,exp:now+8*3600},SECRET,{algorithm:'HS256'});}
const ketua={id:54,username:'ketua@ypwilutim.com',role:'guru',guru_id:54,tenant_id:'YPWILUTIM',assignments:[{tenant_id:'YPWILUTIM',jabatan_di_unit:'Ketua',nama_sekolah:'YPWI Lutim'}]};
const nonKetua={id:117,username:'akbarirwansyahtkk@gmail.com',role:'guru',guru_id:95,tenant_id:'YPWILUTIM',assignments:[
  {tenant_id:'SDITIR',jabatan_di_unit:'admin',nama_sekolah:'SDIT Irpan'},
  {tenant_id:'SDITIR',jabatan_di_unit:'bendahara',nama_sekolah:'SDIT Irpan'},
  {tenant_id:'SDITIR',jabatan_di_unit:'Kepala Sekolah',nama_sekolah:'SDIT Irpan'},
  {tenant_id:'YPWILUTIM',jabatan_di_unit:'admin',nama_sekolah:'YPWI Lutim'},
  {tenant_id:'YPWILUTIM',jabatan_di_unit:'bendahara',nama_sekolah:'YPWI Lutim'},
  {tenant_id:'YPWILUTIM',jabatan_di_unit:'Kepala Sekolah',nama_sekolah:'YPWI Lutim'}
]};
function req(url,t){return new Promise((res,rej)=>{const r=http.get(BASE+url,{headers:{Authorization:'Bearer '+t,Accept:'application/json'}},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({s:x.statusCode,b}));});r.on('error',rej);});}
function post(url,t){return new Promise((res,rej)=>{const r=http.request(BASE+url,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'}},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({s:x.statusCode,b}));});r.on('error',rej);r.end('{}');});}
(async()=>{
  try{
    for(const [label,u] of [['KETUA(54)',ketua],['NON-KETUA(95)',nonKetua]]){
      const t=tok(u);
      console.log(`\n=== ${label} (guru_id=${u.guru_id}) ===`);
      for(const [n,f,u2] of [
        ['yayasan-summary',req,'/api/evaluations/yayasan-summary'],
        ['evaluations/all',req,'/api/evaluations/all'],
        ['evaluations/summary',req,'/api/evaluations/summary'],
        ['evaluations(GET)',req,'/api/evaluations'],
        ['auto-calculate',post,'/api/evaluations/auto-calculate'],
        ['admin/summary',req,'/api/admin/summary'],
        ['admin/tenants',req,'/api/admin/tenants'],
        ['teachers',req,'/api/teachers']
      ]){
        const r=await f(u2,t);
        let msg=''; try{const j=JSON.parse(r.b); msg=`count=${Array.isArray(j.data)?j.data.length:('success='+j.success)}`}catch(e){msg=r.b.slice(0,90)}
        console.log(`  ${n.padEnd(20)} -> HTTP ${r.s} | ${msg}`);
      }
    }
  }catch(e){console.log('ERR',e.message);}
})();

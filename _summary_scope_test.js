const jwt=require('jsonwebtoken');
const http=require('http');
const SECRET='ypwi-secret-key-2026';
const now=Math.floor(Date.now()/1000);
const BASE='http://localhost:3000';
// NO assignments in token -> forces resolveLeaderTenant DB path
const tok=jwt.sign({id:117,username:'akbarirwansyahtkk@gmail.com',role:'guru',guru_id:95,tenant_id:'YPWILUTIM'},SECRET,{expiresIn:'8h',algorithm:'HS256'});
function get(u){return new Promise((res,rej)=>{const r=http.get(BASE+u,{headers:{Authorization:'Bearer '+tok}},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({s:x.statusCode,b}));});r.on('error',rej);});}
(async()=>{
  try{
    for(const u of ['/api/evaluations/summary?tenant_id=YPWILUTIM','/api/evaluations/summary','/api/evaluations/summary?tenant_id=SDITIR','/api/evaluations/all']){
      const r=await get(u);
      let msg=''; try{const j=JSON.parse(r.b); msg=`count=${Array.isArray(j.data)?j.data.length:(j.success?'ok':'-')} success=${j.success}`}catch(e){msg=r.b.slice(0,80)}
      console.log(u.padEnd(40), '-> HTTP',r.s,'|',msg);
    }
  }catch(e){console.log('ERR',e.message);}
})();

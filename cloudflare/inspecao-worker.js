/**
 * ANFEER / Cloudflare Worker
 * Route: https://consultoriarf.net/anfeer/inspecao-api*
 * Server-side proxy to Apps Script, bypassing browser-side cross-origin Google redirects.
 *
 * Deploy with a Worker Route on the Cloudflare zone of consultoriarf.net.
 * Restrict publicly accessible write endpoints before production rollout.
 */
const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbyhvjEly4JGYXKPybayZCizhcl6afl-xpA6ICQfHRAUbGAjFqxFkaPuyrVI5Gx8Y_qV/exec';
const ALLOWED_ORIGINS = new Set(['https://consultoriarf.net','https://www.consultoriarf.net']);
const READS = new Set(['ping','planos','plano_operador','historico']);
const WRITES = new Set(['salvar_plano','salvar_inspecao']);

function response(obj, status=200, origin=''){
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Vary':'Origin'
  };
  if(ALLOWED_ORIGINS.has(origin))headers['Access-Control-Allow-Origin']=origin;
  return new Response(JSON.stringify(obj),{status,headers});
}

async function upstream(method, pathParams, body, ctx) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('Timeout de 20 segundos'),20000);
  try{
    const url=new URL(APPS_SCRIPT);
    if(method==='GET'){
      for(const [k,v] of pathParams.entries()){
        if(!['callback','pin','token','read_action'].includes(k))url.searchParams.set(k,v);
      }
    }
    let resp=await fetch(url.toString(),{
      method, body:method==='POST'?body:undefined,
      headers: method==='POST'?{'Content-Type':'text/plain; charset=utf-8'}:undefined,
      redirect:'manual', cache:'no-store', signal:controller.signal
    });
    for(let i=0;i<4 && resp.status>=300&&resp.status<400;i++){
      const loc=resp.headers.get('Location');
      if(!loc)break;
      const next=new URL(loc,resp.url);
      const hostname=next.hostname.toLowerCase();
      if(hostname!=='script.google.com' && hostname!=='script.googleusercontent.com' && !hostname.endsWith('.googleusercontent.com'))throw Error('Redirecionamento não permitido');
      // Apps Script's ContentService redirects POST responses to one-time GET links.
      resp=await fetch(next.toString(),{method:'GET',redirect:'manual',cache:'no-store',signal:controller.signal});
    }
    if(!resp.ok)throw Error('Apps Script respondeu HTTP '+resp.status);
    const txt=await resp.text();
    let parsed;
    try{parsed=JSON.parse(txt)}catch(e){
      if(/<html|<!doctype/i.test(txt))throw Error('Apps Script devolveu uma página HTML. Verifique permissões da implantação.');
      throw Error('Resposta do Apps Script não está em JSON');
    }
    if(!parsed||typeof parsed!=='object')throw Error('Resposta inválida do Apps Script');
    return parsed;
  }finally{clearTimeout(timer)}
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url),origin=request.headers.get('Origin')||'';
  if(request.method==='OPTIONS') {
    if(!ALLOWED_ORIGINS.has(origin))return response({ok:false,error:'Origem não permitida'},403,origin);
    return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Max-Age':'600',
      'Vary':'Origin'
    }});
  }
  if(!['GET','POST'].includes(request.method))return response({ok:false,error:'Método não permitido'},405,origin);
  try{
   if(request.method==='GET'){
     const action=u.searchParams.get('action')||'ping';
     if(!READS.has(action))return response({ok:false,error:'Ação inválida'},400,origin);
     return response(await upstream('GET',u.searchParams,null,ctx),200,origin);
   }
   if(!ALLOWED_ORIGINS.has(origin))return response({ok:false,error:'Origem inválida para gravação'},403,origin);
   const raw=await request.text();
   if(raw.length>50000)return response({ok:false,error:'Envio muito grande'},413,origin);
   let data;
   try{data=JSON.parse(raw)}catch(e){return response({ok:false,error:'JSON inválido'},400,origin)}
   if(!WRITES.has(data?.action))return response({ok:false,error:'Ação não autorizada'},400,origin);
   return response(await upstream('POST',new URLSearchParams(),JSON.stringify(data),ctx),200,origin);
  }catch(e){return response({ok:false,error:String(e?.message||e)},502,origin)}
 }
};

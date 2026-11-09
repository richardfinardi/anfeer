/**
 * ANFEER / Cloudflare Worker
 * Route: https://consultoriarf.net/anfeer/inspecao-api*
 * Server-side proxy to Apps Script, bypassing browser-side cross-origin Google redirects.
 *
 * Deploy with a Worker Route on the Cloudflare zone of consultoriarf.net.
 * Restrict publicly accessible write endpoints before production rollout.
 */
// ID extraído da URL do canal informada pelo responsável pela ANFEER.
// A rota /hermitage/v1/channels/{id} identifica o canal; o endpoint
// de envio de mensagens, segundo a documentação oficial Omni, é /v1/channels/{id}/messages.
const OMNI_CHANNEL_ID = '01A1C1624E387B6AB07BEFF201530C11';
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

// Alerta WhatsApp Z-API Omni. As credenciais devem ser Secrets do Cloudflare,
// nunca expostas no GitHub ou no navegador.
function omniRecipients(env){
  return [...new Set(
    String(env.OMNI_DESTINATARIOS||'').split(/[;,\n]+/)
      .map(v=>v.trim().replace(/\D/g,''))
      .filter(v=>/^\d{10,15}$/.test(v))
  )].slice(0,15);
}
function omniReady(env){
  return Boolean(String(env.OMNI_SECRET_KEY||'').trim() && omniRecipients(env).length);
}
function fmtTimeBrasil(dateString){
  const dt=new Date(dateString||Date.now());
  if(Number.isNaN(dt.getTime()))return String(dateString||'');
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(dt);
}
function rejectionMessage(request, saved){
  const clean=v=>String(v??'').replace(/[<>]/g,'').slice(0,180);
  const falhas=Array.isArray(saved.falhas)?saved.falhas.slice(0,12):[];
  const corpo=[
    '*ANFEER | INSPEÇÃO REPROVADA*',
    '',
    '*Peça:* '+clean(request.peca),
    '*Processo:* '+clean(request.processo),
    '*Máquina:* '+clean(request.maquina),
    '*Funcionário:* '+clean(request.funcionario),
    '*Data/hora:* '+fmtTimeBrasil(saved.dataHora)
  ];
  if(falhas.length){
    corpo.push('','*Parâmetros reprovados:*');
    for(const f of falhas){
      corpo.push('• '+clean(f.parametro)+(f.medida!==null&&f.medida!==undefined?' | medido: '+clean(f.medida):''));
    }
  }
  corpo.push('','Verificar a não conformidade no controle de inspeções.');
  return corpo.join('\n');
}
async function omniNotify(env, payload, saved){
  const recipients=omniRecipients(env);
  if(!recipients.length)throw Error('OMNI_DESTINATARIOS sem telefone válido (DDI+DDD+número)');
  const channel=String(env.OMNI_CHANNEL_ID||OMNI_CHANNEL_ID).trim();
  if(!/^[A-Za-z0-9_-]+$/.test(channel))throw Error('Channel ID da Omni inválido');
  const endpoint='https://api.omni.z-api.io/v1/channels/'+encodeURIComponent(channel)+'/messages';
  const message=rejectionMessage(payload,saved);
  console.log('ANFEER WhatsApp: iniciando envio', {inspecao:saved.id, resultado:saved.resultado, destinos:recipients.length});
  // Envie para todos em paralelo: waitUntil tem janela limitada depois da resposta.
  // Uma API lenta não deve bloquear o segundo ou terceiro destinatário.
  const attempts=recipients.map(async recipient=>{
    const dest=recipient.slice(-4); // Os logs nunca exibem o telefone completo.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),12000);
    try{
      const res=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OMNI_SECRET_KEY},
        body:JSON.stringify({recipient:{identifier:recipient},content:{type:'TEXT',body:{message}}}),
        signal:ctrl.signal
      });
      const raw=(await res.text()).slice(0,4000);
      let info=null;
      try{info=raw?JSON.parse(raw):null}catch(_){}
      const body=info&&typeof info==='object'?info:{};
      const messageId=body.messageId||body.data?.messageId||body.id||body.data?.id||null;
      const status=body.status||body.data?.status||null;
      const error=body.error||body.message||body.data?.error||null;
      const trace={inspecao:saved.id,destinoFinal:dest,http:res.status,messageId,status};
      if(!res.ok||body.success===false||body.ok===false){
        console.error('ANFEER WhatsApp RECUSADO',JSON.stringify({...trace,error:String(error||'Sem detalhe').slice(0,180)}));
        return {dest,aceito:false,http:res.status};
      }
      if(!messageId){
        console.warn('ANFEER WhatsApp ACEITO SEM ID - entrega não confirmada',JSON.stringify({...trace,camposResposta:Object.keys(body).slice(0,12)}));
      }else{
        console.log('ANFEER WhatsApp ACEITO PELA OMNI (não confirma entrega)',JSON.stringify(trace));
      }
      return {dest,aceito:true,http:res.status};
    }catch(err){
      console.error('ANFEER WhatsApp ERRO DE ENVIO',JSON.stringify({inspecao:saved.id,destinoFinal:dest,erro:String(err)}));
      return {dest,aceito:false,erro:String(err)};
    }finally{
      clearTimeout(timer);
    }
  });
  const resultados=await Promise.all(attempts);
  console.log('ANFEER WhatsApp RESUMO',JSON.stringify({
    inspecao:saved.id,
    previstos:recipients.length,
    aceitos:resultados.filter(x=>x.aceito).length,
    falhas:resultados.filter(x=>!x.aceito).map(x=>x.dest),
    lembrete:'Aceito pela API não é confirmação de entrega no WhatsApp.'
  }));
}


// Webhook de status de entrega da Omni (assinatura HMAC-SHA256 oficial).
// O segredo de assinatura NÃO é a OMNI_SECRET_KEY de envio.
async function omniWebhook(request, env){
  const secret=String(env.OMNI_WEBHOOK_SIGNING_SECRET||'').trim();
  if(!secret)return new Response('Webhook ainda não configurado',{status:503});
  const signature=request.headers.get('x-webhook-signature')||'';
  const idem=request.headers.get('x-idempotency-key')||'';
  const mt=signature.match(/(?:^|,)\s*t=(\d+)(?:,|$)/);
  const mv=signature.match(/(?:^|,)\s*v1=([a-fA-F0-9]{64})(?:,|$)/);
  const parts=idem.match(/^(.*):([^:]+):([^:]+)$/);
  if(!mt||!mv||!parts||Math.abs(Date.now()/1000-Number(mt[1]))>300){
    return new Response('Assinatura ausente ou expirada',{status:401});
  }
  let body=new Uint8Array(await request.arrayBuffer());
  if(request.headers.get('content-encoding')?.toLowerCase()==='gzip'){
    const stream=new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'));
    body=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if(body.length>200_000)return new Response('Corpo muito grande',{status:413});
  const prefix=new TextEncoder().encode([mt[1],parts[1],parts[2],parts[3],''].join('\n'));
  const canonical=new Uint8Array(prefix.length+body.length);
  canonical.set(prefix,0);
  canonical.set(body,prefix.length);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,canonical));
  const sig=mv[1].toLowerCase();
  const expected=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  let diff=0;
  for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);
  if(diff!==0)return new Response('Assinatura inválida',{status:401});
  let data;
  try{data=JSON.parse(new TextDecoder().decode(body))}catch(e){return new Response('JSON inválido',{status:400})}
  const events=Array.isArray(data)?data:[data];
  for(const event of events.slice(0,40)){
    const message=event?.message||event?.data?.message||event?.data||{};
    const items=[...(Array.isArray(message.contents)?message.contents:[]),...(Array.isArray(message.attachments)?message.attachments:[])];
    const states=items.flatMap(x=>Array.isArray(x.state_items)?x.state_items:[])
      .map(x=>String(x?.state?.name||x?.state||'')).filter(Boolean);
    const messageId=String(message._id||message.messageId||event?.messageId||message.id||'').slice(0,80);
    const recipient=String(message?.recipient?.identifier||event?.recipient?.identifier||'').replace(/\D/g,'');
    const state=String(event?.status||event?.state?.name||message?.status||states.at(-1)||'SEM_STATUS').slice(0,80);
    const eventType=String(event?.messageEventType||event?.event||event?.type||'STATUS').slice(0,80);
    console.log('ANFEER OMNI WEBHOOK STATUS',JSON.stringify({
      messageId,recipientFinal:recipient.slice(-4),state,eventType,
      deliveryId:(request.headers.get('x-webhook-delivery-id')||'').slice(0,100),
      states
    }));
  }
  return new Response('ok',{status:200});
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url),origin=request.headers.get('Origin')||'';
  if(u.pathname==='/omni-webhook' && request.method==='POST'){
    try{return await omniWebhook(request,env)}
    catch(e){console.error('ANFEER OMNI WEBHOOK ERRO',String(e));return new Response('Falha ao receber webhook',{status:500})}
  }
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
     if(action==='whatsapp_status'){
       const quantidade=omniRecipients(env).length;
       return response({
         ok:true,
         configurado:omniReady(env),
         destinatarios:quantidade,
         chavePresente:Boolean(String(env.OMNI_SECRET_KEY||'').trim()),
         destinoPresente:Boolean(String(env.OMNI_DESTINATARIOS||'').trim()),
         destinoValido:quantidade>0,
         canalConfigurado:!!(env.OMNI_CHANNEL_ID||OMNI_CHANNEL_ID)
       },200,origin);
     }
     if(!READS.has(action))return response({ok:false,error:'Ação inválida'},400,origin);
     return response(await upstream('GET',u.searchParams,null,ctx),200,origin);
   }
   if(!ALLOWED_ORIGINS.has(origin))return response({ok:false,error:'Origem inválida para gravação'},403,origin);
   const raw=await request.text();
   if(raw.length>50000)return response({ok:false,error:'Envio muito grande'},413,origin);
   let data;
   try{data=JSON.parse(raw)}catch(e){return response({ok:false,error:'JSON inválido'},400,origin)}
   if(!WRITES.has(data?.action))return response({ok:false,error:'Ação não autorizada'},400,origin);
   const saved=await upstream('POST',new URLSearchParams(),JSON.stringify(data),ctx);
   if(data.action==='salvar_inspecao'&&saved?.ok&&saved.resultado==='REPROVADO'&&!saved.jaRegistrada){
     if(omniReady(env)){
       ctx.waitUntil(omniNotify(env,data,saved).catch(err=>console.error('Erro ao notificar inspeção',saved.id,String(err))));
       return response({...saved,alertaWhatsapp:'envio_solicitado'},200,origin);
     }
     return response({...saved,alertaWhatsapp:'nao_configurado'},200,origin);
   }
   return response(saved,200,origin);
  }catch(e){return response({ok:false,error:String(e?.message||e)},502,origin)}
 }
};

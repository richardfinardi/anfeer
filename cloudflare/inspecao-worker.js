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
const READS = new Set(['ping','planos','plano_operador','historico','relatorio_inspecoes','relatorio_detalhe']);
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

// Cadastro persistente de telefones no KV, editado exclusivamente pela administração.
// Sem registro salvo, preserva OMNI_DESTINATARIOS para não interromper envios atuais.
const RECIPIENTS_KEY='whatsapp_recipients_v1';
function legacyRecipientRecords(env){
  return [...new Set(
    String(env.OMNI_DESTINATARIOS||'').split(/[;,\n]+/)
      .map(v=>v.trim().replace(/\D/g,''))
      .filter(v=>/^\d{10,15}$/.test(v))
  )].slice(0,15).map(numero=>({nome:'Destinatário '+numero.slice(-4),numero,ativo:true}));
}
function validateRecipientRecords(data){
  if(!Array.isArray(data)||data.length>15)throw Error('Informe até 15 destinatários');
  const numbers=new Set();
  return data.map((item,i)=>{
    if(!item||typeof item!=='object')throw Error('Destinatário inválido: '+(i+1));
    const nome=String(item.nome||'').trim();
    const numero=String(item.numero||'').replace(/\D/g,'');
    if(!nome||nome.length>80)throw Error('Nome inválido no destinatário '+(i+1));
    if(!/^\d{10,15}$/.test(numero))throw Error('Use DDI + DDD + número no destinatário '+(i+1));
    if(typeof item.ativo!=='boolean')throw Error('Status inválido no destinatário '+(i+1));
    if(numbers.has(numero))throw Error('Número duplicado: final '+numero.slice(-4));
    numbers.add(numero);
    return {nome,numero,ativo:item.ativo};
  });
}
async function recipientRecords(env){
  if(!env.ANFEER_CONFIG?.get)return legacyRecipientRecords(env);
  const saved=await env.ANFEER_CONFIG.get(RECIPIENTS_KEY);
  if(saved===null)return legacyRecipientRecords(env);
  return validateRecipientRecords(JSON.parse(saved));
}
async function omniRecipients(env){
  return (await recipientRecords(env)).filter(x=>x.ativo).map(x=>x.numero);
}
async function omniReady(env){
  return Boolean(String(env.OMNI_SECRET_KEY||'').trim() && (await omniRecipients(env)).length);
}
// A senha da administração nunca é colocada no HTML ou em parâmetros da URL.
async function adminAuthorized(request,env){
  const expected=String(env.ANFEER_NOTIFICACOES_ADMIN_KEY||'');
  const received=request.headers.get('X-ANFEER-ADMIN-KEY')||'';
  if(expected.length<24||received.length<1||received.length>512)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(expected)),
    crypto.subtle.digest('SHA-256',enc.encode(received))
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let difference=0;
  for(let i=0;i<x.length;i++)difference|=x[i]^y[i];
  return difference===0;
}
async function adminGuard(request,env,origin){
  if(String(env.ANFEER_NOTIFICACOES_ADMIN_KEY||'').length<24)
    return response({ok:false,error:'Defina ANFEER_NOTIFICACOES_ADMIN_KEY (mínimo 24 caracteres) no Cloudflare'},503,origin);
  if(!env.ANFEER_CONFIG?.get||!env.ANFEER_CONFIG?.put)
    return response({ok:false,error:'Vincule o KV namespace ANFEER_CONFIG ao Worker'},503,origin);
  if(!await adminAuthorized(request,env))
    return response({ok:false,error:'Chave administrativa inválida'},401,origin);
  return null;
}

// Sessão do portal: usuário utiliza SOMENTE o login normal da ANFEER.
// O token é assinado pelo Worker e não pode ser gerado por localStorage ou /me.
const PORTAL_TOKEN_TTL=12*60*60;
const PORTAL_LOGIN_ENDPOINT='https://anfeer.consultoriarf.net/login';
const enc=new TextEncoder();
function b64url(bytes){
  let raw='';
  for(const n of bytes)raw+=String.fromCharCode(n);
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(src){
  if(!/^[A-Za-z0-9_-]+$/.test(src)||src.length>2400)throw Error('Token inválido');
  const data=atob(src.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-src.length%4)%4));
  return Uint8Array.from(data,x=>x.charCodeAt(0));
}
async function portalSigningKey(env){
  const secret=String(env.ANFEER_NOTIFICACOES_ADMIN_KEY||'');
  if(secret.length<24)throw Error('Configure o Secret administrativo no Cloudflare');
  return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function newPortalToken(usuario,env){
  const now=Math.floor(Date.now()/1000);
  const payload=b64url(enc.encode(JSON.stringify({v:1,sub:String(usuario).slice(0,120),iat:now,exp:now+PORTAL_TOKEN_TTL})));
  const signature=await crypto.subtle.sign('HMAC',await portalSigningKey(env),enc.encode(payload));
  return payload+'.'+b64url(new Uint8Array(signature));
}
async function portalSession(request,env){
  const m=(request.headers.get('Authorization')||'').match(/^Bearer ([A-Za-z0-9_-]{20,2000}\.[A-Za-z0-9_-]{40,100})$/);
  if(!m)return null;
  try{
    const [data,sig]=m[1].split('.');
    const verified=await crypto.subtle.verify('HMAC',await portalSigningKey(env),unb64url(sig),enc.encode(data));
    if(!verified)return null;
    const payload=JSON.parse(new TextDecoder().decode(unb64url(data)));
    const now=Math.floor(Date.now()/1000);
    if(payload.v!==1||!payload.sub||typeof payload.sub!=='string'||!Number.isSafeInteger(payload.iat)||
       !Number.isSafeInteger(payload.exp)||payload.iat>now+60||payload.exp<=now||
       payload.exp-payload.iat>PORTAL_TOKEN_TTL)return null;
    return payload;
  }catch(err){return null}
}
async function portalLogin(data,env,origin){
  const usuario=String(data.usuario||'').trim().toUpperCase();
  const senha=String(data.senha||'');
  if(!usuario||usuario.length>100||!senha||senha.length>256)return response({ok:false,error:'Informe usuário e senha válidos'},400,origin);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const login=await fetch(PORTAL_LOGIN_ENDPOINT,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario,senha}),
      cache:'no-store',signal:controller.signal});
    if(!login.ok)return response({ok:false,error:'Usuário ou senha incorretos'},401,origin);
    const user=await login.json();
    if(!user||typeof user!=='object'||Array.isArray(user)||user.ok===false||user.success===false||user.error) return response({ok:false,error:'Usuário ou senha incorretos'},401,origin);
    const token=await newPortalToken(usuario,env);
    return response({ok:true,user,token},200,origin);
  }finally{clearTimeout(timeout)}
}

function fmtTimeBrasil(dateString){
  const dt=new Date(dateString||Date.now());
  if(Number.isNaN(dt.getTime()))return String(dateString||'');
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(dt);
}
function rejectionMessage(request, saved){
  const clean=v=>String(v??'').replace(/[<>*]/g,'').slice(0,180);
  const numero=v=>{
    const n=typeof v==='number'?v:Number(String(v??'').replace(',','.'));
    return Number.isFinite(n)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(n):clean(v);
  };
  const falhas=Array.isArray(saved.falhas)?saved.falhas.slice(0,30):[];
  const titulo=clean(saved.titulo||request.titulo||'');
  const corpo=[
    '*ANFEER | INSPEÇÃO REPROVADA*',
    '',
    '*Peça:* '+clean(request.peca),
    ...(titulo?['*Nome:* '+titulo]:[]),
    '*Processo:* '+clean(request.processo),
    '*Máquina:* '+clean(request.maquina),
    '*Funcionário:* '+clean(request.funcionario),
    '*Data/hora:* '+fmtTimeBrasil(saved.dataHora)
  ];
  if(falhas.length){
    corpo.push('','*Parâmetros reprovados:*');
    for(const f of falhas){
      const tipo=String(f.tipo||'').toUpperCase();
      const nome=clean(f.parametro);
      if(tipo==='COTA'){
        corpo.push('','• *'+nome+'* (COTA)');
        if(f.nominal!==null && f.nominal!==undefined && f.nominal!=='')corpo.push('   Padrão: '+numero(f.nominal));
        if(f.minimo!==null && f.minimo!==undefined && f.maximo!==null && f.maximo!==undefined){
          corpo.push('   Permitido: '+numero(f.minimo)+' a '+numero(f.maximo));
        }
        corpo.push('   Encontrado: '+numero(f.medida));
      }else{
        corpo.push('• *'+nome+'* ('+clean(tipo||'VISUAL')+'): REPROVADO');
      }
    }
  }else{
    corpo.push('','*Resultado:* REPROVADO');
  }
  corpo.push('','Verificar a não conformidade no controle de inspeções.');
  return corpo.join('\n');
}
async function omniNotify(env, payload, saved){
  const recipients=await omniRecipients(env);
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
  if(!secret){console.error('ANFEER OMNI WEBHOOK SEM SECRET',JSON.stringify({motivo:'OMNI_WEBHOOK_SIGNING_SECRET_AUSENTE'}));return new Response('Webhook ainda não configurado',{status:503})}
  const signature=request.headers.get('x-webhook-signature')||'';
  const idem=request.headers.get('x-idempotency-key')||'';
  const mt=signature.match(/(?:^|,)\s*t=(\d+)(?:,|$)/);
  const mv=signature.match(/(?:^|,)\s*v1=([a-fA-F0-9]{64})(?:,|$)/);
  const parts=idem.match(/^(.*):([^:]+):([^:]+)$/);
  const eventId=(request.headers.get('x-webhook-event-id')||'').slice(0,100);
  const deliveryId=(request.headers.get('x-webhook-delivery-id')||'').slice(0,100);
  const skew=mt?Math.abs(Math.floor(Date.now()/1000)-Number(mt[1])):null;
  if(!mt||!mv||!parts||skew>300){
    console.error('ANFEER OMNI WEBHOOK 401',JSON.stringify({
      motivo: !mt?'TIMESTAMP_AUSENTE':!mv?'ASSINATURA_AUSENTE':!parts?'IDEMPOTENCIA_INVALIDA':'TIMESTAMP_FORA_DA_JANELA',
      eventId,deliveryId,skew,encoding:request.headers.get('content-encoding')||'none'
    }));
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
  if(diff!==0){
    console.error('ANFEER OMNI WEBHOOK 401',JSON.stringify({
      motivo:'HMAC_DIVERGENTE',
      eventId,deliveryId,skew,
      encoding:request.headers.get('content-encoding')||'none',
      bodyBytes:body.length,
      secretPresente:true
    }));
    return new Response('Assinatura inválida',{status:401});
  }
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
      'Access-Control-Allow-Headers':'Content-Type, X-ANFEER-ADMIN-KEY, Authorization',
      'Access-Control-Max-Age':'600',
      'Vary':'Origin'
    }});
  }
  if(!['GET','POST'].includes(request.method))return response({ok:false,error:'Método não permitido'},405,origin);
  try{
   if(request.method==='GET'){
     const action=u.searchParams.get('action')||'ping';
     if(action==='whatsapp_status'){
       const quantidade=(await omniRecipients(env)).length;
       return response({
         ok:true,
         configurado:await omniReady(env),
         destinatarios:quantidade,
         chavePresente:Boolean(String(env.OMNI_SECRET_KEY||'').trim()),
         destinoPresente:quantidade>0,
         destinoValido:quantidade>0,
         canalConfigurado:!!(env.OMNI_CHANNEL_ID||OMNI_CHANNEL_ID)
       },200,origin);
     }
     if(action==='portal_session'){
       const session=await portalSession(request,env);
       return session?response({ok:true,usuario:session.sub},200,origin):response({ok:false,error:'Sessão expirada. Entre no portal ANFEER.'},401,origin);
     }
     if(action==='whatsapp_destinatarios'){
       const denied=await adminGuard(request,env,origin);
       if(denied)return denied;
       return response({ok:true,destinatarios:await recipientRecords(env)},200,origin);
     }
     if(['relatorio_inspecoes','relatorio_detalhe'].includes(action)){
       const session=await portalSession(request,env);
       if(!session)return response({ok:false,error:'Entre no portal ANFEER para acessar os relatórios'},401,origin);
       // Preferir uma chave exclusiva, mas permitir o Secret administrativo
       // já existente para reduzir a configuração do serviço.
       const backendKey=String(env.ANFEER_RELATORIO_BACKEND_KEY||env.ANFEER_NOTIFICACOES_ADMIN_KEY||'');
       if(backendKey.length<24)return response({ok:false,error:'Configure ANFEER_RELATORIO_BACKEND_KEY no Worker e nas propriedades do Apps Script'},503,origin);
       const params=Object.fromEntries(u.searchParams);
       delete params.action;
       const result=await upstream('POST',new URLSearchParams(),JSON.stringify({action,...params,backendKey}),ctx);
       return response(result,result?.ok===false?400:200,origin);
     }
     if(!READS.has(action))return response({ok:false,error:'Ação inválida'},400,origin);
     return response(await upstream('GET',u.searchParams,null,ctx),200,origin);
   }
   if(!ALLOWED_ORIGINS.has(origin))return response({ok:false,error:'Origem inválida para gravação'},403,origin);
   const raw=await request.text();
   if(raw.length>50000)return response({ok:false,error:'Envio muito grande'},413,origin);
   let data;
   try{data=JSON.parse(raw)}catch(e){return response({ok:false,error:'JSON inválido'},400,origin)}
   if(data?.action==='portal_login')return portalLogin(data,env,origin);
   if(data?.action==='salvar_destinatarios'){
     const denied=await adminGuard(request,env,origin);
     if(denied)return denied;
     try{
       const destinatarios=validateRecipientRecords(data.destinatarios);
       await env.ANFEER_CONFIG.put(RECIPIENTS_KEY,JSON.stringify(destinatarios));
       console.log('ANFEER WhatsApp CADASTRO ATUALIZADO',JSON.stringify({
         cadastrados:destinatarios.length,ativos:destinatarios.filter(x=>x.ativo).length
       }));
       return response({ok:true,destinatarios},200,origin);
     }catch(err){
       return response({ok:false,error:String(err?.message||err)},400,origin);
     }
   }
   if(!WRITES.has(data?.action))return response({ok:false,error:'Ação não autorizada'},400,origin);
   const saved=await upstream('POST',new URLSearchParams(),JSON.stringify(data),ctx);
   // Não devolver nominal/tolerâncias à tela do operador: são usados somente pelo Worker.
   const {falhas:__falhas,titulo:__titulo,...publicResult}=saved||{};
   if(data.action==='salvar_inspecao'&&saved?.ok&&saved.resultado==='REPROVADO'&&!saved.jaRegistrada){
     if(await omniReady(env)){
       ctx.waitUntil(omniNotify(env,data,saved).catch(err=>console.error('Erro ao notificar inspeção',saved.id,String(err))));
       return response({...publicResult,alertaWhatsapp:'envio_solicitado'},200,origin);
     }
     return response({...publicResult,alertaWhatsapp:'nao_configurado'},200,origin);
   }
   return response(publicResult,200,origin);
  }catch(e){return response({ok:false,error:String(e?.message||e)},502,origin)}
 }
};

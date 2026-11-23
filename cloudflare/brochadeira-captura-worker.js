// ANFEER / AUVRIUN - Captura remota dos ciclos da brochadeira
// Worker separado: NAO altera a API atual de telemetria/calibracao.
// Vincule o MESMO banco D1 existente como BROCHA_DB.
// As tabelas de captura sao criadas automaticamente.
const ORIGENS = new Set(['https://consultoriarf.net','https://www.consultoriarf.net']);
const PORTAL_AUTH_URL = 'https://anfeer-inspecao-api.apicolumbia.workers.dev/?action=portal_session';
const JSON_HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const ESTADOS = new Set(['AGUARDANDO','CAPTURANDO','FINALIZANDO','ENVIANDO','CONCLUIDA','ERRO']);
let tablesReady = false;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});}
function cors(req,response) {
  const origin = req.headers.get('Origin');
  if (!ORIGENS.has(origin)) return response;
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin',origin);h.set('Vary','Origin');
  h.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  h.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  h.set('Access-Control-Max-Age','600');
  return new Response(response.body,{status:response.status,headers:h});
}
function positive(n){return Number.isSafeInteger(n)&&n>0&&n<=999999999;}
function validDevice(s){return typeof s==='string'&&/^[A-Za-z0-9_-]{8,48}$/.test(s);}
function bad(status,erro){return json({ok:false,erro},status);}
async function bodyJson(req,max=11000){
  if(!(req.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))throw {status:415,erro:'Use application/json.'};
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>max)throw {status:413,erro:'Conteudo grande demais.'};
  try{return JSON.parse(raw);}catch{throw {status:400,erro:'JSON invalido.'};}
}
async function schema(env){
  if(tablesReady)return;
  if(!env.BROCHA_DB)throw new Error('D1 BROCHA_DB nao configurado');
  await env.BROCHA_DB.prepare("CREATE TABLE IF NOT EXISTS brochadeira_captura_controle (cod_maquina INTEGER PRIMARY KEY, dispositivo_id TEXT NOT NULL, captura_id TEXT NOT NULL, comando TEXT NOT NULL, geracao INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL, total_amostras INTEGER NOT NULL DEFAULT 0, erro TEXT, atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
  await env.BROCHA_DB.prepare("CREATE TABLE IF NOT EXISTS brochadeira_captura_blocos (cod_maquina INTEGER NOT NULL, captura_id TEXT NOT NULL, bloco INTEGER NOT NULL, pontos_json TEXT NOT NULL, PRIMARY KEY(cod_maquina,captura_id,bloco))").run();
  tablesReady=true;
}
async function portalAuth(request){
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer ')||auth.length<20||auth.length>4096)return false;
  try{
    const r=await fetch(PORTAL_AUTH_URL,{method:'GET',headers:{Authorization:auth,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return false;
    const j=await r.json();return j?.ok===true;
  }catch(e){console.error('Falha sessao:',e?.name);return false;}
}
async function deviceAuth(request,env,cod){
  const bearer=request.headers.get('Authorization')||'';
  if(!bearer.startsWith('Bearer '))return null;
  const token=bearer.slice(7);
  if(token.length<43||token.length>256)return null;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hex=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
  const row=await env.BROCHA_DB.prepare('SELECT k.dispositivo_id, k.token_hash FROM brochadeira_dispositivo_chaves k JOIN brochadeira_sensores s ON s.cod_maquina=k.cod_maquina AND s.dispositivo_id=k.dispositivo_id WHERE k.cod_maquina=?').bind(cod).first();
  if(!row||typeof row.token_hash!=='string'||row.token_hash.length!==64)return null;
  let diff=0;for(let i=0;i<64;i++)diff|=hex.charCodeAt(i)^row.token_hash.charCodeAt(i);
  return diff===0?row.dispositivo_id:null;
}
async function control(env,cod) {
  return env.BROCHA_DB.prepare('SELECT cod_maquina, dispositivo_id, captura_id, comando, geracao, estado, total_amostras, erro, atualizado_em FROM brochadeira_captura_controle WHERE cod_maquina=?').bind(cod).first();
}
function routeMachine(u){const x=u.searchParams.get('cod_maquina');const n=Number(x);return /^[1-9][0-9]{0,8}$/.test(x||'')&&positive(n)?n:null;}
function currentState(row){return row?{cod_maquina:row.cod_maquina,dispositivo_id:row.dispositivo_id,captura_id:row.captura_id,comando:row.comando,estado:row.estado,total_amostras:row.total_amostras,erro:row.erro||'',atualizado_em:row.atualizado_em}:null;}
async function webGet(u,env){
  const cod=routeMachine(u);
  if(!cod)return bad(400,'Informe cod_maquina valido.');
  const registro=await control(env,cod);
  if(!registro)return json({ok:true,captura:null});
  const payload={ok:true,captura:currentState(registro)};
  if(u.searchParams.get('dados')==='1'){
    if(registro.estado!=='CONCLUIDA')return bad(409,'A captura ainda nao terminou.');
    const blocos=await env.BROCHA_DB.prepare('SELECT bloco,pontos_json FROM brochadeira_captura_blocos WHERE cod_maquina=? AND captura_id=? ORDER BY bloco ASC').bind(cod,registro.captura_id).all();
    let pontos=[],proximo=0;
    for(const b of blocos.results||[]){
      if(b.bloco!==proximo++)return bad(409,'Blocos da captura incompletos.');
      const chunk=JSON.parse(b.pontos_json);
      if(!Array.isArray(chunk))return bad(503,'Bloco de captura invalido.');
      pontos.push(...chunk);
      if(pontos.length>1500)return bad(503,'Limite de amostras excedido.');
    }
    if(pontos.length!==registro.total_amostras)return bad(409,'Captura incompleta. Aguarde sincronizacao.');
    payload.dados={formato:'ANFEER_CAPTURA_V1',cod_maquina:cod,dispositivo_id:registro.dispositivo_id,pontos};
  }
  return json(payload);
}
async function webPost(req,env){
  const b=await bodyJson(req,1024),cod=b?.cod_maquina,acao=b?.acao;
  if(!positive(cod)||!['INICIAR','PARAR'].includes(acao))return bad(400,'Maquina ou acao invalida.');
  const s=await env.BROCHA_DB.prepare('SELECT dispositivo_id FROM brochadeira_sensores WHERE cod_maquina=?').bind(cod).first();
  if(!s||!validDevice(s.dispositivo_id))return bad(404,'Sensor nao cadastrado para a maquina.');
  if(acao==='INICIAR'){
    const cid=crypto.randomUUID();
    await env.BROCHA_DB.prepare("INSERT INTO brochadeira_captura_controle(cod_maquina,dispositivo_id,captura_id,comando,geracao,estado,total_amostras,erro) VALUES(?,?,?,'INICIAR',1,'AGUARDANDO',0,NULL) ON CONFLICT(cod_maquina) DO UPDATE SET dispositivo_id=excluded.dispositivo_id,captura_id=excluded.captura_id,comando='INICIAR',geracao=geracao+1,estado='AGUARDANDO',total_amostras=0,erro=NULL,atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(cod,s.dispositivo_id,cid).run();
    await env.BROCHA_DB.prepare('DELETE FROM brochadeira_captura_blocos WHERE cod_maquina=?').bind(cod).run();
  }else{
    const res=await env.BROCHA_DB.prepare("UPDATE brochadeira_captura_controle SET comando='PARAR',geracao=geracao+1,estado='FINALIZANDO',atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cod_maquina=? AND estado IN ('AGUARDANDO','CAPTURANDO')").bind(cod).run();
    if(res.meta?.changes!==1)return bad(409,'Nao existe captura ativa para finalizar.');
  }
  return json({ok:true,captura:currentState(await control(env,cod))});
}
async function cmdGet(u,env,ident){
  const cod=routeMachine(u);
  const row=await control(env,cod);
  if(row&&row.dispositivo_id!==ident)return bad(403,'Identificador nao corresponde ao sensor.');
  return json({ok:true,cod_maquina:cod,comando:row?.comando||'NENHUM',captura_id:row?.captura_id||'',geracao:row?.geracao||0,estado:row?.estado||'OCIOSA'});
}
async function deviceStatus(req,env,cod,ident){
  const b=await bodyJson(req,1024);
  if(b?.cod_maquina!==cod||b?.dispositivo_id!==ident||typeof b?.captura_id!=='string'||!ESTADOS.has(b?.estado)||!['CAPTURANDO','ENVIANDO','ERRO'].includes(b.estado))return bad(400,'Status invalido.');
  const row=await control(env,cod);
  if(!row||row.captura_id!==b.captura_id||row.dispositivo_id!==ident)return bad(409,'Captura nao e mais a atual.');
  const total=Number.isSafeInteger(b.total_amostras)&&b.total_amostras>=0&&b.total_amostras<=1500?b.total_amostras:0;
  const erro=b.estado==='ERRO'?String(b.erro||'Falha na captura').slice(0,160):null;
  if(b.estado==='CAPTURANDO'&&row.estado==='FINALIZANDO')return json({ok:true,estado:'FINALIZANDO'});
  if(row.estado==='CONCLUIDA')return json({ok:true,estado:'CONCLUIDA'});
  await env.BROCHA_DB.prepare("UPDATE brochadeira_captura_controle SET estado=?,total_amostras=?,erro=?,atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cod_maquina=? AND captura_id=?").bind(b.estado,total,erro,cod,b.captura_id).run();
  return json({ok:true,estado:b.estado});
}
async function deviceLote(req,env,cod,ident){
  const b=await bodyJson(req,11000);
  if(b?.cod_maquina!==cod||b?.dispositivo_id!==ident||typeof b?.captura_id!=='string'||!Number.isSafeInteger(b.bloco)||b.bloco<0||b.bloco>14||!Array.isArray(b.pontos)||b.pontos.length<1||b.pontos.length>100||typeof b.finalizado!=='boolean'||!Number.isSafeInteger(b.total_amostras)||b.total_amostras<20||b.total_amostras>1500)return bad(400,'Lote invalido.');
  let ultimo=-1;
  for(const p of b.pontos){
    if(!p||!Number.isSafeInteger(p.t_ms)||p.t_ms<0||p.t_ms>600000||typeof p.corrente_a!=='number'||!Number.isFinite(p.corrente_a)||p.corrente_a<0||p.corrente_a>1000||p.t_ms<=ultimo)return bad(400,'Amostra ou ordem de tempos invalida.');
    ultimo=p.t_ms;
  }
  const row=await control(env,cod);
  if(!row||row.captura_id!==b.captura_id||row.dispositivo_id!==ident)return bad(409,'Captura desatualizada.');
  if(!['FINALIZANDO','ENVIANDO','CONCLUIDA'].includes(row.estado))return bad(409,'A captura ainda nao foi finalizada no portal.');
  await env.BROCHA_DB.prepare('INSERT INTO brochadeira_captura_blocos(cod_maquina,captura_id,bloco,pontos_json) VALUES(?,?,?,?) ON CONFLICT(cod_maquina,captura_id,bloco) DO UPDATE SET pontos_json=excluded.pontos_json').bind(cod,b.captura_id,b.bloco,JSON.stringify(b.pontos)).run();
  if(b.finalizado){
    const items=await env.BROCHA_DB.prepare('SELECT bloco,pontos_json FROM brochadeira_captura_blocos WHERE cod_maquina=? AND captura_id=? ORDER BY bloco ASC').bind(cod,b.captura_id).all();
    let total=0,num=0;
    for(const el of items.results||[]){
      if(el.bloco!==num++)return bad(409,'Faltam blocos para finalizar.');
      total+=JSON.parse(el.pontos_json).length;
    }
    if(total!==b.total_amostras)return bad(409,'Quantidade de amostras nao confere.');
    await env.BROCHA_DB.prepare("UPDATE brochadeira_captura_controle SET comando='NENHUM',estado='CONCLUIDA',total_amostras=?,erro=NULL,atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cod_maquina=? AND captura_id=?").bind(total,cod,b.captura_id).run();
  }else{
    await env.BROCHA_DB.prepare("UPDATE brochadeira_captura_controle SET estado='ENVIANDO',total_amostras=?,atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cod_maquina=? AND captura_id=? AND estado<>'CONCLUIDA'").bind(b.total_amostras,cod,b.captura_id).run();
  }
  return json({ok:true,bloco:b.bloco,finalizado:b.finalizado},201);
}
export default {
  async fetch(request,env){
    const u=new URL(request.url),path=u.pathname,origin=request.headers.get('Origin');
    if(request.method==='OPTIONS'){
      if(!ORIGENS.has(origin))return bad(403,'Origem nao autorizada.');
      return cors(request,new Response(null,{status:204}));
    }
    if(request.method==='GET'&&path==='/health')return json({ok:true,servico:'anfeer-brochadeira-captura',database_configured:!!env.BROCHA_DB});
    const isWeb=path==='/v1/captura';
    const isDevice=path==='/v1/dispositivo/comando'||path==='/v1/dispositivo/status'||path==='/v1/dispositivo/lote';
    if(!isWeb&&!isDevice)return cors(request,bad(404,'Rota nao encontrada.'));
    try{
      await schema(env);
      if(isWeb){
        if(origin&&!ORIGENS.has(origin))return cors(request,bad(403,'Origem nao permitida.'));
        if(!(await portalAuth(request)))return cors(request,bad(401,'Sessao ANFEER invalida.'));
        const response=request.method==='GET'?await webGet(u,env):request.method==='POST'?await webPost(request,env):bad(405,'Metodo nao permitido.');
        return cors(request,response);
      }
      const cod=routeMachine(u);
      if(!cod)return bad(400,'cod_maquina invalido.');
      const ident=await deviceAuth(request,env,cod);
      if(!ident)return bad(401,'Chave do dispositivo invalida.');
      if(path==='/v1/dispositivo/comando'&&request.method==='GET')return cmdGet(u,env,ident);
      if(path==='/v1/dispositivo/status'&&request.method==='POST')return deviceStatus(request,env,cod,ident);
      if(path==='/v1/dispositivo/lote'&&request.method==='POST')return deviceLote(request,env,cod,ident);
      return bad(405,'Metodo nao permitido.');
    }catch(e){
      console.error('CAPTURA:',e?.name||'erro',e?.status||'');
      return cors(request,bad(e?.status||503,e?.erro||'Falha interna da captura.'));
    }
  }
};

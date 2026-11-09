/**
 * ANFEER - Inspeções. Cole este arquivo em um projeto Apps Script independente,
 * vinculado à planilha cujo ID consta abaixo. Implante como aplicativo da Web.
 * Sem PIN: proteja o acesso ao endpoint em produção por autenticação externa.
 */
const INSPECAO_SHEET_ID = '1bpVNM857IN_ymqF_zV3Moy6XRvjTD2KNIIV-r3yXgW0';
const INSPECAO_TABS = {
  PLANOS:['ID_PLANO','COD_PECAS','PROCESSO','VERSAO','ATIVO','CRIADO_EM','CRIADO_POR','OBSERVACAO'],
  PARAMETROS:['ID_PARAMETRO','ID_PLANO','ORDEM','TIPO','NOME','NOMINAL','TOL_MIN','TOL_MAX','FAMILIA','VISIVEL_CLIENTE','OBRIGATORIO'],
  INSPECOES:['ID_INSPECAO','ID_APONTAMENTO','COD_MAQUINA','MAQUINA','FUNCIONARIO','COD_PECAS','TITULO','PROCESSO','ID_PLANO','VERSAO','DATA_HORA','RESULTADO'],
  RESULTADOS:['ID_INSPECAO','ID_PARAMETRO','TIPO','NOME','MEDIDA','COD_INSTRUMENTO','RESULTADO','DT_VENCIMENTO_INSTRUMENTO'],
  HISTORICO:['ID_EVENTO','DATA_HORA','ACAO','ID_PLANO','COD_PECAS','PROCESSO','VERSAO','DETALHES']
};
function insTab(name){return SpreadsheetApp.openById(INSPECAO_SHEET_ID).getSheetByName(name)}
function insFlag(v){return ['TRUE','VERDADEIRO','1','SIM'].includes(String(v??'').trim().toUpperCase())}
function insRows(name){
  const tab=insTab(name), values=tab.getDataRange().getDisplayValues(), head=values.shift()||[];
  return values.filter(a=>a.some(v=>v!=='')).map(a=>Object.fromEntries(head.map((h,i)=>[h,['ATIVO','VISIVEL_CLIENTE','OBRIGATORIO'].includes(h)?String(insFlag(a[i])):a[i]])));
}
function insAppend(name,objects){
  if(!objects.length)return;
  const t=insTab(name),head=INSPECAO_TABS[name];
  const first=t.getLastRow()+1;
  const range=t.getRange(first,1,objects.length,head.length);
  // Códigos CPS e identificadores são texto, nunca data nem número.
  // A formatação precisa acontecer ANTES de setValues.
  const textCols=['ID_PLANO','ID_PARAMETRO','ID_INSPECAO','ID_APONTAMENTO','COD_MAQUINA','COD_PECAS','COD_INSTRUMENTO','ID_EVENTO','VERSAO'];
  for(const colName of textCols){
    const col=head.indexOf(colName);
    if(col>=0)t.getRange(first,col+1,objects.length,1).setNumberFormat('@');
  }
  range.setValues(objects.map(o=>head.map(h=>o[h]===undefined?'':o[h])));
}
function insJson(obj,cb){
  const content=JSON.stringify(obj);
  if(cb && /^[A-Za-z_$][\w.$]{0,90}$/.test(cb))
    return ContentService.createTextOutput(cb+'('+content+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JSON);
}
function insProcess(p){const v=String(p||'').trim().toUpperCase();if(!['BROCHA','BROCHAMENTO'].includes(v))throw Error('Processo inválido');return v}
function insCode(s){return String(s||'').trim().toUpperCase()}
function insPlanos(){
  const pars=insRows('PARAMETROS');
  return insRows('PLANOS').map(p=>({...p,parametros:pars.filter(x=>x.ID_PLANO===p.ID_PLANO).sort((a,b)=>Number(a.ORDEM)-Number(b.ORDEM))}));
}
function insRead(q){
  const action=q.action||'ping';
  if(action==='ping')return {ok:true};
  if(action==='planos')return {ok:true,planos:insPlanos()};
  if(action==='plano_operador'){
    const peca=insCode(q.peca),processo=insProcess(q.processo);
    const plano=insPlanos().filter(p=>insCode(p.COD_PECAS)===peca&&p.PROCESSO===processo&&String(p.ATIVO).toLowerCase()==='true').sort((a,b)=>Number(b.VERSAO)-Number(a.VERSAO))[0];
    if(!plano)return {ok:true,plano:null};
    const {parametros,...cabecalho}=plano;
    return {ok:true,plano:{...cabecalho,parametros:parametros.map(({ID_PARAMETRO,ORDEM,TIPO,NOME,FAMILIA,OBRIGATORIO})=>({ID_PARAMETRO,ORDEM,TIPO,NOME,FAMILIA,OBRIGATORIO}))}};
  }
  if(action==='historico')return {ok:true,inspecoes:insRows('INSPECOES').filter(x=>insCode(x.COD_PECAS)===insCode(q.peca)&&x.PROCESSO===insProcess(q.processo)).slice(-100).reverse()};
  throw Error('Ação desconhecida');
}
function insBridge(data,token){
  // A página no Apps Script envia dados ao site via postMessage, sem depender de JSONP.
  // token + verificação de source na página eliminam respostas de outros iframes.
  const payload=JSON.stringify({channel:'ANFEER_INSPECAO_BRIDGE',token:String(token||''),data}).replace(/</g,'\\u003c');
  const html='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><script>window.top.postMessage('+payload+',"https://consultoriarf.net");<\\/script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doGet(e){
  const q=e.parameter||{};
  try{
    if(q.action==='bridge'){
      if(!/^[a-zA-Z0-9_-]{10,100}$/.test(String(q.token||'')))throw Error('Token inválido');
      if(!['ping','planos','plano_operador','historico'].includes(q.read_action))throw Error('Consulta não permitida');
      return insBridge(insRead({...q,action:q.read_action}),q.token);
    }
    return insJson(insRead(q),q.callback);
  }catch(err){
    if(q.action==='bridge')return insBridge({ok:false,error:err.message},q.token);
    return insJson({ok:false,error:err.message},q.callback);
  }
}
function doPost(e){
  let d={};
  try{
    d=JSON.parse(e.postData.contents);
    const lock=LockService.getScriptLock();lock.waitLock(25000);
    try{
      if(d.action==='salvar_plano')return insJson(insSavePlan(d));
      if(d.action==='salvar_inspecao')return insJson(insSaveInspection(d));
      throw Error('Ação desconhecida');
    }finally{lock.releaseLock()}
  }catch(err){return insJson({ok:false,error:err.message})}
}
function insSavePlan(d){
  const peca=insCode(d.peca),processo=insProcess(d.processo),items=d.parametros||[];
  if(!peca||!Array.isArray(items)||!items.length)throw Error('Peça e parâmetros obrigatórios');
  if(items.length>250)throw Error('Máximo de 250 parâmetros');
  const allowed=['COTA','VISUAL','CALIBRADOR'];
  const sanitized=items.map((p,i)=>{
    const tipo=insCode(p.tipo),nome=String(p.nome||'').trim(),familia=String(p.familia||'').trim();
    if(!allowed.includes(tipo)||!nome)throw Error('Parâmetro inválido: '+(i+1));
    if(tipo==='CALIBRADOR' && processo!=='BROCHAMENTO')throw Error('Calibrador somente no brochamento');
    if(tipo!=='VISUAL'&&!familia)throw Error('Família obrigatória: '+nome);
    const nominal=Number(String(p.nominal??'').replace(',','.')),min=Number(String(p.min??'').replace(',','.')),max=Number(String(p.max??'').replace(',','.'));
    if(tipo==='COTA' && ([p.nominal,p.min,p.max].some(v=>String(v??'').trim()==='') || !Number.isFinite(nominal)||!Number.isFinite(min)||!Number.isFinite(max)||min>max||min>nominal||max<nominal))throw Error('Medidas/tolerâncias inválidas: '+nome);
    return {ID_PARAMETRO:Utilities.getUuid(),ORDEM:i+1,TIPO:tipo,NOME:nome,NOMINAL:tipo==='COTA'?nominal:'',TOL_MIN:tipo==='COTA'?min:'',TOL_MAX:tipo==='COTA'?max:'',FAMILIA:familia,VISIVEL_CLIENTE:!!p.visivel,OBRIGATORIO:true};
  });
  const old=insRows('PLANOS').filter(x=>x.COD_PECAS===peca&&x.PROCESSO===processo);
  const version=Math.max(0,...old.map(x=>Number(x.VERSAO)||0))+1;
  const sheet=insTab('PLANOS'),grid=sheet.getDataRange().getValues(),headers=grid[0],activeCol=headers.indexOf('ATIVO');
  for(let i=1;i<grid.length;i++){if(String(grid[i][1]).trim().toUpperCase()===peca&&String(grid[i][2]).trim().toUpperCase()===processo&&insFlag(grid[i][4]))sheet.getRange(i+1,activeCol+1).setValue(false)}
  const id=Utilities.getUuid(),now=new Date().toISOString();
  insAppend('PARAMETROS',sanitized.map(x=>({...x,ID_PLANO:id})));
  insAppend('PLANOS',[{ID_PLANO:id,COD_PECAS:peca,PROCESSO:processo,VERSAO:version,ATIVO:true,CRIADO_EM:now,CRIADO_POR:String(d.usuario||'').slice(0,100),OBSERVACAO:String(d.observacao||'').slice(0,1000)}]);
  insAppend('HISTORICO',[{ID_EVENTO:Utilities.getUuid(),DATA_HORA:now,ACAO:'PUBLICAR_VERSAO',ID_PLANO:id,COD_PECAS:peca,PROCESSO:processo,VERSAO:version,DETALHES:'Parâmetros: '+sanitized.length}]);
  return {ok:true,id,versao:version};
}
function insNumber(value){const s=String(value??'').trim().replace(',','.');if(!s||!Number.isFinite(Number(s)))throw Error('Medida inválida');return Number(s)}
function insCpsRows(path){
  const cache=CacheService.getScriptCache(),key='ins_'+path;
  const cached=cache.get(key);if(cached)return JSON.parse(cached);
  const res=UrlFetchApp.fetch('https://anfeer.consultoriarf.net/'+path,{muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw Error('API CPS indisponível: '+path);
  const obj=JSON.parse(res.getContentText());
  const rows=Array.isArray(obj)?obj:Array.isArray(obj.dados)?obj.dados:Array.isArray(obj.items)?obj.items:null;
  if(!rows)throw Error('Formato inválido no endpoint '+path);
  try{cache.put(key,JSON.stringify(rows),60)}catch(e){}
  return rows;
}
function insExpiry(s){
  const str=String(s||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(str))return str.slice(0,10);
  if(/^\d{2}\/\d{2}\/\d{4}/.test(str))return str.slice(6,10)+'-'+str.slice(3,5)+'-'+str.slice(0,2);
  return '';
}
function insToday(){
  return Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd');
}
function insSaveInspection(d){
  const peca=insCode(d.peca),processo=insProcess(d.processo);
  const plano=insPlanos().find(p=>p.ID_PLANO===d.idPlano&&p.COD_PECAS===peca&&p.PROCESSO===processo&&String(p.ATIVO).toLowerCase()==='true');
  if(!plano)throw Error('Plano não está mais ativo. Atualize a tela.');
  if(!d.maquina||!d.funcionario)throw Error('Máquina e funcionário obrigatórios');
  const apontamentos=insCpsRows('aponta_aberto');
  const aberto=apontamentos.some(a=>String(a.COD_MAQUINA)===String(d.codMaquina)&&insCode(a.COD_PECAS)===peca&&insCode(a.U_TP)===processo&&String(a.FUNCIONARIO)===String(d.funcionario));
  if(!aberto)throw Error('Apontamento não está mais aberto. Atualize a tela.');
  const instrumentos=insCpsRows('INSTRUMENTOS');
  const results=d.resultados||[];
  if(!Array.isArray(results)||results.length!==plano.parametros.length)throw Error('Preencha todos os parâmetros');
  const map=new Map(results.map(r=>[String(r.idParametro),r]));
  const rows=plano.parametros.map(p=>{
    const r=map.get(p.ID_PARAMETRO);if(!r)throw Error('Parâmetro faltando: '+p.NOME);
    let aprovado,medida='',cod='',venc='';
    if(p.TIPO==='COTA'){
      medida=insNumber(r.medida);
      aprovado=medida>=insNumber(p.TOL_MIN)&&medida<=insNumber(p.TOL_MAX);
    }else{if(!['APROVADO','REPROVADO'].includes(r.resultado))throw Error('Resultado obrigatório: '+p.NOME);aprovado=r.resultado==='APROVADO'}
    if(p.TIPO!=='VISUAL'){
      cod=String(r.instrumento||'').trim();venc=String(r.vencimento||'').slice(0,30);
      if(!cod)throw Error('Selecione instrumento: '+p.NOME);
      if(r.familia!==p.FAMILIA)throw Error('Família incorreta: '+p.NOME);
      const encontrado=instrumentos.find(x=>String(x.CODIGO).trim()===cod&&String(x.FAMILIA).trim()===p.FAMILIA);
      if(!encontrado || String(encontrado.VALIDADE).trim().toUpperCase()!=='OK'|| !insExpiry(encontrado.DT_VENCIMENTO)||insExpiry(encontrado.DT_VENCIMENTO)<insToday())throw Error('Instrumento inválido ou vencido: '+p.NOME);
      venc=insExpiry(encontrado.DT_VENCIMENTO);
    }
    return {ID_PARAMETRO:p.ID_PARAMETRO,TIPO:p.TIPO,NOME:p.NOME,MEDIDA:medida,COD_INSTRUMENTO:cod,RESULTADO:aprovado?'APROVADO':'REPROVADO',DT_VENCIMENTO_INSTRUMENTO:venc};
  });
  const id=String(d.requisicaoId||Utilities.getUuid());
  if(insRows('INSPECOES').some(x=>x.ID_INSPECAO===id))return {ok:true,id,jaRegistrada:true};
  const result=rows.every(x=>x.RESULTADO==='APROVADO')?'APROVADO':'REPROVADO';
  insAppend('INSPECOES',[{ID_INSPECAO:id,ID_APONTAMENTO:String(d.apontamento||''),COD_MAQUINA:String(d.codMaquina||''),MAQUINA:String(d.maquina),FUNCIONARIO:String(d.funcionario),COD_PECAS:peca,TITULO:String(d.titulo||''),PROCESSO:processo,ID_PLANO:plano.ID_PLANO,VERSAO:plano.VERSAO,DATA_HORA:new Date().toISOString(),RESULTADO:result}]);
  insAppend('RESULTADOS',rows.map(r=>({...r,ID_INSPECAO:id})));
  return {ok:true,id,resultado:result};
}
/**
 * ANFEER - Inspeções. Cole este arquivo em um projeto Apps Script independente,
 * vinculado à planilha cujo ID consta abaixo. Implante como aplicativo da Web.
 * Sem PIN: proteja o acesso ao endpoint em produção por autenticação externa.
 */
const INSPECAO_SHEET_ID = '1bpVNM857IN_ymqF_zV3Moy6XRvjTD2KNIIV-r3yXgW0';
const INSPECAO_TABS = {
  PLANOS:['ID_PLANO','COD_PECAS','PROCESSO','VERSAO','ATIVO','CRIADO_EM','CRIADO_POR','OBSERVACAO'],
  PARAMETROS:['ID_PARAMETRO','ID_PLANO','ORDEM','TIPO','NOME','NOMINAL','TOL_MIN','TOL_MAX','FAMILIA','VISIVEL_CLIENTE','OBRIGATORIO'],
  INSPECOES:['ID_INSPECAO','ID_APONTAMENTO','COD_MAQUINA','MAQUINA','FUNCIONARIO','COD_PECAS','TITULO','PROCESSO','ID_PLANO','VERSAO','DATA_HORA','RESULTADO','NUM_OS','COD_EMPRESA'],
  RESULTADOS:['ID_INSPECAO','ID_PARAMETRO','TIPO','NOME','MEDIDA','COD_INSTRUMENTO','RESULTADO','DT_VENCIMENTO_INSTRUMENTO','NOME_INSTRUMENTO'],
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
  // Migração não destrutiva: amplia cabeçalhos antigos, preservando dados existentes.
  const existing=t.getRange(1,1,1,Math.max(1,t.getLastColumn())).getDisplayValues()[0];
  for(const h of head){if(!existing.includes(h)){
    const col=t.getLastColumn()+1;
    t.getRange(1,col).setValue(h);
    existing.push(h);
  }}
  const first=t.getLastRow()+1;
  const range=t.getRange(first,1,objects.length,head.length);
  // Códigos CPS e identificadores são texto, nunca data nem número.
  // A formatação precisa acontecer ANTES de setValues.
  const textCols=['ID_PLANO','ID_PARAMETRO','ID_INSPECAO','ID_APONTAMENTO','COD_MAQUINA','COD_PECAS','COD_INSTRUMENTO','ID_EVENTO','VERSAO','NUM_OS','COD_EMPRESA'];
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

function insOsValue(record){
 const entry=Object.fromEntries(Object.entries(record||{}).map(([k,v])=>[k.trim().toUpperCase(),v]));
 for(const k of ['N_OS','NUM_OS','NUMERO_OS','NRO_OS','N_OS_OS','OS','COD_OS','CODIGO_OS','COD_ORDEM_SERVICO','TOS_CODIGO','OS_CODIGO']){
   const v=entry[k];
   if((typeof v==='string'||typeof v==='number')&&String(v).trim())return String(v).trim();
 }
 return '';
}
function insEmpresaValue(record){
 const entry=Object.fromEntries(Object.entries(record||{}).map(([k,v])=>[k.trim().toUpperCase(),v]));
 for(const k of ['COD_EMPRESA','COD_EMP','EMPRESA_COD','CODIGO_EMPRESA','TOS_COD_EMPRESA']){
  const v=entry[k];if((typeof v==='string'||typeof v==='number')&&String(v).trim())return String(v).trim();
 }
 return '';
}
function insCompletarIdentidade(rows){
 const pendentes=rows.some(x=>!x.NUM_OS||!x.COD_EMPRESA);
 if(!pendentes)return rows;
 let abertos=[];
 try{abertos=insCpsRows('aponta_aberto')}catch(e){return rows}
 return rows.map(x=>{
  if(x.NUM_OS&&x.COD_EMPRESA)return x;
  const codigo=insCode(x.COD_PECAS),processo=insCode(x.PROCESSO),maquina=String(x.COD_MAQUINA||''),funcionario=String(x.FUNCIONARIO||'');
  // Só completa dados antigos quando os apontamentos atuais têm identidade única.
  // Nunca assumir apenas pelo código da peça.
  const candidates=abertos.filter(a=>{
   if(x.NUM_OS&&insCode(insOsValue(a))!==insCode(x.NUM_OS))return false;
   if(x.COD_EMPRESA&&insCode(insEmpresaValue(a))!==insCode(x.COD_EMPRESA))return false;
   const origem=String(a.ID_APONTAMENTO||a.GUID_APONTAMENTO||'');
   if(x.ID_APONTAMENTO&&origem)return String(x.ID_APONTAMENTO)===origem;
   return insCode(a.COD_PECAS)===codigo && insCode(a.U_TP)===processo &&
          String(a.COD_MAQUINA||'')===maquina && String(a.FUNCIONARIO||'')===funcionario;
  });
  const identidades=new Map();
  for(const a of candidates){
    const empresa=insEmpresaValue(a),os=insOsValue(a);
    if(empresa&&os)identidades.set(JSON.stringify([empresa,os]),{empresa,os});
  }
  if(identidades.size!==1)return x;
  const match=[...identidades.values()][0];
  // Uma divergência explícita não pode ser sobrescrita.
  if((x.NUM_OS&&x.NUM_OS!==match.os)||(x.COD_EMPRESA&&x.COD_EMPRESA!==match.empresa))return x;
  return {...x,NUM_OS:x.NUM_OS||match.os,COD_EMPRESA:x.COD_EMPRESA||match.empresa};
 });
}
function insChaveGrupo(x){
 const empresa=insCode(x.COD_EMPRESA),os=insCode(x.NUM_OS),peca=insCode(x.COD_PECAS);
 return empresa&&os
   ?JSON.stringify([empresa,os,peca])
   :JSON.stringify(['PENDENTE',String(x.ID_INSPECAO),peca]);
}
function insRelatorioBase(){return insCompletarIdentidade(insRows('INSPECOES'))}
function insRelatorioGrupos(q){
 const busca=insCode(q.busca||q.q||''),resultado=insCode(q.resultado||''),processo=insCode(q.processo||'');
 const de=String(q.de||'').slice(0,10),ate=String(q.ate||'').slice(0,10),os=insCode(q.os||'');
 const grupos=new Map();
 for(const x of insRelatorioBase()){
   if(!x.ID_INSPECAO)continue;
   const key=insChaveGrupo(x);
   if(!grupos.has(key))grupos.set(key,[]);
   grupos.get(key).push(x);
 }
 const data=[...grupos].map(([chave,registros])=>{
  registros.sort((a,b)=>String(a.DATA_HORA||'').localeCompare(String(b.DATA_HORA||'')));
  const ultimo=registros[registros.length-1];
  return {chave,NUM_OS:ultimo.NUM_OS||'',COD_EMPRESA:ultimo.COD_EMPRESA||'',COD_PECAS:ultimo.COD_PECAS,
   TITULO:ultimo.TITULO,DATA_HORA:ultimo.DATA_HORA,RESULTADO:ultimo.RESULTADO,
   QUANTIDADE:registros.length,teveReprovacao:registros.some(x=>x.RESULTADO==='REPROVADO'),
   PROCESSOS:[...new Set(registros.map(x=>x.PROCESSO).filter(Boolean))],
   MAQUINAS:[...new Set(registros.map(x=>x.MAQUINA).filter(Boolean))],
   osPendente:!ultimo.NUM_OS||!ultimo.COD_EMPRESA,
   _registros:registros};
 }).filter(g=>{
   if(busca&&![g.COD_PECAS,g.TITULO,g.NUM_OS,g.COD_EMPRESA].some(v=>insCode(v).includes(busca)))return false;
   if(os&&!insCode(g.NUM_OS).includes(os))return false;
   if(resultado&&!g._registros.some(x=>insCode(x.RESULTADO)===resultado))return false;
   if(processo&&!g._registros.some(x=>insCode(x.PROCESSO)===processo))return false;
   if((de||ate)&&!g._registros.some(x=>{
    const d=String(x.DATA_HORA||'').slice(0,10);return (!de||d>=de)&&(!ate||d<=ate);
   }))return false;
   return true;
 }).sort((a,b)=>String(b.DATA_HORA||'').localeCompare(String(a.DATA_HORA||'')));
 const offset=Math.max(0,Math.floor(Number(q.offset)||0)),limite=Math.min(200,Math.max(1,Number(q.limite)||100));
 return {ok:true,total:data.length,offset,limite,grupos:data.slice(offset,offset+limite).map(({_registros,...g})=>g)};
}
function insRelatorioGrupoDetalhe(q){
 let key;
 try{key=JSON.parse(String(q.chave||''))}catch(e){throw Error('Identificação de grupo inválida')}
 if(!Array.isArray(key)||key.length!==3||key.some(x=>typeof x!=='string'||x.length>180))throw Error('Grupo inválido');
 const chave=JSON.stringify(key);
 const registros=insRelatorioBase().filter(x=>insChaveGrupo(x)===chave)
   .sort((a,b)=>String(a.DATA_HORA||'').localeCompare(String(b.DATA_HORA||'')));
 if(!registros.length)throw Error('Grupo não encontrado');
 if(registros.length>150)throw Error('Limite de 150 inspeções por PDF');
 // Busca cada plano e todas as medições uma única vez, preservando versões históricas.
 const ids=new Set(registros.map(x=>x.ID_INSPECAO));
 const planos=new Set(registros.map(x=>x.ID_PLANO));
 const paramMap=new Map(insRows('PARAMETROS').filter(x=>planos.has(x.ID_PLANO)).map(p=>[p.ID_PARAMETRO,p]));
 const resultMap=new Map();
 const results=insRows('RESULTADOS').filter(r=>ids.has(r.ID_INSPECAO));
 for(const r of results){if(!resultMap.has(r.ID_INSPECAO))resultMap.set(r.ID_INSPECAO,[]);resultMap.get(r.ID_INSPECAO).push(r)}
 let instrumentos=[];
 if(results.some(r=>r.COD_INSTRUMENTO&&!r.NOME_INSTRUMENTO))
   try{instrumentos=insCpsRows('INSTRUMENTOS')}catch(e){}
 const nomes=new Map(instrumentos.map(i=>[String(i.CODIGO||''),String(i.NOME||'')]));
 const inspecoes=registros.map(inspecao=>({
   inspecao,
   parametros:(resultMap.get(inspecao.ID_INSPECAO)||[]).map(r=>{
    const p=paramMap.get(r.ID_PARAMETRO);
    return {
     idParametro:r.ID_PARAMETRO,ordem:p?Number(p.ORDEM):9999,tipo:r.TIPO,nome:r.NOME,
     nominal:r.TIPO==='COTA'?p?.NOMINAL??'':'',minimo:r.TIPO==='COTA'?p?.TOL_MIN??'':'',
     maximo:r.TIPO==='COTA'?p?.TOL_MAX??'':'',medida:r.MEDIDA,resultado:r.RESULTADO,
     instrumento:r.COD_INSTRUMENTO,nomeInstrumento:r.NOME_INSTRUMENTO||nomes.get(String(r.COD_INSTRUMENTO||''))||'',
     vencimentoInstrumento:r.DT_VENCIMENTO_INSTRUMENTO
    };
   }).sort((a,b)=>a.ordem-b.ordem)
 }));
 const first=registros[0],last=registros[registros.length-1];
 return {ok:true,grupo:{chave,COD_EMPRESA:first.COD_EMPRESA||'',NUM_OS:first.NUM_OS||'',
  COD_PECAS:first.COD_PECAS,TITULO:last.TITULO,QUANTIDADE:registros.length,
  RESULTADO:last.RESULTADO,teveReprovacao:registros.some(x=>x.RESULTADO==='REPROVADO'),
  osPendente:!first.NUM_OS||!first.COD_EMPRESA},inspecoes};
}
function insRelatorioList(q){
  const filter=insCode(q.busca||q.q||'');
  const osFilter=insCode(q.os||'');
  const result=insCode(q.resultado||'');
  const process=insCode(q.processo||'');
  const start=String(q.de||'').slice(0,10),end=String(q.ate||'').slice(0,10);
  const limit=Math.min(500,Math.max(1,Number(q.limite)||200));
  const offset=Math.max(0,Math.floor(Number(q.offset)||0));
  const rows=insRows('INSPECOES').filter(x=>{
    if(filter&&![x.COD_PECAS,x.TITULO,x.NUM_OS].some(v=>insCode(v).includes(filter)))return false;
    if(osFilter&&!insCode(x.NUM_OS).includes(osFilter))return false;
    if(result&&insCode(x.RESULTADO)!==result)return false;
    if(process&&insCode(x.PROCESSO)!==process)return false;
    const day=String(x.DATA_HORA||'').slice(0,10);
    if(start&&day<start)return false;
    if(end&&day>end)return false;
    return true;
  }).sort((a,b)=>String(b.DATA_HORA||'').localeCompare(String(a.DATA_HORA||'')));
  return {ok:true,total:rows.length,limite:limit,offset,inspecoes:rows.slice(offset,offset+limit)};
}
function insRelatorioDetalhe(q){
  const id=String(q.id||'').trim();
  if(!id||id.length>110)throw Error('Identificador da inspeção inválido');
  const inspecao=insRows('INSPECOES').find(x=>x.ID_INSPECAO===id);
  if(!inspecao)throw Error('Inspeção não localizada');
  const parametros=insRows('PARAMETROS').filter(p=>p.ID_PLANO===inspecao.ID_PLANO);
  const paramMap=new Map(parametros.map(p=>[p.ID_PARAMETRO,p]));
  const registrados=insRows('RESULTADOS').filter(r=>r.ID_INSPECAO===id);
  // Históricos anteriores à inclusão do nome continuam exibindo o código.
  let instrumentosAtuais=[];
  if(registrados.some(r=>r.COD_INSTRUMENTO&&!r.NOME_INSTRUMENTO)){
    try{instrumentosAtuais=insCpsRows('INSTRUMENTOS')}catch(e){}
  }
  const instrumentMap=new Map(instrumentosAtuais.map(i=>[String(i.CODIGO||''),String(i.NOME||'')]));
  const results=registrados.map(r=>{
    const p=paramMap.get(r.ID_PARAMETRO);
    return {
      idParametro:r.ID_PARAMETRO,
      ordem:p?Number(p.ORDEM):9999,
      tipo:r.TIPO,
      nome:r.NOME,
      nominal:r.TIPO==='COTA'?p?.NOMINAL??'':'',
      minimo:r.TIPO==='COTA'?p?.TOL_MIN??'':'',
      maximo:r.TIPO==='COTA'?p?.TOL_MAX??'':'',
      medida:r.MEDIDA,
      instrumento:r.COD_INSTRUMENTO,
      nomeInstrumento:r.NOME_INSTRUMENTO||instrumentMap.get(String(r.COD_INSTRUMENTO||''))||'',
      vencimentoInstrumento:r.DT_VENCIMENTO_INSTRUMENTO,
      resultado:r.RESULTADO
    };
  }).sort((a,b)=>a.ordem-b.ordem);
  return {ok:true,inspecao,parametros:results};
}

function insRead(q){
  const action=q.action||'ping';
  if(action==='ping')return {ok:true};
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
  const html='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><script>window.top.postMessage('+payload+',"https://consultoriarf.net");</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doGet(e){
  const q=e.parameter||{};
  try{
    if(q.action==='bridge'){
      if(!/^[a-zA-Z0-9_-]{10,100}$/.test(String(q.token||'')))throw Error('Token inválido');
      if(!['ping','plano_operador','historico'].includes(q.read_action))throw Error('Consulta não permitida');
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
    // Só o Cloudflare Worker pode ler/cadastrar planos e emitir relatórios.
    // A tela pública de inspeção continua acessando plano_operador / salvar_inspecao.
    const privateActions=['planos','salvar_plano','relatorio_inspecoes','relatorio_detalhe','relatorio_grupos','relatorio_grupo_detalhe'];
    if(privateActions.includes(d.action)){
      const expected=String(PropertiesService.getScriptProperties().getProperty('ANFEER_RELATORIO_BACKEND_KEY')||'');
      if(expected.length<24||String(d.backendKey||'')!==expected)throw Error('Acesso administrativo não autorizado');
      if(d.action==='planos')return insJson({ok:true,planos:insPlanos()});
      if(d.action!=='salvar_plano')
        return insJson(d.action==='relatorio_grupos'?insRelatorioGrupos(d):d.action==='relatorio_grupo_detalhe'?insRelatorioGrupoDetalhe(d):d.action==='relatorio_inspecoes'?insRelatorioList(d):insRelatorioDetalhe(d));
    }
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
  const id=Utilities.getUuid(),now=insNowLocalISO();
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
/**
 * Grava horário da fábrica, com offset explícito. Preserva o instante correto,
 * mas exibe 14:32 -03:00 em vez de 17:32Z para America/Sao_Paulo.
 */
function insNowLocalISO(){
  const instant=new Date(),zone='America/Sao_Paulo';
  const value=Utilities.formatDate(instant,zone,"yyyy-MM-dd'T'HH:mm:ss");
  const tz=Utilities.formatDate(instant,zone,'Z');
  const offset=tz.slice(0,3)+':'+tz.slice(3);
  return value+offset;
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
  const requestedEmpresa=insCode(d.codEmpresa);
  const candidatos=apontamentos.filter(a=>String(a.COD_MAQUINA)===String(d.codMaquina)&&insCode(a.COD_PECAS)===peca&&insCode(a.U_TP)===processo&&String(a.FUNCIONARIO)===String(d.funcionario)&&(!requestedEmpresa||insCode(insEmpresaValue(a))===requestedEmpresa));
  const requestedOs=insCode(d.numOs);
  const requestedApontamento=String(d.apontamento||'').trim();
  const porApontamento=candidatos.filter(a=>requestedApontamento&&requestedApontamento===String(a.ID_APONTAMENTO||a.GUID_APONTAMENTO||'').trim());
  const porOs=candidatos.filter(a=>requestedOs&&requestedOs===insCode(insOsValue(a)));
  // Uma seleção ambígua jamais deve atribuir uma OS de outra empresa.
  const aberto=porApontamento.length===1?porApontamento[0]:
    porOs.length===1?porOs[0]:
    candidatos.length===1?candidatos[0]:null;
  if(candidatos.length>1&&!aberto)throw Error('Há mais de um apontamento para essa peça/máquina. Verifique a empresa e a OS antes de salvar.');
  if(!aberto)throw Error('Apontamento não está mais aberto. Atualize a tela.');
  if(requestedOs&&insCode(insOsValue(aberto))!==requestedOs)
    throw Error('A OS do apontamento mudou. Atualize a tela antes de salvar.');
  const instrumentos=insCpsRows('INSTRUMENTOS');
  const results=d.resultados||[];
  if(!Array.isArray(results)||results.length!==plano.parametros.length)throw Error('Preencha todos os parâmetros');
  const map=new Map(results.map(r=>[String(r.idParametro),r]));
  const rows=plano.parametros.map(p=>{
    const r=map.get(p.ID_PARAMETRO);if(!r)throw Error('Parâmetro faltando: '+p.NOME);
    let aprovado,medida='',cod='',venc='',nomeInstrumento='';
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
      nomeInstrumento=String(encontrado.NOME||'').trim();
    }
    return {ID_PARAMETRO:p.ID_PARAMETRO,TIPO:p.TIPO,NOME:p.NOME,MEDIDA:medida,COD_INSTRUMENTO:cod,RESULTADO:aprovado?'APROVADO':'REPROVADO',DT_VENCIMENTO_INSTRUMENTO:venc,NOME_INSTRUMENTO:nomeInstrumento};
  });
  const id=String(d.requisicaoId||Utilities.getUuid());
  if(insRows('INSPECOES').some(x=>x.ID_INSPECAO===id))return {ok:true,id,jaRegistrada:true};
  const result=rows.every(x=>x.RESULTADO==='APROVADO')?'APROVADO':'REPROVADO';
  const dataHora=insNowLocalISO();
  // O nome da peça é sempre TOS.TITULO da API /aponta_aberto,
  // e nunca um campo digitado ou modificado no navegador.
  const titulo=String(aberto.TITULO||d.titulo||'').trim();
  insAppend('INSPECOES',[{ID_INSPECAO:id,ID_APONTAMENTO:String(aberto.ID_APONTAMENTO||aberto.GUID_APONTAMENTO||d.apontamento||''),COD_MAQUINA:String(d.codMaquina||''),MAQUINA:String(d.maquina),FUNCIONARIO:String(d.funcionario),COD_PECAS:peca,TITULO:titulo,PROCESSO:processo,ID_PLANO:plano.ID_PLANO,VERSAO:plano.VERSAO,DATA_HORA:dataHora,RESULTADO:result,NUM_OS:insOsValue(aberto),COD_EMPRESA:insEmpresaValue(aberto)}]);
  insAppend('RESULTADOS',rows.map(r=>({...r,ID_INSPECAO:id})));
  const parametrosPorId=new Map(plano.parametros.map(p=>[p.ID_PARAMETRO,p]));
  // Nominal/limites somente após gravar a medição; jamais são enviados
  // na consulta plano_operador. O Worker os usa apenas no WhatsApp.
  const falhas=rows.filter(r=>r.RESULTADO==='REPROVADO').map(r=>{
    const parametro=parametrosPorId.get(r.ID_PARAMETRO);
    const cota=r.TIPO==='COTA';
    return {
      parametro:r.NOME,
      tipo:r.TIPO,
      medida:cota?r.MEDIDA:null,
      nominal:cota?insNumber(parametro.NOMINAL):null,
      minimo:cota?insNumber(parametro.TOL_MIN):null,
      maximo:cota?insNumber(parametro.TOL_MAX):null
    };
  });
  return {ok:true,id,resultado:result,dataHora,titulo,falhas};
}
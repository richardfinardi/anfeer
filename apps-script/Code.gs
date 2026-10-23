/**
 * ANFEER • Controle PLR compartilhado no Drive
 * Cole no Apps Script vinculado à planilha ANFEER_PLR_BANCO.
 * A planilha e a chave NÃO ficam no GitHub.
 *
 * 1. Execute instalarPLR(), autorize e copie CHAVE_PLR do registro de execução.
 * 2. Implantar > Nova implantação > Aplicativo da Web > Executar como: Eu;
 *    acesso: Qualquer pessoa. Compartilhe somente a URL /exec e a chave com gestores.
 */
const PLR_PROP_CHAVE = "ANFEER_PLR_CHAVE";
const PLR_REV_FERIAS = "ANFEER_PLR_REV_FERIAS";
const PLR_REV_REGRAS = "ANFEER_PLR_REV_REGRAS";
const PLR_REV_FUNC = "ANFEER_PLR_REV_FUNC";

function instalarPLR() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty(PLR_PROP_CHAVE)) p.setProperty(PLR_PROP_CHAVE,
      Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,""));
  console.log("CHAVE_PLR = "+p.getProperty(PLR_PROP_CHAVE));
  console.log("Planilha vinculada: "+bancoPLR_().getName());
}
function bancoPLR_() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw Error("Vincule o Apps Script diretamente à planilha ANFEER_PLR_BANCO.");
  return ss;
}
function propPLR_(key) {return PropertiesService.getScriptProperties().getProperty(key)||"0";}
function chavePLR_(valor) {
  const key=propPLR_(PLR_PROP_CHAVE);
  if(key==="0"||!valor||String(valor)!==key)throw Error("Chave de acesso inválida. Execute instalarPLR e informe a chave no painel.");
}
function isoPLR_(v) {
  if(Object.prototype.toString.call(v)==="[object Date]")
    return Utilities.formatDate(v,"America/Sao_Paulo","yyyy-MM-dd");
  const s=String(v||"").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:"";
}
function normPLR_(v) {
  return String(v||"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ");
}
function abaPLR_(nome) {
  const sh=bancoPLR_().getSheetByName(nome);
  if(!sh)throw Error("Aba "+nome+" não localizada no banco ANFEER.");
  return sh;
}
function linhasPLR_(nome,cols) {
  const sh=abaPLR_(nome),total=sh.getLastRow()-1;
  return total>0?sh.getRange(2,1,total,cols).getValues():[];
}
function feriasPLR_() {
  return linhasPLR_("FERIAS",4).filter(r=>r[0]&&r[1]).map(r=>({
    id:String(r[0]),funcionario:String(r[1]),inicio:isoPLR_(r[2]),fim:isoPLR_(r[3])
  }));
}
function regrasPLR_() {
  const fs={};
  linhasPLR_("FAIXAS",5).filter(r=>r[1]).forEach(r=>{
    (fs[String(r[1])] ||= []).push({min:Number(r[2]),nome:String(r[3]),cor:String(r[4])});
  });
  return linhasPLR_("REGRAS",4).filter(r=>r[0]).map(r=>({
    id:String(r[0]),inicio:isoPLR_(r[1]),fim:isoPLR_(r[2]),meta:Number(r[3]),
    faixas:(fs[String(r[0])]||[]).sort((a,b)=>a.min-b.min)
  }));
}
function funcionariosPLR_() {
  return linhasPLR_("FUNCIONARIOS",2).filter(r=>r[1]).map(r=>String(r[1]));
}
function snapshotPLR_() {
  return {ok:true,ferias:feriasPLR_(),regras:regrasPLR_(),funcionarios:funcionariosPLR_(),
    revisoes:{ferias:propPLR_(PLR_REV_FERIAS),regras:propPLR_(PLR_REV_REGRAS),
      funcionarios:propPLR_(PLR_REV_FUNC)},consultadoEm:new Date().toISOString()};
}
function saidaPLR_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  const q=e&&e.parameter||{};
  const cb=String(q.callback||"");
  let result;
  try {chavePLR_(q.key);result=snapshotPLR_();}
  catch(err){result={ok:false,erro:String(err.message||err)};}
  if(/^plrCallback_[A-Za-z0-9_]{4,80}$/.test(cb))
    return ContentService.createTextOutput(cb+"("+JSON.stringify(result)+");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return saidaPLR_(result);
}
function validarFeriasPLR_(lista) {
  if(!Array.isArray(lista)||lista.length>5000)throw Error("Quantidade inválida de férias.");
  const mapa={};
  lista.forEach(p=>{
    if(!p||!String(p.id||"").trim()||!normPLR_(p.funcionario)||!isoPLR_(p.inicio)||
      !isoPLR_(p.fim)||p.inicio>p.fim)throw Error("Registro de férias inválido.");
    (mapa[normPLR_(p.funcionario)] ||= []).push(p);
  });
  Object.values(mapa).forEach(arr=>{
    arr.sort((a,b)=>a.inicio.localeCompare(b.inicio));
    for(let i=1;i<arr.length;i++)if(arr[i-1].fim>=arr[i].inicio)
      throw Error("Férias sobrepostas de "+arr[i].funcionario);
  });
}
function validarRegrasPLR_(lista) {
  if(!Array.isArray(lista)||lista.length>200)throw Error("Quantidade inválida de regras.");
  const ordered=[...lista].sort((a,b)=>a.inicio.localeCompare(b.inicio));
  ordered.forEach((r,i)=>{
    if(!r||!String(r.id||"").trim()||!isoPLR_(r.inicio)||!isoPLR_(r.fim)||r.inicio>r.fim||
      !Number.isFinite(Number(r.meta))||Number(r.meta)<=0||Number(r.meta)>24)
      throw Error("Vigência ou meta inválida.");
    if(i&&ordered[i-1].fim>=r.inicio)throw Error("Períodos de vigência sobrepostos.");
    if(!Array.isArray(r.faixas)||r.faixas.length<1||r.faixas.length>20)
      throw Error("Status/faixas inválidos.");
    const fs=[...r.faixas].sort((a,b)=>Number(a.min)-Number(b.min));
    if(Number(fs[0].min)!==0)throw Error("A primeira faixa deve começar em 0%.");
    fs.forEach((f,j)=>{
      if(!Number.isFinite(Number(f.min))||Number(f.min)<0||Number(f.min)>100||
        (j&&Number(f.min)<=Number(fs[j-1].min))||
        !String(f.nome||"").trim()||!["danger","warning","success","dark"].includes(f.cor))
        throw Error("Faixas percentuais inválidas.");
    });
  });
}
function substituirLinhasPLR_(aba,matriz,colunas) {
  const sh=abaPLR_(aba);
  const antigas=sh.getLastRow()-1;
  if(antigas>0)sh.getRange(2,1,antigas,colunas).clearContent();
  if(!matriz.length)return;
  if(matriz.length>sh.getMaxRows()-1)sh.insertRowsAfter(sh.getMaxRows(),matriz.length-(sh.getMaxRows()-1));
  // Campos ISO tratados como texto para não converter conforme configuração de locale.
  sh.getRange(2,1,matriz.length,colunas).setNumberFormat("@");
  sh.getRange(2,1,matriz.length,colunas).setValues(matriz);
}
function adicionarFuncionariosPLR_(nomes) {
  const sh=abaPLR_("FUNCIONARIOS");
  const registrados=new Set(funcionariosPLR_().map(normPLR_));
  const rows=[];
  (nomes||[]).forEach(v=>{
    const nome=String(v||"").trim();
    if(!nome||nome.length>120||registrados.has(normPLR_(nome)))return;
    registrados.add(normPLR_(nome));
    rows.push([Utilities.getUuid(),nome,"",1,"MANUAL",new Date().toISOString()]);
  });
  if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,6).setValues(rows);
}
function doPost(e) {
  let lock;
  try{
    const payload=e&&e.parameter&&e.parameter.payload;
    if(!payload||payload.length>600000)throw Error("Payload inválido.");
    const q=JSON.parse(payload);
    chavePLR_(q.key);
    if(!["salvarFerias","salvarRegras"].includes(q.acao))throw Error("Ação não autorizada.");
    lock=LockService.getScriptLock();lock.waitLock(25000);
    const tipo=q.acao==="salvarFerias"?"ferias":"regras";
    const prop=tipo==="ferias"?PLR_REV_FERIAS:PLR_REV_REGRAS;
    if(String(q.revisao)!==propPLR_(prop))
      throw Error("CONFLITO: outro usuário alterou os dados. Atualize para evitar sobrescrever alterações.");
    const agora=new Date().toISOString();
    if(tipo==="ferias"){
      validarFeriasPLR_(q.periodos);
      substituirLinhasPLR_("FERIAS",q.periodos.map(p=>[p.id,p.funcionario,p.inicio,p.fim,agora,"SITE"]),6);
      adicionarFuncionariosPLR_(q.funcionarios||[]);
      PropertiesService.getScriptProperties().setProperty(PLR_REV_FUNC,Utilities.getUuid());
    }else{
      validarRegrasPLR_(q.regras);
      substituirLinhasPLR_("REGRAS",q.regras.map(r=>[r.id,r.inicio,r.fim,Number(r.meta),agora,"SITE"]),6);
      const faixas=[];
      q.regras.forEach(r=>r.faixas.forEach((f,i)=>
        faixas.push([r.id+"_"+i,r.id,Number(f.min),String(f.nome),String(f.cor)])));
      substituirLinhasPLR_("FAIXAS",faixas,5);
    }
    SpreadsheetApp.flush();
    const nova=Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty(prop,nova);
    return saidaPLR_({ok:true,revisao:nova});
  }catch(err){return saidaPLR_({ok:false,erro:String(err.message||err)});}
  finally{if(lock)lock.releaseLock();}
}

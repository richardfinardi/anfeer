/**
 * ANFEER PLR • relatórios e envio automático.
 * Colar como segundo arquivo "Relatorios.gs" no mesmo projeto Apps Script de Code.gs.
 * Dependências: bancoPLR_(), regrasPLR_(), feriasPLR_() e chavePLR_().
 * Execute instalarAgendamentoPLR() uma vez após a implantação.
 */
const DESTINATARIOS_ANFEER = [
  "richard@consultoriarf.net",
  "adriana@anfeer-n.com.br",
  "adriana@anfeer.com.br"
];
const URL_API_ANFEER = "https://anfeer.consultoriarf.net";
const ZONA_PLR = "America/Sao_Paulo";

function competenciaAnteriorPLR_() {
  const hoje = new Date();
  const ano = Number(Utilities.formatDate(hoje,ZONA_PLR,"yyyy"));
  const mes = Number(Utilities.formatDate(hoje,ZONA_PLR,"MM"));
  const anterior = new Date(ano,mes-2,15);
  return Utilities.formatDate(anterior,ZONA_PLR,"yyyy-MM");
}
function diasDaCompetenciaPLR_(competencia) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia))throw Error("Competência YYYY-MM inválida.");
  const ano=Number(competencia.slice(0,4)), mes=Number(competencia.slice(5,7));
  const ultimo=new Date(ano,mes,0).getDate();
  const iso=n=>competencia+"-"+String(n).padStart(2,"0");
  const dias=[];
  for(let d=1;d<=ultimo;d++){
    const data=new Date(ano,mes-1,d,12);
    if(data.getDay()===0||data.getDay()===6)continue;
    dias.push(iso(d));
  }
  return {inicio:iso(1),fim:iso(ultimo),dias};
}
function registrosApiPLR_(endpoint) {
  const resp=UrlFetchApp.fetch(URL_API_ANFEER+"/"+endpoint,{
    method:"get",muteHttpExceptions:true,followRedirects:true,
    headers:{"Accept":"application/json"},timeout:45000
  });
  if(resp.getResponseCode()<200||resp.getResponseCode()>299)
    throw Error("API "+endpoint+" devolveu HTTP "+resp.getResponseCode());
  const json=JSON.parse(resp.getContentText("UTF-8"));
  if(!Array.isArray(json))throw Error("API "+endpoint+" retornou resposta que não é lista.");
  return json;
}
function soDiaPLR_(v) {
  const m=String(v||"").match(/^(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:"";
}
function nomeSetorPLR_(registro,mapa) {
  const tipo=normPLR_(registro.TIPOSERVICO);
  return mapa[tipo]||(tipo.includes("BROCHAMENTO")?"BROCHAMENTO":"FERRAMENTARIA");
}
function indiceRegistroPLR_(i) {
  const previsto=Number(i.PREVISTO)||0,realizado=Number(i.REALIZADO)||0;
  if(realizado>previsto && previsto>0)return previsto/realizado*100;
  return previsto<=0&&realizado>0?0:100;
}
function mediaNumeroPLR_(lista) {
  return lista.length?lista.reduce((x,y)=>x+y,0)/lista.length:null;
}
function valorPercentualPLR_(n) {
  return n===null||!Number.isFinite(n)?"N/D":n.toFixed(1)+"%";
}
function valorHorasPLR_(n) {return Number(n||0).toFixed(2)+"h";}
function classificacaoPLR_(n) {
  return n===null?"SEM_DADOS":n>=90?"EXCELENTE":n>=70?"ATENCAO":"ABAIXO";
}
function fatorProprioBrochaPLR_() {
  const configs=linhasPLR_("CONFIG",2);
  const r=configs.find(x=>String(x[0])==="FATOR_PROPRIO_BROCHAMENTO");
  return r?String(r[1]).trim()==="1":false;
}
function dadosMensaisPLR_(competencia) {
  const {inicio,fim,dias}=diasDaCompetenciaPLR_(competencia);
  const [horas,erros,prev]=[
    registrosApiPLR_("HORAS_DIA"),
    registrosApiPLR_("ERRO_APONTAMENTO"),
    registrosApiPLR_("PREV_REAL")
  ];
  const mapaFuncionarios={},mapaServicos={},mapaHoras={},mapaErros=new Set();
  horas.forEach(h=>{
    const nome=String(h.funcionario||"").trim();
    const setor=String(h.SETOR||"").trim();
    if(nome&&setor)mapaFuncionarios[normPLR_(nome)]=setor;
    if(h.TP_MAQUINA&&setor)mapaServicos[normPLR_(h.TP_MAQUINA)]=normPLR_(setor);
  });
  erros.forEach(e=>{
    const data=soDiaPLR_(e.DATA_FIM),nome=String(e.FUNCIONARIO||"").trim();
    if(data>=inicio&&data<=fim&&nome)
      mapaErros.add(normPLR_(nome)+"|"+data);
  });
  const nomes=new Map();
  horas.forEach(h=>{
    const data=soDiaPLR_(h.data_fim),nome=String(h.funcionario||"").trim();
    if(!nome||data<inicio||data>fim)return;
    nomes.set(normPLR_(nome),nome);
    const chave=normPLR_(nome)+"|"+data;
    mapaHoras[chave]=(mapaHoras[chave]||0)+Math.max(0,Number(h.horas)||0);
  });
  erros.forEach(e=>{
    const data=soDiaPLR_(e.DATA_FIM),nome=String(e.FUNCIONARIO||"").trim();
    if(nome&&data>=inicio&&data<=fim)nomes.set(normPLR_(nome),nome);
  });
  if(!nomes.size)throw Error("Nenhum funcionário retornou horas ou erros no período. Email bloqueado para evitar relatório vazio.");
  const prevPeriodo=prev.filter(x=>{
    const data=soDiaPLR_(x.DT_FINALIZACAO);
    return data&&data>=inicio&&data<=fim;
  });
  if(!prevPeriodo.length)throw Error("PREV_REAL sem registros com DT_FINALIZACAO na competência. Envio bloqueado.");
  const porSetor={};
  prevPeriodo.forEach(x=>{
    const setor=nomeSetorPLR_(x,mapaServicos);
    if (!porSetor[setor]) porSetor[setor]=[];
    porSetor[setor].push(indiceRegistroPLR_(x));
  });
  const metaRegras=regrasPLR_(),ferias=feriasPLR_();
  const somenteFerramentaria=mediaNumeroPLR_(porSetor.FERRAMENTARIA||[]);
  const fatorBrochamentoAtivo=fatorProprioBrochaPLR_();
  const funcionarios=[...nomes.entries()].map(([chave,nome])=>{
    const setor=mapaFuncionarios[chave]||"OUTROS";
    const vac=ferias.filter(f=>normPLR_(f.funcionario)===chave);
    let meta=0,horasValidas=0,diasUteis=0,diasFerias=0;
    dias.forEach(data=>{
      if(vac.some(f=>f.inicio<=data&&f.fim>=data)){diasFerias++;return;}
      const regra=metaRegras.find(r=>r.inicio<=data&&r.fim>=data);
      const metaDia=regra?Number(regra.meta):8;
      meta+=metaDia;diasUteis++;
      const apontado=mapaErros.has(chave+"|"+data)?0:(mapaHoras[chave+"|"+data]||0);
      horasValidas+=Math.min(metaDia,apontado);
    });
    const eficienciaIndividual=meta>0?Math.min(100,horasValidas/meta*100):null;
    const efSetor=normPLR_(setor)==="BROCHAMENTO"&&!fatorBrochamentoAtivo?
      somenteFerramentaria:mediaNumeroPLR_(porSetor[normPLR_(setor)]||[]);
    const plr=eficienciaIndividual===null||efSetor===null?null:Math.min(100,eficienciaIndividual*(efSetor/100));
    return {nome,setor,diasUteis,diasFerias,meta,horasValidas,eficienciaIndividual,efSetor,plr,faixa:classificacaoPLR_(plr)};
  }).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
  if(funcionarios.every(x=>x.plr===null))
    throw Error("Nenhum PLR calculável: confirme a relação de tipos de serviço/setores e PREV_REAL.");
  const efGeral=mediaNumeroPLR_(prevPeriodo.filter(x=>
    fatorBrochamentoAtivo||nomeSetorPLR_(x,mapaServicos)!=="BROCHAMENTO"
  ).map(indiceRegistroPLR_));
  return {competencia,inicio,fim,dias,funcionarios,
    fatorBrochamentoAtivo,efGeral,porSetor,consultadoEm:new Date().toISOString()};
}
function documentoPdfPLR_(titulo,competencia,subtitulo,header,rows,infos=[]) {
  const doc=DocumentApp.create("TEMP ANFEER "+titulo+" "+competencia);
  const corpo=doc.getBody();
  const top=corpo.appendParagraph("ANFEER | "+titulo);
  top.setHeading(DocumentApp.ParagraphHeading.TITLE);
  corpo.appendParagraph("Competência: "+competencia+"  •  "+subtitulo).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  infos.forEach(texto=>corpo.appendParagraph(texto));
  corpo.appendParagraph(" ");
  // Divide tabela grande para evitar exceder limite de células de documentos.
  const blocos=rows.length?rows:[["Sem registros"]];
  const batch=70;
  for(let k=0;k<blocos.length;k+=batch){
    const tabela=corpo.appendTable([header,...blocos.slice(k,k+batch)]);
    const linha=tabela.getRow(0);
    for(let j=0;j<linha.getNumCells();j++){
      const cell=linha.getCell(j);
      cell.setBackgroundColor("#26313d");
      cell.editAsText().setForegroundColor("#ffffff").setBold(true);
    }
    if(k+batch<blocos.length)corpo.appendParagraph("Continuação...");
  }
  corpo.appendParagraph("Fonte: API ANFEER (HORAS_DIA, ERRO_APONTAMENTO, PREV_REAL) e BANCO_DADOS (férias/regras).");
  corpo.appendParagraph("Emitido em "+Utilities.formatDate(new Date(),ZONA_PLR,"dd/MM/yyyy HH:mm"));
  doc.saveAndClose();
  const file=DriveApp.getFileById(doc.getId());
  const blob=file.getAs("application/pdf").setName("ANFEER_"+titulo.replace(/\s+/g,"_")+"_"+competencia+".pdf");
  file.setTrashed(true);
  return blob;
}
function anexosPLR_(dados) {
  const mes=dados.competencia;
  const membros=dados.funcionarios;
  const header=["Funcionário","Setor","Dias úteis","Férias","Horas válidas","Meta","Efic. ind.","Efic. setor","PLR final"];
  const linha=f=>[f.nome,f.setor,String(f.diasUteis),String(f.diasFerias),valorHorasPLR_(f.horasValidas),
    valorHorasPLR_(f.meta),valorPercentualPLR_(f.eficienciaIndividual),
    valorPercentualPLR_(f.efSetor),valorPercentualPLR_(f.plr)];
  const anexos=[];
  [["ABAIXO","Abaixo (<70%)"],["ATENCAO","Atenção (70% até <90%)"],["EXCELENTE","Excelente (>=90%)"]].forEach(([faixa,descricao])=>{
    const selecionados=membros.filter(m=>m.faixa===faixa);
    anexos.push(documentoPdfPLR_("PLR "+faixa,mes,descricao,header,
      selecionados.map(linha),
      ["Funcionários nesta faixa: "+selecionados.length,
       "Fator Brochamento: "+(dados.fatorBrochamentoAtivo?"Próprio":"Utiliza a eficiência da Ferramentaria")]));
  });
  const excelentes=membros.filter(x=>x.faixa==="EXCELENTE").length;
  const atencao=membros.filter(x=>x.faixa==="ATENCAO").length;
  const abaixo=membros.filter(x=>x.faixa==="ABAIXO").length;
  const mediaPLR=mediaNumeroPLR_(membros.map(x=>x.plr).filter(x=>x!==null));
  const totalHoras=membros.reduce((s,x)=>s+x.horasValidas,0);
  const resumo=[
    "Colaboradores: "+membros.length+" | Abaixo: "+abaixo+
    " | Atenção: "+atencao+" | Excelente: "+excelentes,
    "PLR médio: "+valorPercentualPLR_(mediaPLR)+
    " | Eficiência geral: "+valorPercentualPLR_(dados.efGeral),
    "Horas válidas acumuladas: "+valorHorasPLR_(totalHoras),
    "Fator Brochamento: "+(dados.fatorBrochamentoAtivo?"Próprio":"Mesmo da Ferramentaria")
  ];
  anexos.push(documentoPdfPLR_("GERENCIAL PLR",mes,"Consolidado de indicadores por funcionário",
    header,membros.sort((a,b)=>(b.plr===null?-1:b.plr)-(a.plr===null?-1:a.plr)).map(linha),resumo));
  return anexos;
}
function registrosEnvioPLR_(){
  return linhasPLR_("ENVIOS",6).filter(r=>r[0]).map(r=>({
    competencia:String(r[0]),enviadoEm:String(r[1]),status:String(r[3]),
    quantidade:Number(r[4])||0,observacao:String(r[5]||"")
  }));
}
function registrarEnvioPLR_(competencia,status,quantidade,motivo) {
  abaPLR_("ENVIOS").appendRow([competencia,new Date().toISOString(),
    DESTINATARIOS_ANFEER.join(", " ),status,quantidade,String(motivo||"").slice(0,500)]);
}
function enviarRelatoriosPLR_(competencia,manual=false,forcar=false) {
  let lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))throw Error("Outro processamento PLR está em andamento.");
  try{
    const enviados=registrosEnvioPLR_().some(x=>x.competencia===competencia&&x.status==="ENVIADO");
    if(enviados&&!forcar){return {ok:false,erro:"Esta competência já foi enviada. Para reenviar manualmente, confirme o reenvio."};}
    const dados=dadosMensaisPLR_(competencia);
    const anexos=anexosPLR_(dados);
    if(anexos.length!==4)throw Error("Não foi possível produzir os quatro PDFs.");
    const assunto="ANFEER | Relatórios PLR - "+competencia;
    MailApp.sendEmail({
      to:DESTINATARIOS_ANFEER.join(","),
      subject:assunto,
      htmlBody:"<p>Seguem os relatórios PLR da competência <b>"+competencia+
        "</b>.</p><p>Em anexo: Abaixo, Atenção, Excelente e Gerencial (4 PDFs).</p>"+
        "<p>Gerado automaticamente a partir dos dados reais da ANFEER.</p>",
      attachments:anexos,name:"ANFEER - Indicadores PLR"
    });
    registrarEnvioPLR_(competencia,"ENVIADO",4,manual?"Disparo manual":"Envio automático mensal");
    return {ok:true,competencia,enviado:true};
  }catch(err){
    registrarEnvioPLR_(competencia,"ERRO",0,String(err.message||err));
    throw err;
  }finally{lock.releaseLock();}
}
function enviarRelatoriosMensaisPLR() {
  // Executada automaticamente no dia 1. Nunca envia relatórios parciais.
  return enviarRelatoriosPLR_(competenciaAnteriorPLR_(),false,false);
}
function instalarAgendamentoPLR() {
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==="enviarRelatoriosMensaisPLR")
    .forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger("enviarRelatoriosMensaisPLR").timeBased().onMonthDay(1)
    .atHour(8).nearMinute(0).inTimezone(ZONA_PLR).create();
  console.log("Agendamento PLR instalado: dia 1, aproximadamente 08:00 (São Paulo).");
}

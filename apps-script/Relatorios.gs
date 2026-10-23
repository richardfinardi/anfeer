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
// Não gerar PDFs no Apps Script: os quatro documentos vêm do mesmo jsPDF do painel.

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

/**
 * Envio unificado: recebe os QUATRO PDFs criados pelos geradores jsPDF
 * originais do site ANFEER, preservando layout, filtros e memória de cálculo.
 * Nunca recria PDF via Google Docs.
 */
function enviarPdfsProntosPLR_(solicitacao) {
  const competencia=String(solicitacao.competencia||"");
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia))
    throw Error("Competência inválida.");
  const esperados=[
    "ANFEER_PLR_ABAIXO_"+competencia+".pdf",
    "ANFEER_PLR_ATENCAO_"+competencia+".pdf",
    "ANFEER_PLR_EXCELENTE_"+competencia+".pdf",
    "ANFEER_GERENCIAL_PLR_"+competencia+".pdf"
  ];
  if(!Array.isArray(solicitacao.arquivos)||solicitacao.arquivos.length!==4)
    throw Error("Envio bloqueado: são obrigatórios os quatro PDFs originais.");
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw Error("Já existe outro processamento de e-mail em andamento.");
  try {
    if(registrosEnvioPLR_().some(x=>x.competencia===competencia&&x.status==="ENVIADO") &&
      solicitacao.reenviar!==true)
      throw Error("Competência já enviada. Reenvio só pode ser confirmado manualmente.");
    let somaBytes=0;
    const blobs=esperados.map(nome=>{
      const reg=solicitacao.arquivos.find(x=>x&&x.nome===nome);
      if(!reg||typeof reg.base64!=="string"||!reg.base64)
        throw Error("Arquivo ausente: "+nome);
      if(reg.base64.length>20*1024*1024)throw Error("PDF excede limite: "+nome);
      const bytes=Utilities.base64Decode(reg.base64);
      if(bytes.length<500||bytes[0]!==37||bytes[1]!==80||bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)
        throw Error("PDF inválido: "+nome);
      somaBytes+=bytes.length;
      return Utilities.newBlob(bytes,"application/pdf",nome);
    });
    if(somaBytes>19*1024*1024)throw Error("Os anexos excedem o tamanho seguro de e-mail (19 MB).");
    if(MailApp.getRemainingDailyQuota()<DESTINATARIOS_ANFEER.length)
      throw Error("Cota diária de envio de e-mail insuficiente.");
    MailApp.sendEmail({
      to:DESTINATARIOS_ANFEER.join(","),
      subject:"ANFEER | Relatórios PLR - "+competencia,
      htmlBody:"<p>Seguem os <b>quatro PDFs originais do painel ANFEER</b>, competência <b>"+
        competencia+"</b>.</p><p>Indicadores Abaixo, Atenção, Excelente e Gerencial.</p>"+
        "<p>Todos os anexos foram gerados usando o mesmo mecanismo do botão Exportar PDF da aplicação.</p>",
      attachments:blobs,
      name:"ANFEER - Indicadores PLR"
    });
    registrarEnvioPLR_(competencia,"ENVIADO",4,"4 PDFs originais gerados pela aplicação");
    return {ok:true,competencia,enviado:true,quantidade:4};
  }catch(err){
    registrarEnvioPLR_(competencia,"ERRO",0,String(err.message||err));
    throw err;
  }finally{lock.releaseLock();}
}
/**
 * Compatibilidade: impede que um gatilho ANTIGO envie os PDFs simples do Docs.
 * O automático usa a tarefa GitHub Actions (navegador Chromium + jsPDF).
 */
function enviarRelatoriosMensaisPLR(){
  console.error("Envio legado desativado. PDFs mensais devem ser gerados no navegador pelo workflow PLR.");
  return {ok:false,erro:"Gatilho legado desativado para preservar os PDFs originais."};
}
function instalarAgendamentoPLR(){
  // Mantém o nome para compatibilidade com instruções antigas, mas apaga o
  // gatilho do Docs: NÃO há envio mensal direto pelo Apps Script.
  const lista=ScriptApp.getProjectTriggers().filter(t=>
    t.getHandlerFunction()==="enviarRelatoriosMensaisPLR");
  lista.forEach(t=>ScriptApp.deleteTrigger(t));
  console.log("Gatilho antigo eliminado. Configure o agendamento no GitHub Actions.");
}

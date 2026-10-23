/**
 * ANFEER • Envio mensal de PDFs ORIGINAIS do site.
 * Executa Chromium (Playwright) no GitHub Actions: usa os mesmos
 * criarPdfIndicadoresPLR() e criarPdfGerencialPLR() do navegador.
 * Google Apps Script apenas encaminha os quatro blobs PDF por e-mail.
 */
import { chromium } from 'playwright';

const scriptUrl=process.env.ANFEER_PLR_WEBAPP_URL?.trim();
const chave=process.env.ANFEER_PLR_WEBAPP_KEY?.trim();
const semEnviar=process.env.DRY_RUN==='true';
const reenviar=process.env.REENVIAR==='true';

function competenciaAnterior(){
  const hoje=new Date();
  const anterior=new Date(hoje.getFullYear(),hoje.getMonth()-1,1);
  return anterior.getFullYear()+'-'+String(anterior.getMonth()+1).padStart(2,'0');
}
const competencia=process.env.COMPETENCIA?.trim() || competenciaAnterior();
if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia))throw Error('Competência inválida.');
if(competencia>competenciaAnterior())throw Error('Não é permitido enviar competências em aberto.');
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(scriptUrl||''))
  throw Error('Configure ANFEER_PLR_WEBAPP_URL nos Secrets do GitHub.');
if(!chave||chave.length<20)
  throw Error('Configure ANFEER_PLR_WEBAPP_KEY nos Secrets do GitHub.');
const host=process.env.REPORT_LOCAL_URL||'http://127.0.0.1:8123/apontamento/index.html';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({locale:'pt-BR',timezoneId:'America/Sao_Paulo',
    acceptDownloads:false,javaScriptEnabled:true});
  await context.addInitScript(()=>{
    // A página exige a existência de sessão, mas não usa um token de sessão
    // para buscar os dados públicos da API. Nenhuma credencial pessoal é simulada.
    localStorage.setItem('anfeer_user',JSON.stringify({modo:'relatorio_automatizado'}));
  });
  await context.route(/^https:\/\/anfeer\.consultoriarf\.net\//,async route=>{
    const u=route.request().url();
    try {
      const response=await route.fetch({timeout:60000,maxRedirects:4});
      if(response.status()<200||response.status()>299)
        throw Error('API retornou HTTP '+response.status()+' em '+new URL(u).pathname);
      const body=await response.body();
      await route.fulfill({status:response.status(),
        contentType:response.headers()['content-type']||'application/json',
        headers:{'access-control-allow-origin':'*','cache-control':'no-store'},
        body});
    }catch(e){
      console.error('A API ANFEER não respondeu corretamente:',e.message);
      await route.abort('failed');
    }
  });
  const pagina=await context.newPage();
  const errosPagina=[];
  pagina.on('pageerror',e=>errosPagina.push(String(e.message)));
  await pagina.goto(host,{waitUntil:'domcontentloaded',timeout:60000});
  await pagina.waitForFunction(()=>{
    return typeof dadosPLRCarregados!=='undefined' && dadosPLRCarregados &&
      typeof plrGerarQuatroPdfs==='function' &&
      typeof criarPdfIndicadoresPLR==='function' &&
      typeof criarPdfGerencialPLR==='function' &&
      Boolean(window.jspdf?.jsPDF?.API?.autoTable);
  },{timeout:120000});
  // Leitura do banco compartilhado antes de gerar os documentos.
  const snapshot=await pagina.evaluate(async ({url,key})=>{
    const dados=await plrDriveLer({url,key});
    plrDriveAplicar(dados);
    return {ferias:dados.ferias.length,regras:dados.regras.length,
      enviados:(dados.envios||[]).filter(e=>e.competencia),
      consultadoEm:dados.consultadoEm};
  },{url:scriptUrl,key:chave});
  const jaEnviado=snapshot.enviados.some(e=>e.competencia===competencia&&e.status==='ENVIADO');
  if(jaEnviado&&!reenviar){
    console.log('Competência',competencia,'já enviada. Nenhum novo e-mail será disparado.');
    process.exitCode=0;
  }else{
    const pdfs=await pagina.evaluate(comp=>plrGerarQuatroPdfs(comp),competencia);
    if(pdfs.length!==4 || pdfs.some(p=>!p.base64.startsWith('JVBERi0')))
      throw Error('Os quatro PDFs originais não foram produzidos.');
    console.log('Quatro PDFs originais gerados:',pdfs.map(x=>x.nome+' ('+Math.round(x.base64.length*0.75/1024)+' KB)').join(', '));
    if(errosPagina.length)console.warn('Avisos de página:',errosPagina.slice(0,3).join(' / '));
    if(semEnviar){
      console.log('DRY_RUN: PDFs validados; nenhum e-mail enviado.');
    }else{
      const dados={acao:'enviarPdfsProntos',key:chave,competencia,
        reenviar,arquivos:pdfs};
      const response=await fetch(scriptUrl,{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({payload:JSON.stringify(dados)}),
        redirect:'follow',signal:AbortSignal.timeout(110000)});
      if(!response.ok)throw Error('Apps Script respondeu HTTP '+response.status);
      const retorno=await response.json();
      if(!retorno.ok||!retorno.enviado||retorno.quantidade!==4)
        throw Error('E-mail não enviado: '+(retorno.erro||JSON.stringify(retorno)));
      console.log('Envio confirmado:',competencia,'4 PDFs originais; 3 destinatários.');
    }
  }
}finally{
  await browser.close();
}

/* ANFEER • ÚNICA origem de PDFs para Download, E-mail e Automação.
 * Reutiliza exatamente os métodos jsPDF do site (não recria as tabelas no Apps Script).
 */
function plrCompetenciaPeriodo(competencia) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(competencia)))
        throw Error('Competência inválida (YYYY-MM).');
    const ano=Number(competencia.slice(0,4)),mes=Number(competencia.slice(5,7));
    const ultimo=new Date(ano,mes,0).getDate();
    return {inicio:competencia+'-01',fim:competencia+'-'+String(ultimo).padStart(2,'0')};
}
function plrPdfParaAnexo(doc,nome){
    if(!doc || typeof doc.output!=='function')throw Error('PDF '+nome+' não foi gerado.');
    const data=doc.output('datauristring');
    const indice=data.indexOf(',');
    const b64=indice>=0?data.slice(indice+1):'';
    if(!b64.startsWith('JVBERi0') || b64.length<400)
        throw Error('PDF inválido ou vazio: '+nome);
    return {nome,base64:b64};
}
function plrChecarDadosRelatorio(){
    if(!dadosPLRCarregados)throw Error('Os dados de PLR não terminaram de carregar.');
    if(!Array.isArray(rawHoras)||!rawHoras.length ||
       !Array.isArray(rawPrevReal)||!rawPrevReal.length)
       throw Error('Dados de HORAS_DIA ou PREV_REAL indisponíveis. Envio bloqueado.');
}
function plrGerarQuatroPdfs(competencia) {
    plrChecarDadosRelatorio();
    const p=plrCompetenciaPeriodo(competencia);
    const chaves=['filtro-data-inicio','filtro-data-fim','filtro-servico',
        'filtro-funcionario','filtro-aproveitamento'];
    const originais=Object.fromEntries(chaves.map(id=>[id,document.getElementById(id).value]));
    const setorOriginal=setorAtivo;
    const lista=[];
    try {
        document.getElementById('filtro-data-inicio').value=p.inicio;
        document.getElementById('filtro-data-fim').value=p.fim;
        document.getElementById('filtro-servico').value='';
        document.getElementById('filtro-funcionario').value='';
        setorAtivo='';
        const grupos=[['ABAIXO','ABAIXO'],['ATENCAO','ATENCAO'],['EXCELENTE','EXCELENTE']];
        for(const [categoria,rotulo] of grupos){
            document.getElementById('filtro-aproveitamento').value=categoria;
            renderizarPLR();
            const doc=criarPdfIndicadoresPLR();
            lista.push(plrPdfParaAnexo(doc,'ANFEER_PLR_'+rotulo+'_'+competencia+'.pdf'));
        }
        document.getElementById('filtro-aproveitamento').value='';
        renderizarPLR();
        // O gerencial usa a mesma base/filtros; cria os gráficos e modelo antes do PDF.
        gerencialRenderizar();
        lista.push(plrPdfParaAnexo(criarPdfGerencialPLR(),'ANFEER_GERENCIAL_PLR_'+competencia+'.pdf'));
        if(lista.length!==4)throw Error('São obrigatórios quatro relatórios.');
        const total=lista.reduce((s,a)=>s+a.base64.length,0);
        if(total>24*1024*1024)throw Error('Os quatro PDFs excedem o tamanho permitido pelo serviço de e-mail.');
        return lista;
    }finally{
        chaves.forEach(id=>{document.getElementById(id).value=originais[id]});
        setorAtivo=setorOriginal;
        renderizarPLR();
        // Evita deixar o gerencial com filtro/competência temporários do envio.
        if(document.getElementById('secao-gerencial').style.display!=='none')gerencialRenderizar();
    }
}


/* ANFEER • Gerencial: mesma base, mesmas regras, mesmos filtros do Indicadores PLR. */
let ultimoModeloGerencial = null;
let gerencialPreparado = false;

function gerencialFormato(v, casas=1) {
    return Number.isFinite(v) ? v.toLocaleString('pt-BR',{minimumFractionDigits:casas,maximumFractionDigits:casas}) : 'N/D';
}
function gerencialPct(v) { return Number.isFinite(v) ? gerencialFormato(v)+'%' : 'N/D'; }
function gerencialNomeFaixa(f) {
    return ({ABAIXO:'Abaixo',ATENCAO:'Atenção',EXCELENTE:'Excelente',SEM_DADOS:'Sem dados'})[f] || f;
}
function gerencialFiltrosSincronizar() {
    if (!document.getElementById('secao-gerencial')) return;
    const mapa = {inicio:'filtro-data-inicio',fim:'filtro-data-fim',
        servico:'filtro-servico',funcionario:'filtro-funcionario',aproveitamento:'filtro-aproveitamento'};
    Object.entries(mapa).forEach(([destino,origem])=>{
        const de=document.getElementById('ger-filtro-'+destino);
        const original=document.getElementById(origem);
        if (!de || !original) return;
        if (de.tagName==='SELECT') de.innerHTML=original.innerHTML;
        de.value=original.value;
    });
    const select=document.getElementById('ger-filtro-setor');
    if (select) {
        const atual=select.value;
        select.innerHTML='<option value="">TODOS OS SETORES</option>';
        const existentes=[...new Set(Object.values(mapaFuncionarioSetor).filter(Boolean).map(x=>String(x).trim()))].sort();
        existentes.forEach(s=>{
            const op=document.createElement('option');op.value=s;op.textContent=s;select.appendChild(op);
        });
        if(setorAtivo&&!existentes.includes(setorAtivo)){
            const op=document.createElement('option');op.value=setorAtivo;op.textContent=setorAtivo;select.appendChild(op);
        }
        select.value=setorAtivo || '';
        if (!select.value && atual && setorAtivo) select.value=setorAtivo;
    }
    gerencialPreparado=true;
}
function gerencialAplicarFiltros() {
    if(!gerencialPreparado)return;
    const mapa={inicio:'filtro-data-inicio',fim:'filtro-data-fim',
        servico:'filtro-servico',funcionario:'filtro-funcionario',aproveitamento:'filtro-aproveitamento'};
    Object.entries(mapa).forEach(([origem,destino])=>{
        document.getElementById(destino).value=document.getElementById('ger-filtro-'+origem).value;
    });
    setorAtivo=document.getElementById('ger-filtro-setor').value;
    const setorNormalizado=textoNormalizado(setorAtivo);
    document.querySelectorAll('#container-abas-setor .sector-tab-btn').forEach((b,i)=>{
        const nome=i===0?'':textoNormalizado(b.textContent);
        b.classList.toggle('active',nome===setorNormalizado);
    });
    aplicarFiltros();
}
function gerencialPeriodoRapido(meses) {
    definirPeriodoMes(meses);
    // definirPeriodoMes já chama renderizarPLR e sincroniza os campos, se houver dados.
    gerencialFiltrosSincronizar();
}

function gerencialSerieDiaria(m) {
    const f=m.filtros;
    const hoje=new Date();
    const fimHoje=hoje.getFullYear()+'-'+String(hoje.getMonth()+1).padStart(2,'0')+'-'+String(hoje.getDate()).padStart(2,'0');
    const fim=f.fim<fimHoje?f.fim:fimHoje;
    if(!f.inicio||f.inicio>fim||!m.funcionarios.length)return [];
    const lista=[];
    for(let d=new Date(f.inicio+'T12:00:00'),final=new Date(fim+'T12:00:00');d<=final;d.setDate(d.getDate()+1)){
        if(d.getDay()===0||d.getDay()===6)continue;
        const dia=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        const metaPorPessoa=configDia(dia).meta;
        let meta=0,horas=0;
        m.funcionarios.forEach(x=>{
            if(feriasAtiva(x.nome,dia))return;
            meta+=metaPorPessoa;
            horas+=Math.min(metaPorPessoa,Math.max(0,x.porData[dia]||0));
        });
        if(meta>0)lista.push({dia,meta,horas});
    }
    if(lista.length<=31)return lista.map(x=>({...x,rotulo:x.dia.slice(8,10)+'/'+x.dia.slice(5,7)}));
    const modo=lista.length>140?'mes':'semana';
    const agrupados=new Map();
    lista.forEach(x=>{
        const data=new Date(x.dia+'T12:00:00');
        if(modo==='semana')data.setDate(data.getDate()-(data.getDay()+6)%7);
        const chave=modo==='mes'?x.dia.slice(0,7):data.getFullYear()+'-'+String(data.getMonth()+1).padStart(2,'0')+'-'+String(data.getDate()).padStart(2,'0');
        const atual=agrupados.get(chave)||{dia:chave,meta:0,horas:0,rotulo:modo==='mes'?chave.slice(5,7)+'/'+chave.slice(2,4):chave.slice(8,10)+'/'+chave.slice(5,7)};
        atual.meta+=x.meta;atual.horas+=x.horas;agrupados.set(chave,atual);
    });
    return [...agrupados.values()];
}
function gerencialModeloAtual() {
    const src=window.gerencialDadosPLR;
    if(!src)return null;
    const f=src.filtros;
    const funcs=src.funcionarios||[];
    const conhecidos=funcs.filter(x=>x.plr!==null);
    const media=arr=>arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:null;
    const faixaCount={ABAIXO:0,ATENCAO:0,EXCELENTE:0,SEM_DADOS:0};
    funcs.forEach(x=>faixaCount[x.faixa]=(faixaCount[x.faixa]||0)+1);
    const porSetor={};
    funcs.forEach(x=>{
        const key=x.setor||'OUTROS';
        if(!porSetor[key])porSetor[key]={nome:key,funcionarios:0,efInd:[],plr:[]};
        porSetor[key].funcionarios++;
        if(x.efInd!==null)porSetor[key].efInd.push(x.efInd);
        if(x.plr!==null)porSetor[key].plr.push(x.plr);
    });
    const setores=Object.values(porSetor).map(x=>({
        nome:x.nome,funcionarios:x.funcionarios,plr:media(x.plr),efInd:media(x.efInd)
    })).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
    const porServico={};
    src.prevDoSetor.forEach(x=>{
        const nome=String(x.TIPOSERVICO||'OUTROS').trim();
        if(!porServico[nome])porServico[nome]={nome,soma:0,quantidade:0};
        porServico[nome].soma+=fatorDoRegistro(x);
        porServico[nome].quantidade++;
    });
    const servicos=Object.values(porServico).map(x=>({...x,ef:x.soma/x.quantidade}))
        .sort((a,b)=>a.ef-b.ef || a.nome.localeCompare(b.nome,'pt-BR'));
    const ord=[...funcs].sort((a,b)=>(b.plr??-1)-(a.plr??-1) || a.nome.localeCompare(b.nome,'pt-BR'));
    const resultado={
        filtros:f,funcionarios:funcs,ord,faixaCount,setores,servicos,
        eficienciaSetor:src.efSetorAba,
        mediaPLR:media(conhecidos.map(x=>x.plr)),
        mediaIndividual:media(funcs.map(x=>x.efInd).filter(x=>x!==null)),
        totalHoras:funcs.reduce((s,x)=>s+x.horasValidasPLR,0),
        excelentes:conhecidos.length ? faixaCount.EXCELENTE/conhecidos.length*100 : null,
        diasUteis:src.diasUteis,
        serie:[]
    };
    resultado.serie=gerencialSerieDiaria(resultado);
    return resultado;
}
function gerencialHtmlVazio(texto='Sem registros para os filtros selecionados.') {
    return '<div class="g-empty">'+escaparHtml(texto)+'</div>';
}
function gerencialRenderizar() {
    gerencialFiltrosSincronizar();
    const m=gerencialModeloAtual();
    ultimoModeloGerencial=m;
    if(!m)return;
    const setText=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    const f=m.filtros;
    setText('g-subtitulo-periodo',dataBr(f.inicio)+' — '+dataBr(f.fim));
    setText('g-colaboradores',String(m.funcionarios.length));
    setText('g-plr-medio',gerencialPct(m.mediaPLR));
    setText('g-individual-medio',gerencialPct(m.mediaIndividual));
    setText('g-ef-setor',gerencialPct(m.eficienciaSetor));
    setText('g-horas-validas',gerencialFormato(m.totalHoras,1)+'h');
    setText('g-excelentes',gerencialPct(m.excelentes));
    setText('g-foot-plr',m.funcionarios.length+' selecionados • '+m.faixaCount.SEM_DADOS+' sem cálculo PLR');
    setText('g-foot-horas','Horas válidas, limitadas à meta diária • '+m.diasUteis+' dias úteis decorridos');
    setText('g-foot-excelentes',m.faixaCount.EXCELENTE+' de '+(m.funcionarios.length-m.faixaCount.SEM_DADOS)+' com PLR calculado');
    const n=m.funcionarios.length, c=m.faixaCount;
    const c1=n?100*c.ABAIXO/n:0,c2=n?100*c.ATENCAO/n:0,c3=n?100*c.EXCELENTE/n:0;
    const disco=document.getElementById('g-donut');
    disco.style.background=n?
        'conic-gradient(#ef4444 0% '+c1+'%,#f59e0b '+c1+'% '+(c1+c2)+'%,#10b981 '+(c1+c2)+'% '+(c1+c2+c3)+'%,#94a3b8 '+(c1+c2+c3)+'% 100%)':
        '#e5e7eb';
    setText('g-donut-centro',String(n));
    for(const k of ['ABAIXO','ATENCAO','EXCELENTE','SEM_DADOS'])setText('g-legend-'+k,String(c[k]||0));
    const ranking=document.getElementById('g-ranking');
    ranking.innerHTML=m.ord.length?m.ord.slice(0,10).map((x,i)=>{
        const cor=x.faixa==='EXCELENTE'?'#10b981':x.faixa==='ATENCAO'?'#f59e0b':x.faixa==='ABAIXO'?'#ef4444':'#94a3b8';
        return '<div class="g-bar-row"><div class="g-bar-name" title="'+escaparHtml(x.nome)+'">'+(i+1)+'. '+escaparHtml(x.nome)+'</div>'+
            '<div class="g-track"><div class="g-fill" style="width:'+(x.plr===null?0:Math.min(100,Math.max(0,x.plr)))+'%;background:'+cor+'"></div></div>'+
            '<div class="g-bar-pct">'+gerencialPct(x.plr)+'</div></div>';
    }).join(''):gerencialHtmlVazio();
    const evo=document.getElementById('g-evolucao');
    evo.innerHTML=m.serie.length?m.serie.map(x=>{
        const p=x.meta>0?Math.min(100,Math.max(0,x.horas/x.meta*100)):0;
        const title=x.rotulo+': '+gerencialFormato(x.horas)+'h válidas / '+gerencialFormato(x.meta)+'h de meta';
        return '<div class="g-evo-item" title="'+escaparHtml(title)+'"><div class="g-evo-percent">'+gerencialFormato(p,0)+'%</div>'+
            '<div class="g-evo-column-wrap"><div class="g-evo-column" style="height:'+p+'%"></div></div>'+
            '<div class="g-evo-label">'+escaparHtml(x.rotulo)+'</div></div>';
    }).join(''):gerencialHtmlVazio('Não há dias úteis ou funcionários para compor a evolução.');
    setText('g-evolucao-unidade',m.serie.length>31?'Período agregado':'Dias úteis • horas válidas / meta');
    const setorEl=document.getElementById('g-setores');
    setorEl.innerHTML=m.setores.length?m.setores.map(x=>
        '<tr><td><strong>'+escaparHtml(x.nome)+'</strong></td><td>'+x.funcionarios+'</td><td>'+gerencialPct(x.efInd)+
        '</td><td><strong>'+gerencialPct(x.plr)+'</strong></td></tr>').join(''):
        '<tr><td colspan="4">Sem dados para os filtros selecionados.</td></tr>';
    const serv=document.getElementById('g-servicos');
    serv.innerHTML=m.servicos.length?m.servicos.slice(0,12).map(x=>
        '<tr><td><strong>'+escaparHtml(x.nome)+'</strong></td><td>'+x.quantidade+
        '</td><td><span class="g-pill" data-faixa="'+(x.ef>=90?'EXCELENTE':x.ef>=70?'ATENCAO':'ABAIXO')+'">'+gerencialPct(x.ef)+'</span></td></tr>').join(''):
        '<tr><td colspan="3">Sem apontamentos PREV_REAL datados no período/setor/serviço.</td></tr>';
    const rankingTable=document.getElementById('g-colaboradores-tabela');
    rankingTable.innerHTML=m.ord.length?m.ord.map((x,i)=>
        '<tr><td>'+(i+1)+'</td><td><strong>'+escaparHtml(x.nome)+'</strong></td><td>'+escaparHtml(x.setor)+
        '</td><td>'+gerencialPct(x.efInd)+'</td><td><span class="g-pill" data-faixa="'+x.faixa+'">'+gerencialPct(x.plr)+
        ' • '+gerencialNomeFaixa(x.faixa)+'</span></td></tr>').join(''):
        '<tr><td colspan="5">Nenhum funcionário no filtro escolhido.</td></tr>';
}
function criarPdfGerencialPLR() {
    const m=ultimoModeloGerencial;
    if(!dadosPLRCarregados||!m){alert('Aguarde o carregamento dos indicadores.');return;}
    const JS=window.jspdf && window.jspdf.jsPDF;
    if(!JS){alert('Biblioteca PDF indisponível. Atualize a página com Ctrl+F5.');return;}
    const doc=new JS({orientation:'landscape',unit:'mm',format:'a4'});
    if(typeof doc.autoTable!=='function'){alert('Recurso de tabelas PDF não carregado.');return;}
    const largura=doc.internal.pageSize.getWidth();
    const semAcento=t=>String(t??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const txt=(t,x,y,opts)=>doc.text(semAcento(t),x,y,opts);
    doc.setFillColor(33,37,43);doc.rect(0,0,largura,32,'F');
    doc.setFillColor(217,35,29);doc.rect(0,0,largura,3,'F');
    doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(18);
    txt('ANFEER  |  PAINEL GERENCIAL PLR',14,16);
    doc.setFont('helvetica','normal');doc.setFontSize(9);
    txt('Indicadores consolidados e analise de desempenho',14,24);
    doc.setTextColor(40,43,48);doc.setFont('helvetica','normal');doc.setFontSize(9);
    const filtro=m.filtros;
    const contexto='Periodo: '+dataBr(filtro.inicio)+' a '+dataBr(filtro.fim)+
        '    |    Setor: '+(setorAtivo||'TODOS')+'    |    Servico: '+(filtro.servico||'TODOS');
    txt(contexto,14,41,{maxWidth:largura-28});
    const linha2='Funcionario: '+(filtro.func||'TODOS')+'    |    Faixa PLR: '+gerencialNomeFaixa(filtro.aproveitamento||'TODOS');
    txt(linha2,14,47,{maxWidth:largura-28});
    const kpis=[
        ['COLABORADORES',String(m.funcionarios.length)],
        ['PLR MEDIO',gerencialPct(m.mediaPLR)],
        ['EFICIENCIA INDIVIDUAL',gerencialPct(m.mediaIndividual)],
        ['EFICIENCIA DO SETOR',gerencialPct(m.eficienciaSetor)],
        ['HORAS VALIDAS PLR',gerencialFormato(m.totalHoras)+'h'],
        ['EM EXCELENTE',gerencialPct(m.excelentes)]
    ];
    const cardL=(largura-28-5*3)/6;
    kpis.forEach(([nome,valor],i)=>{
        const x=14+i*(cardL+3);
        doc.setFillColor(246,248,250);doc.roundedRect(x,53,cardL,25,2,2,'F');
        doc.setDrawColor(225,231,237);doc.roundedRect(x,53,cardL,25,2,2,'S');
        doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(95,105,115);
        txt(nome,x+3,60,{maxWidth:cardL-6});
        doc.setFontSize(15);doc.setTextColor(34,40,48);
        txt(valor,x+3,71);
    });
    doc.setTextColor(40,43,48);
    let y=86;
    function tabela(titulo,cabecalhos,linhas){
        if(y>177){doc.addPage();y=18;}
        doc.setFont('helvetica','bold');doc.setFontSize(11);txt(titulo,14,y);y+=3;
        doc.autoTable({startY:y,head:[cabecalhos.map(semAcento)],
            body:linhas.length?linhas.map(l=>l.map(semAcento)):[['Sem dados no periodo.']],
            margin:{left:14,right:14,top:16,bottom:15},theme:'grid',
            styles:{font:'helvetica',fontSize:8,cellPadding:2.5,overflow:'linebreak'},
            headStyles:{fillColor:[40,45,53],textColor:255},
            alternateRowStyles:{fillColor:[248,249,251]}});
        y=doc.lastAutoTable.finalY+10;
    }
    const c=m.faixaCount;
    tabela('Distribuicao do aproveitamento PLR',['Abaixo (<70%)','Atencao (70%-89,9%)','Excelente (>=90%)','Sem dados'],
        [[String(c.ABAIXO),String(c.ATENCAO),String(c.EXCELENTE),String(c.SEM_DADOS)]]);
    tabela('Desempenho por setor',['Setor','Colaboradores','Eficiencia individual media','PLR medio'],
        m.setores.map(s=>[s.nome,String(s.funcionarios),gerencialPct(s.efInd),gerencialPct(s.plr)]));
    tabela('Ranking de colaboradores (filtros aplicados)',['#','Funcionario','Setor','Horas validas PLR','Eficiencia individual','PLR final','Classificacao'],
        m.ord.map((x,i)=>[String(i+1),x.nome,x.setor,gerencialFormato(x.horasValidasPLR)+'h',
            gerencialPct(x.efInd),gerencialPct(x.plr),gerencialNomeFaixa(x.faixa)]));
    tabela('Servicos - menor eficiencia primeiro (indice do periodo/setor)',['Tipo de servico','Registros','Eficiencia media'],
        m.servicos.map(x=>[x.nome,String(x.quantidade),gerencialPct(x.ef)]));
    tabela('Evolucao de horas validas / meta',['Dia / periodo','Horas validas','Meta total','Atingimento'],
        m.serie.map(x=>[x.rotulo,gerencialFormato(x.horas)+'h',gerencialFormato(x.meta)+'h',
            gerencialPct(x.meta?100*x.horas/x.meta:null)]));
    const paginas=doc.internal.getNumberOfPages();
    for(let p=1;p<=paginas;p++){
        doc.setPage(p);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(110);
        txt('ANFEER | Gerencial PLR | Gerado em '+new Date().toLocaleString('pt-BR')+
            ' | Pagina '+p+'/'+paginas,14,doc.internal.pageSize.getHeight()-7);
    }
    return doc;
}
function gerencialGerarPDF() {
    const doc=criarPdfGerencialPLR();
    if(doc) {
        const f=obterFiltrosAtivos();
        doc.save('ANFEER_Gerencial_PLR_'+f.inicio+'_a_'+f.fim+'.pdf');
    }
}

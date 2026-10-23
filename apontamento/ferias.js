
/* Férias por funcionário • frontend estático • armazenamento local com exportação. */
const FERIAS_KEY = 'anfeer_ferias_v1';
let periodosFerias = [];
let funcionariosExtras = [];
let feriasEditorId = '';
try {
    const antigo = JSON.parse(localStorage.getItem(FERIAS_KEY) || '{}');
    periodosFerias = Array.isArray(antigo.periodos) ? antigo.periodos : [];
    funcionariosExtras = Array.isArray(antigo.funcionarios) ? antigo.funcionarios : [];
} catch(e) { console.warn('Férias: configuração local não encontrada.',e); }
function feriasNome(n) { return String(n||'').trim(); }
function feriasChave(n) { return textoNormalizado(n).replace(/\s+/g,' '); }
function feriasFuncionarios() {
    const nomes=new Map();
    function add(s) {
        const nome=feriasNome(s),key=feriasChave(nome);
        if(nome && !nomes.has(key))nomes.set(key,nome);
    }
    rawHoras.forEach(r=>add(r.funcionario));
    rawErros.forEach(r=>add(r.FUNCIONARIO));
    funcionariosExtras.forEach(add);
    periodosFerias.forEach(p=>add(p.funcionario));
    return [...nomes.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function feriasAtiva(func, dia) {
    const chave=feriasChave(func);
    if(!chave||!dia)return false;
    return periodosFerias.some(p=>feriasChave(p.funcionario)===chave && p.inicio<=dia && p.fim>=dia);
}
function feriasValidar(lista) {
    if (!Array.isArray(lista) || lista.length>5000)return 'Número de registros de férias inválido.';
    const grupos={};
    for(const p of lista){
        if(!p || typeof p.id!=='string'||!p.id || typeof p.funcionario!=='string'||!feriasChave(p.funcionario))return 'Preencha o nome do funcionário.';
        if(!p.inicio||!p.fim||extrairDataIso(p.inicio)!==p.inicio||extrairDataIso(p.fim)!==p.fim||p.inicio>p.fim)return 'Período de férias inválido.';
        const k=feriasChave(p.funcionario);
        if(!grupos[k])grupos[k]=[];
        grupos[k].push(p);
    }
    for(const valores of Object.values(grupos)){
        valores.sort((a,b)=>a.inicio.localeCompare(b.inicio));
        for(let i=1;i<valores.length;i++)if(valores[i-1].fim>=valores[i].inicio)return 'Os períodos de um mesmo funcionário não podem se sobrepor.';
    }
    return '';
}
async function feriasPersistir(novos, extras=funcionariosExtras) {
    const erro=feriasValidar(novos);
    if(erro)throw new Error(erro);
    const ordenadas=[...novos].sort((a,b)=>b.inicio.localeCompare(a.inicio));
    if(typeof plrDriveAtivo==='function' && plrDriveAtivo()){
        // Falha no Drive não vira gravação apenas local: evita divergência entre usuários.
        const confirmado=await plrDriveGravar('ferias',{periodos:ordenadas,funcionarios:extras});
        if(!confirmado)throw Error('O Drive não confirmou a gravação.');
    }else{
        localStorage.setItem(FERIAS_KEY,JSON.stringify({versao:1,periodos:ordenadas,funcionarios:extras}));
        periodosFerias=ordenadas;
        funcionariosExtras=[...extras];
        if (dadosPLRCarregados) renderizarPLR();
        feriasRenderizar();
    }
}
function feriasMensagem(m,erro=false){
    const el=document.getElementById('vac-mensagem');
    if(!el)return;
    el.textContent=m;el.style.color=erro?'#991b1b':'#065f46';
}
function feriasLimpar() {
    feriasEditorId='';
    document.getElementById('vac-edicao').value='';
    document.getElementById('vac-inicio').value='';
    document.getElementById('vac-fim').value='';
    feriasMensagem('');
}
async function feriasCadastrarFuncionario() {
    const nome=prompt('Nome completo do funcionário que ainda não aparece na lista:');
    if(!nome)return;
    const padronizado=feriasNome(nome);
    if(!padronizado||padronizado.length>120){feriasMensagem('Nome do funcionário inválido.',true);return;}
    if(feriasFuncionarios().some(n=>feriasChave(n)===feriasChave(padronizado))){
        feriasMensagem('Este funcionário já está cadastrado.',true);return;
    }
    try{await feriasPersistir(periodosFerias,[...funcionariosExtras,padronizado]);feriasMensagem('Funcionário adicionado '+(typeof plrDriveAtivo==='function'&&plrDriveAtivo()?'ao Google Drive.':'neste navegador.'));}
    catch(e){feriasMensagem(e.message,true);}
    document.getElementById('vac-funcionario').value=padronizado;
}
async function feriasSalvar() {
    const nome=document.getElementById('vac-funcionario').value;
    const inicio=document.getElementById('vac-inicio').value, fim=document.getElementById('vac-fim').value;
    const id=feriasEditorId||'ferias-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const novos=[...periodosFerias.filter(p=>p.id!==id),{id,funcionario:nome,inicio,fim}];
    try {
        await feriasPersistir(novos);
        feriasLimpar();
        feriasMensagem('Férias salvas com sucesso '+(typeof plrDriveAtivo==='function'&&plrDriveAtivo()?'no Google Drive.':'neste navegador.'));
    }catch(e){feriasMensagem(e.message,true);}
}
function feriasEditar(id){
    const p=periodosFerias.find(x=>x.id===id);if(!p)return;
    feriasEditorId=id;
    document.getElementById('vac-edicao').value=id;
    feriasRenderizar();
    document.getElementById('vac-funcionario').value=p.funcionario;
    document.getElementById('vac-inicio').value=p.inicio;
    document.getElementById('vac-fim').value=p.fim;
    feriasMensagem('Editando as férias de '+p.funcionario+'.');
    document.getElementById('vac-inicio').focus();
}
async function feriasExcluir(id){
    const p=periodosFerias.find(x=>x.id===id);
    if(!p||!confirm('Excluir as férias de '+p.funcionario+' ('+dataBr(p.inicio)+' a '+dataBr(p.fim)+')?'))return;
    try{await feriasPersistir(periodosFerias.filter(x=>x.id!==id));feriasLimpar();feriasMensagem('Período excluído.');}
    catch(e){feriasMensagem(e.message,true);}
}
function feriasExportar() {
    const content=JSON.stringify({versao:1,periodos:periodosFerias,funcionarios:funcionariosExtras},null,2);
    const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='ANFEER_ferias.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function feriasImportar(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    try{
        if(file.size>500000)throw Error('Arquivo maior que o permitido.');
        const payload=JSON.parse(await file.text());
        if(payload.versao!==1||!Array.isArray(payload.periodos)||!Array.isArray(payload.funcionarios))throw Error('Formato JSON inválido.');
        const erro=feriasValidar(payload.periodos);if(erro)throw Error(erro);
        if(!confirm('Substituir as férias e os funcionários adicionais deste navegador pelo arquivo importado?'))return;
        await feriasPersistir(payload.periodos,payload.funcionarios);
        feriasLimpar();
        feriasMensagem('Configuração importada.');
    }catch(e){feriasMensagem('Erro: '+e.message,true);}
}
function feriasRenderizar() {
    const sel=document.getElementById('vac-funcionario');
    if(!sel)return;
    const atual=sel.value;
    sel.innerHTML='<option value="">SELECIONE O FUNCIONÁRIO</option>';
    const nomes=feriasFuncionarios();
    nomes.forEach(nome=>{const op=document.createElement('option');op.value=nome;op.textContent=nome;sel.appendChild(op);});
    if(feriasEditorId){
        const periodo=periodosFerias.find(p=>p.id===feriasEditorId);
        sel.value=periodo?.funcionario||atual;
    }else sel.value=atual;
    const agora=new Date(),hoje=agora.getFullYear()+'-'+String(agora.getMonth()+1).padStart(2,'0')+'-'+String(agora.getDate()).padStart(2,'0');
    document.getElementById('vac-total-funcionarios').textContent=String(nomes.length);
    const ativos=new Set(periodosFerias.filter(p=>p.inicio<=hoje&&p.fim>=hoje).map(p=>feriasChave(p.funcionario)));
    document.getElementById('vac-em-ferias').textContent=String(ativos.size);
    document.getElementById('vac-periodos').textContent=String(periodosFerias.length);
    const query=feriasChave(document.getElementById('vac-busca')?.value||'');
    const ano=document.getElementById('vac-ano')?.value||'';
    const registros=periodosFerias.filter(p=>(!query||feriasChave(p.funcionario).includes(query))&&
        (!ano||(p.inicio.slice(0,4)<=ano&&p.fim.slice(0,4)>=ano)));
    const corpo=document.getElementById('vac-tbody');corpo.innerHTML='';
    registros.forEach(p=>{
        const estado=p.inicio>hoje?'futuro':p.fim<hoje?'passado':'agora';
        const rotulo=estado==='futuro'?'Programadas':estado==='passado'?'Encerradas':'Em férias';
        const tr=document.createElement('tr');
        tr.innerHTML='<td><strong>'+escaparHtml(p.funcionario)+'</strong></td>'+
            '<td>'+dataBr(p.inicio)+'</td><td>'+dataBr(p.fim)+'</td>'+
            '<td><span class="vac-status '+estado+'">'+rotulo+'</span></td>'+
            '<td><button class="vac-mini vac-edit" type="button">Editar</button> <button class="vac-mini vac-delete" type="button">Excluir</button></td>';
        tr.querySelector('.vac-edit').addEventListener('click',()=>feriasEditar(p.id));
        tr.querySelector('.vac-delete').addEventListener('click',()=>feriasExcluir(p.id));
        corpo.appendChild(tr);
    });
    if(!registros.length)corpo.innerHTML='<tr><td colspan="5">Nenhum período de férias encontrado.</td></tr>';
    document.getElementById('vac-registros').textContent=String(registros.length);
}

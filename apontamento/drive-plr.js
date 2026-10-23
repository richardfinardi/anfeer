/* ANFEER • conexão compartilhada Google Sheets via Web App Apps Script.
 * O repositório público nunca contém URL privada nem chave.
 */
const PLR_DRIVE_LOCAL='anfeer_plr_webapp_v1';
let plrDriveConn=null;
let plrDriveRevision={ferias:'0',regras:'0',funcionarios:'0',fator:'0'};
let plrDriveEnvios=[];
let plrDriveSaving=false;
try{const x=JSON.parse(localStorage.getItem(PLR_DRIVE_LOCAL)||'null');
    if(x?.url&&x?.key)plrDriveConn=x;}catch(e){console.warn('PLR Drive configuração inválida.');}
function plrDriveAtivo(){return Boolean(plrDriveConn?.url&&plrDriveConn?.key);}
function plrDriveInfo(msg,erro=false){
    const s=document.getElementById('plr-drive-status');
    if(s){s.textContent=msg;s.style.color=erro?'#991b1b':'#065f46';}
    const badge=document.getElementById('plr-drive-badge');
    if(badge)badge.textContent=plrDriveAtivo()?'Drive configurado':'Sem Drive configurado';
}
function plrDriveJSONP(config){
    return new Promise((resolve,reject)=>{
        const callback='plrCallback_'+Date.now()+'_'+Math.random().toString(36).slice(2);
        const script=document.createElement('script');
        let done=false,timeout;
        function finish(e,data){
            if(done)return;done=true;
            clearTimeout(timeout);script.remove();delete window[callback];
            if(e)reject(e);else resolve(data);
        }
        window[callback]=dados=>finish(null,dados);
        script.onerror=()=>finish(Error('Não foi possível carregar o Web App. Confira publicação e acesso.'));
        timeout=setTimeout(()=>finish(Error('O Google Drive demorou a responder.')),25000);
        const u=new URL(config.url);
        u.searchParams.set('key',config.key);
        u.searchParams.set('callback',callback);
        u.searchParams.set('_',String(Date.now()));
        script.src=u.toString();document.head.appendChild(script);
    });
}
async function plrDriveLer(config=plrDriveConn){
    if(!config)throw Error('Falta configurar a URL do Apps Script e a chave.');
    const dados=await plrDriveJSONP(config);
    if(!dados?.ok)throw Error(dados?.erro||'Resposta inválida do banco de dados.');
    if(!Array.isArray(dados.ferias)||!Array.isArray(dados.regras)||!Array.isArray(dados.funcionarios))
        throw Error('Estrutura incorreta no banco Google.');
    const erroFerias=feriasValidar(dados.ferias);
    const erroRegras=validarRegras(dados.regras);
    if(erroFerias||erroRegras)throw Error(erroFerias||erroRegras);
    return dados;
}
function plrDriveAplicar(dados){
    periodosFerias=[...dados.ferias].sort((a,b)=>b.inicio.localeCompare(a.inicio));
    regrasStatus=[...dados.regras].sort((a,b)=>a.inicio.localeCompare(b.inicio));
    funcionariosExtras=[...dados.funcionarios];
    if(typeof dados.fatorBrochamentoProprio==='boolean')
        usarFatorProprioBrochamento=dados.fatorBrochamentoProprio;
    plrDriveRevision={
        ferias:String(dados.revisoes?.ferias||'0'),
        regras:String(dados.revisoes?.regras||'0'),
        funcionarios:String(dados.revisoes?.funcionarios||'0'),
        fator:String(dados.revisoes?.fator||'0')
    };
    plrDriveEnvios=dados.envios||[];
    if(typeof atualizaControleFatorBrochamento==='function')atualizaControleFatorBrochamento();
    listarRegras();feriasRenderizar();
    if(dadosPLRCarregados)renderizarPLR();
    plrDriveInfo('Google Drive conectado — férias, regras e fator sincronizados.');
}
async function plrDriveConectar(){
    const inputUrl=document.getElementById('plr-drive-url').value.trim();
    const key=document.getElementById('plr-drive-key').value.trim();
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(inputUrl)){
        plrDriveInfo('Informe o link /exec da implantação do Apps Script.',true);return;
    }
    if(key.length<20){plrDriveInfo('Informe a chave criada pela função instalarPLR().',true);return;}
    const config={url:inputUrl.replace(/\/$/,''),key};
    plrDriveInfo('Testando a conexão com o banco...');
    try{
        const dados=await plrDriveLer(config);
        plrDriveConn=config;
        localStorage.setItem(PLR_DRIVE_LOCAL,JSON.stringify(config));
        plrDriveAplicar(dados);
        document.getElementById('plr-drive-key').value='';
        document.getElementById('plr-drive-key').placeholder='Chave salva neste navegador';
    }catch(e){plrDriveInfo('Conexão não ativada: '+e.message,true);}
}
async function plrDriveAtualizar(){
    if(!plrDriveAtivo()){plrDriveInfo('O Drive ainda não está configurado.',true);return;}
    try{plrDriveInfo('Buscando dados compartilhados...');plrDriveAplicar(await plrDriveLer());}
    catch(e){plrDriveInfo('Falha ao atualizar: '+e.message,true);}
}
function plrDriveDesconectar(){
    if(!confirm('Desconectar o Drive deste navegador? Os dados da planilha serão preservados.'))return;
    localStorage.removeItem(PLR_DRIVE_LOCAL);
    plrDriveConn=null;plrDriveInfo('Drive desconectado. Modo local ativo.');
}
function plrDriveIgual(tipo,dados,pedido) {
    if(tipo==='ferias'){
        const normaliza=x=>[...x].map(v=>[v.id,v.funcionario,v.inicio,v.fim]).sort((a,b)=>a[0].localeCompare(b[0]));
        const iguais=JSON.stringify(normaliza(dados.ferias))===JSON.stringify(normaliza(pedido.periodos));
        const nomes=new Set(dados.funcionarios.map(x=>textoNormalizado(x)));
        return iguais&&pedido.funcionarios.every(x=>nomes.has(textoNormalizado(x)));
    }
    if(tipo==='regras'){
        const normaliza=x=>[...x].map(v=>({
            id:v.id,inicio:v.inicio,fim:v.fim,meta:Number(v.meta),
            faixas:[...v.faixas].map(f=>({min:Number(f.min),nome:f.nome,cor:f.cor})).sort((a,b)=>a.min-b.min)
        })).sort((a,b)=>a.id.localeCompare(b.id));
        return JSON.stringify(normaliza(dados.regras))===JSON.stringify(normaliza(pedido.regras));
    }
    if(tipo==='fator')return dados.fatorBrochamentoProprio===pedido.ativo;
    return false;
}
async function plrDrivePOST(payload){
    if(!plrDriveAtivo())throw Error('O Drive não está conectado.');
    // Apps Script responde por redirecionamento e não oferece CORS para POST;
    // a confirmação obrigatória ocorre via leitura autenticada depois da gravação.
    const form=new URLSearchParams({payload:JSON.stringify({...payload,key:plrDriveConn.key})});
    await fetch(plrDriveConn.url,{
        method:'POST',mode:'no-cors',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:form
    });
}
async function plrDriveGravar(tipo,payload){
    if(!plrDriveAtivo())return false;
    if(plrDriveSaving)throw Error('Há uma operação de gravação em andamento.');
    plrDriveSaving=true;
    const antiga=plrDriveRevision[tipo]||'0';
    try{
        await plrDrivePOST({
            acao:tipo==='ferias'?'salvarFerias':tipo==='regras'?'salvarRegras':'alterarBrochamento',
            revisao:antiga,...payload
        });
        for(let n=0;n<9;n++){
            await new Promise(r=>setTimeout(r,650+n*250));
            const data=await plrDriveLer();
            if(String(data.revisoes?.[tipo]||'0')!==antiga){
                if(!plrDriveIgual(tipo,data,payload))
                    throw Error('O Drive mudou, mas não corresponde ao cadastro. Atualize antes de editar novamente.');
                plrDriveAplicar(data);
                return true;
            }
        }
        throw Error('A gravação não foi confirmada no Drive. Verifique se outro usuário alterou os dados e clique Atualizar.');
    }finally{plrDriveSaving=false;}
}
function plrDriveCompetenciaAnterior(){
    const d=new Date(),a=d.getFullYear(),m=d.getMonth();
    const anterior=new Date(a,m-1,1);
    return anterior.getFullYear()+'-'+String(anterior.getMonth()+1).padStart(2,'0');
}
async function plrDriveEnviarEmail(){
    if(!plrDriveAtivo()){alert('Configure e conecte o Google Drive na aba Status Apontamento antes de enviar relatórios por e-mail.');return;}
    const campo=document.getElementById('plr-email-competencia');
    const competencia=campo.value;
    const referencia=plrDriveCompetenciaAnterior();
    if(!/^\d{4}-\d{2}$/.test(competencia)||competencia>referencia){
        alert('Escolha uma competência mensal encerrada (até o mês anterior).');return;
    }
    const anteriores=plrDriveEnvios.filter(x=>x.competencia===competencia&&x.status==='ENVIADO');
    const reenviar=anteriores.length>0;
    const destinatarios='richard@consultoriarf.net, adriana@anfeer-n.com.br e adriana@anfeer.com.br';
    const pergunta=(reenviar?'Esta competência JÁ FOI ENVIADA. Deseja REENVIAR os quatro PDFs?':
        'Enviar os quatro PDFs do PLR (Abaixo, Atenção, Excelente e Gerencial)?')+
        '\nCompetência: '+competencia+'\nDestinatários: '+destinatarios;
    if(!confirm(pergunta))return;
    const msg=document.getElementById('plr-email-status');
    const btn=document.getElementById('plr-btn-email');
    btn.disabled=true;
    msg.textContent='Preparando PDFs e processando o envio no Google Apps Script...';
    const antes=plrDriveEnvios.length;
    try{
        await plrDrivePOST({acao:'enviarRelatorios',competencia,reenviar});
        for(let n=0;n<25;n++){
            await new Promise(r=>setTimeout(r,1500+n*250));
            const snapshot=await plrDriveLer();
            const registros=(snapshot.envios||[]).filter(x=>x.competencia===competencia);
            const antigos=plrDriveEnvios.filter(x=>x.competencia===competencia);
            // O backend cria um novo registro em ENVIOS somente após concluir o processo.
            if(registros.length>antigos.length){
                plrDriveAplicar(snapshot);
                const ultimo=registros[registros.length-1];
                if(ultimo.status==='ENVIADO'){msg.textContent='Enviado com sucesso: 4 PDFs para os três destinatários.';return;}
                throw Error('Falha no envio: '+(ultimo.observacao||'consulte ENVIOS no Drive'));
            }
        }
        throw Error('O envio não foi confirmado. Confira ENVIOS na planilha antes de tentar novamente.');
    }catch(e){msg.textContent='Envio não confirmado: '+e.message;}
    finally{btn.disabled=false;}
}
(function iniciarDrivePLR(){
    const cfg=plrDriveConn;
    const input=document.getElementById('plr-drive-url');
    if(input)input.value=cfg?.url||'';
    const competencia=document.getElementById('plr-email-competencia');
    if(competencia)competencia.value=plrDriveCompetenciaAnterior();
    plrDriveInfo(cfg?'Drive configurado, verificando acesso...':'Drive não configurado. Cadastros ainda são locais.');
    if(cfg)plrDriveAtualizar();
})();

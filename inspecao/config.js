window.ANFEER_INSPECAO={
 API_CPS:'https://anfeer.consultoriarf.net',
 // Cole a URL /exec do deployment Apps Script aqui. Não publique PIN neste arquivo.
 API_SHEETS:'https://script.google.com/macros/s/AKfycbyhvjEly4JGYXKPybayZCizhcl6afl-xpA6ICQfHRAUbGAjFqxFkaPuyrVI5Gx8Y_qV/exec'
};
window.InspecaoAPI={
 
 ready(){return !!window.ANFEER_INSPECAO.API_SHEETS},
 async get(action,params={}){
  const url=window.ANFEER_INSPECAO.API_SHEETS;
  if(!url)throw Error('Integração Google Sheets ainda não configurada (inspecao/config.js).');
  return new Promise((resolve,reject)=>{
   const cb='ins_cb_'+Date.now()+'_'+Math.floor(Math.random()*99999);
   const s=document.createElement('script');
   const timer=setTimeout(()=>finish(new Error('Tempo esgotado ao consultar o Google Sheets')),18000);
   const finish=(e,v)=>{clearTimeout(timer);delete window[cb];s.remove();e?reject(e):v.ok?resolve(v):reject(Error(v.error||'Falha na API'))};
   window[cb]=v=>finish(null,v);
   s.onerror=()=>finish(Error('Não foi possível consultar o Apps Script'));
   s.src=url+(url.includes('?')?'&':'?')+new URLSearchParams({...params,action,callback:cb});
   document.head.appendChild(s);
  })
 },
 async post(payload){
  if(!this.ready())throw Error('Configure API_SHEETS em inspecao/config.js');
  // Apps Script não envia cabeçalhos CORS. POST simples com resposta opaca.
  // A escrita é conferida com leitura subsequente pelo identificador salvo.
  await fetch(window.ANFEER_INSPECAO.API_SHEETS,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,})});
 },
 async operatorPlan(peca,processo){
  let primaryError=null;
  try {
   const r=await this.get('plano_operador',{peca,processo});
   if(r.plano)return r.plano;
  }catch(e){primaryError=e}
  // Compatibilidade com implantações anteriores do Apps Script.
  // Nunca colocar nominal/tolerâncias no HTML do formulário.
  try{
   const r=await this.get('planos');
   const p=(r.planos||[]).filter(x=>String(x.COD_PECAS||'').trim().toUpperCase()===String(peca||'').trim().toUpperCase()&&
     String(x.PROCESSO||'').trim().toUpperCase()===String(processo||'').trim().toUpperCase()&&
     String(x.ATIVO||'').trim().toLowerCase()==='true')
    .sort((a,b)=>Number(b.VERSAO)-Number(a.VERSAO))[0];
   if(!p)return null;
   const {parametros,...cabecalho}=p;
   return {...cabecalho,parametros:(parametros||[]).map(({ID_PARAMETRO,ORDEM,TIPO,NOME,FAMILIA,OBRIGATORIO})=>
    ({ID_PARAMETRO,ORDEM,TIPO,NOME,FAMILIA,OBRIGATORIO}))};
  }catch(e){
   throw new Error('Falha ao carregar plano pelo Apps Script. Consulta direta: '+(primaryError?.message||'sem plano')+'; consulta alternativa: '+e.message);
  }
 },
 async cps(path){
  const r=await fetch(window.ANFEER_INSPECAO.API_CPS+'/'+path,{cache:'no-store'});
  if(!r.ok)throw Error('Falha no endpoint '+path+': '+r.status);
  const j=await r.json();return Array.isArray(j)?j:Array.isArray(j.dados)?j.dados:Array.isArray(j.items)?j.items:[]
 }
};
window.insLogin=function(){return true};
window.insEscape=function(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
window.insDate=function(v){const s=String(v||'');return s.slice(0,10)};
window.insVence=function(v){const s=String(v||'').trim();if(!s)return false;const date=s.match(/^(\d{4})-(\d{2})-(\d{2})/)?s.slice(0,10):s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)?s.slice(6,10)+'-'+s.slice(3,5)+'-'+s.slice(0,2):'';return date&&date>=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'})};
window.insFamilia=function(i){return String(i.FAMILIA||'').trim()};
window.insInstrumentos=function(items,familia){return items.filter(i=>insFamilia(i)===String(familia||'').trim()&&String(i.VALIDADE||'').toUpperCase()==='OK'&&insVence(i.DT_VENCIMENTO))};

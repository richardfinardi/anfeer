/**
 * ANFEER | Monitor automático de horas das brochas.
 * Cloudflare Worker acionado por CRON, sem página e sem login no navegador.
 *
 * Bindings:
 *   DB                 Cloudflare D1 (estado persistente)
 *   WHATSAPP_APP_KEY   Secret da aplicação anfeer_brochas na Central AUVRIUN
 *
 * Cron recomendado: a cada cinco minutos (configurado no Cloudflare).
 *
 * Primeira leitura: registra a situação atual, SEM disparar alertas antigos.
 * A partir daí: 1 alerta por empresa+OS ao alcançar >= 80%.
 */
const ORIGEM = "https://anfeer.consultoriarf.net/brochas";
const DESTINO = "https://auvriun-whatsapp.auvriun-monitor.workers.dev/whatsapp/v1/send";
const APLICACAO = "anfeer_brochas";
const LIMIAR = 80;
const MAX_ENVIOS_POR_EXECUCAO = 30;
const MAX_TENTATIVAS = 5;
const TEMPO_CLAIM_MS = 20 * 60 * 1000;

export default {
  async scheduled(_event, env) {
    try {
      await verificar(env);
    } catch (e) {
      console.error("ANFEER BROCHAS: execução interrompida:", String(e?.message || e));
      throw e;
    }
  }
};

async function verificar(env) {
  if (!env.DB?.prepare) throw Error("Binding D1 DB não configurado.");
  if (!String(env.WHATSAPP_APP_KEY || "").trim()) {
    throw Error("Secret WHATSAPP_APP_KEY não configurado.");
  }
  await prepararBanco(env.DB);

  const linhas = await obterDados();
  const osMap = consolidar(linhas);
  if (!osMap.size) throw Error("Endpoint sem OS válidas. Não será atualizado o estado.");

  const agora = new Date().toISOString();
  const primeiraConsulta = !(await env.DB.prepare(
    "SELECT valor FROM monitor_meta WHERE chave = 'baseline_concluida'"
  ).first());

  const dados = Array.from(osMap.values());
  for (let i = 0; i < dados.length; i += 50) {
    const lote = dados.slice(i, i + 50).map(os => env.DB.prepare(
      "INSERT INTO monitor_os (id, percentual, situacao, visto_em) " +
      "VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "percentual = excluded.percentual, visto_em = excluded.visto_em"
    ).bind(os.id, os.percentual,
      primeiraConsulta && os.percentual >= LIMIAR ? "BASELINE" : "OBSERVANDO",
      agora));
    await env.DB.batch(lote);
  }

  if (primeiraConsulta) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO monitor_meta (chave, valor) VALUES (?, ?)"
    ).bind("baseline_concluida", agora).run();
    console.log("ANFEER BROCHAS: primeira leitura registrada; sem alertas retroativos.", {
      os: dados.length, jaAcima80: dados.filter(x => x.percentual >= LIMIAR).length
    });
    return;
  }

  const cutoff = new Date(Date.now() - TEMPO_CLAIM_MS).toISOString();
  const pendentes = await env.DB.prepare(
    "SELECT id, situacao, tentativas, ultima_tentativa " +
    "FROM monitor_os WHERE visto_em = ? AND percentual >= ? " +
    "AND tentativas < ? " +
    "AND (situacao = 'OBSERVANDO' OR situacao = 'ERRO' " +
    "OR (situacao = 'ENVIANDO' AND ultima_tentativa < ?)) " +
    "ORDER BY id LIMIT ?"
  ).bind(agora, LIMIAR, MAX_TENTATIVAS, cutoff, MAX_ENVIOS_POR_EXECUCAO).all();

  let aceitos = 0, falhas = 0, ignorados = 0;
  for (const linha of pendentes.results || []) {
    const os = osMap.get(linha.id);
    if (!os) continue;

    // Backoff para falhas anteriores, evitando tempestade em caso de indisponibilidade.
    if (linha.situacao === "ERRO" && linha.ultima_tentativa) {
      const minutos = Math.min(60, 5 * Math.pow(2, Math.max(0, linha.tentativas - 1)));
      if (Date.now() - Date.parse(linha.ultima_tentativa) < minutos * 60000) {
        ignorados++;
        continue;
      }
    }

    // Aquisição atômica do direito de enviar. Execuções sobrepostas não enviam juntas.
    const claim = await env.DB.prepare(
      "UPDATE monitor_os SET situacao = 'ENVIANDO', " +
      "tentativas = tentativas + 1, ultima_tentativa = ? " +
      "WHERE id = ? AND percentual >= ? AND tentativas < ? AND " +
      "(situacao IN ('OBSERVANDO', 'ERRO') " +
      "OR (situacao = 'ENVIANDO' AND ultima_tentativa < ?))"
    ).bind(agora, os.id, LIMIAR, MAX_TENTATIVAS, cutoff).run();
    if (!(claim.meta?.changes > 0)) continue;

    try {
      await enviarWhatsapp(env.WHATSAPP_APP_KEY, os);
      await env.DB.prepare(
        "UPDATE monitor_os SET situacao = 'NOTIFICADO', " +
        "notificado_em = ?, ultimo_erro = NULL WHERE id = ?"
      ).bind(new Date().toISOString(), os.id).run();
      aceitos++;
      console.log("ANFEER BROCHAS: WhatsApp aceito", {
        os: os.n_os, empresa: os.empresa, percentual: os.percentual
      });
    } catch (e) {
      const erro = String(e?.message || e).slice(0, 260);
      await env.DB.prepare(
        "UPDATE monitor_os SET situacao = CASE " +
        "WHEN tentativas >= ? THEN 'ERRO_FINAL' ELSE 'ERRO' END, " +
        "ultimo_erro = ? WHERE id = ?"
      ).bind(MAX_TENTATIVAS, erro, os.id).run();
      falhas++;
      console.error("ANFEER BROCHAS: falha no envio", {
        os: os.n_os, empresa: os.empresa, erro
      });
    }
  }
  console.log("ANFEER BROCHAS: verificação concluída", {
    os: dados.length, acima80: dados.filter(x => x.percentual >= LIMIAR).length,
    aceitos, falhas, aguardandoRetentativa: ignorados
  });
}

async function prepararBanco(db) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS monitor_meta (" +
      "chave TEXT PRIMARY KEY NOT NULL, valor TEXT NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS monitor_os (" +
      "id TEXT PRIMARY KEY NOT NULL, percentual REAL NOT NULL DEFAULT 0, " +
      "situacao TEXT NOT NULL DEFAULT 'OBSERVANDO', " +
      "visto_em TEXT NOT NULL, ultima_tentativa TEXT, " +
      "tentativas INTEGER NOT NULL DEFAULT 0, " +
      "notificado_em TEXT, ultimo_erro TEXT)"
    )
  ]);
}

async function obterDados() {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), 25000);
  try {
    const resp = await fetch(ORIGEM, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controlador.signal,
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!resp.ok) throw Error("Endpoint /brochas retornou HTTP " + resp.status);
    const json = await resp.json();
    if (!Array.isArray(json)) throw Error("Endpoint /brochas não retornou array JSON.");
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function consolidar(linhas) {
  const mapa = new Map();
  for (const r of linhas) {
    if (!r || typeof r !== "object") continue;
    const empresa = texto(r.EMPRESA, 12).toUpperCase();
    const n_os = texto(r.N_OS, 50);
    const p = r.PERCENTUAL_EXECUCAO;
    const percentual = p === null || p === undefined || p === "" ? NaN : Number(p);
    if (!empresa || !n_os || !Number.isFinite(percentual) || percentual < 0) continue;
    const id = empresa + "|" + n_os;
    const atual = mapa.get(id);
    if (atual && atual.percentual >= percentual) continue;
    mapa.set(id, {
      id, empresa, n_os, percentual,
      titulo: texto(r.TITULO, 140),
      cliente: texto(r.CLIENTE, 140),
      orcamento: texto(r.N_ORCAMENTO, 80),
      entrega: texto(r.DT_PREVISAO_ENTREGA, 40),
      previstas: Number(r.HORAS_PREVISTAS) || 0,
      realizadas: Number(r.HORAS_REALIZADAS) || 0,
      status: texto(r.STATUS_HORAS, 40)
    });
  }
  return mapa;
}

function texto(valor, tamanho) {
  return String(valor ?? "").trim().slice(0, tamanho).replace(/[\r\n\t*<>]/g, " ");
}
function numero(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
function dataBR(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "Não informada";
}
function mensagem(os) {
  return [
    "*ANFEER | ALERTA DE HORAS: 80%*",
    "",
    "*Empresa:* " + os.empresa,
    "*OS:* " + os.n_os,
    "*Título:* " + (os.titulo || "-"),
    "*Orçamento:* " + (os.orcamento || "-"),
    "*Cliente:* " + (os.cliente || "-"),
    "*Previsão de entrega:* " + dataBR(os.entrega),
    "",
    "*Horas previstas:* " + numero(os.previstas) + " h",
    "*Horas realizadas:* " + numero(os.realizadas) + " h",
    "*Execução:* " + numero(os.percentual) + "%",
    "*Situação:* " + (os.status || "NORMAL"),
    "",
    "A OS atingiu ou ultrapassou 80% das horas previstas."
  ].join("\n");
}

async function enviarWhatsapp(chave, os) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), 20000);
  const referencia = ("anfeer_brochas_80_" + os.empresa + "_" + os.n_os)
    .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  try {
    const resp = await fetch(DESTINO, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + String(chave).trim(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app: APLICACAO,
        event: "notificacao",
        message: mensagem(os),
        reference: referencia
      }),
      signal: controlador.signal
    });
    const resultado = await resp.json().catch(() => null);
    if (!resp.ok || !resultado?.ok ||
        (typeof resultado.accepted === "number" && resultado.accepted < 1)) {
      throw Error("Central WhatsApp HTTP " + resp.status + ": " +
        texto(resultado?.error || resultado?.erro || JSON.stringify(resultado), 150));
    }
    // Aceito pela Central não significa entregue no telefone.
  } finally {
    clearTimeout(timer);
  }
}

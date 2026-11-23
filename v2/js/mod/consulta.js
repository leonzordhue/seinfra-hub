// Consulta livre em SQL sobre os dados do Hub (DuckDB-WASM no navegador, sem servidor). [Claude] 23/11/2026
// Fonte: os mesmos JSON de ../data/ (cada um com _meta). Modal e grupo dos contratos vêm de dados.js (mesma regra do resto do Hub).
import { carregar, talvez, contratos as listaContratos } from "../dados.js";
import { esc, num } from "../fmt.js";
import { $, tabela, grafico, serie, estiloBarra, fonte } from "../ui.js";

const VERSAO = "1.32.0"; // @duckdb/duckdb-wasm, versão fixa
const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${VERSAO}/+esm`;
const LIMITE = 2000;
const EXTRAS = ["acesso", "hidro", "queimadas", "sinistros_oficiais", "precos", "mapa_municipios"];

const PRONTAS = [
  ["Medições por mês em 2026", `SELECT date_trunc('month', data) AS mes, sum(valor) AS valor_medido
FROM medicoes WHERE year(data) = 2026
GROUP BY 1 ORDER BY 1`],
  ["Contratos em andamento sem medição há 90 dias", `SELECT id, emp AS empresa, mun AS municipio, modal, ult_med,
       date_diff('day', ult_med, current_date) AS dias_sem_medir, saldo
FROM contratos
WHERE sit = 'Andamento' AND ult_med < current_date - INTERVAL 90 DAY
ORDER BY dias_sem_medir DESC`],
  ["Valor medido por município e modal", `SELECT mun AS municipio, coalesce(modal, 'Outros') AS modal,
       count(*) AS contratos, sum(medido) AS medido
FROM contratos
GROUP BY ALL ORDER BY medido DESC`],
  ["Valor medido por modal", `SELECT coalesce(modal, 'Outros') AS modal, sum(medido) AS medido
FROM contratos GROUP BY 1 ORDER BY 2 DESC`],
  ["Empresas com mais contratos ativos", `SELECT emp AS empresa, count(*) AS contratos_ativos,
       sum(v_atual) AS valor_atual, sum(saldo) AS saldo
FROM contratos WHERE grupo = 'ativo'
GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 30`],
  ["Sinistros fatais por rodovia e ano", `SELECT rodovia, year(data) AS ano, count(*) AS ocorrencias, sum(mortos) AS mortos
FROM sinistros WHERE fatal
GROUP BY ALL ORDER BY ano DESC, mortos DESC`],
  ["Sinistros por rodovia (todas as ocorrências)", `SELECT rodovia, count(*) AS ocorrencias
FROM sinistros GROUP BY 1 ORDER BY 2 DESC`],
  ["Licitações rodoviárias abertas (PNCP)", `SELECT edital, modalidade, objeto, situacao, encerramento, estimado, link
FROM licitacoes_pncp
WHERE rodoviario AND regexp_matches(situacao, 'Divulgada|aberta|andamento', 'i')
  AND (encerramento IS NULL OR CAST(encerramento AS DATE) >= current_date)
ORDER BY encerramento`],
  ["Vigência terminando em até 60 dias", `SELECT id, emp AS empresa, sit, fim_vig, date_diff('day', current_date, fim_vig) AS dias, saldo
FROM contratos
WHERE grupo = 'ativo' AND fim_vig BETWEEN current_date AND current_date + INTERVAL 60 DAY
ORDER BY fim_vig`],
  ["Aditivos acima de 25% (Lei 14.133, art. 125)", `SELECT id, emp AS empresa, v_orig, v_adit, round(100 * v_adit / v_orig, 1) AS pct_aditado
FROM contratos WHERE v_orig > 0 AND v_adit / v_orig > 0.25
ORDER BY pct_aditado DESC`],
  ["Financeiro acima do físico (+10 p.p.)", `SELECT id, emp AS empresa, sit, fis, fin, round(fin - fis, 1) AS diferenca_pp
FROM contratos WHERE grupo <> 'encerrado' AND fis IS NOT NULL AND fin - fis > 10
ORDER BY diferenca_pp DESC`],
  ["IRI médio por rodovia (ICM)", `SELECT codigo, iri_medio FROM rodovias_icm ORDER BY iri_medio DESC`],
  ["Medição mensal dos últimos 24 meses", `SELECT date_trunc('month', data) AS mes, sum(valor) AS valor_medido
FROM medicoes WHERE data >= current_date - INTERVAL 24 MONTH
GROUP BY 1 ORDER BY 1`],
];

let banco = null; // { db, conn, tabelas: [{nome, colunas:[{n,t}], linhas, fonte}] } — fica vivo entre visitas à rota

// Linha só com valores simples; lista de valores simples vira texto "a, b"; listas de listas (geometria) e objetos saem.
function plana(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v == null || typeof v !== "object") r[k] = v;
    else if (Array.isArray(v) && v.every(x => x == null || typeof x !== "object")) r[k] = v.join(", ");
  }
  return r;
}
// Acha as listas de registros de um JSON de formato desconhecido: GeoJSON → properties; senão, cada lista de objetos no 1º nível.
function listas(d) {
  if (Array.isArray(d)) return { "": d };
  if (Array.isArray(d?.features)) return { "": d.features.map(f => f.properties || {}) };
  const out = {};
  for (const [k, v] of Object.entries(d || {})) if (k !== "_meta" && Array.isArray(v) && v.length && typeof v[0] === "object" && !Array.isArray(v[0])) out[k] = v;
  return out;
}

async function abrirBanco(passo) {
  passo("Baixando o DuckDB-WASM (~6 MB na primeira vez; depois fica no cache do navegador)…");
  const duckdb = await import(CDN);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // Worker de outro domínio não abre direto no GitHub Pages: sobe por Blob URL com importScripts.
  const url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(url));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(url);
  const conn = await db.connect();

  passo("Carregando os dados do Hub…");
  const [ct, sin, lic, icm, ...extras] = await Promise.all([
    listaContratos(), carregar("sinistros"), talvez("licitacoes"), talvez("icm"), ...EXTRAS.map(talvez)]);
  const tabs = [];
  const registra = async (nome, linhas, origem) => {
    if (!linhas?.length) return;
    await db.registerFileText(`${nome}.json`, JSON.stringify(linhas.map(plana)));
    await conn.insertJSONFromPath(`${nome}.json`, { name: nome });
    tabs.push({ nome, linhas: linhas.length, origem });
  };
  await registra("contratos", ct.lista.map(({ med, alertas, ...c }) => ({ ...c, alertas: alertas.map(a => a.txt).join("; ") || null })), "eobras.json (modal e grupo calculados em dados.js)");
  // med = [data, valor liberado R$, % acumulado, % físico] (eobras.json, _meta.campos)
  await registra("medicoes", ct.lista.flatMap(c => (c.med || []).map(([d, v, a, f], i) =>
    ({ contrato: c.id, n: i + 1, data: d, valor: v, acumulado: a, fisico: f, modal: c.modal, mun: c.mun }))), "eobras.json, campo med");
  await registra("sinistros", sin.ocorrencias, "sinistros.json, ocorrencias");
  await registra("noticias", sin.noticias, "sinistros.json, noticias");
  await registra("licitacoes_pncp", lic?.pncp, "licitacoes.json, pncp");
  await registra("licitacoes_csc", lic?.csc, "licitacoes.json, csc");
  await registra("rodovias_icm", icm?.rodovias, "icm.json (sem segmentos e buracos)");
  for (const [i, d] of extras.entries()) {
    for (const [k, v] of Object.entries(d ? listas(d) : {})) {
      try { await registra(k ? `${EXTRAS[i]}_${k}` : EXTRAS[i], v, `${EXTRAS[i]}.json${k ? `, ${k}` : ""}`); }
      catch (e) { console.warn(`consulta: ${EXTRAS[i]}.${k} não entrou`, e); }
    }
  }
  const cols = await conn.query(`SELECT table_name AS t, column_name AS n, data_type AS tipo FROM information_schema.columns ORDER BY table_name, ordinal_position`);
  for (const r of cols.toArray()) { const t = tabs.find(x => x.nome === r.t); if (t) (t.colunas ||= []).push({ n: r.n, t: r.tipo }); }
  return { db, conn, tabelas: tabs, meta: ct.meta };
}

// Arrow → JS simples: BigInt vira número, DATE/TIMESTAMP vira texto ISO, DECIMAL vira número.
function valor(v, tipo) {
  if (v == null) return null;
  if (typeof v === "bigint") return Number(v);
  if (/^Date|^Timestamp/.test(tipo) && typeof v === "number") return new Date(v).toISOString().slice(0, /^Date/.test(tipo) ? 10 : 19).replace("T", " ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (/^Decimal/.test(tipo)) return Number(String(v)) / 10 ** (+(tipo.match(/,\s*(\d+)/) || [0, 0])[1]);
  if (typeof v === "object") return JSON.stringify(v, (_, x) => typeof x === "bigint" ? Number(x) : x);
  return v;
}
function resultado(t) {
  const campos = t.schema.fields.map(f => ({ n: f.name, t: String(f.type) }));
  const n = Math.min(t.numRows, LIMITE);
  const linhas = [];
  for (let i = 0; i < n; i++) {
    const r = {};
    campos.forEach((c, j) => { r[c.n] = valor(t.getChildAt(j).get(i), c.t); });
    linhas.push(r);
  }
  return { campos, linhas, total: t.numRows };
}

const erroPt = m =>
  /Catalog Error/i.test(m) ? "Tabela ou função não existe." :
  /Parser Error/i.test(m) ? "Erro de sintaxe no SQL." :
  /Binder Error/i.test(m) ? "Coluna ou referência inválida." :
  /Conversion Error/i.test(m) ? "Não deu para converter um valor de tipo." :
  "A consulta falhou.";

function csv(r) {
  const cel = v => v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : `"${String(v).replace(/"/g, '""')}"`;
  const txt = [r.campos.map(c => cel(c.n)).join(";"), ...r.linhas.map(l => r.campos.map(c => cel(l[c.n])).join(";"))].join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" })), download: "consulta-dmob.csv" });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Gráfico rápido: 2 colunas, a 2ª numérica. 1ª data/mês → linha; 1ª texto → barras (30 maiores).
function tipoGrafico(r) {
  if (r.campos.length !== 2 || !r.linhas.length) return null;
  const [a, b] = r.campos;
  if (!r.linhas.every(l => l[b.n] == null || typeof l[b.n] === "number")) return null;
  if (/^Date|^Timestamp/.test(a.t) || r.linhas.every(l => /^\d{4}-\d{2}/.test(l[a.n] ?? ""))) return "line";
  return r.linhas.every(l => typeof l[a.n] !== "number") ? "bar" : null;
}

const CSS = `
.cq-grade{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:14px;align-items:start}
@media (max-width:900px){.cq-grade{grid-template-columns:1fr}}
.cq-sql{width:100%;min-height:170px;resize:vertical;font:13.5px/1.5 ui-monospace,Consolas,"Cascadia Mono",monospace;background:var(--sup-2);color:var(--tinta);border:1px solid var(--borda-2);border-radius:6px;padding:10px 12px;tab-size:2}
.cq-sql:focus{outline:2px solid var(--azul);outline-offset:1px}
.cq-acoes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.cq-acoes .peq{color:var(--tinta-3);font-size:13px}
.cq-tabs{max-height:420px;overflow:auto;font-size:13px}
.cq-tabs details{border-bottom:1px solid var(--borda);padding:4px 0}
.cq-tabs summary{cursor:pointer;font-weight:600}
.cq-tabs button{background:none;border:0;padding:1px 4px;cursor:pointer;color:var(--azul);font:inherit;text-align:left}
.cq-tabs button:hover{text-decoration:underline}
.cq-tabs ul{list-style:none;margin:2px 0 4px;padding-left:10px}
.cq-tabs small{color:var(--tinta-3)}
.cq-prontas{display:flex;flex-wrap:wrap;gap:6px}
.cq-prontas .btn{font-size:13px;padding:5px 10px}
.cq-erro{border:1px solid var(--critico);background:var(--critico-bg);color:var(--tinta);border-radius:var(--raio);padding:10px 14px;font-size:13.5px}
.cq-erro code{display:block;white-space:pre-wrap;margin-top:4px;font-size:12.5px;color:var(--tinta-2)}`;

export async function render(el) {
  if (!document.getElementById("cq-css")) document.head.append(Object.assign(document.createElement("style"), { id: "cq-css", textContent: CSS }));
  el.innerHTML = `<div class="cab"><div><h1>Consulta livre</h1>
    <p>SQL direto sobre os dados do Hub, rodando no seu navegador (DuckDB). Nada sai da máquina e nada é alterado nos arquivos.</p></div></div>
    <p class="carregando" id="cqPasso" role="status">Preparando…</p>`;
  let B;
  try {
    banco ||= abrirBanco(t => { const p = $("#cqPasso", el); if (p) p.textContent = t; });
    B = await banco;
  } catch (e) {
    banco = null;
    el.innerHTML += `<div class="aviso"><b>Não consegui abrir o DuckDB.</b> ${esc(e.message || e)}<br>Precisa de acesso a cdn.jsdelivr.net e de um navegador com WebAssembly.</div>`;
    $("#cqPasso", el)?.remove();
    return;
  }
  const { conn, tabelas } = B;
  el.innerHTML = `<div class="cab"><div><h1>Consulta livre</h1>
      <p>SQL direto sobre os dados do Hub, rodando no seu navegador (DuckDB). Nada sai da máquina e nada é alterado nos arquivos.</p></div>
      <div class="fontes">${fonte("e-Obras", B.meta?.posicao || "—")}${fonte("tabelas", num(tabelas.length))}</div></div>
    <section class="secao cartao"><header><div><h2>Consultas prontas</h2><p>Clique para carregar no editor e rodar.</p></div></header>
      <div class="corpo cq-prontas">${PRONTAS.map(([t], i) => `<button type="button" class="btn" data-p="${i}">${esc(t)}</button>`).join("")}</div></section>
    <div class="cq-grade secao">
      <section class="cartao"><header><div><h2>SQL</h2><p>Dialeto DuckDB. Ctrl+Enter roda. Mostra até ${num(LIMITE)} linhas.</p></div></header>
        <div class="corpo"><textarea id="cqSql" class="cq-sql" spellcheck="false" aria-label="Consulta SQL">${esc(PRONTAS[0][1])}</textarea>
        <div class="cq-acoes"><button type="button" class="btn pri" id="cqRodar">Rodar</button>
          <button type="button" class="btn" id="cqCsv" disabled>Exportar CSV</button><span class="peq" id="cqInfo" role="status"></span></div></div></section>
      <aside class="cartao"><header><div><h2>Tabelas</h2><p>Clique num nome para inserir.</p></div></header>
        <div class="corpo cq-tabs">${tabelas.map(t => `<details><summary><button type="button" data-ins="${esc(t.nome)}">${esc(t.nome)}</button> <small>${num(t.linhas)}</small></summary>
          <small>${esc(t.origem)}</small><ul>${(t.colunas || []).map(c => `<li><button type="button" data-ins="${esc(c.n)}">${esc(c.n)}</button> <small>${esc(c.t.toLowerCase())}</small></li>`).join("")}</ul></details>`).join("")}</div></aside>
    </div>
    <section class="secao cartao" id="cqRes" hidden><header><div><h2>Resultado</h2></div><span class="contagem" id="cqCont"></span></header>
      <div class="corpo"><div class="graf" id="cqGrafBox" hidden><canvas id="cqGraf" aria-label="Gráfico do resultado"></canvas></div><div id="cqTab"></div></div></section>
    <p class="peq" style="color:var(--tinta-3);font-size:13px;margin-top:16px">Fontes: arquivos de <code>data/</code> do Hub, cada um com <code>_meta</code> de proveniência (e-Obras, PNCP, CSC-AM, notícias de sinistros, ICM). Modal e situação dos contratos seguem a regra do Hub (dados.js). Contrato que cita rodovia só como localização não é da rodovia.</p>`;

  const sql = $("#cqSql", el);
  let ultimo = null;
  const rodar = async () => {
    const info = $("#cqInfo", el), box = $("#cqRes", el);
    info.textContent = "Rodando…"; $("#cqRodar", el).disabled = true;
    const t0 = performance.now();
    try {
      const r = resultado(await conn.query(sql.value));
      ultimo = r;
      info.textContent = `${num(r.total)} linha(s) em ${num(performance.now() - t0)} ms`;
      $("#cqCont", el).textContent = r.total > LIMITE ? `mostrando ${num(LIMITE)} de ${num(r.total)}` : `${num(r.total)} linhas`;
      box.hidden = false; $("#cqCsv", el).disabled = !r.linhas.length;
      const tipo = tipoGrafico(r), gb = $("#cqGrafBox", el);
      gb.hidden = !tipo;
      if (tipo) {
        const [a, b] = r.campos, ls = tipo === "bar" ? [...r.linhas].sort((x, y) => (y[b.n] || 0) - (x[b.n] || 0)).slice(0, 30) : r.linhas;
        grafico($("#cqGraf", el), { type: tipo, data: { labels: ls.map(l => String(l[a.n] ?? "—").slice(0, 40)),
          datasets: [{ label: b.n, data: ls.map(l => l[b.n]), ...(tipo === "bar" ? estiloBarra(serie(1)) : { borderColor: serie(1), backgroundColor: serie(1), tension: 0, pointRadius: 2 }) }] } });
      }
      const ehNum = c => /^(Int|Uint|Float|Decimal)/.test(c.t);
      const semMilhar = c => /^(ano|year|n|id|mes)$/i.test(c.n); // "2026", não "2.026"
      tabela($("#cqTab", el), r.campos.map(c => ({ k: c.n, rot: c.n, n: ehNum(c) ? 1 : 0,
        html: l => { const v = l[c.n]; return v == null ? "—" : semMilhar(c) ? esc(v) : ehNum(c) ? num(v, Number.isInteger(v) ? 0 : 2) : /^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">link</a>` : esc(String(v).slice(0, 300)); } })),
        r.linhas, { limite: LIMITE, vazio: "A consulta não devolveu linhas." });
    } catch (e) {
      const m = String(e.message || e);
      info.textContent = "";
      box.hidden = false; $("#cqGrafBox", el).hidden = true; $("#cqCsv", el).disabled = true; ultimo = null;
      $("#cqCont", el).textContent = "";
      $("#cqTab", el).innerHTML = `<div class="cq-erro" role="alert"><b>${esc(erroPt(m))}</b> Mensagem original do DuckDB:<code>${esc(m)}</code></div>`;
    } finally { $("#cqRodar", el).disabled = false; }
  };
  $("#cqRodar", el).onclick = rodar;
  $("#cqCsv", el).onclick = () => ultimo && csv(ultimo);
  sql.onkeydown = e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rodar(); }
  };
  el.querySelector(".cq-prontas").onclick = e => { const b = e.target.closest("[data-p]"); if (!b) return; sql.value = PRONTAS[+b.dataset.p][1]; rodar(); };
  el.querySelector(".cq-tabs").onclick = e => {
    const b = e.target.closest("[data-ins]"); if (!b) return;
    e.preventDefault(); // não abre/fecha o <details> ao inserir
    sql.setRangeText(b.dataset.ins, sql.selectionStart, sql.selectionEnd, "end"); sql.focus();
  };
  rodar();
}

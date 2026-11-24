// Briefings de uma página, por município, rodovia ou contrato, montados dos dados do Hub e prontos para imprimir/PDF.
// [Nexus] 23/11/2026. Fontes: eobras.json, sinistros.json, sinistros_analise.json, licitacoes.json, icm.json.
// A IA não escreve nada aqui: toda frase sai de uma conta sobre os dados, com a fonte no rodapé.
import { contratos, talvez, municipios, obraDaRodovia, CURVA_S } from "../dados.js";
import { esc, num, pct, data, brlCurto, semAcento, plural } from "../fmt.js";
import { $, chip, chipSit, opcoes, grafico, serie, css } from "../ui.js";

const estado = { tipo: "municipio", alvo: "" };
// v3: briefing como documento oficial A4 (cabeçalho institucional, seções numeradas, tabelas limpas). [Claude] 23/11/2026
const ESTILO = `<style>
  .doc { counter-reset: dsec; max-width: 920px; }
  .doc .doc-cab { align-items: center; border-bottom: 3px solid var(--azul); padding-bottom: 12px; margin-bottom: 0; }
  .doc-org { display: grid; gap: 1px; font-size: 12px; line-height: 1.4; color: var(--tinta-3); }
  .doc-org b { font: 600 12px var(--f-corpo); letter-spacing: .06em; text-transform: uppercase; color: var(--tinta); }
  .doc-tit { border-top: 2px solid var(--ouro); margin-top: 2px; padding: 18px 0 2px; }
  .doc-tipo { display: block; font: 600 12px var(--f-corpo); letter-spacing: .06em; text-transform: uppercase; color: var(--ouro-2); margin-bottom: 4px; }
  .doc .doc-tit .doc-h::before { content: none; }
  .doc .doc-tit .doc-h { counter-increment: none; display: block; margin: 0; border: 0; padding: 0; font-size: clamp(1.35rem, 2.4vw, 1.75rem); letter-spacing: -.015em; }
  .doc-tit p { margin: 4px 0 0; color: var(--tinta-3); font-size: 14px; }
  .doc-meta { display: flex; flex-wrap: wrap; margin: 14px 0 0; border: 1px solid var(--borda); border-radius: var(--raio); }
  .doc-meta div { padding: 6px 12px; border-left: 1px solid var(--borda); }
  .doc-meta div:first-child { border-left: 0; }
  .doc-meta dt { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--tinta-3); }
  .doc-meta dd { margin: 0; font-size: 13px; font-weight: 500; color: var(--tinta); }
  .doc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
  .doc h2 { counter-increment: dsec; display: flex; gap: 10px; align-items: center; font-size: 1.02rem; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--borda-2); }
  .doc h2::before { content: counter(dsec); display: inline-grid; place-items: center; min-width: 22px; height: 22px; border-radius: 3px; background: var(--azul); color: var(--sup); font: 600 12px var(--f-corpo); }
  .doc p { max-width: 82ch; line-height: 1.6; }
  .doc .sint p { color: var(--tinta); }
  .doc .t { font-size: 13.5px; }
  .doc .t tr.tot td { border-top: 1.5px solid var(--borda-2); font-weight: 600; color: var(--tinta); }
  .doc .t .obj { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 0 32px; margin: 2px 0 10px; }
  .kv div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--borda); font-size: 14px; }
  .kv dt { color: var(--tinta-3); }
  .kv dd { margin: 0; color: var(--tinta); text-align: right; font-variant-numeric: tabular-nums; }
  .risco-cab { display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; }
  .risco-cab .nota-risco { width: 48px; height: 48px; font-size: 18px; }
  .risco-cab b { display: block; color: var(--tinta); font-weight: 600; }
  .risco-cab span { font-size: 13px; color: var(--tinta-3); }
  .doc-rod { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin-top: 30px; padding-top: 10px; border-top: 2px solid var(--azul); font-size: 12px; color: var(--tinta-3); }
  .doc-rod p { margin: 0; max-width: 90ch; }
  /* a marca é azul-escura: no tema escuro vai sobre plaqueta branca */
  :root[data-theme="dark"] .doc .doc-cab img { background: #fff; padding: 4px 8px; border-radius: 4px; box-sizing: content-box; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .doc .doc-cab img { background: #fff; padding: 4px 8px; border-radius: 4px; box-sizing: content-box; } }
  @media (max-width: 640px) { .doc .doc-cab img { height: 30px; } .doc .t .obj { min-width: 200px; } .doc-meta div { flex: 1 1 50%; } }
  @media print {
    /* app.css v3 redefine .casca como grid depois do bloco print: sem isto o documento sai na coluna de 256 px */
    .casca { display: block !important; }
    .doc { font-size: 10pt; }
    .doc .tab-rolo { overflow: visible; }
    .doc h2 { break-after: avoid; margin-top: 18px; }
    .doc .t { font-size: 8.5pt; } .doc .t th { font-size: 7pt; padding: 5px 6px; } .doc .t td { padding: 5px 6px; }
    .doc .t tr, .kv div, .doc .graf-doc, .and { break-inside: avoid; }
    .doc .t .obj { -webkit-line-clamp: 2; }
    .doc h2::before, .nota-risco, .chip, .doc-meta, .doc-cab { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>`;
const T = h => `<div class="tab-rolo" tabindex="0">${h}</div>`;
const rxRod = cod => new RegExp(`\\bAM[\\s-]?0*${parseInt(cod.slice(3), 10)}\\b`, "i");

export async function render(el, params) {
  const [{ meta: eMeta, lista }, sin, an, lic, icm, rodj] = await Promise.all([
    contratos(), talvez("sinistros"), talvez("sinistros_analise"), talvez("licitacoes"), talvez("icm"),
    fetch("../pipelines/sinistros/rodovias.json").then(r => r.ok ? r.json() : null).catch(() => null)]);
  const icmPor = new Map((icm?.rodovias || []).map(r => [r.codigo, r]));
  const nomes = rodj ? Object.fromEntries(Object.entries(rodj.rodovias || rodj).filter(([k]) => /^AM-/.test(k)).map(([k, v]) => [k, v.nomes_fortes || []])) : {};
  const muns = [...new Set(lista.flatMap(municipios))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rods = [...new Set([...icmPor.keys(), ...Object.keys(an?.rodovias || {}), ...Object.keys(nomes)])].sort();
  if (params?.get("municipio")) Object.assign(estado, { tipo: "municipio", alvo: params.get("municipio") });
  if (params?.get("rodovia")) Object.assign(estado, { tipo: "rodovia", alvo: params.get("rodovia") });
  if (params?.get("contrato")) Object.assign(estado, { tipo: "contrato", alvo: params.get("contrato") });
  const porId = new Map(lista.map(c => [c.id, c]));
  const TIPOS = [["municipio", "Município"], ["rodovia", "Rodovia"], ["contrato", "Contrato"]];

  el.innerHTML = `${ESTILO}
    <div class="cab nao-imprime"><div><h1>Briefings</h1>
      <p>Resumo de uma página para reunião, visita ou resposta a parlamentar: de um município, de uma rodovia ou de um contrato. Use "Imprimir / PDF" para salvar.</p></div></div>
    <div class="filtros nao-imprime">
      <div class="seg" id="fTipo">${TIPOS.map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${estado.tipo === v}">${r}</button>`).join("")}</div>
      <select id="fAlvo" aria-label="Escolha"></select>
      <div id="buscaCt" class="busca-ct" hidden>
        <input type="search" id="fCt" placeholder="Número, objeto, empresa ou município do contrato…" aria-label="Buscar contrato" autocomplete="off">
        <div id="sugCt" class="sugestoes" role="listbox" hidden></div>
      </div>
      <button type="button" class="btn pri" id="imprimir">Imprimir / PDF</button>
    </div>
    <div id="doc"></div>`;

  const sel = $("#fAlvo", el), caixa = $("#buscaCt", el), inp = $("#fCt", el), sug = $("#sugCt", el);
  const opts = () => {
    const ehCt = estado.tipo === "contrato";
    sel.hidden = ehCt; caixa.hidden = !ehCt;
    if (ehCt) { inp.value = estado.alvo || ""; return; }
    sel.innerHTML = opcoes(estado.tipo === "municipio" ? muns : rods, estado.alvo, estado.tipo === "municipio" ? "Escolha o município" : "Escolha a rodovia");
  };
  const pinta = () => {
    const ctx = { lista, sin, an, lic, icmPor, nomes, eMeta };
    const nome = { municipio: "um município", rodovia: "uma rodovia", contrato: "um contrato" }[estado.tipo];
    const doc = $("#doc", el);
    if (!estado.alvo) { doc.innerHTML = `<p class="vazio">Escolha ${nome} para montar o briefing.</p>`; return; }
    if (estado.tipo === "contrato") {
      const c = porId.get(estado.alvo);
      if (!c) { doc.innerHTML = `<p class="vazio">Contrato não encontrado no e-Obras.</p>`; return; }
      doc.innerHTML = docContrato(c, ctx); curvaContrato(doc.querySelector("#gCurvaBr"), c); return;
    }
    doc.innerHTML = estado.tipo === "municipio" ? docMunicipio(estado.alvo, ctx) : docRodovia(estado.alvo, ctx);
  };
  const escolher = v => { estado.alvo = v; history.replaceState(null, "", `#/briefings?${estado.tipo}=${encodeURIComponent(v)}`); pinta(); };
  $("#fTipo", el).onclick = e => { const b = e.target.closest("button"); if (!b) return; estado.tipo = b.dataset.v; estado.alvo = "";
    $("#fTipo", el).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); opts(); pinta(); if (estado.tipo === "contrato") inp.focus(); };
  sel.onchange = () => escolher(sel.value);

  // busca de contrato: todos os termos precisam aparecer; até 12 sugestões, ativos primeiro
  const ordem = { ativo: 0, atencao: 1, encerrado: 2 };
  inp.oninput = () => {
    const termos = semAcento(inp.value).split(/\s+/).filter(Boolean);
    if (!termos.length) { sug.hidden = true; return; }
    const achados = lista.filter(c => { const t = semAcento(`${c.id} ${c.obj} ${c.emp} ${c.mun} ${c.rod || ""}`); return termos.every(x => t.includes(x)); })
      .sort((a, b) => ordem[a.grupo] - ordem[b.grupo] || b.v_atual - a.v_atual).slice(0, 12);
    sug.innerHTML = achados.length ? achados.map(c => `<button type="button" role="option" data-id="${esc(c.id)}"><b>${esc(c.id)}</b> · ${esc(c.sit)} · ${brlCurto(c.v_atual)}<span>${esc((c.obj || "").slice(0, 120))} · ${esc(c.mun)}</span></button>`).join("")
      : `<p class="vazio" style="padding:12px">Nenhum contrato com esses termos.</p>`;
    sug.hidden = false;
  };
  sug.onclick = e => { const b = e.target.closest("button[data-id]"); if (!b) return; inp.value = b.dataset.id; sug.hidden = true; escolher(b.dataset.id); };
  inp.onkeydown = e => { if (e.key === "Enter") { const b = sug.querySelector("button[data-id]"); if (b) b.click(); } if (e.key === "Escape") sug.hidden = true; };
  el.addEventListener("click", e => { if (!caixa.contains(e.target)) sug.hidden = true; });
  $("#imprimir", el).onclick = () => window.print();
  opts(); pinta();
}

// cabeçalho institucional: órgão, tipo do briefing, título, subtítulo e carimbo (emissão, base, natureza)
const cab = (tipo, titulo, sub, ctx) => `<header class="doc-cab"><div class="doc-org"><b>Governo do Estado do Amazonas</b>
    <span>Secretaria de Estado de Infraestrutura (SEINFRA)</span><span>Departamento de Mobilidade (DMOB)</span></div>
    <img src="../assets/marca_seinfra.webp" alt="Secretaria de Infraestrutura" width="182" height="40"></header>
  <div class="doc-tit"><span class="doc-tipo">Briefing · ${esc(tipo)}</span><h2 class="doc-h">${esc(titulo)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
  <dl class="doc-meta"><div><dt>Emissão</dt><dd>${new Date().toLocaleDateString("pt-BR")}</dd></div>
    <div><dt>Base</dt><dd>e-Obras, posição ${esc(ctx.eMeta.posicao)}</dd></div><div><dt>Natureza</dt><dd>Informativo, gerado dos dados do Hub</dd></div></dl>`;
const rodape = (ctx, extra = "") => `<footer class="doc-rod"><p>Fontes: e-Obras (posição ${esc(ctx.eMeta.posicao)})${ctx.an ? `; sinistros por notícias (${esc(ctx.an._meta.gerado)})` : ""}${ctx.lic ? `; PNCP (${data(ctx.lic._meta.gerado)})` : ""}${extra}.
  Valores: valor atual = original + aditivos; saldo = valor atual − medido.</p><p>DMOB/SEINFRA-AM · ${new Date().toLocaleDateString("pt-BR")}</p></footer>`;

// modo "andamento": valor, físico, financeiro, saldo e vigência; modo "encerrada": assinatura, término, valor final e medido
function tabelaObras(cs, modo = "andamento") {
  if (!cs.length) return `<p>Nenhum contrato.</p>`;
  const ini = c => `<td><b>${esc(c.id)}</b><div class="peq">${esc(c.emp)}</div></td><td><div class="obj" title="${esc(c.obj)}">${esc(c.obj || "")}</div><div class="peq">${esc(c.modal || c.cat || "")}</div></td>`;
  if (modo === "encerrada") {
    return T(`<table class="t"><thead><tr><th>Contrato</th><th>Objeto</th><th>Situação</th><th>Assinatura</th><th>Término</th><th class="n">Valor final</th><th class="n">Medido</th><th class="n">Físico</th></tr></thead><tbody>
    ${[...cs].sort((a, b) => String(b.ass).localeCompare(String(a.ass))).map(c => `<tr>${ini(c)}<td>${chipSit(c.sit)}</td><td>${data(c.ass)}</td><td>${data(c.fim_exec || c.ult_med || c.desde)}</td>
      <td class="n">${brlCurto(c.v_atual)}</td><td class="n">${brlCurto(c.medido)}<div class="peq">${pct(c.fin)}</div></td><td class="n">${pct(c.fis)}</td></tr>`).join("")}</tbody></table>`);
  }
  return T(`<table class="t"><thead><tr><th>Contrato</th><th>Objeto</th><th>Situação</th><th class="n">Valor atual</th><th class="n">Físico</th><th class="n">Financeiro</th><th class="n">Saldo</th><th>Vigência até</th></tr></thead><tbody>
    ${[...cs].sort((a, b) => b.v_atual - a.v_atual).map(c => `<tr>${ini(c)}
    <td>${chipSit(c.sit)}${c.alertas.length ? `<div class="peq" title="${esc(c.alertas.map(a => a.txt).join("; "))}">${esc(c.alertas[0].txt)}${c.alertas.length > 1 ? ` +${c.alertas.length - 1}` : ""}</div>` : ""}</td><td class="n">${brlCurto(c.v_atual)}</td><td class="n">${pct(c.fis)}</td><td class="n">${pct(c.fin)}</td><td class="n">${brlCurto(c.saldo)}</td><td>${data(c.fim_vig)}</td></tr>`).join("")}</tbody></table>`);
}
const soma = (cs, k) => cs.reduce((s, c) => s + (c[k] || 0), 0);

function blocoLic(lic, teste) {
  if (!lic) return "";
  const ls = lic.pncp.filter(l => teste(`${l.objeto || ""} ${l.descricao || ""}`)).slice(0, 8);
  return `<h2>Licitações relacionadas</h2>${ls.length ? `<ul class="lista">${ls.map(l => `<li><div><div class="q">${esc(l.edital)} · ${esc(l.situacao || "")} · publicado em ${data(l.publicacao)}</div>
    <div class="d">${esc((l.descricao || l.objeto).slice(0, 200))}${l.estimado ? ` · estimado ${brlCurto(l.estimado)}` : ""}${l.homologado ? ` · homologado ${brlCurto(l.homologado)}` : ""}</div></div></li>`).join("")}</ul>` : "<p>Nenhum edital no PNCP cita este local no objeto.</p>"}`;
}

function docMunicipio(mun, ctx) {
  const cs = ctx.lista.filter(c => municipios(c).includes(mun));
  const at = cs.filter(c => c.grupo === "ativo"), atn = cs.filter(c => c.grupo === "atencao");
  const conc = cs.filter(c => c.grupo === "encerrado");
  const comAl = at.filter(c => c.alertas.length);
  const anos = cs.map(c => String(c.ass || "").slice(0, 4)).filter(Boolean).sort();
  // investimento por tipo de obra (todas as situações)
  const porCat = Object.entries(cs.reduce((o, c) => { const k = c.modal || c.cat || "Outros"; (o[k] ||= []).push(c); return o; }, {}))
    .map(([k, v]) => ({ k, n: v.length, valor: soma(v, "v_atual"), medido: soma(v, "medido") })).sort((a, b) => b.valor - a.valor);
  const rodsMun = [...ctx.icmPor.values()].filter(r => (r.municipios || []).some(m => semAcento(m) === semAcento(mun)));
  const ocs = (ctx.sin?.ocorrencias || []).filter(o => semAcento(o.municipio) === semAcento(mun));
  const sintese = [
    cs.length ? `A SEINFRA tem ${plural(cs.length, "contrato", "contratos")} em ${mun} no e-Obras${anos.length ? ` (assinados de ${anos[0]} a ${anos[anos.length - 1]})` : ""}, somando ${brlCurto(soma(cs, "v_atual"))} contratados e ${brlCurto(soma(cs, "medido"))} medidos.` : `Nenhum contrato da SEINFRA em ${mun} no e-Obras.`,
    at.length ? `${plural(at.length, "contrato está", "contratos estão")} em andamento (${brlCurto(soma(at, "v_atual"))}, com ${brlCurto(soma(at, "saldo"))} ainda a medir).` : "",
    atn.length ? `${plural(atn.length, "contrato está", "contratos estão")} paralisado(s), expirado(s) ou em tomada de contas (${brlCurto(soma(atn, "v_atual"))}).` : "",
    comAl.length ? `${plural(comAl.length, "contrato ativo tem", "contratos ativos têm")} alerta de gestão (vigência, medição ou descompasso físico-financeiro).` : "",
    conc.length ? `${plural(conc.length, "contrato foi concluído ou encerrado", "contratos foram concluídos ou encerrados")} (${brlCurto(soma(conc, "v_atual"))}).` : "",
    ocs.length ? `${plural(ocs.length, "acidente em rodovia estadual foi noticiado", "acidentes em rodovias estaduais foram noticiados")} no município desde 2019 (${num(ocs.filter(o => o.fatal).length)} com morte).` : "",
  ].filter(Boolean);
  const nome = semAcento(mun);
  return `<article class="doc">${cab("Município", mun, "Obras, contratos, rodovias e segurança viária da SEINFRA no município", ctx)}
    <h2>Síntese</h2><div class="sint">${sintese.map(s => `<p>${esc(s)}</p>`).join("")}</div>
    ${porCat.length ? `<h2>Investimento por tipo de obra</h2>${T(`<table class="t"><thead><tr><th>Tipo</th><th class="n">Contratos</th><th class="n">Valor contratado</th><th class="n">Medido</th></tr></thead><tbody>
      ${porCat.map(x => `<tr><td>${esc(x.k)}</td><td class="n">${num(x.n)}</td><td class="n">${brlCurto(x.valor)}</td><td class="n">${brlCurto(x.medido)}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td class="n">${num(cs.length)}</td><td class="n">${brlCurto(soma(cs, "v_atual"))}</td><td class="n">${brlCurto(soma(cs, "medido"))}</td></tr></tbody></table>`)}` : ""}
    <h2>Em andamento (${num(at.length)})</h2>${tabelaObras(at)}
    ${atn.length ? `<h2>Paralisadas, expiradas ou em tomada de contas (${num(atn.length)})</h2>${tabelaObras(atn)}` : ""}
    ${conc.length ? `<h2>Concluídas e encerradas (${num(conc.length)})</h2>${tabelaObras(conc, "encerrada")}` : ""}
    ${rodsMun.length ? `<h2>Rodovias estaduais no município</h2>${T(`<table class="t"><thead><tr><th>Rodovia</th><th>Trecho</th><th class="n">Extensão</th><th>Condição (IRI)</th><th class="n">Buracos</th></tr></thead><tbody>
      ${rodsMun.map(r => `<tr><td><b>${esc(r.codigo)}</b></td><td>${esc(r.inicio)} → ${esc(r.fim)}</td><td class="n">${num(r.extensao_total_km, 1)} km</td><td>${esc(r.nivel_geral)} (${num(r.iri_medio, 2)})</td><td class="n">${num(r.n_buracos)}</td></tr>`).join("")}</tbody></table>`)}` : ""}
    ${ocs.length ? `<h2>Sinistros noticiados (desde 2019)</h2><ul class="lista">${ocs.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6).map(o => `<li><div><div class="q">${data(o.data)} · ${esc(o.rodovia)} · ${esc(o.tipo)}${o.fatal ? " · com morte" : ""}</div></div></li>`).join("")}</ul>` : ""}
    ${blocoLic(ctx.lic, o => semAcento(o).includes(nome))}
    ${rodape(ctx, rodsMun.length ? "; condição: levantamento RoadLab (data/icm.json)" : "")}</article>`;
}

function docRodovia(cod, ctx) {
  const rx = rxRod(cod);
  // nomes sem repetição de grafia (Manaus-Itacoatiara / Manaus–Itacoatiara / Manaus/Itacoatiara)
  const vistos = new Set(), nomes = (ctx.nomes[cod] || []).filter(n => { const k = semAcento(n).replace(/[^a-z0-9]/g, ""); return !vistos.has(k) && vistos.add(k); });
  const cita = t => rx.test(t) || nomes.some(n => semAcento(t).includes(semAcento(n)));
  const cs = ctx.lista.filter(c => obraDaRodovia(c.obj, cod));
  const soLocal = ctx.lista.filter(c => c.grupo !== "encerrado" && rx.test(c.obj || "") && !obraDaRodovia(c.obj, cod));
  const at = cs.filter(c => c.grupo !== "encerrado");
  const r = ctx.icmPor.get(cod), s = ctx.an?.rodovias?.[cod];
  const sintese = [
    r ? `${cod}${nomes.length ? ` (${nomes.join(", ")})` : ""}: ${num(r.extensao_total_km, 1)} km, de ${r.inicio} a ${r.fim}; revestimento ${r.revestimento || "—"}. Condição geral ${String(r.nivel_geral).toLowerCase()} (IRI médio ${num(r.iri_medio, 2)} m/km), ${num(r.n_buracos)} buracos registrados no levantamento.` : `${cod}${nomes.length ? ` (${nomes.join(", ")})` : ""}.`,
    `${plural(at.length, "contrato ativo ou pendente cita", "contratos ativos ou pendentes citam")} a rodovia no objeto (${brlCurto(soma(at, "v_atual"))}; saldo ${brlCurto(soma(at, "saldo"))}).`,
    s ? `Sinistros: ${s.leitura}` : "Sem acidente noticiado nesta rodovia desde 2019.",
  ];
  return `<article class="doc">${cab("Rodovia", cod, nomes.length ? nomes.join(" · ") : "Rodovia estadual do Amazonas", ctx)}
    <h2>Síntese</h2><div class="sint">${sintese.map(x => `<p>${esc(x)}</p>`).join("")}</div>
    ${s ? `<p class="doc-chips">${chip(`Prioridade ${num(s.prioridade, 0)} · ${s.faixa}`, s.faixa === "Alta" ? "critico" : s.faixa === "Média" ? "alerta" : "")} ${chip(`${num(s.fatais_100km_ano, 2)} fatais por 100 km/ano`)} ${chip(`tendência ${num(s.tendencia, 2)}×`)}</p>` : ""}
    <h2>Obras e contratos na rodovia (${num(at.length)})</h2>${tabelaObras(at)}
    ${soLocal.length ? `<h2>Obras com acesso pela rodovia (${num(soLocal.length)})</h2><p class="nota">Ramais, estradas e comunidades que citam a ${esc(cod)} só como localização; não entram nos números da rodovia.</p>${tabelaObras(soLocal)}` : ""}
    ${s?.trechos_criticos?.length ? `<h2>Trechos críticos</h2><p>${s.trechos_criticos.map(t => `km ${t.km_ini}–${t.km_fim}: ${t.ocorrencias} ocorrências (${t.fatais} com morte)`).join("; ")}.</p>` : ""}
    ${blocoLic(ctx.lic, cita)}
    ${rodape(ctx, r ? "; condição: levantamento RoadLab (data/icm.json)" : "")}</article>`;
}

// ── briefing de um contrato ──
function docContrato(c, ctx) {
  const dias = c.fim_vig ? Math.round((new Date(c.fim_vig) - new Date()) / 864e5) : null;
  const meds = (c.med || []).slice(-6).reverse();
  // ritmo: p.p. de % financeiro por mês entre as 7 últimas medições
  let ritmo = null;
  if ((c.med || []).length >= 2) {
    const ms = c.med.slice(-7), a = ms[0], b = ms[ms.length - 1];
    const meses = (new Date(b[0]) - new Date(a[0])) / (30.44 * 864e5);
    if (meses > 0) ritmo = (b[2] - a[2]) / meses;
  }
  // prazo decorrido = (hoje − assinatura) ÷ (fim da execução, ou da vigência, − assinatura)
  const fimPrazo = c.fim_exec || c.fim_vig;
  const prazo = c.ass && fimPrazo ? Math.max(0, Math.min(100, (new Date() - new Date(c.ass)) / (new Date(fimPrazo) - new Date(c.ass)) * 100)) : null;
  const fisMeds = (c.med || []).filter(m => m[3] != null);
  let ritmoFis = null;
  if (fisMeds.length >= 2) {
    const ms = fisMeds.slice(-7), a = ms[0], b = ms[ms.length - 1];
    const meses = (new Date(b[0]) - new Date(a[0])) / (30.44 * 864e5);
    if (meses > 0) ritmoFis = (b[3] - a[3]) / meses;
  }
  const desvio = c.fis != null && prazo != null ? c.fis - prazo : null;
  const leituraFis = c.fis == null ? "O e-Obras não informa o percentual físico deste contrato."
    : [`Físico em ${pct(c.fis)}${prazo != null ? ` com ${pct(prazo, 0)} do prazo de execução decorrido` : ""}`,
       desvio != null ? (desvio <= -10 ? `atraso de ${num(-desvio, 0)} p.p. em relação ao prazo` : desvio >= 10 ? `adiantado ${num(desvio, 0)} p.p. em relação ao prazo` : "em linha com o prazo") : "",
       c.fin != null ? (c.fin - c.fis > 10 ? `financeiro ${num(c.fin - c.fis, 0)} p.p. acima do físico` : c.fis - c.fin > 10 ? `físico ${num(c.fis - c.fin, 0)} p.p. acima do financeiro (medições a liberar)` : "físico e financeiro compatíveis") : "",
       ritmoFis != null && c.fis < 100 ? (ritmoFis > 0.05 ? `ritmo recente de ${num(ritmoFis, 1)} p.p. por mês, cerca de ${num((100 - c.fis) / ritmoFis, 0)} meses para concluir` : "sem avanço físico nas últimas medições") : ""]
      .filter(Boolean).join("; ") + ".";
  const barraAnd = (rot, v, cor) => `<div class="and-linha"><span>${rot}</span><div class="and-barra"><i style="width:${Math.max(0, Math.min(100, v || 0))}%;background:${cor}"></i></div><b>${v == null ? "—" : pct(v)}</b></div>`;
  const sintese = [
    `${c.id}, ${c.emp}. ${c.obj}`,
    `Valor atual ${brlCurto(c.v_atual)} (original ${brlCurto(c.v_orig)}${c.v_adit ? `; ${num(c.n_adit)} aditivos somando ${brlCurto(c.v_adit)}, ${pct(c.v_orig ? c.v_adit / c.v_orig * 100 : null)} do original` : ""}). Medido ${pct(c.fin)} do valor atual${c.fis != null ? `, físico ${pct(c.fis)}` : ""}; saldo ${brlCurto(c.saldo)}.`,
    c.fim_vig ? `Vigência até ${data(c.fim_vig)} (${dias < 0 ? `vencida há ${num(-dias)} dias` : `faltam ${num(dias)} dias`})${c.ult_med ? `; última medição em ${data(c.ult_med)}` : ""}.` : "",
    ritmo != null && c.fin < 100 && c.grupo !== "encerrado" ? (ritmo > 0.05
      ? `No ritmo das últimas medições (${num(ritmo, 1)} p.p. do valor por mês), o saldo levaria cerca de ${num((100 - c.fin) / ritmo, 0)} meses para ser medido.`
      : "As últimas medições não mostram avanço financeiro.") : "",
  ].filter(Boolean);
  const kv = pares => `<dl class="kv">${pares.filter(Boolean).map(([r, v]) => `<div><dt>${r}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  // a curva de medição só ganha seção própria quando não há previsão (a previsão já mostra o realizado)
  const temPrev = c.prev && c.prev.situacao !== "encerrado" && c.prev.curva.length;
  return `<article class="doc">${cab("Contrato", c.id, `${c.modal || c.cat} · ${c.mun} · ${c.emp}`, ctx)}
    <div class="doc-chips">${chipSit(c.sit)} ${c.alertas.map(a => chip(a.txt, a.nivel, a.base)).join(" ")}</div>
    <h2>Síntese</h2><div class="sint">${sintese.map(x => `<p>${esc(x)}</p>`).join("")}</div>
    <h2>Execução</h2>
    ${kv([["Assinatura", data(c.ass)], ["Vigência até", data(c.fim_vig)], c.fim_exec && ["Execução até", data(c.fim_exec)],
      ["Valor original", brlCurto(c.v_orig)], ["Aditivos", `${brlCurto(c.v_adit)} (${num(c.n_adit)})`], ["Valor atual", `<b>${brlCurto(c.v_atual)}</b>`],
      ["Medido", `${brlCurto(c.medido)} (${pct(c.fin)})`], ["Saldo", brlCurto(c.saldo)], ["Físico", pct(c.fis)], ["Medições", num(c.n_med)]])}
    <h2>Andamento físico</h2>
    <div class="and">${barraAnd("Físico", c.fis, serie(2))}${barraAnd("Financeiro", c.fin, serie(1))}${barraAnd("Prazo decorrido", prazo, "var(--tinta-3)")}</div>
    <p>${esc(leituraFis)}</p>
    <p class="nota">Prazo: da assinatura (${data(c.ass)}) até ${c.fim_exec ? "o fim da execução" : "o fim da vigência"} (${data(fimPrazo)}).</p>
    ${!temPrev && (c.med || []).length > 1 ? `<h2>Curva de medição</h2>${legendaCurva(c)}<div class="graf graf-doc"><canvas id="gCurvaBr" aria-label="Curva de medição acumulada"></canvas></div>` : ""}
    ${blocoPrevisao(c, kv)}
    ${blocoRisco(c)}
    ${meds.length ? `<h2>Últimas medições</h2>${T(`<table class="t"><thead><tr><th>Data</th><th class="n">Valor liberado</th><th class="n">% acumulado</th><th class="n">% físico</th></tr></thead><tbody>
      ${meds.map(m => `<tr><td>${data(m[0])}</td><td class="n">${brlCurto(m[1])}</td><td class="n">${pct(m[2])}</td><td class="n">${pct(m[3])}</td></tr>`).join("")}</tbody></table>`)}` : ""}
    ${c.alertas.length ? `<h2>Pontos de atenção</h2><ul class="lista">${c.alertas.map(a => `<li>${chip(a.nivel === "critico" ? "crítico" : "atenção", a.nivel)}<div><div class="q">${esc(a.txt)}</div><div class="d">${esc(a.base)}</div></div></li>`).join("")}</ul>` : ""}
    ${rodape({ ...ctx, an: null, lic: null }, "; ficha do contrato: Ficha Resumida e Analítica")}</article>`;
}

// ── curva do contrato no tempo (briefing e ficha de obras.js) ── [Claude] 23/11/2026
// Realizado: % financeiro acumulado e % físico do e-Obras. Prevista: curva S logística de referência (dados.js previsao(),
// Kenley e Wilson, 1986), tracejada. Projeção: regressão das últimas 6 medições, pontilhada. Linha vertical = hoje.
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesAno = v => { const d = new Date(v); return `${MES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`; };
export function legendaCurva(c) {
  const p = c.prev, temFis = (c.med || []).some(m => m[3] != null), prev = p && p.situacao !== "encerrado" && p.curva.length;
  const ln = (cor, rot, tipo = "solid") => `<span><i style="width:18px;height:0;border-radius:0;background:none;border-top:2px ${tipo} ${cor};vertical-align:middle"></i>${rot}</span>`;
  return `<div class="legenda">${ln(serie(1), "Financeiro acumulado")}${temFis ? ln(serie(2), "Físico") : ""}${prev ? ln(css("--tinta-3"), "Prevista (curva S de referência)", "dashed") : ""}${prev && p.conclusao ? ln(serie(p.base === "fis" ? 2 : 1), "Projeção no ritmo recente", "dotted") : ""}</div>`;
}
const HOJE = {
  id: "hoje",
  afterDatasetsDraw(ch) {
    const a = ch.chartArea, px = ch.scales.x.getPixelForValue(Date.now());
    if (!(px >= a.left && px <= a.right)) return;
    const ctx = ch.ctx, cor = css("--tinta-2"); // neutro: ouro já é a cor do físico
    ctx.save();
    ctx.fillStyle = cor; ctx.globalAlpha = .07; ctx.fillRect(px - 4, a.top, 8, a.bottom - a.top);
    ctx.globalAlpha = .7; ctx.strokeStyle = cor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    ctx.font = `600 11px ${css("--f-corpo") || "Outfit"}`; ctx.textBaseline = "top"; ctx.globalAlpha = 1; ctx.fillStyle = cor;
    const dir = px > a.right - 48; ctx.textAlign = dir ? "right" : "left";
    ctx.fillText("hoje", px + (dir ? -6 : 6), a.top + 2);
    ctx.restore();
  },
};
export function curvaContrato(cv, c) {
  if (!cv) return;
  const p = c.prev && c.prev.situacao !== "encerrado" ? c.prev : null;
  const real = (c.med || []).filter(m => m[0]).map(m => [+new Date(m[0]), m[2], m[3] ?? null]);
  const fin = real.filter(r => r[1] != null).map(r => ({ x: r[0], y: r[1] })), fis = real.filter(r => r[2] != null).map(r => ({ x: r[0], y: r[2] }));
  const linha = (label, pts, cor, extra = {}) => ({ label, data: pts, borderColor: cor, backgroundColor: cor, borderWidth: 2, tension: 0,
    pointRadius: pts.length <= 12 ? 2.5 : 0, ...extra });
  const ds = [linha("Financeiro acumulado", fin, serie(1))];
  if (fis.length) ds.push(linha("Físico", fis, serie(2)));
  let x0 = real[0]?.[0] ?? Date.now(), x1 = real.at(-1)?.[0] ?? Date.now();
  if (p?.curva.length) {
    const prev = p.curva.map(([x, y]) => ({ x, y }));
    x0 = Math.min(x0, prev[0].x);
    x1 = Math.max(x1, prev.at(-1).x, p.conclusao ? +new Date(p.conclusao) : 0, Date.now());
    if (x1 > prev.at(-1).x) prev.push({ x: x1, y: 100 });
    ds.unshift(linha("Prevista (curva S)", prev, css("--tinta-3"), { borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 }));
  }
  if (p?.conclusao) {
    const ult = (p.base === "fis" ? fis : fin).at(-1);
    if (ult) ds.push(linha("Projeção", [{ x: p.retomada ? Date.now() : ult.x, y: p.atual }, { x: +new Date(p.conclusao), y: 100 }],
      serie(p.base === "fis" ? 2 : 1), { borderDash: [2, 3], borderWidth: 1.5, pointRadius: [0, 3] }));
  }
  if (c.grupo !== "encerrado") x1 = Math.max(x1, Date.now());
  return grafico(cv, { type: "line", data: { datasets: ds }, plugins: [HOJE],
    options: { animation: false, parsing: false, interaction: { mode: "nearest", intersect: false, axis: "x" },
      scales: { x: { type: "linear", min: x0, max: x1, grid: { display: false }, ticks: { callback: mesAno, maxTicksLimit: 6 } },
        y: { min: 0, max: 100, ticks: { stepSize: 25, callback: v => v + "%" } } },
      plugins: { tooltip: { callbacks: { title: xs => data(new Date(xs[0].raw.x).toISOString().slice(0, 10)), label: x => ` ${x.dataset.label}: ${pct(x.raw.y)}` } } } } });
}

// ── previsão de conclusão e nota de risco (ideias 8 e 9) [Claude] 23/11/2026 ──
// Cálculos em dados.js: previsao() (curva S logística de referência + regressão das últimas 6 medições) e risco().
const NOME_BASE = { fis: "físico", fin: "financeiro acumulado" };
function blocoPrevisao(c, kv) {
  const p = c.prev;
  if (!p || p.situacao === "encerrado") return "";
  const b = NOME_BASE[p.base];
  const frases = [];
  if (p.previstoHoje != null && p.situacao !== "concluida") frases.push(`Pela curva S de referência, o contrato deveria estar com ${pct(p.previstoHoje, 0)} executado hoje; o ${b} está em ${pct(p.atual)}.`);
  if (p.situacao === "projetada") frases.push(`No ritmo das últimas ${num(p.n)} medições (${num(p.ritmo, 1)} p.p. por mês${p.retomada ? ", supondo retomada hoje, porque a última medição tem mais de 90 dias" : ""}), a conclusão provável é ${data(p.conclusao)}, ${p.atraso > 0 ? `${num(p.atraso)} dias depois do fim ${c.fim_exec ? "da execução" : "da vigência"}` : "dentro do prazo"}.`);
  else frases.push(`${p.motivo}${p.atraso > 0 ? ` O prazo terminou há ${num(p.atraso)} dias sem a obra concluída.` : ""}`);
  if (p.aditivo) frases.push(`Aditivo de prazo provavelmente necessário${p.alemExec > 0 ? `: ${num(p.alemExec)} dias além do fim da execução` : ""}${p.alemVig > 0 ? `${p.alemExec > 0 ? " e" : ":"} ${num(p.alemVig)} dias além da vigência` : ""}. A prorrogação deve ser formalizada antes do término do prazo.`);
  return `<h2>Previsão de conclusão</h2>
    ${p.curva.length ? `${legendaCurva(c)}<div class="graf graf-doc"><canvas id="gCurvaBr" aria-label="Curva S prevista, realizado e projeção"></canvas></div>` : ""}
    ${frases.map(x => `<p>${esc(x)}</p>`).join("")}
    ${kv([[c.fim_exec ? "Fim da execução" : "Fim da vigência", data(p.fim)], c.fim_exec && c.fim_vig && ["Fim da vigência", data(c.fim_vig)],
      ["Previsto hoje (curva S)", pct(p.previstoHoje, 0)], [`Realizado (${b})`, pct(p.atual)],
      ["Ritmo recente", p.ritmo == null ? "—" : `${num(p.ritmo, 1)} p.p./mês`], ["Conclusão provável", p.conclusao ? `<b>${data(p.conclusao)}</b>` : "—"],
      ["Atraso projetado", p.atraso == null ? "—" : p.atraso > 0 ? `${num(p.atraso)} dias` : "nenhum"], p.alemVig != null && ["Além da vigência", p.alemVig > 0 ? `${num(p.alemVig)} dias` : "não"]])}
    <p class="nota">Curva prevista: o e-Obras não publica o cronograma do contrato, então ela é uma referência teórica, a curva S logística de desembolso de obras (Kenley e Wilson, 1986), com inclinação ${num(CURVA_S.k)} e inflexão na metade do prazo, entre a assinatura e o fim ${c.fim_exec ? "da execução" : "da vigência"}. Ritmo: regressão linear por mínimos quadrados do % ${b} nas últimas 6 medições. Base legal do aditivo: ${esc(p.baseLegal)}.</p>`;
}

function blocoRisco(c) {
  const r = c.risco;
  if (!r) return "";
  return `<h2>Nota de risco</h2>
    <div class="risco-cab"><span class="nota-risco ${r.nivel}">${num(r.nota)}</span><div><b>Risco ${esc(r.faixa)}</b><span>nota de 0 a 100, soma dos componentes abaixo</span></div></div>
    ${T(`<table class="t"><thead><tr><th>Componente</th><th>Situação</th><th class="n">Peso</th><th class="n">Pontos</th></tr></thead><tbody>
      ${r.comp.map(x => `<tr><td>${esc(x.rot)}<div class="peq">${esc(x.base)}</div></td><td>${esc(x.detalhe)}<div class="peq">${esc(x.regra)}</div></td><td class="n">${x.peso}</td><td class="n">${num(x.pontos, 1)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="3">Total</td><td class="n">${num(r.nota)}</td></tr></tbody></table>`)}
    <p class="nota">Faixas: baixo até 24, médio 25 a 49, alto 50 a 74, crítico 75 ou mais. A nota ordena a atenção do DMOB; não é juízo sobre a empresa.</p>`;
}

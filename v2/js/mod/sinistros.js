// Sinistros nas rodovias estaduais (AM-XXX), a partir de notícias. [Nexus] 23/11/2026
// Fontes: data/sinistros.json (pipelines/sinistros/coletar.py, diário) e data/sinistros_analise.json (analisar.py).
// Métodos e cuidados vêm do _meta da análise e aparecem no painel.
import { carregar } from "../dados.js";
import { esc, num, pct, data, semAcento, desentidade } from "../fmt.js";
import { $, kpi, chip, barra, tabela, grafico, gaveta, fonte, opcoes, serie, css } from "../ui.js";

const estado = { rod: "", ano: "", q: "", fatal: false };

export async function render(el) {
  const [s, a] = await Promise.all([carregar("sinistros"), carregar("sinistros_analise")]);
  const T = a.totais, M = a._meta;
  const nots = new Map(s.noticias.map(n => [n.id, n]));
  const ocs = s.ocorrencias.map(o => ({ ...o, ano: (o.data || "").slice(0, 4), nots: o.noticias.map(i => nots.get(i)).filter(Boolean) }));
  const rods = [...new Set(ocs.map(o => o.rodovia))].sort();
  const anos = [...new Set(ocs.map(o => o.ano))].sort().reverse();
  const arq = s.noticias.filter(n => n.arquivo).length;
  const ranking = a.ranking.map(c => ({ cod: c, ...a.rodovias[c] }));
  const fora = Object.entries(a.rodovias).filter(([c]) => !a.ranking.includes(c)).map(([c, r]) => ({ cod: c, ...r }));

  el.innerHTML = `
    <div class="cab"><div><h1>Sinistros nas rodovias estaduais</h1>
      <p>Acidentes nas rodovias AM-XXX levantados em notícias desde ${data(M.periodo[0])}, com cópia permanente de cada matéria no Wayback Machine. Serve para apontar onde estudar intervenção primeiro.</p></div>
      <div class="fontes">${fonte("atualizado", M.gerado)}${fonte("notícias", num(T.noticias))}${fonte("com cópia arquivada", `${num(arq)} (${pct(T.noticias ? arq / T.noticias * 100 : 0, 0)})`)}</div></div>
    <div class="grade g-kpi">
      ${kpi("Ocorrências", num(T.ocorrencias), `${num(T.rodovias_com_registro)} rodovias com registro`)}
      ${kpi("Com morte", num(T.fatais), `${pct(T.ocorrencias ? T.fatais / T.ocorrencias * 100 : null, 0)} das ocorrências`, true)}
      ${kpi("Mortos (mínimo citado)", num(T.mortos), `${num(T.feridos)} feridos citados`)}
      ${kpi("Severidade (UPS)", num(T.ups), "DENATRAN: morte 13, atropelamento 6, ferido 4, danos 1")}
      ${kpi("Últimos 12 meses", num(T.ultimos_12m), `${num(T.fatais_ultimos_12m)} com morte · 12 meses antes: ${num(T["12m_anteriores"])}`)}
    </div>
    <div class="aviso secao"><b>Como ler:</b> a base são notícias, não boletins de ocorrência.<ul>${M.cuidados.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>

    <section class="secao cartao"><header><div><h2>Onde agir primeiro</h2>
      <p>Índice de prioridade de 0 a 100 (rodovias com 3 ocorrências ou mais). Pesos: ${Object.entries(M.metodos.prioridade.pesos).map(([k, v]) => `${({ ups: "severidade", fatal: "fatais", tendencia: "tendência", iri: "IRI", sem_obra: "sem obra ativa" })[k] || k} ${pct(v * 100, 0)}`).join(", ")}. Faixas: ${esc(M.metodos.prioridade.faixas)}.</p></div></header>
      <div class="corpo" id="rank"></div></section>

    <section class="secao grade g-2">
      <div class="cartao"><header><div><h2>Ocorrências por ano</h2><p>${esc(M.metodos.taxas ? "Contagem de ocorrências (várias notícias do mesmo acidente contam uma vez)" : "")}</p></div></header>
        <div class="corpo"><div class="legenda"><span><i style="background:${serie(1)}"></i>Com morte</span><span><i style="background:${serie(6)}"></i>Sem morte</span></div><div class="graf"><canvas id="gAno"></canvas></div></div></div>
      <div class="cartao"><header><div><h2>Tipo de acidente</h2><p>Define a intervenção a estudar</p></div></header><div class="corpo"><div class="graf"><canvas id="gTipo"></canvas></div></div></div>
      <div class="cartao"><header><div><h2>Mês do ano</h2><p>Chuvoso (dez–mai): ${num(a.sazonalidade.chuvoso_dez_mai)} · seco (jun–nov): ${num(a.sazonalidade.seco_jun_nov)}</p></div></header><div class="corpo"><div class="graf"><canvas id="gMes"></canvas></div></div></div>
      <div class="cartao"><header><div><h2>Município</h2><p>Onde a ocorrência foi registrada</p></div></header><div class="corpo"><div class="graf"><canvas id="gMun"></canvas></div></div></div>
    </section>

    <section class="secao cartao"><header><div><h2>Acervo de notícias</h2><p>Cada ocorrência com o link original e a cópia guardada no Wayback Machine (vale mesmo se o portal apagar a matéria).</p></div><span class="contagem" id="cont"></span></header>
      <div class="corpo">
        <div class="filtros">
          <select id="fRod" aria-label="Rodovia">${opcoes(rods, estado.rod, "Todas as rodovias")}</select>
          <select id="fAno" aria-label="Ano">${opcoes(anos, estado.ano, "Todos os anos")}</select>
          <label style="font-size:14px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="fFatal" ${estado.fatal ? "checked" : ""}> Só com morte</label>
          <input type="search" id="fQ" placeholder="Buscar no título, município, fonte…" aria-label="Buscar">
        </div>
        <div id="tab"></div></div></section>

    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Métodos e fontes</summary>
      <div class="corpo"><dl class="ficha">${Object.entries(M.metodos).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "string" ? v : JSON.stringify(v))}</dd>`).join("")}
      <dt>fonte</dt><dd>${esc(M.fonte_base.fonte)}. ${esc(M.fonte_base.escopo)}.</dd></dl></div></details>`;

  // ranking
  tabela($("#rank", el), [
    { k: "posicao", rot: "#", n: 1 },
    { k: "cod", rot: "Rodovia", html: r => `<b style="color:var(--tinta)">${esc(r.cod)}</b><div class="peq">${num(r.extensao_km, 0)} km</div>` },
    { k: "prioridade", rot: "Prioridade", n: 1, html: r => `${num(r.prioridade, 0)} ${chip(r.faixa, r.faixa === "Alta" ? "critico" : r.faixa === "Média" ? "alerta" : "")}${barra(r.prioridade)}` },
    { k: "ocorrencias", rot: "Ocorrências", n: 1, html: r => `${num(r.ocorrencias)}<div class="peq">${num(r.fatais)} com morte</div>` },
    { k: "fatais_100km_ano", rot: "Fatais / 100 km·ano", n: 1, html: r => `${num(r.fatais_100km_ano, 2)}<div class="peq">IC 95%: ${num(r.fatais_ic95?.[0], 2)}–${num(r.fatais_ic95?.[1], 2)}</div>` },
    { k: "tendencia", rot: "Tendência", n: 1, html: r => r.tendencia == null ? "—" : `${num(r.tendencia, 2)}×<div class="peq">${num(r.ultimos_12m)} em 12 m · média ${num(r.media_anual_36m_antes, 1)}/ano</div>` },
    { k: "iri_medio", rot: "IRI", n: 1, html: r => r.iri_medio == null ? "—" : `${num(r.iri_medio, 2)}<div class="peq">${esc(r.condicao || "")}</div>` },
    { k: "leitura", rot: "Leitura", sem_ord: 1, html: r => `<div class="obj" style="font-size:13.5px">${esc(r.leitura)}</div>` },
  ], ranking, { ordem: { k: "prioridade", dir: -1 }, onLinha: r => detalheRodovia(r, ocs), vazio: "Nenhuma rodovia com 3 ocorrências ou mais ainda." });
  if (fora.length) $("#rank", el).insertAdjacentHTML("beforeend", `<p class="peq" style="font-size:13px;color:var(--tinta-3);margin:10px 0 0">Fora do ranking (menos de 3 ocorrências): ${fora.map(r => `${esc(r.cod)} (${num(r.ocorrencias)})`).join(", ")}.</p>`);

  // gráficos
  const anosG = Object.keys(a.por_ano).sort();
  grafico($("#gAno", el), { type: "bar", data: { labels: anosG, datasets: [
    { label: "Com morte", data: anosG.map(y => a.por_ano[y].fatais), backgroundColor: serie(1), stack: "s", borderColor: css("--sup"), borderWidth: { top: 2 } },
    { label: "Sem morte", data: anosG.map(y => a.por_ano[y].ocorrencias - a.por_ano[y].fatais), backgroundColor: serie(6), stack: "s", borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom" }] },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
  const barrasH = (id, obj, n = 8) => {
    const es = Object.entries(obj).sort((x, y) => y[1] - x[1]).slice(0, n);
    grafico($(id, el), { type: "bar", data: { labels: es.map(e => e[0]), datasets: [{ label: "Ocorrências", data: es.map(e => e[1]), backgroundColor: serie(1), borderRadius: 4, maxBarThickness: 26 }] },
      options: { indexAxis: "y", scales: { x: { grid: { color: css("--grade") } }, y: { grid: { display: false } } } } });
  };
  barrasH("#gTipo", a.por_tipo); barrasH("#gMun", a.por_municipio);
  const meses = Object.keys(a.por_mes);
  grafico($("#gMes", el), { type: "bar", data: { labels: meses, datasets: [{ label: "Ocorrências", data: meses.map(m => a.por_mes[m]),
    backgroundColor: meses.map(m => ["dez", "jan", "fev", "mar", "abr", "mai"].includes(m) ? serie(1) : serie(6)), borderRadius: 4, maxBarThickness: 28 }] } });

  // acervo
  const pinta = () => {
    const q = semAcento(estado.q);
    const fl = ocs.filter(o => (!estado.rod || o.rodovia === estado.rod) && (!estado.ano || o.ano === estado.ano) && (!estado.fatal || o.fatal) &&
      (!q || semAcento(`${o.municipio} ${o.tipo} ${o.nots.map(n => `${n.titulo} ${n.fonte}`).join(" ")}`).includes(q)));
    $("#cont", el).textContent = `${num(fl.length)} ocorrências`;
    tabela($("#tab", el), [
      { k: "data", rot: "Data", html: o => data(o.data) },
      { k: "rodovia", rot: "Rodovia", html: o => `<b style="color:var(--tinta)">${esc(o.rodovia)}</b>${o.km ? `<div class="peq">km ${esc(o.km)}</div>` : ""}` },
      { k: "tipo", rot: "Tipo", html: o => `${esc(o.tipo)}${o.fatal ? `<div>${chip(o.mortos ? `${o.mortos} morte${o.mortos > 1 ? "s" : ""}` : "com morte", "critico")}</div>` : ""}` },
      { k: "municipio", rot: "Município", html: o => esc(o.municipio || "—") },
      { k: "nots", rot: "Notícias", sem_ord: 1, html: o => {
        const um = n => `<div style="margin-bottom:6px"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(desentidade(n.titulo))}</a>
          <div class="peq">${esc(n.fonte)} · ${n.arquivo ? `<a href="${esc(n.arquivo)}" target="_blank" rel="noopener">cópia arquivada</a>` : "cópia ainda não arquivada"}</div></div>`;
        // o mesmo acidente pode ter dezenas de matérias: 3 à vista, o resto recolhido
        return o.nots.slice(0, 3).map(um).join("") + (o.nots.length > 3
          ? `<details><summary style="cursor:pointer;font-size:13px;color:var(--azul)">+${o.nots.length - 3} notícias do mesmo acidente</summary>${o.nots.slice(3).map(um).join("")}</details>` : "");
      } },
    ], fl, { ordem: { k: "data", dir: -1 }, limite: 200 });
  };
  $("#fRod", el).onchange = e => { estado.rod = e.target.value; pinta(); };
  $("#fAno", el).onchange = e => { estado.ano = e.target.value; pinta(); };
  $("#fFatal", el).onchange = e => { estado.fatal = e.target.checked; pinta(); };
  let t; $("#fQ", el).oninput = e => { clearTimeout(t); t = setTimeout(() => { estado.q = e.target.value; pinta(); }, 150); };
  pinta();
}

function detalheRodovia(r, ocs) {
  gaveta(`<h2 style="margin-top:4px">${esc(r.cod)} · prioridade ${num(r.prioridade, 0)} (${esc(r.faixa)})</h2>
    <p style="color:var(--tinta)">${esc(r.leitura)}</p>
    <dl class="ficha">
      <dt>Ocorrências</dt><dd>${num(r.ocorrencias)} (${num(r.fatais)} com morte, ${num(r.mortos)} mortos citados)</dd>
      <dt>Taxa</dt><dd>${num(r.taxa_100km_ano, 2)} por 100 km/ano (IC 95%: ${num(r.taxa_ic95?.[0], 2)}–${num(r.taxa_ic95?.[1], 2)})</dd>
      <dt>Severidade</dt><dd>${num(r.ups_100km_ano, 1)} UPS por 100 km/ano</dd>
      <dt>Tipo mais comum</dt><dd>${esc(r.tipo_predominante)}</dd>
      <dt>Estudar</dt><dd>${esc(r.intervencao_sugerida || "—")}</dd>
      <dt>Km informado</dt><dd>${pct(r.km_informado_pct, 0)} das ocorrências</dd>
      <dt>IRI médio</dt><dd>${num(r.iri_medio, 2)} m/km ${r.condicao ? `(${esc(r.condicao)})` : ""}</dd>
      <dt>Fatores do índice</dt><dd>${Object.entries(r.fatores || {}).map(([k, v]) => `${esc(k)} ${num(v, 2)}`).join(" · ")}</dd>
    </dl>
    ${r.trechos_criticos?.length ? `<h3>Trechos críticos (janelas de 5 km)</h3><table class="t"><thead><tr><th>Trecho</th><th class="n">Ocorr.</th><th class="n">Fatais</th><th class="n">UPS</th></tr></thead><tbody>
      ${r.trechos_criticos.map(t => `<tr><td>km ${t.km_ini}–${t.km_fim}</td><td class="n">${t.ocorrencias}</td><td class="n">${t.fatais}</td><td class="n">${t.ups}</td></tr>`).join("")}</tbody></table>` : ""}
    ${r.obras_ativas?.length ? `<h3 style="margin-top:16px">Obras ativas na rodovia</h3><ul class="lista">${r.obras_ativas.map(o => `<li><div><div class="q">${esc(o.ct)} · ${esc(o.sit)}${o.fis != null ? ` · ${pct(o.fis)} físico` : ""}</div><div class="d">${esc(o.obj)}</div></div></li>`).join("")}</ul>` : `<p>${chip("Sem obra ativa na rodovia", "alerta")}</p>`}
    <h3 style="margin-top:16px">Últimas ocorrências</h3><ul class="lista">${ocs.filter(o => o.rodovia === r.cod).sort((x, y) => y.data.localeCompare(x.data)).slice(0, 8)
      .map(o => `<li><div><div class="q">${data(o.data)} · ${esc(o.tipo)}${o.fatal ? " · com morte" : ""}${o.km ? ` · km ${esc(o.km)}` : ""}</div>${o.nots[0] ? `<div class="d"><a href="${esc(o.nots[0].url)}" target="_blank" rel="noopener">${esc(desentidade(o.nots[0].titulo))}</a></div>` : ""}</div></li>`).join("")}</ul>`);
}

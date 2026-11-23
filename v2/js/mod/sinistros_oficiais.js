// Sinistros de trânsito no AM em bases oficiais (RENAEST/SENATRAN e PRF) e cobertura do robô de notícias. [Claude] 23/11/2026
// Fonte: data/sinistros_oficiais.json (pipelines/sinistros_oficiais/coletar.py, mensal no Actions).
// Taxa de óbitos por 100 mil habitantes = óbitos / população x 100.000 (indicador usado pela OMS e pelo ONSV);
// população = estimativa IBGE que a SENATRAN carrega na tabela Localidade do RENAEST.
import { talvez } from "../dados.js";
import { esc, num, pct } from "../fmt.js";
import { $, kpi, chip, barra, tabela, grafico, fonte, opcoes, serie, css } from "../ui.js";

const estado = { ano: "" };

export async function render(el) {
  const d = await talvez("sinistros_oficiais");
  if (!d) {
    el.innerHTML = `<div class="cab"><div><h1>Sinistros: bases oficiais</h1><p>Os dados ainda não foram gerados. A rotina "Sinistros oficiais (mensal)" roda no GitHub Actions.</p></div></div>`;
    return;
  }
  const M = d._meta, R = d.renaest, P = d.prf, C = d.cobertura, K = d.kpi;
  const anos = Object.keys(R.serie).sort();
  const ult = K.ano || anos[anos.length - 1];
  if (!estado.ano || !anos.includes(estado.ano)) estado.ano = ult;
  const brs = Object.entries(P.brs).filter(([b]) => b.startsWith("BR-")).map(([b, v]) => ({ br: b, ...v.total, v }));
  const covAnos = Object.keys(C.por_ano).sort();
  const prfAnos = M.fontes.prf.anos || [];

  el.innerHTML = `
    <div class="cab"><div><h1>Sinistros: bases oficiais</h1>
      <p>Registros oficiais de sinistros de trânsito no Amazonas: RENAEST (SENATRAN, todas as vias) e PRF (só BRs federais). Servem de régua para conferir quanto o robô de notícias das rodovias estaduais consegue captar.</p></div>
      <div class="fontes">${fonte("atualizado", M.gerado_em)}${fonte("RENAEST", M.fontes.renaest.arquivo || "—")}${fonte("PRF", prfAnos.length ? `${prfAnos[0]}–${prfAnos[prfAnos.length - 1]}` : "—")}</div></div>
    ${M.amostra ? `<div class="aviso secao"><b>Amostra de teste local.</b> Estes números não são a rodada oficial.</div>` : ""}
    <div class="grade g-kpi">
      ${kpi(`Mortos no AM em ${esc(ult || "—")}`, num(K.obitos), `${num(K.com_obito)} sinistros com morte · RENAEST`, true)}
      ${kpi("Óbitos por 100 mil hab.", num(K.taxa_obitos_100mil, 1), `população ${num(K.populacao_am)} (IBGE, via RENAEST)`)}
      ${kpi("Sinistros registrados", num(K.acidentes), `${num(K.feridos)} feridos informados (piso)`)}
      ${kpi("BRs federais (PRF)", num(brs.reduce((s, b) => s + b.mortos, 0)), `mortos ${prfAnos.length ? `${prfAnos[0]}–${prfAnos[prfAnos.length - 1]}` : ""} · ${num(brs.reduce((s, b) => s + b.acidentes, 0))} acidentes`)}
    </div>
    <div class="aviso secao"><b>Como ler:</b><ul>${M.cuidados.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>

    <section class="secao grade g-2">
      <div class="cartao"><header><div><h2>Série anual no AM (RENAEST)</h2><p>Mortos e sinistros com morte por ano. Ano com menos de 12 meses aparece marcado como parcial.</p></div></header>
        <div class="corpo"><div class="legenda"><span><i style="background:${serie(1)}"></i>Mortos</span><span><i style="background:${serie(6)}"></i>Sinistros com morte</span></div><div class="graf"><canvas id="gSerie"></canvas></div></div></div>
      <div class="cartao"><header><div><h2>Tipo de via (RENAEST)</h2><p>Classificação informada no registro, ${esc(estado.ano)}. "Não informado" domina: por isso a rodovia estadual é buscada pelo código AM-xxx no endereço.</p></div></header>
        <div class="corpo"><div class="graf"><canvas id="gTipo"></canvas></div></div></div>
    </section>

    <section class="secao cartao"><header><div><h2>Municípios</h2><p>Sinistros, mortos e feridos no ano escolhido. Taxa por 100 mil habitantes no último ano completo (${esc(ult || "—")}).</p></div>
      <span class="contagem" id="cont"></span></header>
      <div class="corpo"><div class="filtros"><select id="fAno" aria-label="Ano">${opcoes([...anos].reverse(), estado.ano, "Ano")}</select></div><div id="tabMun"></div></div></section>

    <section class="secao cartao"><header><div><h2>Rodovias federais no AM (PRF)</h2><p>Acidentes por BR, ${prfAnos.length ? `${prfAnos[0]} a ${prfAnos[prfAnos.length - 1]}` : ""}. Trecho crítico = faixa de 10 km com mais mortes.</p></div></header>
      <div class="corpo" id="tabBr"></div></section>

    <section class="secao cartao"><header><div><h2>Cobertura do robô de notícias</h2>
      <p>Ocorrências captadas pelo robô (notícias, só AM-xxx) divididas pelos registros oficiais no mesmo município e ano. A comparação justa é com os registros que trazem AM-xxx no endereço; contra o total do município (com vias urbanas) a cobertura é naturalmente baixa.</p></div></header>
      <div class="corpo">
        <div class="legenda"><span><i style="background:${serie(1)}"></i>Robô / oficial com AM-xxx</span><span><i style="background:${serie(3)}"></i>Robô fatais / oficial com morte (total)</span></div>
        <div class="graf"><canvas id="gCob"></canvas></div>
        <div id="tabCob" style="margin-top:14px"></div>
        <p class="peq" style="font-size:13px;color:var(--tinta-3);margin:10px 0 0">${num(C.ocorrencias_sem_municipio)} ocorrências do robô sem município identificado ficaram fora da conta. Cobertura acima de 100% indica registro oficial sem o código da rodovia no endereço, não excesso do robô.</p>
      </div></section>

    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Métodos e fontes</summary>
      <div class="corpo"><dl class="ficha">
        <dt>Metodologia</dt><dd>${esc(M.metodologia)}</dd>
        ${Object.entries(M.fontes).map(([k, f]) => `<dt>${esc(k)}</dt><dd>${Object.entries(f).map(([kk, v]) =>
          kk === "url" ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : `${esc(kk)}: ${esc(Array.isArray(v) ? v.join(", ") : v)}`).join("<br>")}</dd>`).join("")}
        <dt>Subnotificação</dt><dd>Observatório Nacional de Segurança Viária (ONSV), <a href="https://www.onsv.org.br/" target="_blank" rel="noopener">onsv.org.br</a>: comparações do RENAEST com o SIM/DATASUS mostram óbitos a menos no registro de trânsito.</dd>
      </dl></div></details>`;

  // série anual
  const rot = anos.map(a => R.serie[a].meses < 12 ? `${a}*` : a);
  grafico($("#gSerie", el), { type: "bar", data: { labels: rot, datasets: [
    { label: "Mortos", data: anos.map(a => R.serie[a].obitos), backgroundColor: serie(1), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 30 },
    { label: "Sinistros com morte", data: anos.map(a => R.serie[a].com_obito), backgroundColor: serie(6), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 30 }] },
    options: { plugins: { tooltip: { callbacks: { footer: it => R.serie[anos[it[0].dataIndex]].meses < 12 ? `parcial: ${R.serie[anos[it[0].dataIndex]].meses} meses` : "" } } } } });

  const pintaTipo = () => {
    const t = Object.entries(R.tp_rodovia[estado.ano] || {}).sort((x, y) => y[1] - x[1]);
    grafico($("#gTipo", el), { type: "bar", data: { labels: t.map(x => x[0].toLowerCase()), datasets: [{ label: "Sinistros", data: t.map(x => x[1]), backgroundColor: serie(1), borderRadius: 4, maxBarThickness: 26 }] },
      options: { indexAxis: "y", scales: { x: { grid: { color: css("--grade") } }, y: { grid: { display: false } } } } });
  };

  const pintaMun = () => {
    const ls = Object.entries(R.municipios).map(([ib, m]) => ({ ib, nome: m.nome, pop: m.pop, taxa: m.taxa_obitos_100mil, ...(m.anos[estado.ano] || {}) }))
      .filter(m => m.acidentes);
    const max = Math.max(1, ...ls.map(m => m.obitos || 0));
    $("#cont", el).textContent = `${num(ls.length)} municípios com registro`;
    tabela($("#tabMun", el), [
      { k: "nome", rot: "Município", html: m => `<b style="color:var(--tinta)">${esc(m.nome)}</b><div class="peq">${num(m.pop)} hab.</div>` },
      { k: "acidentes", rot: "Sinistros", n: 1, html: m => num(m.acidentes) },
      { k: "obitos", rot: "Mortos", n: 1, html: m => `${num(m.obitos)}${barra(m.obitos || 0, max)}` },
      { k: "feridos", rot: "Feridos", n: 1, html: m => num(m.feridos) },
      { k: "am_xxx", rot: "Com AM-xxx no endereço", n: 1, html: m => `${num(m.am_xxx)}<div class="peq">${num(m.am_xxx_fatais)} com morte</div>` },
      { k: "taxa", rot: `Óbitos/100 mil (${ult})`, n: 1, html: m => num(m.taxa, 1) },
    ], ls, { ordem: { k: "obitos", dir: -1 }, limite: 70 });
  };

  tabela($("#tabBr", el), [
    { k: "br", rot: "Rodovia", html: b => `<b style="color:var(--tinta)">${esc(b.br)}</b>` },
    { k: "acidentes", rot: "Acidentes", n: 1, html: b => num(b.acidentes) },
    { k: "mortos", rot: "Mortos", n: 1, html: b => `${num(b.mortos)}${b.com_morte ? `<div class="peq">${num(b.com_morte)} acidentes com morte</div>` : ""}` },
    { k: "feridos", rot: "Feridos", n: 1, html: b => num(b.feridos) },
    { k: "ultimo", rot: `Último ano (${prfAnos[prfAnos.length - 1] || "—"})`, n: 1, v: b => b.v.anos[prfAnos[prfAnos.length - 1]]?.acidentes ?? 0,
      html: b => { const a = b.v.anos[prfAnos[prfAnos.length - 1]]; return a ? `${num(a.acidentes)}<div class="peq">${num(a.mortos)} mortos</div>` : "—"; } },
    { k: "trecho", rot: "Trecho crítico", sem_ord: 1, html: b => { const t = b.v.trechos_criticos[0];
      return t ? `km ${num(t.km_ini)}–${num(t.km_fim)} ${t.mortos ? chip(`${t.mortos} morte${t.mortos > 1 ? "s" : ""}`, "critico") : ""}<div class="peq">${num(t.acidentes)} acidentes</div>` : "—"; } },
  ], brs, { ordem: { k: "mortos", dir: -1 }, vazio: "Sem dados da PRF." });

  // cobertura
  grafico($("#gCob", el), { type: "bar", data: { labels: covAnos, datasets: [
    { label: "Robô / oficial com AM-xxx (%)", data: covAnos.map(a => C.por_ano[a].pct_am_xxx), backgroundColor: serie(1), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 30 },
    { label: "Robô fatais / oficial com morte (%)", data: covAnos.map(a => C.por_ano[a].pct_fatais_total), backgroundColor: serie(3), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 30 }] },
    options: { scales: { y: { ticks: { callback: v => `${v}%` } } } } });
  tabela($("#tabCob", el), [
    { k: "ano", rot: "Ano" },
    { k: "robo", rot: "Robô (ocorrências)", n: 1, html: r => `${num(r.robo)}<div class="peq">${num(r.robo_fatais)} com morte</div>` },
    { k: "oficial_am_xxx", rot: "Oficial com AM-xxx", n: 1, html: r => `${num(r.oficial_am_xxx)}<div class="peq">${num(r.oficial_am_xxx_fatais)} com morte</div>` },
    { k: "pct_am_xxx", rot: "Robô capta", n: 1, html: r => pct(r.pct_am_xxx, 0) },
    { k: "oficial_total", rot: "Oficial total (municípios do robô)", n: 1, html: r => `${num(r.oficial_total)}<div class="peq">${num(r.oficial_com_obito)} com morte</div>` },
    { k: "pct_fatais_total", rot: "Fatais captadas", n: 1, html: r => pct(r.pct_fatais_total, 0) },
  ], covAnos.map(a => ({ ano: a, ...C.por_ano[a] })), { ordem: { k: "ano", dir: -1 }, vazio: "Sem anos em comum entre o robô e o RENAEST." });

  pintaTipo(); pintaMun();
  $("#fAno", el).onchange = e => { estado.ano = e.target.value || ult; pintaTipo(); pintaMun(); };
}

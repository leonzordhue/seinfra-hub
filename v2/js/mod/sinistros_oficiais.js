// Sinistros de trânsito no AM em bases oficiais (RENAEST/SENATRAN e PRF) e cobertura do robô de notícias. [Claude] 23/11/2026
// Fonte: data/sinistros_oficiais.json (pipelines/sinistros_oficiais/coletar.py, mensal no Actions).
// Taxa de óbitos por 100 mil habitantes = óbitos / população x 100.000 (indicador usado pela OMS e pelo ONSV);
// população = estimativa IBGE que a SENATRAN carrega na tabela Localidade do RENAEST.
import { talvez } from "../dados.js";
import { esc, num, pct } from "../fmt.js";
import { $, kpi, chip, barra, tabela, grafico, fonte, opcoes, serie, css } from "../ui.js";

const estado = { ano: "" };
const MIN_OB = 3;  // taxa só para município com 3+ óbitos no ano: abaixo disso a taxa de cidade pequena é ruído
const nomeM = s => String(s || "").toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/ (Da|De|Do|Das|Dos) /g, m => m.toLowerCase());

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
  // conclusões dos títulos (calculadas, nunca escritas à mão)
  const iU = anos.indexOf(ult), sU = R.serie[ult] || {}, sA = R.serie[anos[iU - 1]];
  const tituloSerie = sA ? `${num(sU.obitos)} mortos em ${esc(ult)}, ${sU.obitos === sA.obitos ? "o mesmo" : `${num(Math.abs(sU.obitos - sA.obitos))} a ${sU.obitos > sA.obitos ? "mais" : "menos"}`} que em ${esc(anos[iU - 1])}` : `${num(sU.obitos)} mortos em ${esc(ult)}`;
  const txs = Object.values(R.municipios).filter(m => m.taxa_obitos_100mil != null && (m.anos[ult]?.obitos || 0) >= MIN_OB)
    .map(m => ({ nome: m.nome, taxa: m.taxa_obitos_100mil, obitos: m.anos[ult].obitos })).sort((x, y) => y.taxa - x.taxa).slice(0, 12);
  const topBr = [...brs].sort((x, y) => y.mortos - x.mortos)[0] || {}, mortosBr = brs.reduce((s, b) => s + b.mortos, 0);
  const somaC = k => covAnos.reduce((s, a) => s + (C.por_ano[a][k] || 0), 0), cR = somaC("robo"), cO = somaC("oficial_am_xxx");
  const tituloCob = !cO ? "Cobertura do robô de notícias" : cR >= cO ? `O robô capta ${num(cR / cO, 1)} vezes o registro oficial com AM-xxx` : `O robô capta ${pct(cR / cO * 100, 0)} do registro oficial com AM-xxx`;

  el.innerHTML = `
    <style>.nota { font-size: 12.5px; color: var(--tinta-3); margin: 10px 0 0; line-height: 1.5; } #gTipoBox { height: 200px; margin-top: 10px; }</style>
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
      <div class="cartao"><header><div><h2>${tituloSerie}</h2><p>Mortos por ano no AM, todas as vias (RENAEST). Barra clara: ano com menos de 12 meses carregados.</p></div></header>
        <div class="corpo"><div class="legenda"><span><i style="background:${serie(1)}"></i>Ano completo</span><span><i style="background:${serie(6)}"></i>Ano parcial</span></div><div class="graf"><canvas id="gSerie"></canvas></div>
          <p class="nota">Fonte: RENAEST/SENATRAN. O registro de trânsito tem óbitos a menos que o SIM/DATASUS (ONSV).</p></div></div>
      <div class="cartao"><header><div><h2>${txs[0] ? `${esc(nomeM(txs[0].nome))}: ${num(txs[0].taxa, 1)} mortos por 100 mil hab.` : "Taxa por 100 mil habitantes"}</h2><p>Óbitos por 100 mil habitantes em ${esc(ult || "—")}, municípios com ${MIN_OB} óbitos ou mais. Média do AM: ${num(K.taxa_obitos_100mil, 1)}.</p></div></header>
        <div class="corpo"><div class="legenda"><span><i style="background:${serie(1)}"></i>Acima da média do AM</span><span><i style="background:${serie(6)}"></i>Igual ou abaixo</span></div><div class="graf" style="height:${Math.max(120, txs.length * 30 + 16)}px"><canvas id="gTaxa"></canvas></div>
          <p class="nota">Taxa = óbitos / população x 100.000 (OMS, ONSV); população IBGE carregada no RENAEST. Município pequeno com 1 ou 2 óbitos fica de fora para a taxa não virar ruído.</p></div></div>
    </section>

    <section class="secao cartao"><header><div><h2 id="tMun">Municípios</h2><p>Sinistros, mortos e feridos no ano escolhido. Taxa por 100 mil habitantes em ${esc(ult || "—")}.</p></div>
      <span class="contagem" id="cont"></span></header>
      <div class="corpo"><div class="filtros"><select id="fAno" aria-label="Ano">${opcoes([...anos].reverse(), estado.ano, "Ano")}</select></div><div id="tabMun"></div>
        <p class="nota" id="tipoVia"></p><div class="graf" id="gTipoBox" hidden><canvas id="gTipo"></canvas></div></div></section>

    <section class="secao cartao"><header><div><h2>${brs.length ? `${esc(topBr.br)} concentra ${pct(mortosBr ? topBr.mortos / mortosBr * 100 : 0, 0)} dos mortos nas BRs federais` : "Rodovias federais no AM (PRF)"}</h2><p>Acidentes por BR (PRF), ${prfAnos.length ? `${prfAnos[0]} a ${prfAnos[prfAnos.length - 1]}` : ""}. Trecho crítico = faixa de 10 km com mais mortes.</p></div></header>
      <div class="corpo" id="tabBr"></div></section>

    <section class="secao cartao"><header><div><h2>${tituloCob}</h2>
      <p>Ocorrências por ano nos municípios do robô: as captadas pelo robô (notícias, só AM-xxx) e as oficiais com AM-xxx no endereço. A comparação justa é essa; contra o total do município, com vias urbanas, a cobertura é naturalmente baixa.</p></div></header>
      <div class="corpo">
        <div class="legenda"><span><i style="background:${serie(1)}"></i>Robô de notícias</span><span><i style="background:${serie(2)}"></i>Oficial com AM-xxx (RENAEST)</span></div>
        <div class="graf"><canvas id="gCob"></canvas></div>
        <div id="tabCob" style="margin-top:14px"></div>
        <p class="nota">${num(C.ocorrencias_sem_municipio)} ocorrências do robô sem município identificado ficaram fora da conta. Robô acima do oficial indica registro oficial sem o código da rodovia no endereço, não excesso do robô.</p>
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
    { label: "Mortos", data: anos.map(a => R.serie[a].obitos), backgroundColor: anos.map(a => R.serie[a].meses < 12 ? serie(6) : serie(1)) }] },
    options: { plugins: { tooltip: { callbacks: { footer: it => { const s = R.serie[anos[it[0].dataIndex]];
      return [`${num(s.com_obito)} sinistros com morte · ${num(s.acidentes)} sinistros`, s.meses < 12 ? `parcial: ${s.meses} meses` : ""]; } } } } } });
  grafico($("#gTaxa", el), { type: "bar", data: { labels: txs.map(m => nomeM(m.nome)), datasets: [{ label: "Óbitos por 100 mil hab.",
    data: txs.map(m => m.taxa), backgroundColor: txs.map(m => m.taxa > K.taxa_obitos_100mil ? serie(1) : serie(6)) }] },
    options: { indexAxis: "y", plugins: { rotulos: { fmt: v => num(v, 1) }, tooltip: { callbacks: { footer: it => `${num(txs[it[0].dataIndex].obitos)} óbitos em ${ult}` } } } } });

  // tipo de via: quase sempre "não informado"; gráfico só quando há mais de uma classe
  const pintaTipo = () => {
    const t = Object.entries(R.tp_rodovia[estado.ano] || {}).sort((x, y) => y[1] - x[1]), tot = t.reduce((s, x) => s + x[1], 0);
    const ni = t.find(x => /N[AÃ]O INFORMAD/i.test(x[0]))?.[1] || 0;
    $("#tipoVia", el).textContent = !tot ? "" : `Tipo de via em ${estado.ano}: ${pct(ni / tot * 100, 0)} dos ${num(tot)} registros vêm sem classificação. Por isso a rodovia estadual é buscada pelo código AM-xxx no endereço.`;
    $("#gTipoBox", el).hidden = t.length < 2;
    if (t.length > 1) grafico($("#gTipo", el), { type: "bar", data: { labels: t.map(x => x[0].toLowerCase()), datasets: [{ label: "Sinistros", data: t.map(x => x[1]), backgroundColor: serie(6) }] }, options: { indexAxis: "y" } });
  };

  const pintaMun = () => {
    const ls = Object.entries(R.municipios).map(([ib, m]) => ({ ib, nome: m.nome, pop: m.pop, taxa: m.taxa_obitos_100mil, ...(m.anos[estado.ano] || {}) }))
      .filter(m => m.acidentes);
    const max = Math.max(1, ...ls.map(m => m.obitos || 0));
    $("#cont", el).textContent = `${num(ls.length)} municípios com registro`;
    const totOb = ls.reduce((s, m) => s + (m.obitos || 0), 0), top = [...ls].sort((x, y) => (y.obitos || 0) - (x.obitos || 0))[0];
    $("#tMun", el).textContent = top && totOb ? `${nomeM(top.nome)} tem ${pct(top.obitos / totOb * 100, 0)} dos mortos de ${estado.ano}` : `Municípios em ${estado.ano}`;
    tabela($("#tabMun", el), [
      { k: "nome", rot: "Município", html: m => `<b style="color:var(--tinta)">${esc(nomeM(m.nome))}</b><div class="peq">${num(m.pop)} hab.</div>` },
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
  // mesma unidade (ocorrências) nas duas séries: um eixo só, sem razão em % que passa de 100
  grafico($("#gCob", el), { type: "bar", data: { labels: covAnos, datasets: [
    { label: "Robô de notícias", data: covAnos.map(a => C.por_ano[a].robo), backgroundColor: serie(1) },
    { label: "Oficial com AM-xxx", data: covAnos.map(a => C.por_ano[a].oficial_am_xxx), backgroundColor: serie(2) }] },
    options: { plugins: { rotulos: { zeros: true }, tooltip: { callbacks: { footer: it => { const p = C.por_ano[covAnos[it[0].dataIndex]].pct_am_xxx; return p == null ? "sem registro oficial com AM-xxx" : `robô = ${pct(p, 0)} do oficial`; } } } } } });
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

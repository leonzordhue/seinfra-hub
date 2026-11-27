// Ambiente e rios: nível dos rios (ANA) e focos de queimada perto das rodovias estaduais (INPE). [Claude] 23/11/2026
// Fontes: data/hidro.json (pipelines/hidro/coletar.py) e data/queimadas.json (pipelines/queimadas/coletar.py), robô diário 05h00.
// Situação do rio: estiagem = cota abaixo da cota de permanência 95% (critério do boletim da Sala de Situação ANA);
// inundação = cota SGB/CPRM; "atenção" = abaixo do P10 histórico da data (cálculo do Hub, não é classificação oficial).
import { talvez, PUBLICO } from "../dados.js";
import { esc, num, data } from "../fmt.js";
import { $, kpi, chip, barra, tabela, grafico, fonte, serie, css, estiloBarra } from "../ui.js";

const ATLAS = "https://leonzordhue.github.io/atlas-amazonas/geojson/RODOVIAS_ESTADUAIS_AMAZONAS.geojson";
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
const estado = { est: "14990000" };
const m2 = v => v == null ? "—" : `${num(v, 2)} m`;
const NIVEL = { "estiagem": "critico", "inundação": "critico", "inundação severa": "critico", "atenção": "alerta", "normal": "ok" };
// rótulo exibido para cada situação do pipeline ("atenção" = P10 da data, critério próprio, sem valor oficial)
const ROTULO = { "estiagem": "Estiagem", "inundação": "Inundação", "inundação severa": "Inundação severa", "atenção": "Abaixo do normal", "normal": "Normal" };
const sit = v => ROTULO[v] || v;
const ORIGEM = { telemetria: "estação automática", convencional: "leitura na régua" };
// dia do ano no calendário bissexto (igual ao pipeline: 29/02 tem índice próprio)
const doy = iso => Math.round((Date.UTC(2000, +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(2000, 0, 1)) / 864e5);
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = Array.from({ length: 366 }, (_, k) => new Date(Date.UTC(2000, 0, 1 + k)).toISOString().slice(5, 10));  // "MM-DD"
// rótulo direto: nome da linha de referência sobre ela (à direita) e o ano no fim de cada linha de cota
const ROT_RIO = {
  id: "rotRio",
  afterDatasetsDraw(ch) {
    const { ctx, chartArea: a, scales: { x, y } } = ch;
    ctx.save(); ctx.font = `600 11.5px ${css("--f-corpo") || "Outfit"}`;
    ch.data.datasets.forEach((d, i) => {
      if (!ch.isDatasetVisible(i)) return;
      if (d._ref != null) {
        const py = y.getPixelForValue(d._ref); if (py < a.top || py > a.bottom) return;
        ctx.fillStyle = d.borderColor; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(`${d.label} ${num(d._ref, 2)} m`, a.left + 6, py - 3);
      } else if (d._fim) {
        let k = d.data.length - 1; while (k >= 0 && d.data[k] == null) k--; if (k < 0) return;
        ctx.fillStyle = d.borderColor; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(d._fim, Math.min(x.getPixelForValue(k) + 5, a.right + 4), y.getPixelForValue(d.data[k]));
      }
    });
    ctx.restore();
  },
};

export async function render(el) {
  const [H, Q] = await Promise.all([talvez("hidro"), talvez("queimadas")]);
  el.innerHTML = `
    <style>
      .amb-frase { font-size: 17px; line-height: 1.5; color: var(--tinta); margin: 0 0 12px; max-width: 70ch; }
      .amb-mapa { height: 460px; border-radius: var(--raio); border: 1px solid var(--borda); background: var(--sup-2); }
      .amb-sel { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
      .amb-sel select { min-width: 220px; }
      .amb-nota { font-size: 14px; color: var(--tinta-2); line-height: 1.55; }
      .amb-nota li { margin: 4px 0; }
      .amb-vazio { padding: 22px 18px; display: grid; gap: 6px; }
      .amb-vazio b { font: 600 1.02rem var(--f-titulo); color: var(--tinta); }
      .amb-vazio span { font-size: 14px; color: var(--tinta-3); max-width: 70ch; }
      .legenda i.tr { height: 0; border-top: 2px dashed var(--tinta-3); border-radius: 0; background: none; vertical-align: 3px; }
      .legenda i.pt { border-radius: 50%; }
      .nota { font-size: 12.5px; color: var(--tinta-3); margin: 10px 0 0; line-height: 1.5; }
      .amb-ler { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px 24px; margin: 0; }
      .amb-ler dt { font-weight: 600; color: var(--tinta); font-size: 14.5px; }
      .amb-ler dd { margin: 3px 0 0; font-size: 14px; line-height: 1.5; color: var(--tinta-2); }
      :root[data-theme="dark"] .amb-mapa .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.35); }
      @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .amb-mapa .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.35); } }
      @media (max-width: 700px) { .amb-mapa { height: 340px; } }
    </style>
    <div class="cab"><div><h1>Rios e queimadas</h1>
      <p>Nível dos principais rios do Amazonas, que define as condições de navegação, das balsas e das travessias, e focos de queimada registrados perto das rodovias estaduais. Os dados são atualizados todos os dias.</p></div>
      <div class="fontes">${H ? fonte("rios (ANA)", data(H._meta.gerado_em)) : ""}${Q ? fonte("queimadas (INPE)", data(Q._meta.gerado_em)) : ""}</div></div>
    <section class="secao cartao"><header><div><h2>Como ler esta página</h2></div></header>
      <div class="corpo"><dl class="amb-ler">
        <div><dt>Nível do rio (cota)</dt><dd>Altura da água na régua da estação, em metros. Não é a profundidade do rio. Cada régua tem o seu zero, então só compare valores da mesma estação.</dd></div>
        <div><dt>Estiagem</dt><dd>O rio está abaixo do nível que costuma superar em 95% dos dias. É o critério usado pela Agência Nacional de Águas (ANA).</dd></div>
        <div><dt>Abaixo do normal</dt><dd>O nível está entre os 10% mais baixos já registrados para a mesma data, mas ainda acima da estiagem.</dd></div>
        <div><dt>Foco de queimada</dt><dd>Ponto de calor detectado por satélite. Indica fogo ativo no local, não o tamanho da área queimada.</dd></div>
      </dl></div></section>
    <section class="secao" id="rios"></section>
    <section class="secao" id="queimadas"></section>
    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Fontes e limitações dos dados</summary>
      <div class="corpo amb-nota" id="nota"></div></details>`;
  const vazio = t => `<div class="cartao amb-vazio"><b>${t}</b><span>${PUBLICO ? "Dados indisponíveis no momento. Tente novamente mais tarde." : "A rotina diária (05h00, GitHub Actions) ainda não gerou este arquivo; a seção aparece sozinha na primeira rodada."}</span></div>`;
  if (H?.estacoes?.length) rios($("#rios", el), H);
  else $("#rios", el).innerHTML = vazio("Nível dos rios");
  if (Q?.anos?.length) queimadas($("#queimadas", el), Q);
  else $("#queimadas", el).innerHTML = vazio("Queimadas perto das rodovias");
  $("#nota", el).innerHTML = nota(H, Q);
}

// ── Rios ──
function rios(sec, H) {
  const E = H.estacoes;
  if (!E.find(e => e.cod === estado.est)) estado.est = E[0].cod;
  sec.innerHTML = `
    <div class="cartao"><header><div><h2>${(n => n ? `${n} de ${E.length} estações acompanhadas estão em estiagem` : `Nenhuma das ${E.length} estações acompanhadas está em estiagem`)(E.filter(e => e.ultima.situacao === "estiagem").length)}</h2><p>Escolha a estação para ver o nível do rio ao longo do ano, comparado com o ano anterior e com tudo o que já foi registrado.</p></div></header>
      <div class="corpo">
        <div class="amb-sel"><label for="fEst" style="font-weight:500;color:var(--tinta)">Estação</label><select id="fEst">${E.map(e => `<option value="${e.cod}"${e.cod === estado.est ? " selected" : ""}>${esc(e.nome)} · ${esc(e.rio)}</option>`).join("")}</select><span id="chipSit"></span></div>
        <p class="amb-frase" id="frase"></p>
        <div class="grade g-kpi" id="kpisRio"></div>
        <div class="legenda" id="legRio"></div>
        <div class="graf alto"><canvas id="gRio"></canvas></div>
        <p class="nota" id="refRio"></p>
      </div></div>
    <div class="cartao secao"><header><div><h2>Todas as estações</h2><p>Última leitura de cada estação. Clique numa linha para ver o gráfico dela.</p></div></header><div class="corpo" id="tabRios"></div></div>`;
  const pinta = () => {
    const e = E.find(x => x.cod === estado.est), u = e.ultima, dia = e.clima.dia[doy(u.data)];
    $("#fEst", sec).value = e.cod;
    $("#chipSit", sec).innerHTML = chip(sit(u.situacao), NIVEL[u.situacao] || "", "Critérios no quadro \"Como ler esta página\"");
    const dif = u.dif_media_m;
    $("#frase", sec).innerHTML = `${esc(e.rio)} em ${esc(e.nome)}: <b>${m2(u.cota_m)}</b> em ${data(u.data)}` +
      (dif == null ? "." : `, <b>${m2(Math.abs(dif))} ${dif < 0 ? "abaixo" : "acima"}</b> da média para esta época do ano (média de ${e.clima.anos} anos, de ${e.clima.periodo.join(" a ")}).`) +
      (u.situacao === "estiagem" ? ` O nível está abaixo da cota de estiagem, que é de ${m2(e.ref.c95)}.` : "");
    $("#kpisRio", sec).innerHTML =
      kpi("Nível atual", m2(u.cota_m), `${data(u.data)} · ${esc(ORIGEM[u.origem] || u.origem)}`, true) +
      kpi("Média para a data", m2(dia?.[0]), dia ? `já variou de ${m2(dia[1])} a ${m2(dia[2])}` : "") +
      kpi("Cota de estiagem", m2(e.ref.c95), e.ref_fonte.startsWith("Boletim") ? "referência da ANA" : "calculada pela série da estação") +
      kpi("Menor nível da série", m2(e.recorde_min.cota_m), data(e.recorde_min.data)) +
      kpi("Maior nível da série", m2(e.recorde_max.cota_m), data(e.recorde_max.data));
    // eixo = calendário (366 dias, 29/02 com índice próprio, igual a doy); cada ano vira uma linha sobre a climatologia
    const ano = u.data.slice(0, 4), ant = String(+ano - 1);
    const porAno = y => { const v = DIAS.map(() => null); e.serie.forEach(([d, c]) => { if (d.startsWith(y)) v[doy(d)] = c; }); return v; };
    const faixa = i => DIAS.map((_, k) => e.clima.dia[k]?.[i] ?? null);
    const ref = (label, v, cor) => ({ label, data: DIAS.map(() => v), _ref: v, borderColor: cor, borderWidth: 1.25, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 0, order: 4 });
    const vAnt = porAno(ant), temAnt = vAnt.some(v => v != null);
    // Chart.js desenha "order" maior primeiro (atrás): faixa no fundo, ano corrente por cima de tudo
    const ds = [
      { label: "Mínimo histórico", data: faixa(1), borderWidth: 0, pointRadius: 0, fill: false, order: 9 },
      { label: "Máximo histórico", data: faixa(2), borderWidth: 0, pointRadius: 0, backgroundColor: css("--sup-3"), fill: "-1", order: 9 },
      { label: "Média", data: faixa(0), borderColor: css("--tinta-3"), borderDash: [4, 4], borderWidth: 1.25, pointRadius: 0, order: 5 },
      ...(temAnt ? [{ label: ant, data: vAnt, _fim: ant, borderColor: serie(6), borderWidth: 1.5, pointRadius: 0, spanGaps: true, order: 2 }] : []),
      { label: ano, data: porAno(ano), _fim: ano, borderColor: serie(1), borderWidth: 2.75, pointRadius: 0, spanGaps: true, order: 0 },
      ref("Estiagem", e.ref.c95, css("--critico")),
    ];
    if (e.ref.inund) ds.push(ref("Inundação", e.ref.inund, css("--alerta")));
    $("#legRio", sec).innerHTML = `<span><i style="background:${serie(1)}"></i>${ano}</span>${temAnt ? `<span><i style="background:${serie(6)}"></i>${ant}</span>` : ""}<span><i class="tr"></i>Média para a data</span><span><i style="background:${css("--sup-3")};outline:1px solid ${css("--borda-2")}"></i>Menor e maior nível já registrados na data (${e.clima.periodo.join(" a ")})</span>`;
    grafico($("#gRio", sec), {
      type: "line", data: { labels: DIAS, datasets: ds }, plugins: [ROT_RIO],
      options: {
        layout: { padding: { right: 38, top: 6 } },
        scales: { x: { ticks: { autoSkip: false, maxRotation: 0, callback(v) { const d = this.getLabelForValue(v); const m = +d.slice(0, 2) - 1; return d.endsWith("-01") && (this.chart.width > 520 || m % 2 === 0) ? MES[m] : null; } } },
          y: { beginAtZero: false, ticks: { precision: 1, callback: v => `${num(v, 0)} m` } } },
        plugins: { tooltip: { filter: x => x.raw != null && !x.dataset._ref && x.datasetIndex > 1,
          callbacks: { title: x => `${x[0].label.slice(3)}/${MES[+x[0].label.slice(0, 2) - 1]}`, label: x => ` ${x.dataset.label}: ${m2(x.raw)}`,
            footer: x => { const d = e.clima.dia[x[0].dataIndex]; return d ? `já variou de ${m2(d[1])} a ${m2(d[2])} nesta data` : ""; } } } },
      },
    });
    $("#refRio", sec).innerHTML = `<b>Importância para o transporte:</b> ${esc(e.uso)}. ` +
      (e.ref_fonte.startsWith("Boletim") ? `Cotas de referência do <a href="${esc(H._meta.boletim_referencia)}" target="_blank" rel="noopener">boletim da Sala de Situação da ANA</a>.`
        : "Esta estação não consta do boletim da ANA; a cota de estiagem foi calculada com a série histórica da própria estação e não tem caráter oficial.") +
      (e.nota && !PUBLICO ? ` ${esc(e.nota)}` : "");  // nota da estação mistura régua e telemetria (12,11 x 12,14 x 12,27 m em Manaus): fora da versão pública até conferir
  };
  tabela($("#tabRios", sec), [
    { k: "nome", rot: "Estação", html: e => `<b>${esc(e.nome)}</b><div class="peq">${esc(e.rio)}</div>` },
    { k: "cota", rot: "Nível", n: 1, v: e => e.ultima.cota_m, html: e => m2(e.ultima.cota_m) },
    { k: "dif", rot: "Diferença para a média", n: 1, v: e => e.ultima.dif_media_m, html: e => e.ultima.dif_media_m == null ? "—" : `${e.ultima.dif_media_m > 0 ? "+" : ""}${num(e.ultima.dif_media_m, 2)} m` },
    { k: "c95", rot: "Cota de estiagem", n: 1, v: e => e.ref.c95, html: e => m2(e.ref.c95) },
    { k: "sit", rot: "Situação", v: e => e.ultima.situacao, html: e => chip(sit(e.ultima.situacao), NIVEL[e.ultima.situacao] || "") },
    { k: "data", rot: "Última leitura", v: e => e.ultima.data, html: e => data(e.ultima.data) },
  ], E, { onLinha: e => { estado.est = e.cod; pinta(); $("#fEst", sec).scrollIntoView({ behavior: "smooth", block: "center" }); } });
  $("#fEst", sec).onchange = ev => { estado.est = ev.target.value; pinta(); };
  pinta();
}

// ── Queimadas ──
function queimadas(sec, Q) {
  const M = Q._meta, anos = Q.anos, atual = anos[anos.length - 1];
  const R = Q.ranking.map(c => ({ cod: c, ...Q.rodovias[c] }));
  const maxT = Math.max(1, ...R.map(r => r.total));
  const recBuf = Q.recentes.filter(p => p[4]);
  const mes = Array(12).fill(0);
  R.forEach(r => r.meses_ano_atual.forEach((v, i) => mes[i] += v));  // soma por rodovia: foco perto de 2 rodovias conta 2 vezes
  const mesMax = mes.indexOf(Math.max(...mes));
  const vA = Q.em_buffer[atual], ant = anos[anos.length - 2], vP = Q.em_buffer[ant];
  // o ano atual está incompleto: compara com o total do ano anterior, sem dizer "a mais/a menos"
  const tituloAno = ant == null ? `${num(vA)} focos perto de rodovias em ${esc(atual)}` : `${esc(atual)}, até hoje: ${num(vA)} focos. Em ${esc(ant)} inteiro, foram ${num(vP)}`;
  sec.innerHTML = `
    <div class="cartao"><header><div><h2>Queimadas perto das rodovias estaduais</h2>
      <p>Focos de queimada detectados por satélite a até ${num(M.buffer_km)} km das rodovias estaduais, de ${anos[0]} até hoje.</p></div></header>
      <div class="corpo"><div class="grade g-kpi">
        ${kpi(`Focos no Amazonas em ${atual}`, num(Q.total_am[atual]), anos.length > 1 ? `até hoje · ${num(Q.total_am[ant])} em ${ant} inteiro` : "até hoje")}
        ${kpi(`Perto de rodovias em ${atual}`, num(Q.em_buffer[atual]), `a até ${num(M.buffer_km)} km · ${num(Q.total_am[atual] ? Q.em_buffer[atual] / Q.total_am[atual] * 100 : null, 1)}% dos focos do estado`, true)}
        ${kpi("Últimos 30 dias", num(recBuf.length), `perto de rodovias · ${num(Q.recentes.length)} em todo o estado`)}
        ${kpi("Rodovia com mais focos", esc(R[0]?.cod || "—"), R[0] ? `${num(R[0].total)} focos desde ${anos[0]}` : "")}
      </div></div></div>
    <section class="secao grade g-2">
      <div class="cartao"><header><div><h2>${tituloAno}</h2><p>Focos por ano a até ${num(M.buffer_km)} km das rodovias estaduais. A barra de ${esc(atual)} vai até hoje.</p></div></header>
        <div class="corpo"><div class="legenda"><span><i style="background:${serie(1)}"></i>${esc(atual)} (até hoje)</span><span><i style="background:${serie(6)}"></i>Anos anteriores</span></div><div class="graf"><canvas id="gAnoQ"></canvas></div></div></div>
      <div class="cartao"><header><div><h2>${mesMax >= 0 && mes[mesMax] ? `Mês com mais focos em ${esc(atual)}: ${MES_LONGO[mesMax]}, com ${num(mes[mesMax])}` : `Focos por mês em ${esc(atual)}`}</h2><p>Focos por mês em ${esc(atual)}, perto das rodovias. O foco próximo de duas rodovias entra na conta das duas.</p></div></header>
        <div class="corpo"><div class="graf"><canvas id="gMesQ"></canvas></div></div></div>
    </section>
    <div class="cartao secao"><header><div><h2>${R[0] ? `${esc(R[0].cod)} lidera, com ${num(R[0].total)} focos desde ${anos[0]}` : "Ranking das rodovias"}</h2><p>Total de focos a até ${num(M.buffer_km)} km de cada rodovia, desde ${anos[0]}${R.length > 12 ? " (as 12 com mais focos)" : ""}.</p></div></header>
      <div class="corpo"><div class="graf" style="height:${Math.max(120, Math.min(12, R.length) * 30 + 16)}px"><canvas id="gRodQ"></canvas></div>
        <details style="margin-top:12px"><summary style="cursor:pointer;font-size:13.5px;color:var(--azul)">Ver todas as ${num(R.length)} rodovias, com focos a cada 100 km</summary><div id="tabQ" style="margin-top:8px"></div></details></div></div>
    <div class="cartao secao"><header><div><h2>Trechos com mais focos</h2><p>Trechos de 5 km com mais focos desde ${anos[0]}. A posição em km é aproximada.</p></div></header><div class="corpo" id="tabTr"></div></div>
    <div class="cartao secao"><header><div><h2>${num(recBuf.length)} focos perto de rodovias nos últimos 30 dias</h2><p>Focos registrados no estado nos últimos 30 dias. Clique num ponto para ver a data e o município.</p></div></header>
      <div class="corpo"><div class="legenda"><span><i class="pt" style="background:${css("--critico")}"></i>A até ${num(M.buffer_km)} km de rodovia estadual</span><span><i class="pt" style="background:${css("--tinta-3")}"></i>Demais focos no estado</span><span><i style="background:${css("--azul")};height:3px;vertical-align:3px"></i>Rodovia estadual</span></div>
        <div class="amb-mapa" id="mapaQ" role="region" aria-label="Mapa dos focos de queimada recentes e das rodovias estaduais"></div>
        <p class="nota">Fonte: INPE, Programa Queimadas. Traçado das rodovias: SEINFRA-AM.</p></div></div>`;

  grafico($("#gAnoQ", sec), { type: "bar", data: { labels: anos, datasets: [{ label: "Focos a até 5 km", data: anos.map(a => Q.em_buffer[a]), ...estiloBarra(anos.map(a => a === atual ? serie(1) : serie(6))) }] },
    options: { plugins: { tooltip: { callbacks: { label: x => ` ${num(x.raw)} perto de rodovias · ${num(Q.total_am[x.label])} em todo o estado` } } } } });
  grafico($("#gMesQ", sec), { type: "bar", data: { labels: MES,
    datasets: [{ label: "Focos", data: mes, ...estiloBarra(mes.map((v, i) => i === mesMax ? serie(2) : serie(6))) }] } });
  const top = R.slice(0, 12);
  grafico($("#gRodQ", sec), { type: "bar", data: { labels: top.map(r => r.cod), datasets: [{ label: `Focos desde ${anos[0]}`, data: top.map(r => r.total), ...estiloBarra(top.map((r, i) => i ? serie(6) : serie(1))) }] },
    options: { indexAxis: "y", plugins: { tooltip: { callbacks: { footer: x => { const r = top[x[0].dataIndex]; return `${num(r.anos[atual])} em ${atual} · ${num(r.por_100km, 1)} por 100 km · ${num(r.extensao_km, 0)} km`; } } } } } });

  tabela($("#tabQ", sec), [
    { k: "cod", rot: "Rodovia", html: r => `<b>${esc(r.cod)}</b>` },
    { k: "extensao_km", rot: "Extensão", n: 1, html: r => `${num(r.extensao_km, 1)} km` },
    { k: "total", rot: `Focos desde ${anos[0]}`, n: 1, html: r => `${num(r.total)}${barra(r.total, maxT)}` },
    { k: "atual", rot: `Em ${atual}`, n: 1, v: r => r.anos[atual], html: r => num(r.anos[atual]) },
    { k: "ultimos_30d", rot: "Últimos 30 dias", n: 1, html: r => r.ultimos_30d ? chip(num(r.ultimos_30d), "alerta") : "0" },
    { k: "por_100km", rot: "Por 100 km", n: 1, html: r => num(r.por_100km, 1) },
  ], R, { ordem: { k: "total", dir: -1 } });
  tabela($("#tabTr", sec), [
    { k: "rod", rot: "Rodovia", html: t => `<b>${esc(t.rod)}</b>` },
    { k: "km_ini", rot: "Trecho", n: 1, html: t => `km ${num(t.km_ini)} a ${num(t.km_fim)}` },
    { k: "total", rot: `Focos desde ${anos[0]}`, n: 1 },
    { k: "ano_atual", rot: `Em ${atual}`, n: 1 },
  ], Q.trechos_top, { ordem: { k: "total", dir: -1 } });
  mapa($("#mapaQ", sec), Q).catch(e => { console.warn(e); $("#mapaQ", sec).innerHTML = `<p class="vazio">Mapa indisponível (${esc(e.message)}).</p>`; });
}

function carregarLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, erro) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `${LEAFLET}.css`; document.head.appendChild(l);
    const s = document.createElement("script"); s.src = `${LEAFLET}.js`; s.onload = ok; s.onerror = () => erro(new Error("Leaflet não carregou")); document.head.appendChild(s);
  });
}

async function mapa(div, Q) {
  await carregarLeaflet();
  const L = window.L;
  const m = L.map(div, { preferCanvas: true }).setView([-3.4653, -62.2159], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(m);
  try {
    const g = await (await fetch(ATLAS)).json();
    L.geoJSON(g, { style: { color: css("--azul") || "#002D72", weight: 2.5, opacity: .9 },
      onEachFeature: (f, l) => l.bindTooltip(`${f.properties.RODOVIA} · km ${num(f.properties["KM INICIAL"], 1)}–${num(f.properties["KM FINAL"], 1)}`) }).addTo(m);
  } catch (e) { console.warn("rodovias", e); }
  const verm = css("--critico"), cinza = css("--tinta-3");
  // cinza primeiro, vermelho por cima
  [...Q.recentes].sort((a, b) => !!a[4] - !!b[4]).forEach(([lat, lon, d, mun, rod, dist]) =>
    L.circleMarker([lat, lon], { radius: rod ? 5 : 3, color: rod ? verm : cinza, weight: 1, fillOpacity: rod ? .85 : .45 })
      .bindPopup(`<b>${data(d)}</b><br>${esc(mun)}${rod ? `<br>A ${num(dist / 1000, 1)} km da ${esc(rod)}` : ""}`).addTo(m));
}

function nota(H, Q) {
  const li = [];
  if (H) {
    li.push("<b>Rios.</b> Fonte: Agência Nacional de Águas e Saneamento Básico (ANA), com dados das estações fluviométricas e da rede de telemetria. Cotas de inundação: Serviço Geológico do Brasil (SGB).");
    li.push(`A cota de estiagem é a do <a href="${esc(H._meta.boletim_referencia)}" target="_blank" rel="noopener">boletim da Sala de Situação da ANA</a>. Careiro, Parintins, Borba e Humaitá não constam do boletim: nessas estações, a cota foi calculada com a série histórica da própria estação e não tem caráter oficial.`);
    li.push("\"Abaixo do normal\" é uma classificação deste painel, sem caráter oficial: indica nível entre os 10% mais baixos já registrados para a data.");
    li.push("As leituras mais recentes vêm das estações automáticas e podem diferir alguns centímetros da leitura feita na régua. A estação de Borba não tem leitura automática, por isso o dado mais recente dela pode ter alguns meses.");
    li.push("Em Itacoatiara (desde 2009) e Humaitá (desde 1967), a média usa só o período medido com o zero atual da régua, que foi alterado no passado.");
  }
  if (Q) {
    li.push("<b>Queimadas.</b> Fonte: Instituto Nacional de Pesquisas Espaciais (INPE), Programa Queimadas. Traçado das rodovias: SEINFRA-AM.");
    li.push(`Um foco conta para a rodovia quando está a até ${num(Q._meta.buffer_km)} km de qualquer trecho dela. No total do estado, cada foco conta uma vez.`);
    li.push("A contagem usa só o satélite de referência do INPE, que permite comparar um ano com outro. A soma de todos os satélites registra mais focos.");
    li.push("O foco tem resolução de cerca de 1 km e não mede a área queimada. Nuvens podem esconder focos. Trechos de rodovia sem traçado digital ficam fora da contagem.");
  }
  return `<ul>${li.map(x => `<li>${x}</li>`).join("")}</ul>`;
}

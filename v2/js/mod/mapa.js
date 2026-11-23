// Mapa do Amazonas: condição (IRI), sinistros, obras ativas e investimento por município. [Claude] 23/11/2026
// Geometria: data/mapa.pmtiles (pipelines/mapa/gerar.py --tiles, robô semanal). Sem ele, cai para GeoJSON:
// data/mapa_malha.geojson (IBGE) + rodovias/ramais/hidrovias do Atlas Amazonas (carregados só quando ligados).
// Números: data/mapa_municipios.json, data/mapa_trechos.json, data/sinistros_analise.json, data/eobras.json.
// Os números entram por expressão "match" no navegador, então o .pmtiles só muda quando muda a geometria.
import { talvez, contratos, municipios } from "../dados.js";
import { esc, num, brlCurto, semAcento } from "../fmt.js";
import { $, $$, gaveta, fonte, chipSit } from "../ui.js";

const ML = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/";
const PMT = "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js";
const ATLAS = "https://leonzordhue.github.io/atlas-amazonas/geojson/";
// Basemap raster sem chave (Esri World Gray Canvas); CARTO exige chave.
const ESRI = t => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${t}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const APELIDO = { "AM-151": "Carlos Braga", "AM-450": "Anel Sul" };  // CLAUDE.md: nomes históricos

// DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006): condição do pavimento pelo IRI (m/km).
// Mesmos limites de pipelines/mapa/gerar.py (classe_iri). Cores = escala do levantamento em data/icm.json.
const IRI = [["Excelente", "até 1,9", "#157347"], ["Bom", "1,9 a 2,7", "#4CAF50"], ["Regular", "2,7 a 3,5", "#F5A623"],
  ["Ruim", "3,5 a 4,6", "#E8730C"], ["Péssimo", "acima de 4,6", "#C0392B"], ["Sem medição", "", "#9AA5B5"]];
const CAMADAS = [["iri", "Condição (IRI)"], ["sinistros", "Sinistros por km"], ["obras", "Obras ativas"], ["invest", "Investimento por município"]];
const EXTRAS = [["ramais", "Ramais", "RAMAIS_SEINFRA.geojson"], ["hidrovias", "Hidrovias", "HIDROVIAS.geojson"], ["federais", "Rodovias federais", "RODOVIAS_FEDERAIS.geojson"]];

const estado = { camada: "iri", porHab: false, extras: {} };
let mapa, libs;

function script(src) {
  return new Promise((ok, erro) => document.head.append(Object.assign(document.createElement("script"),
    { src, onload: ok, onerror: () => erro(new Error(`Não carregou ${src}`)) })));
}
const carregarLibs = () => libs ||= (async () => {
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${ML}maplibre-gl.css">`);
  await Promise.all([script(ML + "maplibre-gl.js"), script(PMT)]);
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
})().catch(e => { libs = null; throw e; });

const escuro = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
// sequenciais (claro -> escuro no tema claro; escuro -> claro no tema escuro)
const SEQ_AZUL = () => escuro() ? ["#1E3354", "#28508A", "#3A72C0", "#6FA0F0", "#B3CCF8"] : ["#DCE6F5", "#A9C1E6", "#6F95D0", "#3566B0", "#002D72"];
const SEQ_RISCO = ["#F7D79A", "#F5A623", "#E8730C", "#C0362C"];

// quebras por quantis dos valores > 0 (5 classes)
function quebras(vals) {
  const v = vals.filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  return [0.2, 0.4, 0.6, 0.8].map(q => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}
const classe = (v, qs) => qs.filter(q => v > q).length;

export async function render(el, params) {
  mapa?.remove(); mapa = null;
  el.innerHTML = `<div class="carregando">Carregando o mapa…</div>`;
  const [_, mun, tr, an, ct, temTiles] = await Promise.all([
    carregarLibs(), talvez("mapa_municipios"), talvez("mapa_trechos"), talvez("sinistros_analise"), contratos(),
    fetch("../data/mapa.pmtiles", { method: "HEAD" }).then(r => r.ok).catch(() => false)]);
  if (params?.get("camada") && CAMADAS.some(c => c[0] === params.get("camada"))) estado.camada = params.get("camada");

  const M = mun?.municipios || {};
  const obrasRod = tr?._meta?.obras_por_rodovia || {};
  const ctPor = new Map(ct.lista.map(c => [c.id, c]));
  const munsEo = [...new Set(ct.lista.flatMap(municipios))];
  const rodAn = an?.rodovias || {};

  el.innerHTML = `
    <style>
      .mapa-caixa { position: relative; height: min(74vh, 760px); min-height: 420px; border: 1px solid var(--borda); border-radius: var(--raio); overflow: hidden; background: var(--sup-2); }
      .mapa-caixa .maplibregl-map { position: absolute; inset: 0; }
      .mapa-leg { position: absolute; left: 10px; bottom: 28px; z-index: 2; max-width: min(300px, calc(100% - 20px)); background: var(--sup); color: var(--tinta-2);
        border: 1px solid var(--borda); border-radius: 6px; padding: 10px 12px; font-size: 12.5px; box-shadow: var(--sombra); }
      .mapa-leg b { display: block; color: var(--tinta); font-weight: 500; margin-bottom: 6px; font-size: 13px; }
      .mapa-leg div { display: flex; align-items: center; gap: 7px; margin: 3px 0; }
      .mapa-leg i { flex: none; width: 18px; height: 10px; border-radius: 2px; }
      .mapa-leg i.lin { height: 4px; }
      .mapa-leg p { margin: 6px 0 0; color: var(--tinta-3); font-size: 11.5px; }
      .mapa-extra { font-size: 14px; display: inline-flex; gap: 6px; align-items: center; }
    </style>
    <div class="cab"><div><h1>Mapa do Amazonas</h1>
      <p>Condição das rodovias estaduais, sinistros, obras ativas e investimento da SEINFRA por município. Clique num trecho, rodovia ou município para ver a ficha.</p></div>
      <div class="fontes">${fonte("municípios", mun?._meta?.gerado_em?.slice(0, 10) || "—")}${fonte("trechos", tr?._meta?.gerado_em?.slice(0, 10) || "—")}${fonte("geometria", temTiles ? "PMTiles" : "GeoJSON")}</div></div>
    ${mun && tr ? "" : `<div class="aviso secao"><b>Dados do mapa ainda não gerados.</b> Rode o robô "Mapa (semanal)" (pipelines/mapa/gerar.py); por enquanto aparecem só as geometrias.</div>`}
    <div class="filtros">
      <div class="seg" id="fCamada" role="group" aria-label="Camada">${CAMADAS.map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${estado.camada === v}">${r}</button>`).join("")}</div>
      <div class="seg" id="fHab" role="group" aria-label="Medida"><button type="button" data-v="" aria-pressed="${!estado.porHab}">R$</button><button type="button" data-v="1" aria-pressed="${estado.porHab}">R$ por habitante</button></div>
      ${EXTRAS.map(([v, r]) => `<label class="mapa-extra"><input type="checkbox" data-x="${v}" ${estado.extras[v] ? "checked" : ""}> ${r}</label>`).join("")}
    </div>
    <div class="mapa-caixa"><div id="mapa"></div><div class="mapa-leg" id="leg" aria-live="polite"></div></div>
    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Métodos e fontes</summary>
      <div class="corpo"><dl class="ficha">
        <dt>Condição</dt><dd>IRI médio de cada trecho de 1 km do levantamento RoadLab Pro (data/icm.json), classificado pelo DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006): excelente até 1,9; bom até 2,7; regular até 3,5; ruim até 4,6; péssimo acima de 4,6 m/km. Condição preliminar, não é o ICM oficial do DNIT. ${esc(tr?._meta?.metodologia || "")}</dd>
        <dt>Sinistros</dt><dd>Rodovia pintada pelas ocorrências por 100 km por ano (análise do módulo Sinistros); trechos destacados quando a notícia informa o km. A base são notícias, não boletins de ocorrência.</dd>
        <dt>Obras ativas</dt><dd>Contratos em andamento, vigentes, a iniciar ou em recebimento no e-Obras. Rodovia citada só como localização não conta como obra da rodovia.</dd>
        <dt>Municípios</dt><dd>${esc(mun?._meta?.metodologia || "")} Fonte: ${esc(mun?._meta?.fonte || "")}.</dd>
        <dt>Geometria</dt><dd>IBGE (malha municipal); Atlas Amazonas (rodovias estaduais SEINFRA, ramais, rodovias federais SNV/DNIT, hidrovias). Fundo: Esri World Gray Canvas.</dd>
      </dl></div></details>`;

  // ── fontes de geometria: PMTiles quando existe, senão GeoJSON ──
  const vt = temTiles ? { type: "vector", url: "pmtiles://" + new URL("../data/mapa.pmtiles", location.href).href } : null;
  const GJ = { municipios: "../data/mapa_malha.geojson", rodovias: ATLAS + "RODOVIAS_ESTADUAIS_AMAZONAS.geojson",
    ...Object.fromEntries(EXTRAS.map(([v, , a]) => [v, ATLAS + a])) };
  const fonteDe = nome => vt ? { source: "vt", "source-layer": nome } : { source: nome };
  const garantirFonte = nome => { if (!vt && !mapa.getSource(nome)) mapa.addSource(nome, { type: "geojson", data: GJ[nome] }); };

  const tema = escuro() ? "Dark" : "Light";
  mapa = new maplibregl.Map({
    container: $("#mapa", el), center: [-62.2159, -3.4653], zoom: 5, minZoom: 3, maxZoom: 14, attributionControl: { compact: true },
    style: { version: 8, sources: { base: { type: "raster", tiles: [ESRI(tema)], tileSize: 256, maxzoom: 16,
      attribution: "Fundo: Esri, HERE, Garmin, © colaboradores do OpenStreetMap · IBGE · Atlas Amazonas" } },
      layers: [{ id: "base", type: "raster", source: "base" }] },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  const m = mapa;
  await new Promise(ok => m.on("load", ok));
  if (m !== mapa) return;  // trocou de tela durante a carga
  if (vt) m.addSource("vt", vt);
  m.addSource("trechos", { type: "geojson", data: tr || { type: "FeatureCollection", features: [] } });

  // ── expressões de dados (match por código) ──
  const corLinha = escuro() ? "#C5CCD6" : "#3B4657";
  const matchMun = (f, padrao) => Object.keys(M).length ? ["match", ["get", "cod"], ...Object.entries(M).flatMap(([c, x]) => [c, f(x)]), padrao] : padrao;
  const matchRod = (f, padrao) => {
    const cods = [...new Set([...Object.keys(rodAn), ...Object.keys(obrasRod)])];
    return cods.length ? ["match", ["get", "RODOVIA"], ...cods.flatMap(c => [c, f(c)]), padrao] : padrao;
  };

  garantirFonte("municipios"); garantirFonte("rodovias");
  m.addLayer({ id: "mun-fill", type: "fill", ...fonteDe("municipios"), paint: { "fill-color": "#000", "fill-opacity": 0 } });
  m.addLayer({ id: "mun-linha", type: "line", ...fonteDe("municipios"), paint: { "line-color": corLinha, "line-opacity": 0.45, "line-width": 0.7 } });
  // extras (ligados sob demanda: os GeoJSON de ramais e federais têm 7 a 8 MB)
  const EXTRA_PAINT = { ramais: ["#8A5A00", 1, [2, 2]], hidrovias: ["#2E86C1", 1.6, null], federais: ["#5B6777", 1.4, null] };
  const ligarExtra = (v, on) => {
    const id = "x-" + v;
    if (!m.getLayer(id)) {
      if (!on) return;
      garantirFonte(v);
      const [cor, w, tr2] = EXTRA_PAINT[v];
      m.addLayer({ id, type: "line", ...fonteDe(v), paint: { "line-color": escuro() && v === "federais" ? "#98A2B1" : cor, "line-width": w, ...(tr2 ? { "line-dasharray": tr2 } : {}) } }, "rod-linha");
    } else m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  m.addLayer({ id: "rod-linha", type: "line", ...fonteDe("rodovias"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": corLinha, "line-width": 2 } });
  m.addLayer({ id: "tr-linha", type: "line", source: "trechos", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 4 } });
  m.addLayer({ id: "mun-sel", type: "line", ...fonteDe("municipios"), filter: ["==", ["get", "cod"], ""], paint: { "line-color": escuro() ? "#F5B544" : "#002D72", "line-width": 2.5 } });

  // ── pintura por camada + legenda ──
  const leg = $("#leg", el);
  const item = (cor, txt, lin = false) => `<div><i class="${lin ? "lin" : ""}" style="background:${cor}"></i>${esc(txt)}</div>`;
  function pintar() {
    const c = estado.camada;
    $("#fHab", el).style.display = c === "invest" ? "" : "none";
    let fill = "#000", fillOp = 0, rodCor = corLinha, rodW = 2, trVis = "none", trPaint = {}, html = "";
    if (c === "iri") {
      trVis = "visible";
      trPaint = { "line-color": ["match", ["get", "classe"], ...IRI.slice(0, 5).flatMap(([n, , k]) => [n, k]), IRI[5][2]], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 6] };
      rodCor = escuro() ? "#5B6777" : "#9AA5B5"; rodW = 1.5;
      html = `<b>Condição pelo IRI (m/km)</b>${IRI.map(([n, f, k]) => item(k, f ? `${n} (${f})` : n, true)).join("")}${item(rodCor, "Rodovia sem levantamento", true)}<p>Escala DNIT IPR-720/2006. Levantamento RoadLab, preliminar.</p>`;
    } else if (c === "sinistros") {
      const faixas = [[1, "menos de 1"], [3, "1 a 3"], [6, "3 a 6"], [Infinity, "6 ou mais"]];
      const cor = t => t == null ? (escuro() ? "#5B6777" : "#9AA5B5") : SEQ_RISCO[faixas.findIndex(([lim]) => t < lim)];
      rodCor = matchRod(r => cor(rodAn[r]?.taxa_100km_ano), escuro() ? "#5B6777" : "#9AA5B5"); rodW = 3;
      trVis = "visible";
      trPaint = { "line-color": escuro() ? "#F07A70" : "#8E1B12", "line-width": ["interpolate", ["linear"], ["get", "sinistros"], 1, 5, 5, 11],
        "line-opacity": ["case", [">", ["get", "sinistros"], 0], 1, 0] };
      html = `<b>Ocorrências por 100 km/ano</b>${faixas.map(([, t], i) => item(SEQ_RISCO[i], t, true)).join("")}${item(escuro() ? "#5B6777" : "#9AA5B5", "Sem registro", true)}
        ${item(escuro() ? "#F07A70" : "#8E1B12", "Km com ocorrência (mais grosso = mais casos)", true)}<p>Base: notícias desde 2019; só ${num(an?.rodovias ? Math.round(Object.values(an.rodovias).reduce((s, r) => s + (r.km_informado_pct || 0) * r.ocorrencias, 0) / Math.max(1, Object.values(an.rodovias).reduce((s, r) => s + r.ocorrencias, 0))) : null)}% informam o km.</p>`;
    } else if (c === "obras") {
      const seq = SEQ_AZUL(), lims = [1, 2, 4, 10];
      const corAt = n => n ? seq[Math.min(4, lims.filter(l => n >= l).length)] : "rgba(0,0,0,0)";
      fill = matchMun(x => corAt(x.ativos), "rgba(0,0,0,0)"); fillOp = 0.75;
      rodCor = matchRod(r => obrasRod[r]?.length ? "#F5A623" : corLinha, corLinha);
      rodW = ["case", ["in", ["get", "RODOVIA"], ["literal", Object.keys(obrasRod)]], 4.5, 1.6];
      html = `<b>Obras ativas</b>${item("#F5A623", "Rodovia com obra ativa", true)}${item(corLinha, "Rodovia sem obra ativa", true)}
        <p style="margin:8px 0 4px;color:var(--tinta-2)">Contratos ativos no município</p>${["1", "2 a 3", "4 a 9", "10 ou mais"].map((t, i) => item(seq[i + 1], t)).join("")}`;
    } else {
      const k = estado.porHab ? "r_hab" : "v_contratado", seq = SEQ_AZUL(), SEM = escuro() ? "#3A3A3A" : "#D6D3CC";  // cinza neutro, fora da escala azul
      const qs = quebras(Object.values(M).map(x => x[k] || 0));
      fill = matchMun(x => x[k] > 0 ? seq[classe(x[k], qs)] : SEM, "rgba(0,0,0,0)"); fillOp = 0.85;
      rodW = 1.2;
      const lim = [Math.min(...Object.values(M).map(x => x[k]).filter(v => v > 0)), ...qs];
      html = `<b>${estado.porHab ? "Valor contratado por habitante" : "Valor contratado (valor atual)"}</b>${seq.map((s, i) => item(s, i < 4 ? `${brlCurto(lim[i])} a ${brlCurto(lim[i + 1])}` : `acima de ${brlCurto(lim[4])}`)).join("")}
        ${item(SEM, "Sem contrato")}<p>Quintis entre municípios com contrato. Contrato de vários municípios tem o valor rateado.${estado.porHab ? ` População: IBGE, estimativa ${esc(mun?._meta?.ano_populacao || "")}.` : ""}</p>`;
    }
    m.setPaintProperty("mun-fill", "fill-color", fill); m.setPaintProperty("mun-fill", "fill-opacity", fillOp);
    m.setPaintProperty("rod-linha", "line-color", rodCor); m.setPaintProperty("rod-linha", "line-width", rodW);
    m.setLayoutProperty("tr-linha", "visibility", trVis);
    for (const [p, v] of Object.entries(trPaint)) m.setPaintProperty("tr-linha", p, v);
    if (c !== "sinistros") m.setPaintProperty("tr-linha", "line-opacity", 1);
    const extras = EXTRAS.filter(([v]) => estado.extras[v]).map(([v, r]) => item(EXTRA_PAINT[v][0], r, true)).join("");
    leg.innerHTML = html + (extras ? `<p style="margin:8px 0 4px;color:var(--tinta-2)">Camadas extras</p>${extras}` : "");
  }

  // ── fichas ──
  const nomeRod = r => `${esc(r)}${APELIDO[r] ? ` (${APELIDO[r]})` : ""}`;
  const listaObras = ids => ids?.length ? `<ul style="padding-left:18px">${ids.map(id => ctPor.get(id)).filter(Boolean).map(c => `<li><b>${esc(c.id)}</b> ${chipSit(c.sit)}<div class="peq">${esc((c.obj || "").slice(0, 160))}</div></li>`).join("")}</ul>` : "<p>Nenhuma obra ativa da rodovia no e-Obras.</p>";
  const linkBrief = (k, v, txt) => `<p><a class="btn" href="#/briefings?${k}=${encodeURIComponent(v)}">${txt}</a></p>`;
  function fichaRodovia(r, extra = "") {
    const a = rodAn[r];
    gaveta(`<h2 style="margin-top:4px">${nomeRod(r)}</h2>${extra}
      <dl class="ficha">
        <dt>Sinistros</dt><dd>${a ? `${num(a.ocorrencias)} ocorrências desde 2019 (${num(a.fatais)} com morte); ${num(a.taxa_100km_ano, 1)} por 100 km/ano` : "Sem registro"}</dd>
        ${a?.prioridade != null ? `<dt>Prioridade</dt><dd>${num(a.prioridade, 0)} (${esc(a.faixa || "")})</dd>` : ""}
        ${a?.iri_medio != null ? `<dt>IRI médio</dt><dd>${num(a.iri_medio, 2)} m/km (${esc(a.condicao || "")})</dd>` : ""}
        ${a?.trechos_criticos?.length ? `<dt>Trechos críticos</dt><dd>${a.trechos_criticos.map(t => `km ${t.km_ini}–${t.km_fim} (${num(t.ocorrencias)})`).join(", ")}</dd>` : ""}
      </dl><h3>Obras ativas da rodovia</h3>${listaObras(obrasRod[r])}
      ${linkBrief("rodovia", r, "Abrir briefing da rodovia")}`);
  }
  function fichaTrecho(p) {
    fichaRodovia(p.rodovia, `<p style="color:var(--tinta)">Trecho do km ${num(p.km)} ao ${num(p.km + 1)} (contado do início do levantamento)</p>
      <dl class="ficha"><dt>IRI</dt><dd>${p.iri == null ? "—" : `${num(p.iri, 2)} m/km`} · <b>${esc(p.classe)}</b> (DNIT IPR-720)</dd>
      <dt>Sinistros neste km</dt><dd>${num(p.sinistros)}${p.fatais ? ` (${num(p.fatais)} com morte)` : ""}</dd></dl>`);
  }
  function fichaMunicipio(cod, nome) {
    const x = M[cod] || {};
    nome = x.nome || nome;
    const nomeEo = munsEo.find(n => semAcento(n) === semAcento(nome)) || nome;
    const cs = ct.lista.filter(c => municipios(c).includes(nomeEo)).sort((a, b) => (b.v_atual || 0) - (a.v_atual || 0));
    m.setFilter("mun-sel", ["==", ["get", "cod"], cod]);
    gaveta(`<h2 style="margin-top:4px">${esc(nome)}</h2>
      <dl class="ficha">
        <dt>População</dt><dd>${num(x.pop)} (IBGE, estimativa ${esc(mun?._meta?.ano_populacao || "")})</dd>
        <dt>Contratos</dt><dd>${num(x.contratos)} · ${num(x.ativos)} ativos · ${num(x.paralisados)} paralisados</dd>
        <dt>Valor contratado</dt><dd>${brlCurto(x.v_contratado)} · ${x.r_hab == null ? "—" : `${brlCurto(x.r_hab)} por habitante`}</dd>
        <dt>Valor medido</dt><dd>${brlCurto(x.v_medido)}</dd>
        <dt>Sinistros</dt><dd>${num(x.sinistros)} ocorrências em rodovias estaduais</dd>
      </dl>
      ${cs.length ? `<h3>Contratos (${num(cs.length)})</h3><ul style="padding-left:18px">${cs.slice(0, 12).map(c => `<li><b>${esc(c.id)}</b> ${chipSit(c.sit)} ${brlCurto(c.v_atual)}<div class="peq">${esc((c.obj || "").slice(0, 140))}</div></li>`).join("")}</ul>${cs.length > 12 ? `<p class="peq">e mais ${num(cs.length - 12)} no briefing.</p>` : ""}` : ""}
      ${linkBrief("municipio", nomeEo, "Abrir briefing do município")}`);
  }

  const clicaveis = () => ["tr-linha", "rod-linha", "mun-fill"].filter(id => m.getLayoutProperty(id, "visibility") !== "none");
  m.on("click", e => {
    const f = m.queryRenderedFeatures(e.point, { layers: clicaveis() })
      .filter(f => f.layer.id !== "tr-linha" || estado.camada !== "sinistros" || f.properties.sinistros > 0)[0];
    if (!f) return;
    const p = f.properties;
    if (f.layer.id === "tr-linha") fichaTrecho(p);
    else if (f.layer.id === "rod-linha") fichaRodovia(p.RODOVIA, p["KM INICIAL"] != null ? `<p style="color:var(--tinta)">Segmento do km ${num(+p["KM INICIAL"], 2)} ao ${num(+p["KM FINAL"], 2)} (cadastro SEINFRA)</p>` : "");
    else fichaMunicipio(String(p.cod), p.nome);
  });
  m.on("mousemove", e => { m.getCanvas().style.cursor = m.queryRenderedFeatures(e.point, { layers: clicaveis() }).length ? "pointer" : ""; });

  // ── controles ──
  $$("#fCamada button", el).forEach(b => b.onclick = () => {
    estado.camada = b.dataset.v;
    $$("#fCamada button", el).forEach(x => x.setAttribute("aria-pressed", x === b));
    pintar();
  });
  $$("#fHab button", el).forEach(b => b.onclick = () => {
    estado.porHab = !!b.dataset.v;
    $$("#fHab button", el).forEach(x => x.setAttribute("aria-pressed", x === b));
    pintar();
  });
  $$("[data-x]", el).forEach(i => i.onchange = () => { estado.extras[i.dataset.x] = i.checked; ligarExtra(i.dataset.x, i.checked); pintar(); });
  EXTRAS.forEach(([v]) => estado.extras[v] && ligarExtra(v, true));
  pintar();
  m.fitBounds([[-73.8, -9.9], [-56.1, 2.3]], { padding: 20, duration: 0 });
}

export const mapaAtual = () => mapa;  // para teste no console/Playwright

// autoteste (console): quebras e classe
export function teste() {
  const q = quebras([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  console.assert(q.length === 4 && q[0] === 3 && q[3] === 9, q);
  console.assert(classe(1, q) === 0 && classe(10, q) === 4);
}

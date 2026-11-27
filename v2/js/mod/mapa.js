// Mapa do Amazonas: condição (IRI), sinistros, obras ativas e investimento por município. [Claude] 23/11/2026
// Geometria: data/mapa.pmtiles (pipelines/mapa/gerar.py --tiles, robô semanal). Sem ele, cai para GeoJSON:
// data/mapa_malha.geojson (IBGE) + rodovias/ramais/hidrovias do Atlas Amazonas (carregados só quando ligados).
// Números: data/mapa_municipios.json, data/mapa_trechos.json, data/sinistros_analise.json, data/eobras.json.
// Os números entram por expressão "match" no navegador, então o .pmtiles só muda quando muda a geometria.
// v3 (acabamento): painel de camadas e legenda flutuantes sobre o mapa, escala em rampa rotulada, ficha diagramada.
import { talvez, contratos, municipios, historico, PUBLICO, RAIZ } from "../dados.js";
import { esc, num, brlCurto, semAcento } from "../fmt.js";
import { $, $$, gaveta, fonte, chipSit, kpi } from "../ui.js";

const ML = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/";
const PMT = "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js";
const ATLAS = "https://leonzordhue.github.io/atlas-amazonas/geojson/";
// Basemap raster sem chave (Esri World Gray Canvas); CARTO exige chave.
const ESRI = t => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${t}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const APELIDO = { "AM-151": "Carlos Braga", "AM-450": "Anel Sul" };  // CLAUDE.md: nomes históricos

// DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006): condição do pavimento pelo IRI (m/km).
// Mesmos limites de pipelines/mapa/gerar.py (classe_iri). Cores = escala do levantamento em data/icm.json,
// clareada no tema escuro para manter contraste sobre o fundo escuro.
const IRI = [["Excelente", "até 1,9"], ["Bom", "1,9 a 2,7"], ["Regular", "2,7 a 3,5"], ["Ruim", "3,5 a 4,6"], ["Péssimo", "acima de 4,6"], ["Sem medição", ""]];
const IRI_LIM = ["1,9", "2,7", "3,5", "4,6"];
const COR_IRI = () => escuro() ? ["#3FB37A", "#8BCF6A", "#F5B544", "#F08C3A", "#F07A70", "#5B6777"] : ["#157347", "#4CAF50", "#F5A623", "#E8730C", "#C0392B", "#9AA5B5"];
const CAMADAS = PUBLICO ? [["iri", "Condição (IRI)"]]
  : [["iri", "Condição (IRI)"], ["sinistros", "Sinistros por km"], ["obras", "Obras ativas"], ["invest", "Investimento por município"]];
const EXTRAS = [["ramais", "Ramais", "RAMAIS_SEINFRA.geojson"], ["hidrovias", "Hidrovias", "HIDROVIAS.geojson"], ["federais", "Rodovias federais", "RODOVIAS_FEDERAIS.geojson"]];

const estado = { camada: "iri", porHab: false, extras: {}, tresD: false };
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

// CSS no <head>: a gaveta da ficha fica fora do container do módulo
const CSS = `
.mapa-caixa { position: relative; height: calc(100vh - 88px); height: calc(100dvh - 88px); min-height: 460px; border: 1px solid var(--borda); border-radius: var(--raio); overflow: hidden; background: var(--sup-2); }
.mapa-caixa .maplibregl-map { position: absolute; inset: 0; }
.mapa-caixa .maplibregl-ctrl-group { border-radius: var(--raio); box-shadow: none; border: 1px solid var(--borda-2); }
.mapa-caixa .maplibregl-ctrl-group { background: var(--sup); }
.mapa-caixa .maplibregl-ctrl-group button + button { border-top-color: var(--borda); }
:root[data-theme="dark"] .mapa-caixa .maplibregl-ctrl-icon, .mapa-caixa .maplibregl-ctrl-attrib-button { filter: invert(.88); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .mapa-caixa .maplibregl-ctrl-icon, .mapa-caixa .maplibregl-ctrl-attrib-button { filter: invert(.88); } }
#mapa .maplibregl-ctrl-attrib { background: var(--sup); opacity: .85; color: var(--tinta-3); font-size: 12px; }
#mapa .maplibregl-ctrl-attrib a { color: inherit; }
#mapa .maplibregl-ctrl-scale { font-size: 12px; background: var(--sup); color: var(--tinta-2); border-color: var(--tinta-3); opacity: .9; }
.mp-flut { position: absolute; z-index: 2; background: var(--sup); color: var(--tinta-2); border: 1px solid var(--borda-2); border-radius: var(--raio); box-shadow: 0 2px 10px rgba(0,23,61,.10); }
.mp-painel { left: 10px; top: 10px; width: 236px; max-height: calc(100% - 20px); overflow: auto; }
.mp-painel summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 9px 12px; font: 600 13px var(--f-titulo); color: var(--tinta); }
.mp-painel summary::-webkit-details-marker { display: none; }
.mp-painel summary::after { content: ""; margin-left: auto; width: 7px; height: 7px; border: solid var(--tinta-3); border-width: 0 1.5px 1.5px 0; transform: translateY(-2px) rotate(45deg); flex: none; }
.mp-painel[open] summary::after { transform: translateY(2px) rotate(-135deg); }
.mp-painel summary small { font: 400 12px var(--f-corpo); color: var(--tinta-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-painel[open] summary small { display: none; }
.mp-corpo { padding: 2px 8px 10px; border-top: 1px solid var(--borda); }
.mp-rot { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tinta-3); margin: 10px 4px 4px; }
.mp-opcoes { display: grid; gap: 1px; }
.mp-opcoes button { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; border: 0; background: none; padding: 7px 8px; border-radius: 4px; font-size: 13.5px; color: var(--tinta-2); cursor: pointer; }
.mp-opcoes button::before { content: ""; box-sizing: border-box; width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--borda-2); flex: none; }
.mp-opcoes button:hover { background: var(--sup-2); color: var(--tinta); }
.mp-opcoes button[aria-pressed="true"] { background: var(--azul-3); color: var(--azul); font-weight: 600; }
.mp-opcoes button[aria-pressed="true"]::before { border: 4px solid var(--azul); }
.mp-painel .seg { display: flex; margin: 6px 4px 2px; }
.mp-painel .seg button { flex: 1; padding: 6px 8px; font-size: 12.5px; }
.mp-extra { display: flex; gap: 9px; align-items: center; padding: 6px 8px; font-size: 13.5px; cursor: pointer; border-radius: 4px; }
.mp-extra:hover { background: var(--sup-2); }
.mp-extra input { accent-color: var(--azul); margin: 0; width: 14px; height: 14px; }
.mp-leg { left: 10px; bottom: 10px; width: 284px; max-width: calc(100% - 20px); padding: 10px 14px 10px; font-size: 12px; }
.mp-leg b { display: block; color: var(--tinta); font: 600 12.5px var(--f-titulo); margin-bottom: 8px; }
.mp-leg b small { display: block; font: 400 12px var(--f-corpo); color: var(--tinta-3); margin-top: 1px; }
.mp-cores { display: flex; gap: 1px; height: 10px; border-radius: 2px; overflow: hidden; }
.mp-cores i { flex: 1; }
.mp-lims { position: relative; height: 16px; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--tinta-2); font-size: 12px; }
.mp-lims span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.mp-lims span::before { content: ""; position: absolute; left: 50%; top: -4px; height: 3px; border-left: 1px solid var(--tinta-3); }
.mp-nomes { display: flex; font-size: 12px; color: var(--tinta-3); margin-top: 1px; }
.mp-nomes span { flex: 1; min-width: 0; text-align: center; white-space: nowrap; }
.mp-sw { display: flex; align-items: center; gap: 7px; margin: 4px 0 0; color: var(--tinta-2); }
.mp-sw i { flex: none; width: 16px; height: 9px; border-radius: 2px; }
.mp-sw i.lin { height: 3px; }
.mp-sep { height: 1px; background: var(--borda); margin: 8px 0 6px; }
.mp-leg p { margin: 7px 0 0; color: var(--tinta-3); font-size: 12px; line-height: 1.4; }
@media (max-width: 700px) {
  .mapa-caixa { height: calc(100vh - 72px); height: calc(100dvh - 72px); min-height: 420px; }
  .mp-painel { width: min(236px, calc(100% - 64px)); }
  .mp-leg { width: auto; right: 10px; bottom: 34px; }
  .mapa-caixa .maplibregl-ctrl-scale { display: none; }
  .mp-leg p { display: none; }
}
.mp-ficha .mp-sobre { display: block; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ouro-2); margin: 6px 0 4px; }
.mp-ficha h2 { font-size: 1.4rem; }
.mp-ficha h2 small { font: 400 .68em var(--f-corpo); color: var(--tinta-3); margin-left: 6px; }
.mp-ficha .mp-intro { margin: 6px 0 0; color: var(--tinta-2); font-size: 14px; }
.mp-ficha .g-kpi { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin: 16px 0 4px; }
.mp-ficha .kpi { padding: 12px 14px 14px; }
.mp-ficha .kpi .val { font-size: 1.35rem; }
.mp-ficha h3 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 22px 0 2px; padding-bottom: 6px; border-bottom: 2px solid var(--azul); font-size: .8rem; letter-spacing: .05em; text-transform: uppercase; }
.mp-ficha h3 span { font: 400 12.5px var(--f-corpo); color: var(--tinta-3); text-transform: none; letter-spacing: 0; }
.mp-ficha dl.ficha { margin: 10px 0 0; }
.mp-lista { list-style: none; margin: 0; padding: 0; }
.mp-lista li { padding: 10px 0; border-bottom: 1px solid var(--borda); }
.mp-lista .l1 { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.mp-lista .l1 b { color: var(--tinta); font-weight: 600; }
.mp-lista .l1 .v { margin-left: auto; font: 600 13.5px var(--f-titulo); color: var(--tinta); white-space: nowrap; }
.mp-lista p { margin: 3px 0 0; font-size: 13px; color: var(--tinta-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mp-ficha .mp-vazio { color: var(--tinta-3); font-size: 14px; margin: 10px 0; }
.mp-ficha .mp-acao { margin-top: 20px; }
.mp-classe { display: inline-flex; align-items: center; gap: 6px; }
.mp-classe i { width: 11px; height: 11px; border-radius: 2px; flex: none; }
`;

export async function render(el, params) {
  mapa?.remove(); mapa = null;
  if (!document.getElementById("mapa-css")) document.head.append(Object.assign(document.createElement("style"), { id: "mapa-css", textContent: CSS }));
  el.innerHTML = `<div class="carregando">Carregando o mapa…</div>`;
  // versão pública não baixa sinistros nem contratos; usa o levantamento (icm) e o cadastro das rodovias
  const [_, mun, tr, an, ct, temTiles, hist, icm, info] = await Promise.all([
    carregarLibs(), talvez("mapa_municipios"), talvez("mapa_trechos"), PUBLICO ? null : talvez("sinistros_analise"), PUBLICO ? { lista: [] } : contratos(),
    fetch(`${RAIZ}data/mapa.pmtiles`, { method: "HEAD" }).then(r => r.ok).catch(() => false), PUBLICO ? null : historico().catch(() => null),
    PUBLICO ? talvez("icm") : null, PUBLICO ? talvez("rodovias_info") : null]);
  if (PUBLICO) estado.camada = "iri";
  if (params?.get("camada") && CAMADAS.some(c => c[0] === params.get("camada"))) estado.camada = params.get("camada");

  const M = mun?.municipios || {};
  const obrasRod = PUBLICO ? {} : tr?._meta?.obras_por_rodovia || {};
  const ctPor = new Map(ct.lista.map(c => [c.id, c]));
  const munsEo = [...new Set(ct.lista.flatMap(municipios))];
  const rodAn = an?.rodovias || {};
  const largo = matchMedia("(min-width: 701px)").matches;

  el.innerHTML = `
    <div class="cab"><div><h1>Mapa do Amazonas</h1>
      <p>${PUBLICO ? "Rodovias estaduais do Amazonas e a condição do pavimento medida em campo. Clique numa rodovia, num trecho ou num município para ver os dados." : "Condição das rodovias estaduais, sinistros, obras ativas e investimento da SEINFRA por município. Clique num trecho, rodovia ou município para ver a ficha."}</p></div>
      <div class="fontes">${fonte("municípios", mun?._meta?.gerado_em?.slice(0, 10) || "—")}${fonte("trechos", tr?._meta?.gerado_em?.slice(0, 10) || "—")}${fonte("geometria", temTiles ? "PMTiles" : "GeoJSON")}</div></div>
    ${mun && tr ? "" : `<div class="aviso" style="margin-bottom:16px">${PUBLICO ? "<b>Parte dos dados do mapa está indisponível no momento.</b> Por enquanto aparecem só os traçados." : `<b>Dados do mapa ainda não gerados.</b> Rode o robô "Mapa (semanal)" (pipelines/mapa/gerar.py); por enquanto aparecem só as geometrias.`}</div>`}
    <div class="mapa-caixa"><div id="mapa"></div>
      <details class="mp-flut mp-painel" id="painel"${largo ? " open" : ""}>
        <summary>Camadas <small id="painelAtual"></small></summary>
        <div class="mp-corpo">
          <div class="mp-rot" id="rotTema"${CAMADAS.length < 2 ? " hidden" : ""}>Tema do mapa</div>
          <div class="mp-opcoes" id="fCamada" role="group" aria-labelledby="rotTema"${CAMADAS.length < 2 ? " hidden" : ""}>${CAMADAS.map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${estado.camada === v}">${r}</button>`).join("")}</div>
          <div class="seg" id="fHab" role="group" aria-label="Medida do investimento"><button type="button" data-v="" aria-pressed="${!estado.porHab}">Valor total</button><button type="button" data-v="1" aria-pressed="${estado.porHab}">Por habitante</button></div>
          <div class="mp-rot">Sobrepor</div>
          ${EXTRAS.map(([v, r]) => `<label class="mp-extra"><input type="checkbox" data-x="${v}" ${estado.extras[v] ? "checked" : ""}> ${r}</label>`).join("")}
          ${matchMedia("(hover: hover)").matches ? `<div class="mp-rot">Visualização</div>
          <label class="mp-extra" title="Inclina o mapa; o município sob o mouse sobe em relevo"><input type="checkbox" id="f3d" ${estado.tresD ? "checked" : ""}> Visão em 3D (relevo)</label>` : ""}
        </div>
      </details>
      <div class="mp-flut mp-leg" id="leg" aria-live="polite"></div>
    </div>
    <details class="secao cartao"><summary style="padding:14px 18px;cursor:pointer;font-weight:600;color:var(--tinta)">Métodos e fontes</summary>
      <div class="corpo"><dl class="ficha">
        <dt>Condição</dt><dd>IRI médio de cada trecho de 1 km do levantamento RoadLab Pro (data/icm.json), classificado pelo DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006): excelente até 1,9; bom até 2,7; regular até 3,5; ruim até 4,6; péssimo acima de 4,6 m/km. Condição preliminar, não é o ICM oficial do DNIT. ${PUBLICO ? "" : esc(tr?._meta?.metodologia || "")}</dd>
        ${PUBLICO ? `<dt>Municípios</dt><dd>Limites municipais e população estimada pelo IBGE (${esc(mun?._meta?.ano_populacao || "")}). A extensão de cada rodovia por município é medida sobre o traçado da SEINFRA.</dd>` : `<dt>Sinistros</dt><dd>Rodovia pintada pelas ocorrências por 100 km por ano (análise do módulo Sinistros); trechos destacados quando a notícia informa o km. A base são notícias, não boletins de ocorrência.</dd>
        <dt>Obras ativas</dt><dd>Contratos em andamento, vigentes, a iniciar ou em recebimento no e-Obras. Rodovia citada só como localização não conta como obra da rodovia.</dd>
        <dt>Municípios</dt><dd>${esc(mun?._meta?.metodologia || "")} Fonte: ${esc(mun?._meta?.fonte || "")}.</dd>`}
        <dt>Geometria</dt><dd>IBGE (malha municipal); Atlas Amazonas (rodovias estaduais SEINFRA, ramais, rodovias federais SNV/DNIT, hidrovias). Fundo: Esri World Gray Canvas.</dd>
      </dl></div></details>`;

  // ── fontes de geometria: PMTiles quando existe, senão GeoJSON ──
  const vt = temTiles ? { type: "vector", url: `pmtiles://${RAIZ}data/mapa.pmtiles` } : null;
  const GJ = { municipios: `${RAIZ}data/mapa_malha.geojson`, rodovias: ATLAS + "RODOVIAS_ESTADUAIS_AMAZONAS.geojson",
    ...Object.fromEntries(EXTRAS.map(([v, , a]) => [v, ATLAS + a])) };
  const fonteDe = nome => vt ? { source: "vt", "source-layer": nome } : { source: nome };
  const garantirFonte = nome => { if (!vt && !mapa.getSource(nome)) mapa.addSource(nome, { type: "geojson", data: GJ[nome] }); };

  const tema = escuro() ? "Dark" : "Light";
  mapa = new maplibregl.Map({
    container: $("#mapa", el), center: [-62.2159, -3.4653], zoom: 5, minZoom: 3, maxZoom: 14, attributionControl: { compact: true },
    style: { version: 8, sources: { base: { type: "raster", tiles: [ESRI(tema)], tileSize: 256, maxzoom: 16,
      attribution: "Fundo: Esri, HERE, Garmin, © colaboradores do OpenStreetMap · IBGE · Atlas Amazonas" } },
      // fundo discreto: sem saturação e com contraste reduzido, para os dados ficarem na frente
      layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -1, "raster-contrast": escuro() ? -0.25 : -0.15, "raster-opacity": escuro() ? 0.8 : 0.9 } }] },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  mapa.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
  const m = mapa;
  await new Promise(ok => m.on("load", ok));
  if (m !== mapa) return;  // trocou de tela durante a carga
  if (vt) m.addSource("vt", vt);
  m.addSource("trechos", { type: "geojson", data: tr || { type: "FeatureCollection", features: [] } });

  // ── expressões de dados (match por código) ──
  const corLinha = escuro() ? "#C5CCD6" : "#3B4657";
  const corApagada = escuro() ? "#5B6777" : "#9AA5B5";
  const matchMun = (f, padrao) => Object.keys(M).length ? ["match", ["get", "cod"], ...Object.entries(M).flatMap(([c, x]) => [c, f(x)]), padrao] : padrao;
  const matchRod = (f, padrao) => {
    const cods = [...new Set([...Object.keys(rodAn), ...Object.keys(obrasRod)])];
    return cods.length ? ["match", ["get", "RODOVIA"], ...cods.flatMap(c => [c, f(c)]), padrao] : padrao;
  };

  garantirFonte("municipios"); garantirFonte("rodovias");
  m.addLayer({ id: "mun-fill", type: "fill", ...fonteDe("municipios"), paint: { "fill-color": "#000", "fill-opacity": 0 } });
  m.addLayer({ id: "mun-linha", type: "line", ...fonteDe("municipios"), paint: { "line-color": corLinha, "line-opacity": 0.35, "line-width": 0.6 } });
  // extras (ligados sob demanda: os GeoJSON de ramais e federais têm 7 a 8 MB)
  const EXTRA_PAINT = { ramais: ["#8A5A00", 1, [2, 2]], hidrovias: ["#2E86C1", 1.6, null], federais: ["#5B6777", 1.4, null] };
  if (escuro()) { EXTRA_PAINT.ramais[0] = "#C99A4A"; EXTRA_PAINT.hidrovias[0] = "#5FA8DC"; EXTRA_PAINT.federais[0] = "#98A2B1"; }
  const ligarExtra = (v, on) => {
    const id = "x-" + v;
    if (!m.getLayer(id)) {
      if (!on) return;
      garantirFonte(v);
      const [cor, w, tr2] = EXTRA_PAINT[v];
      m.addLayer({ id, type: "line", ...fonteDe(v), paint: { "line-color": cor, "line-width": w, ...(tr2 ? { "line-dasharray": tr2 } : {}) } }, "rod-linha");
    } else m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  m.addLayer({ id: "rod-linha", type: "line", ...fonteDe("rodovias"), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": corLinha, "line-width": 2 } });
  m.addLayer({ id: "tr-linha", type: "line", source: "trechos", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 4 } });
  m.addLayer({ id: "mun-sel", type: "line", ...fonteDe("municipios"), filter: ["==", ["get", "cod"], ""], paint: { "line-color": escuro() ? "#F5B544" : "#002D72", "line-width": 2.5 } });

  // ── alto relevo do município sob o mouse ──
  // 2D (padrão): sombra deslocada + o município "levantado" alguns pixels, sem inclinar o mapa (leve, sem 3D).
  // 3D (opcional, só com mouse): mapa inclinado e extrusão de polígono do MapLibre (fill-extrusion), sem biblioteca extra.
  const reduz = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const comMouse = matchMedia("(hover: hover)").matches;
  const fCod = cod => ["==", ["get", "cod"], cod || ""];
  const realce = escuro() ? "#F5B544" : "#002D72";
  m.addLayer({ id: "mun-sombra", type: "fill", ...fonteDe("municipios"), filter: fCod(""),
    paint: { "fill-color": "#00173D", "fill-opacity": escuro() ? 0.6 : 0.3, "fill-translate": [6, 8], "fill-translate-anchor": "viewport" } }, "rod-linha");
  m.addLayer({ id: "mun-hover", type: "fill", ...fonteDe("municipios"), filter: fCod(""),
    paint: { "fill-color": escuro() ? "#1E2A3D" : "#E8EEF8", "fill-opacity": 1, "fill-translate": [-3, -5], "fill-translate-anchor": "viewport" } }, "rod-linha");
  m.addLayer({ id: "mun-hover-borda", type: "line", ...fonteDe("municipios"), filter: fCod(""),
    paint: { "line-color": realce, "line-width": 2, "line-translate": [-3, -5], "line-translate-anchor": "viewport" } }, "rod-linha");
  m.addLayer({ id: "mun-3d", type: "fill-extrusion", ...fonteDe("municipios"), filter: fCod(""), layout: { visibility: "none" },
    paint: { "fill-extrusion-color": "#1A4A96", "fill-extrusion-opacity": 0.95, "fill-extrusion-height": 0,
      "fill-extrusion-height-transition": { duration: reduz ? 0 : 320, delay: 0 }, "fill-extrusion-vertical-gradient": true } });
  let hov = null;
  const ALTURA = 55000;   // metros: em zoom 5 a 7, com o mapa inclinado, dá um degrau bem visível
  function setHover(cod) {
    if (cod === hov) return;
    hov = cod;
    for (const id of ["mun-sombra", "mun-hover", "mun-hover-borda", "mun-3d"]) m.setFilter(id, fCod(cod));
    if (estado.tresD && cod) {
      m.setPaintProperty("mun-3d", "fill-extrusion-height", 0);
      requestAnimationFrame(() => hov === cod && m.setPaintProperty("mun-3d", "fill-extrusion-height", ALTURA));
    }
  }
  if (comMouse) {
    m.on("mousemove", "mun-fill", e => setHover(String(e.features[0]?.properties?.cod ?? "")));
    m.on("mouseleave", "mun-fill", () => setHover(null));
  }
  function modo3D(on) {
    estado.tresD = on;
    m.setLayoutProperty("mun-3d", "visibility", on ? "visible" : "none");
    for (const id of ["mun-sombra", "mun-hover", "mun-hover-borda"]) m.setLayoutProperty(id, "visibility", on ? "none" : "visible");
    m.easeTo({ pitch: on ? 50 : 0, bearing: on ? -12 : 0, duration: reduz ? 0 : 700 });
    const c = hov; hov = null; setHover(c);
  }

  // ── legenda: rampa contínua (cores em sequência, limites nas divisas, nomes das classes embaixo) ──
  const leg = $("#leg", el);
  const sw = (cor, txt, lin = false) => `<div class="mp-sw"><i class="${lin ? "lin" : ""}" style="background:${cor}"></i>${esc(txt)}</div>`;
  const rampa = (cores, lims = [], nomes = []) => `<div class="mp-cores">${cores.map(c => `<i style="background:${c}"></i>`).join("")}</div>
    ${lims.length ? `<div class="mp-lims">${lims.map((l, i) => `<span style="left:${(i + 1) / cores.length * 100}%">${esc(l)}</span>`).join("")}</div>` : ""}
    ${nomes.length ? `<div class="mp-nomes">${nomes.map(n => `<span>${esc(n)}</span>`).join("")}</div>` : ""}`;
  const sem$ = v => brlCurto(v).replace(/^R\$\s?/, "");  // "12,3 mi": a unidade R$ vai no título
  function pintar() {
    const c = estado.camada;
    $("#fHab", el).style.display = c === "invest" ? "" : "none";
    $("#painelAtual", el).textContent = CAMADAS.find(x => x[0] === c)[1];
    let fill = "#000", fillOp = 0, rodCor = corLinha, rodW = 2, trVis = "none", trPaint = {}, html = "";
    if (c === "iri") {
      const k = COR_IRI();
      trVis = "visible";
      trPaint = { "line-color": ["match", ["get", "classe"], ...IRI.slice(0, 5).flatMap(([n], i) => [n, k[i]]), k[5]], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 6] };
      rodCor = corApagada; rodW = 1.5;
      html = `<b>Condição do pavimento<small>IRI em m/km · classes DNIT IPR-720/2006</small></b>${rampa(k.slice(0, 5), IRI_LIM, IRI.slice(0, 5).map(x => x[0]))}
        <div class="mp-sep"></div>${sw(k[5], "Trecho sem medição", true)}${sw(rodCor, "Rodovia sem levantamento", true)}<p>Levantamento RoadLab Pro, preliminar (não é o ICM oficial).</p>`;
    } else if (c === "sinistros") {
      const faixas = [[1, "menos de 1"], [3, "1 a 3"], [6, "3 a 6"], [Infinity, "6 ou mais"]];
      const cor = t => t == null ? corApagada : SEQ_RISCO[faixas.findIndex(([lim]) => t < lim)];
      rodCor = matchRod(r => cor(rodAn[r]?.taxa_100km_ano), corApagada); rodW = 3;
      trVis = "visible";
      const corKm = escuro() ? "#F07A70" : "#8E1B12";
      trPaint = { "line-color": corKm, "line-width": ["interpolate", ["linear"], ["get", "sinistros"], 1, 5, 5, 11],
        "line-opacity": ["case", [">", ["get", "sinistros"], 0], 1, 0] };
      const rs = Object.values(rodAn), pctKm = rs.length ? Math.round(rs.reduce((s, r) => s + (r.km_informado_pct || 0) * r.ocorrencias, 0) / Math.max(1, rs.reduce((s, r) => s + r.ocorrencias, 0))) : null;
      html = `<b>Sinistros na rodovia<small>ocorrências por 100 km por ano</small></b>${rampa(SEQ_RISCO, ["1", "3", "6"])}
        <div class="mp-sep"></div>${sw(corKm, "Km com ocorrência (mais grosso, mais casos)", true)}${sw(corApagada, "Sem registro", true)}<p>Base: notícias desde 2019; ${num(pctKm)}% informam o km.</p>`;
    } else if (c === "obras") {
      const seq = SEQ_AZUL(), lims = [1, 2, 4, 10];
      const corAt = n => n ? seq[Math.min(4, lims.filter(l => n >= l).length)] : "rgba(0,0,0,0)";
      fill = matchMun(x => corAt(x.ativos), "rgba(0,0,0,0)"); fillOp = 0.75;
      rodCor = matchRod(r => obrasRod[r]?.length ? "#F5A623" : corLinha, corLinha);
      rodW = ["case", ["in", ["get", "RODOVIA"], ["literal", Object.keys(obrasRod)]], 4.5, 1.6];
      html = `<b>Obras ativas<small>contratos ativos no município (e-Obras)</small></b>${rampa(seq.slice(1), [], ["1", "2 a 3", "4 a 9", "10 ou mais"])}
        <div class="mp-sep"></div>${sw("#F5A623", "Rodovia com obra ativa", true)}${sw(corLinha, "Rodovia sem obra ativa", true)}`;
    } else {
      const k = estado.porHab ? "r_hab" : "v_contratado", seq = SEQ_AZUL(), SEM = escuro() ? "#3A3A3A" : "#D6D3CC";  // cinza neutro, fora da escala azul
      const qs = quebras(Object.values(M).map(x => x[k] || 0));
      fill = matchMun(x => x[k] > 0 ? seq[classe(x[k], qs)] : SEM, "rgba(0,0,0,0)"); fillOp = 0.85;
      rodW = 1.2;
      html = `<b>${estado.porHab ? "Valor contratado por habitante" : "Valor contratado (valor atual)"}<small>R$ · quintis entre municípios com contrato</small></b>${rampa(seq, qs.map(sem$))}
        <div class="mp-sep"></div>${sw(SEM, "Sem contrato")}<p>Contrato de vários municípios tem o valor rateado.${estado.porHab ? ` População: IBGE, estimativa ${esc(mun?._meta?.ano_populacao || "")}.` : ""}</p>`;
    }
    m.setPaintProperty("mun-fill", "fill-color", fill); m.setPaintProperty("mun-fill", "fill-opacity", fillOp);
    // relevo: o município levantado mantém a cor do tema quando a camada pinta municípios; senão, azul claro
    const corRelevo = fillOp > 0 ? fill : (escuro() ? "#1E2A3D" : "#E8EEF8");
    m.setPaintProperty("mun-hover", "fill-color", corRelevo);
    m.setPaintProperty("mun-3d", "fill-extrusion-color", fillOp > 0 ? fill : "#1A4A96");
    m.setPaintProperty("rod-linha", "line-color", rodCor); m.setPaintProperty("rod-linha", "line-width", rodW);
    m.setLayoutProperty("tr-linha", "visibility", trVis);
    for (const [p, v] of Object.entries(trPaint)) m.setPaintProperty("tr-linha", p, v);
    if (c !== "sinistros") m.setPaintProperty("tr-linha", "line-opacity", 1);
    const extras = EXTRAS.filter(([v]) => estado.extras[v]).map(([v, r]) => sw(EXTRA_PAINT[v][0], r, true)).join("");
    leg.innerHTML = html + (extras ? `<div class="mp-sep"></div>${extras}` : "");
  }

  // ── fichas (gaveta) ──
  const nomeRod = r => `${esc(r)}${APELIDO[r] ? ` <small>${esc(APELIDO[r])}</small>` : ""}`;
  const itemCt = (c, valor = false) => `<li><div class="l1"><b>${esc(c.id)}</b>${chipSit(c.sit)}${valor ? `<span class="v">${brlCurto(c.v_atual)}</span>` : ""}</div><p title="${esc(c.obj || "")}">${esc(c.obj || "")}</p></li>`;
  const listaObras = ids => { const cs = (ids || []).map(id => ctPor.get(id)).filter(Boolean);
    return cs.length ? `<ul class="mp-lista">${cs.map(c => itemCt(c)).join("")}</ul>` : `<p class="mp-vazio">Nenhuma obra ativa da rodovia no e-Obras.</p>`; };
  const linkBrief = (k, v, txt) => `<p class="mp-acao"><a class="btn pri" href="#/briefings?${k}=${encodeURIComponent(v)}">${txt}</a></p>`;
  const classeIri = cl => { const i = IRI.findIndex(x => x[0] === cl); return `<span class="mp-classe"><i style="background:${COR_IRI()[i < 0 ? 5 : i]}"></i>${esc(cl || "Sem medição")}</span>`; };
  const rodIcm = new Map((icm?.rodovias || []).map(x => [x.codigo, x]));
  const rodPorMun = new Map();  // município -> [{ cod, km }] (cadastro das rodovias)
  Object.entries(info?.rodovias || {}).forEach(([cod, x]) => (x.municipios || []).forEach(({ nome, km }) =>
    (rodPorMun.get(semAcento(nome)) || rodPorMun.set(semAcento(nome), []).get(semAcento(nome))).push({ cod, km })));
  function fichaRodoviaPub(r, sobre, extra) {
    const x = info?.rodovias?.[r], c = rodIcm.get(r);
    const ext = (x?.municipios || []).reduce((t, m) => t + m.km, 0);
    gaveta(`<div class="mp-ficha"><span class="mp-sobre">${esc(sobre)}</span><h2>${nomeRod(r)}</h2>${x?.nome_alt ? `<p class="mp-intro">${esc(x.nome_alt)}</p>` : ""}${extra}
      <div class="grade g-kpi">
        ${kpi("Extensão no cadastro", ext ? `${num(ext, 1)} km` : "—", "traçado da SEINFRA")}
        ${kpi("IRI médio", c?.iri_medio != null ? num(c.iri_medio, 2) : "—", c?.iri_medio != null ? `m/km · ${esc(c.nivel_geral || "")}` : "sem levantamento")}
        ${kpi("Pavimento", esc(c?.pavimento || "—"), c ? `${num(c.extensao_levantada_km, 0)} km levantados` : "")}
      </div>
      ${x?.municipios?.length ? `<h3>Municípios atravessados <span>${num(x.municipios.length)}</span></h3>
        <ul class="mp-lista">${x.municipios.map(m => `<li><div class="l1"><b>${esc(m.nome)}</b><span class="v">${num(m.km, 1)} km</span></div></li>`).join("")}</ul>` : ""}</div>`);
  }
  function fichaRodovia(r, sobre = "Rodovia estadual", extra = "") {
    if (PUBLICO) return fichaRodoviaPub(r, sobre, extra);
    const a = rodAn[r];
    gaveta(`<div class="mp-ficha"><span class="mp-sobre">${esc(sobre)}</span><h2>${nomeRod(r)}</h2>${extra}
      <div class="grade g-kpi">
        ${kpi("Sinistros desde 2019", a ? num(a.ocorrencias) : "0", a ? `${num(a.taxa_100km_ano, 1)} por 100 km/ano` : "sem registro")}
        ${kpi("Com morte", a ? num(a.fatais) : "0", "ocorrências fatais", !!a?.fatais)}
        ${kpi("IRI médio", a?.iri_medio != null ? num(a.iri_medio, 2) : "—", a?.iri_medio != null ? `m/km · ${esc(a.condicao || "")}` : "sem levantamento")}
      </div>
      ${a?.prioridade != null || a?.trechos_criticos?.length ? `<dl class="ficha">
        ${a?.prioridade != null ? `<dt>Prioridade</dt><dd>${num(a.prioridade, 0)} (${esc(a.faixa || "")})</dd>` : ""}
        ${a?.trechos_criticos?.length ? `<dt>Trechos críticos</dt><dd>${a.trechos_criticos.map(t => `km ${t.km_ini}–${t.km_fim} (${num(t.ocorrencias)})`).join(", ")}</dd>` : ""}
      </dl>` : ""}
      <h3>Obras ativas da rodovia <span>${num(obrasRod[r]?.length || 0)}</span></h3>${listaObras(obrasRod[r])}
      ${linkBrief("rodovia", r, "Abrir briefing da rodovia")}</div>`);
  }
  function fichaTrecho(p) {
    fichaRodovia(p.rodovia, `Trecho de 1 km · km ${num(p.km)} ao ${num(p.km + 1)}`,
      `<dl class="ficha"><dt>IRI do trecho</dt><dd>${p.iri == null ? "—" : `${num(p.iri, 2)} m/km`} · ${classeIri(p.classe)} <span class="peq" style="color:var(--tinta-3)">(DNIT IPR-720)</span></dd>
      ${PUBLICO ? "" : `<dt>Sinistros neste km</dt><dd>${num(p.sinistros)}${p.fatais ? ` (${num(p.fatais)} com morte)` : ""}</dd>`}</dl>
      <p class="mp-intro" style="font-size:12.5px;color:var(--tinta-3)">km contado do início do levantamento.</p>`);
  }
  function fichaMunicipio(cod, nome) {
    const x = M[cod] || {};
    nome = x.nome || nome;
    if (PUBLICO) {
      const rs = (rodPorMun.get(semAcento(nome)) || []).sort((a, b) => b.km - a.km);
      m.setFilter("mun-sel", ["==", ["get", "cod"], cod]);
      return gaveta(`<div class="mp-ficha"><span class="mp-sobre">Município</span><h2>${esc(nome)}</h2>
        <p class="mp-intro">${x.pop ? `${num(x.pop)} habitantes (IBGE, estimativa ${esc(mun?._meta?.ano_populacao || "")})` : ""}</p>
        ${rs.length ? `<h3>Rodovias estaduais no município <span>${num(rs.reduce((t, r) => t + r.km, 0), 1)} km</span></h3>
          <ul class="mp-lista">${rs.map(r => `<li><div class="l1"><b>${nomeRod(r.cod)}</b><span class="v">${num(r.km, 1)} km</span></div></li>`).join("")}</ul>`
          : `<p class="mp-vazio">Nenhuma rodovia estadual cadastrada no território do município.</p>`}</div>`);
    }
    const nomeEo = munsEo.find(n => semAcento(n) === semAcento(nome)) || nome;
    const cs = ct.lista.filter(c => municipios(c).includes(nomeEo)).sort((a, b) => (b.v_atual || 0) - (a.v_atual || 0));
    const hs = (hist?.lista || []).filter(c => municipios(c).some(m => semAcento(m) === semAcento(nome))).sort((a, b) => String(b.ass || b.ano).localeCompare(String(a.ass || a.ano)));
    const hAnos = hs.map(c => c.ano).filter(Boolean).sort();
    m.setFilter("mun-sel", ["==", ["get", "cod"], cod]);
    gaveta(`<div class="mp-ficha"><span class="mp-sobre">Município</span><h2>${esc(nome)}</h2>
      <p class="mp-intro">${num(x.pop)} habitantes (IBGE, estimativa ${esc(mun?._meta?.ano_populacao || "")}) · ${num(x.sinistros)} sinistros em rodovias estaduais</p>
      <div class="grade g-kpi">
        ${kpi("Contratos", num(x.contratos), `${num(x.ativos)} ativos · ${num(x.paralisados)} paralisados`, x.paralisados > 0)}
        ${kpi("Valor contratado", brlCurto(x.v_contratado), x.r_hab == null ? "—" : `${brlCurto(x.r_hab)} por habitante`)}
        ${kpi("Valor medido", brlCurto(x.v_medido), x.v_contratado ? `${num(x.v_medido / x.v_contratado * 100)}% do contratado` : "")}
      </div>
      ${cs.length ? `<h3>Contratos no e-Obras <span>${num(cs.length)}, por valor</span></h3><ul class="mp-lista">${cs.slice(0, 12).map(c => itemCt(c, true)).join("")}</ul>${cs.length > 12 ? `<p class="mp-vazio">e mais ${num(cs.length - 12)} no briefing.</p>` : ""}` : `<p class="mp-vazio">Nenhum contrato do município no e-Obras.</p>`}
      ${hs.length ? `<h3>Histórico anterior ao e-Obras <span>${num(hs.length)} contratos${hAnos.length ? `, ${hAnos[0]} a ${hAnos[hAnos.length - 1]}` : ""} · ${brlCurto(hs.reduce((t, c) => t + (c.v_atual || 0), 0))}</span></h3>
        <ul class="mp-lista">${hs.slice(0, 8).map(c => `<li><div class="l1"><b>${esc(c.id)}</b><span class="peq">${esc(c.ano || "")}</span>${c.v_atual ? `<span class="v">${brlCurto(c.v_atual)}</span>` : ""}</div><p title="${esc(c.obj)}">${esc(c.obj)}</p></li>`).join("")}</ul>
        ${hs.length > 8 ? `<p class="mp-vazio">e mais ${num(hs.length - 8)} no briefing (Planilha Geral, contratos removidos).</p>` : ""}` : ""}
      ${linkBrief("municipio", nomeEo, "Abrir briefing do município")}</div>`);
  }

  const clicaveis = () => ["tr-linha", "rod-linha", "mun-fill"].filter(id => m.getLayoutProperty(id, "visibility") !== "none");
  m.on("click", e => {
    const f = m.queryRenderedFeatures(e.point, { layers: clicaveis() })
      .filter(f => f.layer.id !== "tr-linha" || estado.camada !== "sinistros" || f.properties.sinistros > 0)[0];
    if (!f) return;
    const p = f.properties;
    if (f.layer.id === "tr-linha") fichaTrecho(p);
    else if (f.layer.id === "rod-linha") fichaRodovia(p.RODOVIA, p["KM INICIAL"] != null ? `Segmento do km ${num(+p["KM INICIAL"], 2)} ao ${num(+p["KM FINAL"], 2)} (cadastro SEINFRA)` : "Rodovia estadual");
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
  const c3d = $("#f3d", el);
  if (c3d) { c3d.onchange = () => modo3D(c3d.checked); if (estado.tresD) modo3D(true); }
  pintar();
  m.fitBounds([[-73.8, -9.9], [-56.1, 2.3]], { padding: largo ? { top: 20, bottom: 20, left: 250, right: 20 } : { top: 60, bottom: 190, left: 10, right: 10 }, duration: 0 });
}

export const mapaAtual = () => mapa;  // para teste no console/Playwright

// autoteste (console): quebras e classe
export function teste() {
  const q = quebras([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  console.assert(q.length === 4 && q[0] === 3 && q[3] === 9, q);
  console.assert(classe(1, q) === 0 && classe(10, q) === 4);
}

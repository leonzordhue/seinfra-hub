// Buracos por foto: detecção de panelas no próprio navegador (YOLOv8n em ONNX) + GPS da foto. [Claude] 23/11/2026
// Modelo: keremberke/yolov8n-pothole-segmentation (Hugging Face, treinado com Ultralytics 8.0.21 no conjunto
//   keremberke/pothole-segmentation, mAP50 0,995 na validação do autor), exportado em ONNX por
//   seanjudelyons/yolov8n-pothole-segmentation-onnx. Arquivo: v2/modelos/buracos-yolov8n-seg.onnx (12,6 MB).
//   Licença: o repositório não declara licença; pesos treinados com Ultralytics seguem, em regra, a AGPL-3.0.
//   Uso aqui: modelo sem alteração, servido junto com o código-fonte aberto deste site (repositório público),
//   o que atende a exigência de código aberto da AGPL. Uso comercial fechado exigiria licença Ultralytics.
// Saída usada: output0 [1, 37, 8400] = caixa (cx, cy, w, h), confiança da classe "pothole" e 32 coeficientes de
//   máscara (ignorados: só a caixa interessa). Pré-processamento letterbox 640×640, cinza 114, RGB/255 (padrão Ultralytics).
// Severidade: área da caixa em relação à foto (heurística de triagem). A norma (DNIT 005/2003-TER define "panela";
//   ASTM D6433 gradua pela profundidade e diâmetro) exige medir em campo; a foto não dá escala.
import { esc, num } from "../fmt.js";
import { kpi, chip, fonte } from "../ui.js";
import { mapa, baixar, csv, script, estilo, estiloCampo } from "./campo_comum.js";

const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const EXIFR = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js";
const MODELO = new URL("../../modelos/buracos-yolov8n-seg.onnx", import.meta.url).href;
const LADO = 640, NANC = 8400;
export const SEVERIDADE = [  // fração da área da foto ocupada pela caixa
  { rot: "Leve", max: 0.015, cor: "#F5A623", nivel: "" }, { rot: "Moderada", max: 0.06, cor: "#E8730C", nivel: "alerta" },
  { rot: "Grave", max: Infinity, cor: "#C0392B", nivel: "critico" },
];
export const severidade = area => SEVERIDADE.find(s => area < s.max);

let sessao = null, estadoModelo = "parado";  // parado | carregando | pronto | falhou
const fotos = [];  // fica na memória enquanto a aba estiver aberta
let ui = {}, camadas = null, conf = 0.3;

function carregarModelo() {
  if (sessao || estadoModelo === "falhou") return Promise.resolve(sessao);
  estadoModelo = "carregando"; aviso();
  return (carregarModelo.p ||= (async () => {
    await script(ORT + "ort.min.js");
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT;
    ort.env.wasm.numThreads = 1;  // GitHub Pages não é cross-origin isolated: sem threads
    sessao = await ort.InferenceSession.create(MODELO, { executionProviders: ["wasm"] });
    estadoModelo = "pronto"; aviso();
    return sessao;
  })().catch(e => { console.warn(e); estadoModelo = "falhou"; aviso(); return null; }));
}

// letterbox 640×640 (Ultralytics) → tensor CHW float32 0..1
function preparar(img) {
  const w = img.naturalWidth, h = img.naturalHeight, r = Math.min(LADO / w, LADO / h);
  const nw = Math.round(w * r), nh = Math.round(h * r), dx = (LADO - nw) / 2, dy = (LADO - nh) / 2;
  const c = Object.assign(document.createElement("canvas"), { width: LADO, height: LADO }), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "rgb(114,114,114)"; x.fillRect(0, 0, LADO, LADO);
  x.drawImage(img, dx, dy, nw, nh);
  const px = x.getImageData(0, 0, LADO, LADO).data, n = LADO * LADO, t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { t[i] = px[i * 4] / 255; t[n + i] = px[i * 4 + 1] / 255; t[2 * n + i] = px[i * 4 + 2] / 255; }
  return { t, r, dx, dy, w, h };
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i || 1);
};
// decodifica output0 e aplica NMS; caixas normalizadas 0..1 na foto original
export function decodificar(d, { r, dx, dy, w, h }, limiar, nms = 0.45) {
  const cand = [];
  for (let i = 0; i < NANC; i++) {
    const s = d[4 * NANC + i];
    if (s < limiar) continue;
    const cw = d[2 * NANC + i], ch = d[3 * NANC + i];
    const x = Math.max(0, (d[i] - cw / 2 - dx) / r), y = Math.max(0, (d[NANC + i] - ch / 2 - dy) / r);
    const x2 = Math.min(w, (d[i] + cw / 2 - dx) / r), y2 = Math.min(h, (d[NANC + i] + ch / 2 - dy) / r);
    if (x2 > x && y2 > y) cand.push({ x: x / w, y: y / h, w: (x2 - x) / w, h: (y2 - y) / h, conf: s });
  }
  cand.sort((a, b) => b.conf - a.conf);
  const fica = [];
  for (const c of cand) if (fica.every(f => iou(f, c) < nms)) fica.push(c);
  return fica;
}

async function detectar(f) {
  const s = await carregarModelo();
  if (!s) return false;
  const p = preparar(f.img);
  const out = await s.run({ [s.inputNames[0]]: new window.ort.Tensor("float32", p.t, [1, 3, LADO, LADO]) });
  f.bruto = { d: out[s.outputNames[0]].data, p };
  f.caixas = decodificar(f.bruto.d, p, conf);
  return true;
}

async function gpsDaFoto(arq) {
  try { await script(EXIFR); const g = await window.exifr.gps(arq); if (g && isFinite(g.latitude)) return [g.latitude, g.longitude]; } catch (e) { console.warn(e); }
  return null;
}
let posAparelho = null;
const gpsAparelho = () => posAparelho ||= new Promise(ok => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition(p => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});

async function adicionar(arquivos) {
  carregarModelo();  // começa a baixar enquanto lê as fotos
  for (const arq of arquivos) {
    const f = { id: fotos.length + 1, nome: arq.name, url: URL.createObjectURL(arq), caixas: [], p: null, origem: null, pronto: false };
    f.img = new Image(); f.img.src = f.url;
    try { await f.img.decode(); } catch { URL.revokeObjectURL(f.url); continue; }
    fotos.push(f);
    f.p = await gpsDaFoto(arq); f.origem = f.p ? "EXIF da foto" : null;
    if (!f.p) { f.p = await gpsAparelho(); f.origem = f.p ? "posição do aparelho no envio" : null; }
    pintarFotos(); pintarKpi();
    ui.st.textContent = `Analisando ${f.nome}…`;
    try { f.auto = await detectar(f); } catch (e) { console.warn(e); f.auto = false; }
    f.pronto = true;
    pintarFoto(f); pintarKpi(); pintarMapa();
  }
  ui.st.textContent = fotos.length ? `${num(fotos.length)} foto(s). ${estadoModelo === "pronto" ? "Toque numa caixa para apagar ou fora dela para marcar um buraco que o modelo não viu." : ""}` : "";
}

// ── tela ──
export async function render(el) {
  estiloCampo();
  estilo("campo-bur-css", `
    .cb-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .cb-ctl input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
    .cb-fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
    .cb-foto{border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden;background:var(--sup)}
    .cb-foto canvas{display:block;width:100%;height:auto;cursor:crosshair;touch-action:manipulation}
    .cb-foto .cb-rod{padding:8px 10px;font-size:13px;color:var(--tinta-2);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .cb-mapa{height:360px;border-radius:var(--raio);border:1px solid var(--borda)}
    .cb-conf{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--tinta-2);flex:1 1 260px}
    .cb-conf input{flex:1;accent-color:var(--azul);min-width:120px}
    .cb-conf b{font-variant-numeric:tabular-nums;color:var(--tinta);min-width:3ch;text-align:right}
    .cb-exp{margin-left:auto;display:flex;gap:8px}
    @media (max-width:600px){.cb-exp{margin-left:0}#cbKpi{grid-template-columns:1fr 1fr}#cbKpi .kpi{padding:12px}}`);
  el.innerHTML = `
    <div class="cab"><div><h1>Buracos por foto</h1>
      <p>Tire ou escolha fotos do pavimento. O navegador procura panelas (buracos) em cada foto, marca a posição pelo GPS da foto e monta o mapa. Nada é enviado para servidor.</p></div>
      <div class="fontes">${fonte("modelo", "YOLOv8n (keremberke)")}${fonte("roda em", "seu aparelho")}</div></div>
    <section class="cartao"><div class="corpo cp-painel">
        <div class="cp-estado" role="status"><span class="ponto" aria-hidden="true"></span><p id="cbSt">Nenhuma foto ainda.</p></div>
        <div class="cp-btns">
          <label class="btn pri">Tirar foto<input type="file" accept="image/*" capture="environment" id="cbCam"></label>
          <label class="btn">Escolher fotos<input type="file" accept="image/*" multiple id="cbArq"></label>
        </div>
        <div id="cbModelo"></div>
        <div class="grade g-kpi" id="cbKpi"></div>
        <div class="cp-sec">
          <label class="cb-conf">Confiança mínima <input type="range" id="cbConf" min="0.1" max="0.9" step="0.05" value="${conf}" aria-label="Confiança mínima"> <b id="cbConfV">${num(conf * 100)}%</b></label>
          <span class="cb-exp"><button class="btn" id="cbCsv" type="button">CSV</button><button class="btn" id="cbGeo" type="button">GeoJSON</button><button class="btn" id="cbLimpa" type="button">Limpar</button></span>
        </div>
      </div></section>
    <div class="aviso secao"><b>Triagem, não levantamento.</b> A detecção erra (falso positivo em sombra e poça, buraco perdido em foto escura). Confira cada foto: toque numa caixa para apagar, toque fora para marcar.
      <details class="cp-ajuda" style="margin-top:6px"><summary>Como fotografar e como é a severidade</summary><ul><li>Severidade = área da caixa na foto (leve &lt; 1,5%, moderada &lt; 6%, grave ≥ 6%). A foto não tem escala: a classificação de norma (DNIT 005/2003-TER, panela; ASTM D6433) exige medir diâmetro e profundidade.</li>
      <li>Fotografe de pé, a 2 a 4 m do buraco, câmera inclinada para o chão, com a localização da câmera ligada.</li></ul></details></div>

    <section class="secao cartao"><header><div><h2>Fotos analisadas</h2><p>Caixa = buraco detectado, na cor da severidade. Toque para corrigir.</p></div></header>
      <div class="corpo"><div class="cb-fotos" id="cbFotos"></div></div></section>

    <section class="secao cartao"><header><div><h2>Mapa</h2><p>Um marcador por foto, na cor do buraco mais grave.</p></div></header>
      <div class="corpo"><div class="cb-mapa" id="cbMapa" role="region" aria-label="Mapa das fotos com buracos"></div></div></section>

    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Modelo, licença e método</summary>
      <div class="corpo" style="font-size:14px;color:var(--tinta-2)"><ul>
        <li>Modelo: <a href="https://huggingface.co/keremberke/yolov8n-pothole-segmentation" target="_blank" rel="noopener">keremberke/yolov8n-pothole-segmentation</a>, versão ONNX de <a href="https://huggingface.co/seanjudelyons/yolov8n-pothole-segmentation-onnx" target="_blank" rel="noopener">seanjudelyons</a>, 12,6 MB, baixado uma vez e guardado pelo navegador.</li>
        <li>Licença: o repositório não declara licença; modelos treinados com Ultralytics YOLOv8 seguem, em regra, a AGPL-3.0. Este site tem código aberto e usa o modelo sem alteração.</li>
        <li>Execução: onnxruntime-web 1.20.1 (WebAssembly). Posição: EXIF da foto (exifr 7.1.3); sem EXIF, posição atual do aparelho.</li>
        <li>Se o modelo não carregar (sem internet, aparelho antigo), a marcação manual continua funcionando.</li></ul></div></details>`;

  ui = { el, st: el.querySelector("#cbSt") };
  const $ = s => el.querySelector(s);
  const ao = inp => inp.onchange = () => { const a = [...inp.files]; inp.value = ""; if (a.length) adicionar(a); };
  ao($("#cbCam")); ao($("#cbArq"));
  $("#cbConf").oninput = ev => {
    conf = +ev.target.value; $("#cbConfV").textContent = `${num(conf * 100)}%`;
    fotos.forEach(f => { if (f.bruto) { f.caixas = [...decodificar(f.bruto.d, f.bruto.p, conf), ...f.caixas.filter(c => c.manual)]; pintarFoto(f); } });
    pintarKpi(); pintarMapa();
  };
  $("#cbCsv").onclick = () => fotos.length && baixar("buracos-fotos.csv", paraCsv(), "text/csv;charset=utf-8");
  $("#cbGeo").onclick = () => fotos.length && baixar("buracos-fotos.geojson", JSON.stringify(paraGeo()), "application/geo+json");
  $("#cbLimpa").onclick = () => { if (!fotos.length || !confirm("Remover todas as fotos desta tela?")) return; fotos.forEach(f => URL.revokeObjectURL(f.url)); fotos.length = 0; pintarFotos(); pintarKpi(); pintarMapa(); };
  aviso(); pintarKpi(); pintarFotos();
  try { const { L, m } = await mapa($("#cbMapa")); camadas = { L, m, grupo: L.layerGroup().addTo(m) }; pintarMapa(); }
  catch { camadas = null; $("#cbMapa").outerHTML = `<p class="vazio">Mapa indisponível sem internet. As fotos e a exportação funcionam.</p>`; }
}

function aviso() {
  const el = ui.el?.querySelector("#cbModelo"); if (!el) return;
  el.innerHTML = {
    parado: "", carregando: `<p class="peq" style="font-size:13px;color:var(--tinta-3)">Baixando o modelo de detecção (12,6 MB, só na primeira vez)…</p>`,
    pronto: chip("Detecção automática ativa", "ok"),
    falhou: `<div class="aviso">${chip("Detecção automática indisponível", "alerta")} O modelo não carregou neste aparelho. Marque os buracos tocando na foto.</div>`,
  }[estadoModelo];
}

const piorSev = f => f.caixas.reduce((p, c) => { const s = severidade(c.w * c.h); return SEVERIDADE.indexOf(s) > SEVERIDADE.indexOf(p) ? s : p; }, null);
function pintarKpi() {
  const el = ui.el?.querySelector("#cbKpi"); if (!el) return;
  const cx = fotos.flatMap(f => f.caixas), graves = cx.filter(c => severidade(c.w * c.h).rot === "Grave").length;
  el.innerHTML = kpi("Fotos", num(fotos.length), `${num(fotos.filter(f => f.caixas.length).length)} com buraco`) +
    kpi("Buracos marcados", num(cx.length), `${num(cx.filter(c => c.manual).length)} à mão`) +
    kpi("Graves", num(graves), "caixa ≥ 6% da foto", graves > 0) +
    kpi("Sem posição", num(fotos.filter(f => !f.p).length), "fora do mapa e do GeoJSON");
}
function pintarFotos() {
  const el = ui.el?.querySelector("#cbFotos"); if (!el) return;
  el.innerHTML = fotos.length ? "" : `<p class="vazio">Use "Tirar foto" no celular ou "Escolher fotos" para analisar fotos já feitas.</p>`;
  fotos.forEach(f => {
    const card = Object.assign(document.createElement("figure"), { className: "cb-foto" });
    card.style.margin = "0"; card.dataset.id = f.id;
    const cv = document.createElement("canvas");
    cv.setAttribute("aria-label", `Foto ${f.nome}`);
    cv.onclick = ev => tocar(f, cv, ev);
    card.append(cv, Object.assign(document.createElement("figcaption"), { className: "cb-rod" }));
    el.append(card);
    pintarFoto(f);
  });
}
function pintarFoto(f) {
  const card = ui.el?.querySelector(`.cb-foto[data-id="${f.id}"]`); if (!card) return;
  const cv = card.querySelector("canvas"), W = Math.min(1000, f.img.naturalWidth), H = Math.round(W * f.img.naturalHeight / f.img.naturalWidth);
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  x.drawImage(f.img, 0, 0, W, H);
  x.lineWidth = Math.max(2, W / 250); x.font = `600 ${Math.max(13, W / 45)}px Outfit, sans-serif`;
  f.caixas.forEach((c, i) => {
    const s = severidade(c.w * c.h), rot = `${i + 1} ${s.rot}${c.manual ? " (mão)" : ` ${num(c.conf * 100)}%`}`;
    x.strokeStyle = s.cor; x.strokeRect(c.x * W, c.y * H, c.w * W, c.h * H);
    const tw = x.measureText(rot).width + 8, th = Math.max(13, W / 45) + 6, ty = c.y * H > th ? c.y * H - th : c.y * H;
    x.fillStyle = s.cor; x.fillRect(c.x * W, ty, tw, th);
    x.fillStyle = "#111"; x.fillText(rot, c.x * W + 4, ty + th - 6);
  });
  const sev = piorSev(f);
  card.querySelector("figcaption").innerHTML = `<b>${esc(f.nome)}</b>
    ${!f.pronto ? chip("analisando") : f.caixas.length ? chip(`${f.caixas.length} buraco(s)`, sev?.nivel || "") : chip("nenhum buraco", "ok")}
    ${f.p ? `<span>${num(f.p[0], 5)}, ${num(f.p[1], 5)} · ${esc(f.origem)}</span>` : chip("sem posição", "alerta")}`;
}
// toque: dentro de caixa apaga; fora marca caixa manual (10% da largura) centrada no toque
function tocar(f, cv, ev) {
  if (!f.pronto) return;
  const b = cv.getBoundingClientRect(), px = (ev.clientX - b.left) / b.width, py = (ev.clientY - b.top) / b.height;
  const i = f.caixas.findIndex(c => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
  if (i >= 0) f.caixas.splice(i, 1);
  else { const w = 0.1, h = 0.1 * f.img.naturalWidth / f.img.naturalHeight; f.caixas.push({ x: Math.max(0, px - w / 2), y: Math.max(0, py - h / 2), w, h, conf: 1, manual: true }); }
  pintarFoto(f); pintarKpi(); pintarMapa();
}
function pintarMapa() {
  if (!camadas) return;
  const { L, m, grupo } = camadas;
  grupo.clearLayers();
  const comPos = fotos.filter(f => f.p);
  comPos.forEach(f => {
    const s = piorSev(f);
    L.circleMarker(f.p, { radius: 8, color: "#fff", weight: 2, fillColor: s?.cor || "#4CAF50", fillOpacity: .95 })
      .bindPopup(`<b>${esc(f.nome)}</b><br>${f.caixas.length} buraco(s)${s ? ` · pior: ${s.rot}` : ""}<br><img src="${f.url}" alt="" style="width:180px;margin-top:6px;border-radius:4px">`).addTo(grupo);
  });
  if (comPos.length) m.fitBounds(comPos.map(f => f.p), { padding: [30, 30], maxZoom: 17 });
}

function paraCsv() {
  return csv(["foto", "arquivo", "lat", "lon", "origem_posicao", "buraco", "severidade", "area_pct_foto", "confianca", "marcacao"],
    fotos.flatMap(f => (f.caixas.length ? f.caixas : [null]).map((c, i) => [f.id, f.nome, f.p?.[0] ?? "", f.p?.[1] ?? "", f.origem || "",
      c ? i + 1 : 0, c ? severidade(c.w * c.h).rot : "", c ? +(c.w * c.h * 100).toFixed(2) : "", c && !c.manual ? +c.conf.toFixed(3) : "", c ? (c.manual ? "manual" : "automatica") : ""])));
}
function paraGeo() {
  return { type: "FeatureCollection",
    _meta: { fonte: "Buracos por foto, DMOB Hub", gerado_em: new Date().toISOString(), metodologia: "Detecção YOLOv8n (keremberke/yolov8n-pothole-segmentation, ONNX) no navegador, revisada à mão. Severidade pela área da caixa na foto (leve < 1,5%, moderada < 6%, grave >= 6%): triagem, sem escala métrica." },
    features: fotos.filter(f => f.p).map(f => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.p[1], f.p[0]] },
      properties: { foto: f.nome, origem_posicao: f.origem, buracos: f.caixas.length, pior_severidade: piorSev(f)?.rot || null,
        caixas: f.caixas.map(c => ({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4), severidade: severidade(c.w * c.h).rot, confianca: c.manual ? null : +c.conf.toFixed(3), manual: !!c.manual })) } })) };
}

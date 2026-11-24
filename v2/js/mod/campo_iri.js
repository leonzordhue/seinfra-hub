// IRI pelo celular: estimativa de irregularidade longitudinal com acelerômetro + GPS do aparelho. [Claude] 23/11/2026
// Método (citado na tela):
//  - Aceleração vertical = projeção da aceleração no vetor gravidade estimado por filtro passa-baixa
//    (gravidade removida; usa DeviceMotionEvent.acceleration quando o aparelho fornece).
//  - Segmentos de 100 m pela distância GPS (haversine).
//  - IRI = a·RMS + b, RMS da aceleração vertical em m/s². Coeficientes iniciais: Yeganeh, Mahmoudzadeh,
//    Azizpour & Golroo (2019), "Validation of smartphone based pavement roughness measures",
//    arXiv:1902.10699, eq. 3: IRI = 4,19·RMS + 1,73 (R² = 0,76; 20–50 km/h; perfilômetro RSP como referência).
//    Os coeficientes dependem do aparelho, do veículo, do suporte e da velocidade: calibrar com trecho de IRI conhecido.
//  - Classes de IRI: DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006), conceitos de
//    irregularidade: bom ≤ 2,7; regular ≤ 3,5; ruim ≤ 4,6; péssimo > 4,6 m/km (faixa "ótimo" ≤ 1,9 somada a "bom").
//  - Estimativa indicativa: não substitui perfilômetro classe 1/2 (ASTM E950; DNIT PRO 182/94, DNER-ES 173/86).
import { talvez } from "../dados.js";
import { esc, num, data } from "../fmt.js";
import { kpi, chip, tabela, fonte, opcoes } from "../ui.js";
import { mapa, baixar, csv, dist, guardar, ler, estilo, estiloCampo } from "./campo_comum.js";

export const COEF_PADRAO = { a: 4.19, b: 1.73 };
const CHAVE_COEF = "dmob-campo-iri-coef", CHAVE_SESS = "dmob-campo-iri-sessoes";
const SEG_M = 100, VMIN = 30, VMAX = 80, PREC_MAX = 30;  // m, km/h, km/h, m
export const CLASSES = [  // DNIT IPR-720/2006
  { rot: "Bom", max: 2.7, cor: "#4CAF50" }, { rot: "Regular", max: 3.5, cor: "#F5A623" },
  { rot: "Ruim", max: 4.6, cor: "#E8730C" }, { rot: "Péssimo", max: Infinity, cor: "#C0392B" },
];
const COR_INVALIDO = "#9AA5B5";
export const classe = iri => CLASSES.find(c => iri <= c.max);
export const estimar = (rms, c) => c.a * rms + c.b;

// mínimos quadrados de iri_oficial = a·rms + b (calibração)
export function ajustar(pares) {
  const n = pares.length; if (n < 2) return null;
  const mx = pares.reduce((s, p) => s + p[0], 0) / n, my = pares.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pares) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx) return null;
  const a = sxy / sxx;
  return { a, b: my - a * mx, r2: syy ? sxy * sxy / (sxx * syy) : 0, n };
}

// ── processamento dos sensores (o mesmo para leitura real e simulação) ──
function novaGravacao(coef, limiar, sim) {
  return { id: Date.now(), ini: new Date().toISOString(), sim, coef: { ...coef }, limiar, segs: [], buracos: [],
    seg: null, ult: null, g: null, nAm: 0, ultPico: -1e9, vel: null, prec: null };
}
function novoSeg(p) { return { pts: [p], d: 0, tv: 0, s2: 0, n: 0, bur: 0 }; }

// a: accelerationIncludingGravity; l: acceleration (sem gravidade) ou null; t em ms
function amostra(R, a, l, t) {
  if (!R.g) R.g = [...a];
  const al = 0.05;  // passa-baixa: separa a gravidade (≈ 0,5 Hz a 60 Hz de amostragem)
  for (let i = 0; i < 3; i++) R.g[i] += al * (a[i] - R.g[i]);
  if (++R.nAm < 60 || !R.seg) return;  // espera o filtro assentar e o 1º fixo GPS
  const gn = Math.hypot(...R.g), u = R.g.map(v => v / gn);
  const av = l ? l[0] * u[0] + l[1] * u[1] + l[2] * u[2] : a[0] * u[0] + a[1] * u[1] + a[2] * u[2] - gn;
  R.seg.s2 += av * av; R.seg.n++;
  if (Math.abs(av) > R.limiar && t - R.ultPico > 1000 && R.ult) {  // 1 s de bloqueio: um impacto, um buraco
    R.ultPico = t; R.seg.bur++;
    R.buracos.push({ p: R.ult.p, pico: +Math.abs(av).toFixed(2), t: new Date(t).toISOString() });
    return "buraco";
  }
}

function posicao(R, p, velMs, prec, t) {
  R.prec = prec;
  if (prec > PREC_MAX) return null;  // fixo ruim não entra na distância
  if (!R.ult) { R.ult = { p, t }; R.seg = novoSeg(p); return null; }
  const d = dist(R.ult.p, p), dt = (t - R.ult.t) / 1000;
  if (dt <= 0) return null;
  R.vel = (velMs != null && !isNaN(velMs) ? velMs : d / dt) * 3.6;
  R.seg.d += d; R.seg.tv += dt; R.seg.pts.push(p);
  R.ult = { p, t };
  return R.seg.d >= SEG_M ? fecharSeg(R) : null;
}

function fecharSeg(R) {
  const s = R.seg, rms = s.n ? Math.sqrt(s.s2 / s.n) : null, v = s.tv ? s.d / s.tv * 3.6 : null;
  const iri = rms == null ? null : +estimar(rms, R.coef).toFixed(2);
  const fecho = { pts: s.pts.map(q => [+q[0].toFixed(6), +q[1].toFixed(6)]), d: +s.d.toFixed(1), v: v && +v.toFixed(1), rms: rms && +rms.toFixed(4), iri, bur: s.bur, n: s.n,
    valido: rms != null && s.n >= 30 && v >= VMIN && v <= VMAX };
  R.segs.push(fecho);
  R.seg = novoSeg(R.ult.p);
  return fecho;
}

// ── levantamento oficial (data/icm.json, RoadLab Pro) para comparar e calibrar ──
let refs = null;
async function referencias() {
  if (refs) return refs;
  const icm = await talvez("icm");
  refs = { icm, pts: [] };
  for (const r of icm?.rodovias || []) for (const s of r.segments || [])
    if (s[4] != null) refs.pts.push({ lat: (s[0] + s[2]) / 2, lon: (s[1] + s[3]) / 2, iri: s[4], cod: r.codigo });
  return refs;
}
function maisProximo(p, max = 60) {
  let m = null, dm = max;
  const k = Math.cos(p[0] * Math.PI / 180) * 111320;
  for (const q of refs?.pts || []) {
    const dy = (q.lat - p[0]) * 110540, dx = (q.lon - p[1]) * k;
    if (Math.abs(dy) > dm) continue;
    const d = Math.hypot(dx, dy);
    if (d < dm) { dm = d; m = q; }
  }
  return m && { ...m, dist: dm };
}
const meio = s => s.pts[Math.floor(s.pts.length / 2)];
function comparar(segs) {
  return segs.filter(s => s.valido).map(s => ({ s, ref: maisProximo(meio(s)) })).filter(x => x.ref);
}

// ── tela ──
let R = null, sim = null, watch = null, wake = null, camadas = null;
const coefAtual = () => ({ ...COEF_PADRAO, ...ler(CHAVE_COEF, {}) });

function pararTudo(salvar = true) {
  if (sim) { clearInterval(sim); sim = null; }
  if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
  window.removeEventListener("devicemotion", onMotion);
  try { wake?.release(); } catch {} wake = null;
  const fim = R; R = null;
  if (fim && salvar && fim.segs.length) {
    const sess = ler(CHAVE_SESS, []);
    sess.unshift({ id: fim.id, ini: fim.ini, fim: new Date().toISOString(), sim: fim.sim, coef: fim.coef, limiar: fim.limiar, segs: fim.segs, buracos: fim.buracos });
    if (!guardar(CHAVE_SESS, sess.slice(0, 30))) alert("Não consegui salvar a sessão no aparelho (armazenamento cheio ou bloqueado). Exporte o CSV/GeoJSON antes de sair.");
  }
  return fim;
}
function onMotion(e) {
  if (!R) return;
  const g = e.accelerationIncludingGravity, l = e.acceleration;
  if (g?.x == null) return;
  const r = amostra(R, [g.x, g.y, g.z], l?.x != null ? [l.x, l.y, l.z] : null, performance.timeOrigin + e.timeStamp);
  if (r === "buraco") desenharBuraco(R.buracos.at(-1));
}

let ui = {};
export async function render(el, params) {
  pararTudo();  // nova renderização (troca de tema, rota) encerra e salva a gravação em curso
  estiloCampo();
  estilo("campo-iri-css", `
    .ci-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .ci-mapa{height:420px;border-radius:var(--raio);border:1px solid var(--borda)}
    .ci-leg{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--tinta-2);margin-top:8px}
    .ci-leg i{display:inline-block;width:18px;height:4px;border-radius:2px;margin-right:5px;vertical-align:middle}
    .ci-cal{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
    .ci-cal label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--tinta-2)}
    .ci-cal input{font:inherit;padding:7px 9px;border:1px solid var(--borda-2);border-radius:6px;background:var(--sup);color:var(--tinta)}
    @media (max-width:600px){.ci-mapa{height:300px}}`);
  await referencias();
  const coef = coefAtual(), limiar = ler("dmob-campo-iri-limiar", 4);
  const rods = (refs.icm?.rodovias || []).map(r => r.codigo);
  const temSensor = "DeviceMotionEvent" in window, temGps = "geolocation" in navigator;

  el.innerHTML = `
    <div class="cab"><div><h1>IRI pelo celular</h1>
      <p>Estima a irregularidade (IRI) a cada 100 m com o acelerômetro e o GPS do celular durante a viagem, conta impactos de buraco e compara com o levantamento oficial do trecho.</p></div>
      <div class="fontes">${fonte("coeficientes", `a = ${num(coef.a, 2)} · b = ${num(coef.b, 2)}`)}${fonte("referência", refs.icm ? `RoadLab Pro ${refs.icm.gerado_em}` : "indisponível")}</div></div>
    <section class="cartao" id="ciGrav"><div class="corpo cp-painel">
        <div class="cp-estado" role="status"><span class="ponto" aria-hidden="true"></span><p id="ciSt">${!temSensor || !temGps ? "Este navegador não oferece acelerômetro ou GPS. Use Simular para conhecer a ferramenta." : "Parado. Toque em Iniciar com o carro já em movimento."}</p></div>
        <div id="ciKpi"></div>
        <div class="cp-btns">
          <button class="btn pri" id="ciIni" type="button"${!temSensor || !temGps ? " disabled" : ""}>Iniciar gravação</button>
          <button class="btn cp-parar" id="ciPar" type="button" disabled>Parar e salvar</button>
        </div>
        <div class="cp-sec"><span>Sem sair do lugar:</span>
          <select id="ciRod" aria-label="Rodovia para simular">${opcoes(rods, "AM-010", "Rodovia para simular")}</select>
          <button class="btn" id="ciSim" type="button"${rods.length ? "" : " disabled"}>Simular</button>
        </div>
      </div></section>
    <div class="aviso secao"><b>Estimativa indicativa.</b> Não substitui o levantamento com perfilômetro (ASTM E950; DNIT PRO 182/94). Use para triagem e para apontar trechos a vistoriar.
      <details class="cp-ajuda" style="margin-top:6px"><summary>Como usar</summary><ul><li>Fixe o celular no painel ou no para-brisa (suporte firme, tela para cima ou em pé). Celular solto no banco não serve.</li>
      <li>Mantenha velocidade constante entre ${VMIN} e ${VMAX} km/h. Segmento fora da faixa fica cinza e não entra na média.</li>
      <li>Calibre com um trecho de IRI conhecido antes de usar o número: o resultado depende do carro, do suporte e do aparelho.</li></ul></details></div>

    <section class="secao cartao"><header><div><h2>Trilha</h2><p>Cor pela classe de IRI estimada (DNIT). Círculos vermelhos: impactos acima do limiar.</p></div></header>
      <div class="corpo"><div class="ci-mapa" id="ciMapa" role="img" aria-label="Mapa da trilha gravada"></div>
        <div class="ci-leg">${CLASSES.map((c, i) => `<span><i style="background:${c.cor}"></i>${c.rot} ${isFinite(c.max) ? `≤ ${num(c.max, 1)}` : `> ${num(CLASSES[i - 1].max, 1)}`}</span>`).join("")}<span><i style="background:${COR_INVALIDO}"></i>Fora de ${VMIN}–${VMAX} km/h</span></div></div></section>

    <section class="secao cartao"><header><div><h2>Comparação com o levantamento oficial</h2><p>Segmentos válidos com trecho oficial a menos de 60 m. Referência: data/icm.json (${esc(refs.icm?.fonte || "indisponível")}), que também é estimativa por celular, não perfilômetro.</p></div><span class="contagem" id="ciCompN"></span></header>
      <div class="corpo"><div id="ciComp"><p class="vazio">Grave ou abra uma sessão para comparar.</p></div></div></section>

    <section class="secao cartao"><header><div><h2>Calibração</h2><p>IRI = a · RMS + b (RMS da aceleração vertical em m/s²). Padrão: Yeganeh et al. (2019), arXiv:1902.10699, a = 4,19 e b = 1,73.</p></div></header>
      <div class="corpo"><div class="ci-cal">
        <label>a (m/km por m/s²)<input id="ciA" type="number" step="0.01" value="${coef.a}"></label>
        <label>b (m/km)<input id="ciB" type="number" step="0.01" value="${coef.b}"></label>
        <label>Limiar de buraco (m/s²)<input id="ciL" type="number" step="0.5" min="1" value="${limiar}"></label>
      </div>
      <div class="ci-ctl secao"><button class="btn" id="ciSalvaCoef" type="button">Salvar coeficientes</button>
        <button class="btn" id="ciPadrao" type="button">Voltar ao padrão</button>
        <button class="btn" id="ciCalib" type="button" disabled>Calibrar com a sessão aberta</button><span id="ciCalMsg" class="peq" style="font-size:13px;color:var(--tinta-3)"></span></div></div></section>

    <section class="secao cartao"><header><div><h2>Sessões salvas neste aparelho</h2><p>Ficam só neste navegador. Exporte para guardar ou enviar.</p></div></header>
      <div class="corpo"><div id="ciSess"></div></div></section>`;

  ui = { el, st: el.querySelector("#ciSt"), kpi: el.querySelector("#ciKpi"), aberta: null };
  pintarKpi(null);
  try {
    const { L, m } = await mapa(el.querySelector("#ciMapa"));
    camadas = { L, m, grupo: L.layerGroup().addTo(m), seguir: true };
  } catch (e) { camadas = null; el.querySelector("#ciMapa").outerHTML = `<p class="vazio">Mapa indisponível (sem internet para carregar o Leaflet). A gravação funciona assim mesmo.</p>`; }

  const $ = s => el.querySelector(s);
  const lerCoef = () => ({ a: parseFloat($("#ciA").value), b: parseFloat($("#ciB").value) });
  $("#ciIni").onclick = () => iniciar(lerCoef(), parseFloat($("#ciL").value) || 4);
  $("#ciSim").onclick = () => simular($("#ciRod").value || rods[0], lerCoef(), parseFloat($("#ciL").value) || 4, params.has("rapido") ? 200 : 20);
  $("#ciPar").onclick = () => { const s = pararTudo(); botoes(false); pintarSessoes(); if (s) abrirSessao(ler(CHAVE_SESS, [])[0]); ui.st.textContent = s?.segs.length ? "Sessão salva." : "Parado (nenhum segmento completo)."; };
  $("#ciSalvaCoef").onclick = () => { const c = lerCoef(); if (!(isFinite(c.a) && isFinite(c.b))) return alert("Coeficientes inválidos."); guardar(CHAVE_COEF, c); guardar("dmob-campo-iri-limiar", parseFloat($("#ciL").value) || 4); $("#ciCalMsg").textContent = "Salvos. Valem para as próximas gravações."; };
  $("#ciPadrao").onclick = () => { $("#ciA").value = COEF_PADRAO.a; $("#ciB").value = COEF_PADRAO.b; guardar(CHAVE_COEF, COEF_PADRAO); $("#ciCalMsg").textContent = "Coeficientes de literatura restaurados."; };
  $("#ciCalib").onclick = () => {
    const pares = comparar(ui.aberta?.segs || []).map(x => [x.s.rms, x.ref.iri]);
    const f = ajustar(pares);
    if (!f || f.n < 10) return $("#ciCalMsg").textContent = `Pares insuficientes (${pares.length}). São necessários 10 segmentos válidos sobre trecho levantado.`;
    $("#ciA").value = f.a.toFixed(3); $("#ciB").value = f.b.toFixed(3);
    $("#ciCalMsg").textContent = `Ajuste com ${f.n} segmentos: a = ${num(f.a, 2)}, b = ${num(f.b, 2)}, R² = ${num(f.r2, 2)}. Confira e toque em Salvar coeficientes.`;
  };
  pintarSessoes();
  if (params.has("teste")) autoteste();
  window.addEventListener("hashchange", () => pararTudo(), { once: true });
}

function botoes(gravando) {
  const $ = s => ui.el.querySelector(s);
  $("#ciIni").disabled = gravando || !("DeviceMotionEvent" in window); $("#ciSim").disabled = gravando; $("#ciPar").disabled = !gravando;
  $("#ciGrav").classList.toggle("gravando", gravando);
}

async function iniciar(coef, limiar) {
  // iOS 13+: a permissão do sensor precisa ser pedida dentro do toque, antes de qualquer await
  const pedido = typeof window.DeviceMotionEvent?.requestPermission === "function" ? DeviceMotionEvent.requestPermission() : Promise.resolve("granted");
  let ok;
  try { ok = await pedido; } catch (e) { ok = "erro"; }
  if (ok !== "granted") { ui.st.textContent = "Sem permissão para o acelerômetro. Libere o acesso a movimento nas configurações do navegador."; return; }
  pararTudo();
  R = novaGravacao(coef, limiar, false);
  limparMapa(); botoes(true);
  window.addEventListener("devicemotion", onMotion);
  watch = navigator.geolocation.watchPosition(
    pos => { if (R) aoFixo(posicao(R, [pos.coords.latitude, pos.coords.longitude], pos.coords.speed, pos.coords.accuracy, pos.timestamp)); },
    err => { ui.st.textContent = "GPS: " + (err.code === 1 ? "permissão negada. Libere a localização para este site." : err.message); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  travarTela();
  ui.st.textContent = "Gravando. Aguardando GPS…";
  // navegador de PC expõe DeviceMotionEvent mas nunca dispara: avisa em vez de gravar em silêncio
  setTimeout(() => { if (R && !R.sim && R.nAm === 0) ui.st.textContent = "Nenhuma leitura do acelerômetro. Este aparelho não tem sensor de movimento (use o celular) ou o navegador bloqueou o acesso."; }, 4000);
}
async function travarTela() {
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && R && !R.sim) travarTela(); });

// ── simulação: percorre uma rodovia do levantamento oficial e gera aceleração com RMS coerente com o IRI dela ──
function simular(cod, coef, limiar, passosPorTique) {
  pararTudo();
  const rod = refs.icm.rodovias.find(r => r.codigo === cod);
  const caminho = [];  // [lat, lon, iri]
  for (const s of rod.segments) { if (!caminho.length) caminho.push([s[0], s[1], s[4]]); caminho.push([s[2], s[3], s[4]]); }
  R = novaGravacao(coef, limiar, true);
  limparMapa(); botoes(true);
  let i = 0, frac = 0, t = Date.now(), semente = 42;
  const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  ui.st.textContent = `Simulando ${cod} a ~55 km/h (dados sintéticos).`;
  sim = setInterval(() => {
    for (let k = 0; k < passosPorTique && R; k++) {  // cada passo = 1 s de viagem
      if (i >= caminho.length - 1) { ui.el.querySelector("#ciPar").click(); return; }
      const v = (55 + gauss() * 3) / 3.6, a = caminho[i], b = caminho[i + 1], L = dist(a, b) || 1;
      frac += v / L;
      while (frac >= 1 && i < caminho.length - 2) { frac -= 1; i++; }
      if (frac >= 1) { i++; frac = 0; continue; }
      const p0 = caminho[i], p1 = caminho[i + 1], iri = p1[2] ?? 2.5;
      const alvo = Math.max(0.05, (iri - COEF_PADRAO.b) / COEF_PADRAO.a) * (1 + 0.15 * gauss());
      for (let j = 0; j < 50; j++) {  // 50 Hz; celular inclinado 30° para testar a projeção na gravidade
        const av = alvo * gauss() + (rnd() < 0.0004 * iri ? 9 : 0);
        const vz = 9.81 + av;
        amostra(R, [0, vz * Math.sin(0.52), vz * Math.cos(0.52)], null, t + j * 20) === "buraco" && desenharBuraco(R.buracos.at(-1));
      }
      t += 1000;
      aoFixo(posicao(R, [p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac], v, 5, t));
    }
  }, 100);
}

// ── atualização da tela ──
function aoFixo(seg) {
  if (!R) return;
  if (seg) { desenharSeg(seg); pintarKpi(R); }
  else if (R.vel != null) pintarKpi(R);
  const fora = R.vel != null && (R.vel < VMIN || R.vel > VMAX);
  ui.st.innerHTML = R.prec > PREC_MAX ? `GPS impreciso (±${num(R.prec)} m). Aguardando sinal melhor.` :
    `<b class="cp-rot">${R.sim ? "SIMULANDO" : "GRAVANDO"}</b> · ${num(R.segs.length)} segmentos${fora ? " · " + chip(`Velocidade fora de ${VMIN}–${VMAX} km/h`, "alerta") : ""}${!R.sim && !wake ? " · mantenha a tela ligada" : ""}`;
}
function resumo(segs, buracos) {
  const v = segs.filter(s => s.valido), km = segs.reduce((s, x) => s + x.d, 0) / 1000;
  const med = v.length ? v.reduce((s, x) => s + x.iri * x.d, 0) / v.reduce((s, x) => s + x.d, 0) : null;
  return { km, med, nv: v.length, n: segs.length, bur: buracos.length, cls: med != null ? classe(med) : null };
}
function pintarKpi(G) {
  const r = resumo(G?.segs || [], G?.buracos || []), ult = G?.segs.at(-1);
  const fora = G?.vel != null && (G.vel < VMIN || G.vel > VMAX);
  const c = ult?.iri != null ? classe(ult.iri) : null;
  // leitura grande (velocidade e IRI do último segmento) + 3 números de apoio
  ui.kpi.innerHTML = `<div class="cp-leit">
      <div class="${fora ? "cp-fora" : ""}"><div class="rot">Velocidade</div><div class="cp-num">${G?.vel != null ? num(G.vel) : "—"}<small>km/h</small></div>
        <div class="cp-sub">${fora ? chip(`fora de ${VMIN}–${VMAX} km/h`, "alerta") : `faixa válida ${VMIN}–${VMAX} km/h`}</div></div>
      <div><div class="rot">IRI último trecho</div><div class="cp-num">${ult?.iri != null ? num(ult.iri, 1) : "—"}<small>m/km</small></div>
        <div class="cp-sub">${c ? `<span class="cp-classe" style="--c:${ult.valido ? c.cor : COR_INVALIDO}">${c.rot}</span>${ult.valido ? "" : " · fora da faixa"}` : `a cada ${SEG_M} m`}</div></div>
    </div>
    <div class="cp-mini" style="margin-top:10px">
      <div><div class="rot">IRI médio</div><div class="v">${r.med != null ? num(r.med, 2) : "—"}</div><div class="s">${r.cls ? `${r.cls.rot} · ${num(r.nv)}/${num(r.n)} válidos` : "m/km, só válidos"}</div></div>
      <div><div class="rot">Percorrido</div><div class="v">${num(r.km, 1)} km</div><div class="s">${num(r.n)} trechos de ${SEG_M} m</div></div>
      <div${r.bur > 0 ? ' class="cp-fora"' : ""}><div class="rot">Impactos</div><div class="v">${num(r.bur)}</div><div class="s">picos &gt; ${num(G?.limiar ?? ler("dmob-campo-iri-limiar", 4), 1)} m/s²</div></div>
    </div>`;
}
function limparMapa() { camadas?.grupo.clearLayers(); camadas && (camadas.seguir = true); }
function desenharSeg(s) {
  if (!camadas) return;
  const { L, m, grupo } = camadas;
  L.polyline(s.pts, { color: s.valido ? classe(s.iri).cor : COR_INVALIDO, weight: 6, opacity: .9, dashArray: s.valido ? null : "4 6" })
    .bindTooltip(`IRI ${num(s.iri, 2)} m/km · ${num(s.v)} km/h${s.bur ? ` · ${s.bur} impacto(s)` : ""}`).addTo(grupo);
  if (camadas.seguir) { m.setView(s.pts.at(-1), Math.max(m.getZoom(), 14)); }
}
function desenharBuraco(b) {
  if (!camadas || !b) return;
  camadas.L.circleMarker(b.p, { radius: 6, color: "#C0392B", fillColor: "#C0392B", fillOpacity: .8, weight: 1 })
    .bindTooltip(`Impacto ${num(b.pico, 1)} m/s²`).addTo(camadas.grupo);
}

function pintarSessoes() {
  const el = ui.el.querySelector("#ciSess"), sess = ler(CHAVE_SESS, []);
  if (!sess.length) { el.innerHTML = `<p class="vazio">Nenhuma sessão salva.</p>`; return; }
  el.innerHTML = "<div></div>";
  const linhas = sess.map(s => ({ ...s, ...resumo(s.segs, s.buracos) }));
  tabela(el.firstChild, [
    { k: "ini", rot: "Início", html: r => `${esc(data(r.ini))} ${esc(r.ini.slice(11, 16))}${r.sim ? " " + chip("simulação") : ""}` },
    { k: "km", rot: "km", n: 1, html: r => num(r.km, 1) },
    { k: "med", rot: "IRI médio", n: 1, html: r => r.med != null ? `${num(r.med, 2)} · ${r.cls.rot}` : "—" },
    { k: "bur", rot: "Impactos", n: 1, html: r => num(r.bur) },
    { k: "acao", rot: "Ações", sem_ord: 1, html: r => `<span class="ci-ctl"><button class="btn" data-a="abrir" data-id="${r.id}">Abrir</button><button class="btn" data-a="csv" data-id="${r.id}">CSV</button><button class="btn" data-a="geo" data-id="${r.id}">GeoJSON</button><button class="btn" data-a="del" data-id="${r.id}">Excluir</button></span>` },
  ], linhas, { limite: 30 });
  el.onclick = ev => {  // delegação: a tabela redesenha os botões ao ordenar
    const b = ev.target.closest("button[data-a]"); if (!b) return;
    const s = sess.find(x => String(x.id) === b.dataset.id), nome = `iri-celular-${s.ini.slice(0, 16).replace(/[:T]/g, "-")}`;
    if (b.dataset.a === "abrir") abrirSessao(s);
    if (b.dataset.a === "csv") baixar(nome + ".csv", paraCsv(s), "text/csv;charset=utf-8");
    if (b.dataset.a === "geo") baixar(nome + ".geojson", JSON.stringify(paraGeo(s)), "application/geo+json");
    if (b.dataset.a === "del" && confirm("Excluir esta sessão do aparelho?")) { guardar(CHAVE_SESS, sess.filter(x => x !== s)); pintarSessoes(); }
  };
}
function abrirSessao(s) {
  if (!s) return;
  ui.aberta = s;
  limparMapa(); if (camadas) camadas.seguir = false;
  s.segs.forEach(desenharSeg); s.buracos.forEach(desenharBuraco);
  if (camadas && s.segs.length) camadas.m.fitBounds(s.segs.flatMap(x => x.pts), { padding: [20, 20] });
  pintarKpi({ ...s, vel: null });
  ui.el.querySelector("#ciCalib").disabled = false;
  const comp = comparar(s.segs), el = ui.el.querySelector("#ciComp");
  ui.el.querySelector("#ciCompN").textContent = `${num(comp.length)} pares`;
  if (!comp.length) { el.innerHTML = `<p class="vazio">Nenhum segmento válido sobre trecho do levantamento oficial.</p>`; return; }
  const dif = comp.map(x => x.s.iri - x.ref.iri), md = dif.reduce((a, b) => a + b, 0) / dif.length;
  const mae = dif.reduce((a, b) => a + Math.abs(b), 0) / dif.length, mesma = comp.filter(x => classe(x.s.iri) === classe(x.ref.iri)).length;
  const f = ajustar(comp.map(x => [x.s.iri, x.ref.iri]));
  el.innerHTML = `<div class="grade g-kpi">${kpi("Diferença média", (md > 0 ? "+" : "") + num(md, 2), "estimado − oficial, m/km")}${kpi("Erro médio absoluto", num(mae, 2), "m/km")}${kpi("Mesma classe DNIT", `${num(mesma / comp.length * 100)}%`, `${num(mesma)} de ${num(comp.length)}`)}${kpi("Correlação (R²)", f ? num(f.r2, 2) : "—", "entre estimado e oficial")}</div><div id="ciCompT" class="secao"></div>`;
  tabela(el.querySelector("#ciCompT"), [
    { k: "i", rot: "Seg.", n: 1 }, { k: "cod", rot: "Rodovia" },
    { k: "est", rot: "IRI estimado", n: 1, html: r => num(r.est, 2) }, { k: "ofi", rot: "IRI oficial", n: 1, html: r => num(r.ofi, 2) },
    { k: "dif", rot: "Diferença", n: 1, html: r => num(r.dif, 2) }, { k: "d", rot: "Dist. ref. (m)", n: 1, html: r => num(r.d) },
  ], comp.map((x, i) => ({ i: s.segs.indexOf(x.s) + 1, cod: x.ref.cod, est: x.s.iri, ofi: x.ref.iri, dif: x.s.iri - x.ref.iri, d: x.ref.dist })), { limite: 100 });
}

function paraCsv(s) {
  return csv(["segmento", "lat_ini", "lon_ini", "lat_fim", "lon_fim", "dist_m", "vel_kmh", "rms_ms2", "iri_estimado", "classe_dnit", "valido", "impactos", "iri_oficial", "rodovia_oficial"],
    s.segs.map((x, i) => { const r = x.valido ? maisProximo(meio(x)) : null;
      return [i + 1, ...x.pts[0], ...x.pts.at(-1), x.d, x.v, x.rms, x.iri, x.iri != null ? classe(x.iri).rot : "", x.valido ? "sim" : "nao", x.bur, r?.iri ?? "", r?.cod ?? ""]; }));
}
function paraGeo(s) {
  return { type: "FeatureCollection",
    _meta: { fonte: "IRI pelo celular, DMOB Hub", gerado_em: new Date().toISOString(), metodologia: `IRI = ${s.coef.a}·RMS + ${s.coef.b} (RMS da aceleração vertical, m/s², segmentos de ${SEG_M} m). Coeficientes padrão: Yeganeh et al. 2019, arXiv:1902.10699. Classes DNIT IPR-720/2006. Estimativa indicativa, não substitui perfilômetro.`, simulacao: !!s.sim },
    features: [
      ...s.segs.map((x, i) => ({ type: "Feature", geometry: { type: "LineString", coordinates: x.pts.map(p => [p[1], p[0]]) },
        properties: { segmento: i + 1, dist_m: x.d, vel_kmh: x.v, rms_ms2: x.rms, iri: x.iri, classe: x.iri != null ? classe(x.iri).rot : null, valido: x.valido, impactos: x.bur } })),
      ...s.buracos.map(b => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.p[1], b.p[0]] }, properties: { tipo: "impacto", pico_ms2: b.pico, hora: b.t } })),
    ] };
}

// verificação rápida da matemática (abrir com #/campo-iri?teste e ver o console)
export function autoteste() {
  const ok = (c, m) => { if (!c) throw new Error("autoteste IRI: " + m); };
  ok(Math.abs(estimar(0.1, COEF_PADRAO) - 2.149) < 1e-9, "eq. 3 de Yeganeh (RMS 0,1 → 2,1)");
  ok(classe(2.7).rot === "Bom" && classe(2.71).rot === "Regular" && classe(4.6).rot === "Ruim" && classe(5).rot === "Péssimo", "classes DNIT");
  const f = ajustar([[0.1, 2.149], [0.3, 2.987], [0.5, 3.825]]);
  ok(Math.abs(f.a - 4.19) < 1e-9 && Math.abs(f.b - 1.73) < 1e-9 && f.r2 > 0.999, "mínimos quadrados");
  ok(Math.abs(dist([-3, -60], [-3.001, -60]) - 111.2) < 0.5, "haversine");
  const G = novaGravacao(COEF_PADRAO, 4, true);  // gravidade inclinada sem vibração: RMS ~0
  posicao(G, [-3, -60], 15, 5, 0);
  for (let j = 0; j < 500; j++) amostra(G, [0, 4.9, 8.5], null, j * 20);
  ok(Math.sqrt(G.seg.s2 / G.seg.n) < 0.05, "remoção da gravidade");
  console.log("autoteste IRI: ok");
  return true;
}

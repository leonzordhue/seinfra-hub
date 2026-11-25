// Acessibilidade rodoviária das sedes municipais do AM: tempo por estrada até Manaus, hospital e terminal. [Claude] 23/11/2026
// Fonte: data/acesso.json e data/acesso_isocronas.geojson (pipelines/acesso/acesso.py, mensal no GitHub Actions:
// OpenStreetMap + OSRM perfil car, CNES, IBGE Censo 2022). Métodos e limitações vêm do _meta e aparecem no painel.
// Sem ligação rodoviária é informação (município só fluvial/aéreo), não erro.
import { talvez, contratos, municipios } from "../dados.js";
import { esc, num, pct, data, semAcento, plural } from "../fmt.js";
import { $, kpi, chip, tabela, fonte, opcoes, grafico, css } from "../ui.js";

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/";
const AM = [-3.4653, -62.2159];
// faixas de tempo até Manaus (min). Paleta sequencial de uma cor (azul): mais perto = mais forte.
// As cores dependem do tema e são preenchidas em render() por pintarFaixas().
const FAIXAS = [{ ate: 60, rot: "até 1 h" }, { ate: 120, rot: "1 a 2 h" }, { ate: 240, rot: "2 a 4 h" }, { ate: Infinity, rot: "mais de 4 h" }];
const SEM = { rot: "sem ligação rodoviária" };
const ehEscuro = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function pintarFaixas() {
  const azul = ehEscuro() ? ["#B3CCF8", "#6FA0F0", "#3A6DB8", "#2A4570"] : ["#002D72", "#2F62AE", "#7FA3D6", "#C9D8EE"];
  FAIXAS.forEach((f, i) => { f.cor = azul[i]; });
  SEM.cor = ehEscuro() ? "#55606F" : "#A3ACB8";  // cinza neutro, fora da escala
}
const estado = { lig: "", q: "", origem: "Manaus", base: "mapa", iso: true, rot: true, alv: false, rio: true, aer: true, sel: "" };
let mapa = null, selecionar = () => {};

const faixa = m => m.tempo_manaus_min == null ? SEM : FAIXAS.find(f => m.tempo_manaus_min <= f.ate);
// horas (float) de barco: acima de 24 h vira dias
const hd = h => h == null ? "—" : h >= 24 ? `${num(h / 24, 1)} dias` : hm(Math.round(h * 60));
const hm = v => v == null ? "—" : v < 60 ? `${num(v)} min` : `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, "0")}`;
const ligTxt = m => !m.ligacao_rodoviaria ? chip("Só fluvial / aéreo", "", "Sem rota por estrada até Manaus na malha do OSM")
  : m.travessia_balsa ? chip("Estrada + balsa", "alerta", "A rota usa travessia de balsa (espera não incluída)") : chip("Estrada", "ok");

function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!document.querySelector(`link[href="${LEAFLET}leaflet.css"]`))
    document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${LEAFLET}leaflet.css">`);
  return new Promise((ok, erro) => {
    const s = document.createElement("script");
    s.src = `${LEAFLET}leaflet.js`; s.onload = () => ok(window.L); s.onerror = () => erro(new Error("Leaflet não carregou"));
    document.head.appendChild(s);
  });
}

const ESTILO = `<style>
  .mapa-acesso { height: 560px; border-radius: var(--raio); border: 1px solid var(--borda); background: var(--sup-2); }
  @media (max-width: 640px) { .mapa-acesso { height: 420px; } }
  .mapa-acesso .leaflet-popup-content { font-family: var(--f-corpo); font-size: 13px; line-height: 1.45; }
  .leg-circ i { border-radius: 50% !important; }
  .ac-leg { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin-top: 10px; font-size: 12.5px; color: var(--tinta-2); }
  .ac-leg .rampa { display: inline-flex; gap: 1px; border-radius: 2px; overflow: hidden; vertical-align: middle; }
  .ac-leg .rampa i { width: 34px; height: 10px; }
  .ac-leg .rot-r { display: inline-flex; gap: 1px; }
  .ac-leg .rot-r span { width: 34px; text-align: center; font-size: 12px; color: var(--tinta-3); }
  .ac-leg b { font-weight: 600; color: var(--tinta); margin-right: 4px; }
  .ac-leg .pt { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: -1px; margin-right: 5px; }
  .ac-graf { position: relative; height: 196px; }
  .ac-wrap { position: relative; }
  .ac-painel { position: absolute; top: 10px; right: 10px; z-index: 500; display: grid; gap: 6px; padding: 10px 12px;
    background: var(--sup); border: 1px solid var(--borda); border-radius: var(--raio); box-shadow: var(--sombra); font-size: 13px; color: var(--tinta-2); }
  .ac-painel label { display: flex; align-items: center; gap: 6px; cursor: pointer; min-height: 28px; }
  .ac-painel .seg button { padding: 4px 10px; font-size: 12.5px; }
  .ac-card { position: absolute; left: 10px; bottom: 10px; z-index: 500; width: min(340px, calc(100% - 20px)); padding: 12px 14px 10px;
    background: var(--sup); border: 1px solid var(--borda); border-radius: var(--raio); box-shadow: var(--sombra); font-size: 13px; }
  .ac-card h3 { margin: 0 28px 2px 0; font-size: 1.05rem; color: var(--tinta); }
  .ac-card .sub { margin: 0 0 8px; color: var(--tinta-3); font-size: 12.5px; }
  .ac-card ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
  .ac-card li { display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: baseline; color: var(--tinta-2); }
  .ac-card li i { width: 14px; height: 4px; border-radius: 2px; align-self: center; }
  .ac-card li b { color: var(--tinta); font-weight: 600; white-space: nowrap; }
  .ac-card li small { display: block; color: var(--tinta-3); font-size: 12px; }
  .ac-card .fechar { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; border: 0; background: none; color: var(--tinta-3); font-size: 20px; cursor: pointer; border-radius: 6px; }
  .ac-card .fechar:hover { background: var(--sup-2); }
  @media (max-width: 640px) { .ac-painel { position: static; margin-bottom: 8px; grid-auto-flow: column; overflow-x: auto; }
    .ac-card { position: static; width: auto; margin-top: 8px; } }
  .ac-leg .ln { display: inline-block; width: 22px; height: 4px; border-radius: 2px; vertical-align: 3px; margin: 0 4px 0 10px; }
  .ac-leg .ln.rio { background: repeating-linear-gradient(90deg, var(--ac-rio) 0 8px, transparent 8px 11px); }
  .ac-leg .ln.aer { background: repeating-linear-gradient(90deg, var(--ac-aer) 0 3px, transparent 3px 6px); }
  .ac-wrap, .ac-leg { --ac-rio: #0A7DB0; --ac-aer: #7A4FB5; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) :is(.ac-wrap, .ac-leg) { --ac-rio: #5CC8F0; --ac-aer: #C3A6F2; } }
  :root[data-theme="dark"] :is(.ac-wrap, .ac-leg) { --ac-rio: #5CC8F0; --ac-aer: #C3A6F2; }
  .ac-leg .ln.balsa { background: repeating-linear-gradient(90deg, var(--ouro) 0 5px, transparent 5px 9px); }
  .ac-alvo { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--sup); border: 2px solid currentColor; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
  .ac-alvo svg { width: 12px; height: 12px; }
  .ac-rot { font: 600 12px var(--f-corpo); color: var(--tinta); background: var(--sup); border: 1px solid var(--borda); box-shadow: none; padding: 2px 6px; }
  .ac-rot::before { display: none; }
  .leaflet-layer.tile-sat-clara { filter: brightness(1.18) contrast(1.06) saturate(1.12); }
</style>`;

export async function render(el) {
  if (mapa) { mapa.remove(); mapa = null; }
  const d = await talvez("acesso");
  if (!d) {
    el.innerHTML = `<div class="cab"><div><h1>Acessibilidade rodoviária</h1></div></div><div class="aviso">Os dados ainda não foram gerados. O robô <b>Acessibilidade rodoviária (mensal)</b> (<code>pipelines/acesso/acesso.py</code>) baixa a malha do OpenStreetMap, sobe o OSRM no GitHub Actions e publica <code>data/acesso.json</code> no dia 5 de cada mês.</div>`;
    return;
  }
  pintarFaixas();
  const M = d._meta, R = d.resumo, mun = d.municipios;
  const sem = mun.filter(m => !m.ligacao_rodoviaria);
  const pt = R.pop_total || 1;
  const p2 = R.pop_manaus_ate_min["120"], p4 = R.pop_manaus_ate_min["240"];

  el.innerHTML = `${ESTILO}
    <div class="cab"><div><h1>Acessibilidade rodoviária</h1>
      <p>Quanto tempo se leva por estrada de cada sede municipal até Manaus, até o hospital mais próximo e até o terminal flutuante mais próximo. Mostra também quem não tem ligação por estrada com a capital: nesses municípios o acesso é só fluvial ou aéreo.</p></div>
      <div class="fontes">${fonte("calculado em", data(M.gerado_em))}${fonte("população", `IBGE Censo ${R.ano_pop}`)}${fonte("roteamento", "OSM + OSRM")}</div></div>
    <div class="grade g-kpi">
      ${kpi("Sedes ligadas a Manaus por estrada", `${num(R.com_ligacao)} de ${num(R.municipios)}`, `${num(R.com_ligacao_via_balsa)} dependem de balsa`, true)}
      ${kpi("Só fluvial / aéreo", plural(sem.length, "município", "municípios"), `${num(R.pop_sem_ligacao)} pessoas (${pct(R.pop_sem_ligacao / pt * 100, 0)})`)}
      ${kpi("Pessoas a até 2 h de Manaus", num(p2), `${pct(p2 / pt * 100, 0)} do AM · até 4 h: ${pct(p4 / pt * 100, 0)}`)}
      ${kpi("Pessoas a até 2 h de hospital", num(R.pop_hospital_ate_120), `${pct(R.pop_hospital_ate_120 / pt * 100, 0)} do AM, por estrada a partir da sede`)}
    </div>
    <div class="aviso secao"><b>Como ler:</b> a população é a do município inteiro, atribuída ao tempo da sede; quem mora em comunidade ou zona rural pode estar bem mais longe. Tempo de fluxo livre, sem espera de balsa e sem considerar estrada intransitável na cheia.</div>

    <section class="secao cartao"><header><div><h2>Mapa de acessibilidade</h2><p>Escolha um município (no mapa, na lista ou na tabela) para ver o caminho por estrada, pelo rio e de avião até Manaus, e até o hospital e o terminal flutuante mais próximos. A mancha azul é a área alcançável em 1, 2 e 4 horas.</p></div></header>
        <div class="corpo">
          <div class="filtros">
            <select id="fMun" aria-label="Ver o caminho de um município"><option value="">Ver o caminho de um município…</option>${[...mun].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(m => `<option value="${esc(m.cod)}">${esc(m.nome)}</option>`).join("")}</select>
            <div class="seg" id="fOrig" role="group" aria-label="Origem das isócronas">
              <button type="button" data-v="Manaus" aria-pressed="${estado.origem === "Manaus"}">Isócronas a partir de Manaus</button>
              <button type="button" data-v="Sede municipal mais próxima" aria-pressed="${estado.origem !== "Manaus"}">A partir da sede mais próxima</button></div></div>
          <div class="ac-wrap">
            <div id="mapa" class="mapa-acesso" role="region" aria-label="Mapa do Amazonas com rotas por estrada, isócronas e sedes municipais. Os mesmos dados estão na tabela abaixo."></div>
            <div class="ac-painel" role="group" aria-label="Camadas do mapa">
              <div class="seg" id="fBase" role="group" aria-label="Fundo do mapa">
                <button type="button" data-v="mapa" aria-pressed="${estado.base === "mapa"}">Mapa</button>
                <button type="button" data-v="sat" aria-pressed="${estado.base === "sat"}">Satélite</button></div>
              <label><input type="checkbox" id="cIso" ${estado.iso ? "checked" : ""}> Isócronas</label>
              <label><input type="checkbox" id="cRot" ${estado.rot ? "checked" : ""}> Rotas até Manaus</label>
              <label><input type="checkbox" id="cRio" ${estado.rio ? "checked" : ""}> Rotas pelo rio</label>
              <label><input type="checkbox" id="cAer" ${estado.aer ? "checked" : ""}> Aeródromos e voos</label>
              <label><input type="checkbox" id="cAlv" ${estado.alv ? "checked" : ""}> Hospitais e terminais</label>
            </div>
            <div class="ac-card" id="acCard" aria-live="polite" hidden></div>
          </div>
          <div class="ac-leg"><span><b>Tempo até Manaus</b></span>
            <span><span class="rampa">${FAIXAS.map(f => `<i style="background:${f.cor}"></i>`).join("")}</span><br><span class="rot-r">${["1 h", "2 h", "4 h", "+4 h"].map(t => `<span>${t}</span>`).join("")}</span></span>
            <span><i class="pt" style="background:${SEM.cor}"></i>Sede sem ligação rodoviária</span>
            <span><b>Caminho</b><i class="ln" style="background:var(--ouro)"></i>até Manaus <i class="ln" style="background:var(--critico)"></i>até hospital <i class="ln" style="background:var(--ok)"></i>até terminal <i class="ln balsa"></i>balsa <i class="ln rio"></i>pelo rio <i class="ln aer"></i>voo regular</span></div>
        </div></section>
    <section class="secao cartao"><header><div><h2>${pct(p4 / pt * 100, 0)} da população está a até 4 h de Manaus por estrada</h2><p>População dos municípios pela faixa de tempo da sede até Manaus (pessoas e % do AM). Entre parênteses, número de municípios.</p></div></header>
      <div class="corpo"><div class="ac-graf"><canvas id="gFaixa" role="img" aria-label="População por faixa de tempo até Manaus"></canvas></div>
        <p class="peq" style="margin:8px 0 0;font-size:12.5px;color:var(--tinta-3)">Fonte: IBGE Censo ${esc(String(R.ano_pop))}; tempo OSRM sobre OpenStreetMap, fluxo livre.</p></div></section>

    <section class="secao cartao"><header><div><h2>Municípios</h2><p>Clique no cabeçalho para ordenar.</p></div><span class="contagem" id="cont"></span></header>
      <div class="corpo">
        <div class="filtros">
          <select id="fLig" aria-label="Ligação">${opcoes(["Estrada", "Estrada + balsa", "Só fluvial / aéreo"], estado.lig, "Todas as ligações")}</select>
          <input type="search" id="fQ" placeholder="Buscar município, hospital, terminal…" aria-label="Buscar">
        </div>
        <div id="tab"></div></div></section>

    <section class="secao cartao"><header><div><h2>Ganho com obra</h2><p>Contratos ativos de rodovia, ramal ou ponte (e-Obras) por município e o que a obra pode mudar no acesso. Leitura qualitativa: o ganho em minutos não foi simulado.</p></div></header>
      <div class="corpo" id="obras"></div></section>

    <details class="secao cartao"><summary style="padding:14px 16px;cursor:pointer;font-weight:500;color:var(--tinta)">Métodos, fontes e limitações</summary>
      <div class="corpo"><dl class="ficha">
        ${Object.entries(M.metodologia).map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(v)}</dd>`).join("")}
        <dt>limitações</dt><dd><ul style="margin:0;padding-left:18px">${M.limitacoes.map(l => `<li>${esc(l)}</li>`).join("")}</ul></dd>
        <dt>fontes</dt><dd>${esc(M.fonte)}.<br>${Object.entries(M.url).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(" · ")}</dd>
        <dt>servidor</dt><dd>${esc(M.servidor_osrm)}${M.balsas_longas_removidas != null ? ` · ${num(M.balsas_longas_removidas)} linhas fluviais longas retiradas da malha` : ""} · grade de ${num(R.celulas_grade)} células · ${num(R.hospitais)} hospitais · ${num(R.terminais)} terminais</dd>
      </dl></div></details>`;

  // gráfico população por faixa
  const grupos = [...FAIXAS, SEM].map(f => ({ ...f, pop: mun.filter(m => faixa(m) === f).reduce((s, m) => s + (m.pop || 0), 0), n: mun.filter(m => faixa(m) === f).length }));
  // barra horizontal com rótulo na ponta (plugin "rotulos" do ui.js esconde o eixo de valores)
  grafico($("#gFaixa", el), { type: "bar", data: { labels: grupos.map(g => `${g.rot === SEM.rot ? "sem estrada" : g.rot} (${g.n})`), datasets: [{ label: "Pessoas", data: grupos.map(g => g.pop),
    backgroundColor: grupos.map(g => g.cor), maxBarThickness: 22 }] },
    options: { indexAxis: "y", layout: { padding: { right: innerWidth < 600 ? 104 : 120 } },
      plugins: { rotulos: { fmt: v => `${num(v)} · ${pct(v / pt * 100, 0)}` }, legend: { display: false }, tooltip: { callbacks: { label: c => `${num(c.raw)} pessoas (${pct(c.raw / pt * 100, 1)})` } } } } });

  // tabela
  const lig = m => !m.ligacao_rodoviaria ? "Só fluvial / aéreo" : m.travessia_balsa ? "Estrada + balsa" : "Estrada";
  const alvo = a => !a ? "—" : a.min == null ? `${esc(a.nome)}<div class="peq">sem estrada · ${num(a.km_linha_reta, 1)} km em linha reta</div>`
    : `${esc(a.nome)}<div class="peq">${hm(a.min)} · ${num(a.km, 1)} km${a.estimado ? " · estimado" : ""}${a.tipo ? ` · ${esc(a.tipo)}` : ""}</div>`;
  const pinta = () => {
    const q = semAcento(estado.q);
    const fl = mun.filter(m => (!estado.lig || lig(m) === estado.lig) &&
      (!q || semAcento(`${m.nome} ${m.hospital_mais_proximo?.nome} ${m.terminal_mais_proximo?.nome}`).includes(q)));
    $("#cont", el).textContent = `${num(fl.length)} municípios`;
    tabela($("#tab", el), [
      { k: "nome", rot: "Município", html: m => `<b style="color:var(--tinta)">${esc(m.nome)}</b>` },
      { k: "pop", rot: "População", n: 1, html: m => num(m.pop) },
      { k: "lig", rot: "Ligação com Manaus", v: lig, html: ligTxt },
      { k: "tempo_manaus_min", rot: "Tempo até Manaus", n: 1, v: m => m.tempo_manaus_min ?? 1e9,
        html: m => m.tempo_manaus_min == null ? `—<div class="peq">${num(m.km_linha_reta_manaus)} km em linha reta</div>` : `${hm(m.tempo_manaus_min)}<div class="peq">${num(m.km_manaus)} km</div>` },
      { k: "rio", rot: "Rio e avião até Manaus", n: 1, v: m => m.fluvial?.na_malha ? m.fluvial.km : 1e9,
        html: m => m.nome === "Manaus" || (!m.fluvial && !m.aereo) ? "—" : `${m.fluvial?.na_malha ? `${num(m.fluvial.km)} km de rio · ~${hd(m.fluvial.h_barco)} de barco` : "fora da malha fluvial"}` +
          `<div class="peq">${!m.aereo ? "sem aeródromo público" : `${esc(m.aereo.oaci)} · ${m.aereo.voo_regular ? `voo regular${m.aereo.tempo_voo_min ? `, ${hm(m.aereo.tempo_voo_min)}` : ""}` : "sem voo regular"}`}</div>` },
      { k: "hosp", rot: "Hospital mais próximo", n: 1, v: m => m.hospital_mais_proximo?.min ?? 1e9, html: m => alvo(m.hospital_mais_proximo) },
      { k: "term", rot: "Terminal flutuante mais próximo", n: 1, v: m => m.terminal_mais_proximo?.min ?? 1e9, html: m => alvo(m.terminal_mais_proximo) },
    ], fl, { ordem: { k: "tempo_manaus_min", dir: 1 }, onLinha: m => { selecionar(m); $("#mapa", el)?.scrollIntoView({ behavior: "smooth", block: "center" }); } });
  };
  $("#fLig", el).onchange = e => { estado.lig = e.target.value; pinta(); };
  $("#fQ", el).oninput = e => { estado.q = e.target.value; pinta(); };
  pinta();

  ganhoObra($("#obras", el), mun);
  desenharMapa(el, mun, R).catch(e => { $("#mapa", el).innerHTML = `<div class="aviso" style="margin:12px">Mapa indisponível: ${esc(e.message)}. A tabela abaixo tem os mesmos dados.</div>`; });
}



// Ícones dos alvos (traço da casa, sem emoji): cruz do hospital e âncora do terminal flutuante.
const ICONE = {
  Hospital: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 1h3v3.5H11v3H7.5V11h-3V7.5H1v-3h3.5z" fill="currentColor"/></svg>`,
  Aviao: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8c.5 0 .8.5.8 1.1v3l4.2 2.3v1.2L6.8 7.2v2.2l1.3 1v.9L6 10.7l-2.1.6v-.9l1.3-1V7.2L1 8.4V7.2l4.2-2.3v-3C5.2 1.3 5.5.8 6 .8z" fill="currentColor"/></svg>`,
  Terminal: `<svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="2.4" r="1.3"/><path d="M6 3.7V11M3.4 5.6h5.2M1.6 7.4C2 9.6 3.8 11 6 11s4-1.4 4.4-3.6"/></svg>`,
};

async function desenharMapa(el, mun, R = {}) {
  const L = await carregarLeaflet();
  const box = $("#mapa", el);
  if (!box?.isConnected) return;   // usuário já saiu da rota
  const escuro = ehEscuro();
  mapa = L.map(box, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView(AM, 6);
  // o desenho vetorial do Leaflet vira "imagem sem nome" para o leitor de tela; os dados estão na tabela e no cartão
  new MutationObserver(() => box.querySelectorAll("svg:not([aria-hidden])").forEach(s => s.setAttribute("aria-hidden", "true"))).observe(box, { childList: true, subtree: true });
  mapa.createPane("iso").style.zIndex = 350;
  mapa.createPane("rotas").style.zIndex = 420;
  mapa.createPane("sel").style.zIndex = 440;
  mapa.createPane("sedes").style.zIndex = 460;

  // Fundos (Esri, sem chave): "Mapa" mostra rios, lagos e relevo (topográfico; cinza escuro no tema escuro);
  // "Satélite" é o mesmo da v1 (imagem clareada + limites e nomes).
  const esri = (s, o = {}) => L.tileLayer(`https://{s}.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
    { subdomains: ["server", "services"], maxZoom: 18, keepBuffer: 3, updateWhenZooming: false, ...o });
  const ATR = "Fundo: Esri, HERE, Garmin, USGS, &copy; colaboradores do OpenStreetMap · Rotas: OSRM sobre OSM";
  const bases = {
    mapa: escuro ? L.layerGroup([esri("Canvas/World_Dark_Gray_Base", { attribution: ATR }), esri("Canvas/World_Dark_Gray_Reference")])
      : esri("World_Topo_Map", { attribution: ATR }),
    sat: L.layerGroup([esri("World_Imagery", { className: "tile-sat-clara", attribution: ATR }), esri("Reference/World_Boundaries_and_Places")]),
  };
  bases[estado.base].addTo(mapa);
  el.querySelectorAll("#fBase button").forEach(b => b.onclick = () => {
    bases[estado.base].remove(); estado.base = b.dataset.v; bases[estado.base].addTo(mapa);
    el.querySelectorAll("#fBase button").forEach(x => x.setAttribute("aria-pressed", x === b));
  });

  const [geo, rotas] = await Promise.all(["acesso_isocronas", "acesso_rotas"].map(n =>
    fetch(`../data/${n}.geojson`, { cache: "no-cache" }).then(x => x.ok ? x.json() : null).catch(() => null)));
  if (!box.isConnected) return;

  // isócronas
  const corIso = { 60: FAIXAS[0].cor, 120: FAIXAS[1].cor, 240: FAIXAS[2].cor };
  let camIso = null;
  const pintaIso = () => {
    camIso?.remove(); camIso = null;
    if (!geo || !estado.iso) return;
    const fs = geo.features.filter(f => f.properties.origem === estado.origem).sort((a, b) => b.properties.ate_min - a.properties.ate_min);
    camIso = L.geoJSON({ type: "FeatureCollection", features: fs }, { pane: "iso",
      style: f => ({ color: corIso[f.properties.ate_min], weight: 0.8, opacity: estado.sel ? 0.25 : 0.6, fillColor: corIso[f.properties.ate_min], fillOpacity: estado.sel ? 0.06 : 0.2 }),
      onEachFeature: (f, l) => l.bindTooltip(`Até ${hm(f.properties.ate_min)} ${f.properties.origem === "Manaus" ? "de Manaus" : "da sede mais próxima"}`, { sticky: true }),
    }).addTo(mapa);
  };
  pintaIso();
  el.querySelectorAll("#fOrig button").forEach(b => b.onclick = () => {
    estado.origem = b.dataset.v;
    el.querySelectorAll("#fOrig button").forEach(x => x.setAttribute("aria-pressed", x === b));
    pintaIso();
  });

  // todas as rotas até Manaus: linha com contorno, cor = faixa de tempo da sede de origem
  const porCod = new Map(mun.map(m => [m.cod, m]));
  const fundo = escuro ? "#0E1626" : "#FFFFFF";
  const ouro = css("--ouro") || "#F5A623", cor = { Manaus: ouro, Hospital: css("--critico") || "#C0392B", Terminal: css("--ok") || "#1B7F4C" };
  // linha um tom mais forte que a faixa: as cores claras da rampa (+4 h) somem sobre o fundo topográfico
  const wrap = $(".ac-wrap", el), corRio = getComputedStyle(wrap).getPropertyValue("--ac-rio").trim() || "#0A7DB0",
    corAer = getComputedStyle(wrap).getPropertyValue("--ac-aer").trim() || "#7A4FB5";
  cor["Manaus pelo rio"] = corRio;
  const corLinha = m => (escuro ? ["#B3CCF8", "#8DB2F2", "#6FA0F0", "#5A8BD8"] : ["#002D72", "#1F4F99", "#3D6DB5", "#5B85C4"])[FAIXAS.indexOf(faixa(m))] || SEM.cor;
  const camRot = L.layerGroup();
  const rotasDe = cod => (rotas?.features || []).filter(f => f.properties.cod === cod);
  const linha = c => c.map(([x, y]) => [y, x]);
  (rotas?.features || []).filter(f => f.properties.destino === "Manaus").forEach(f => {
    const m = porCod.get(f.properties.cod), ll = linha(f.geometry.coordinates);
    if (!m) return;
    L.polyline(ll, { pane: "rotas", color: fundo, weight: 5, opacity: 0.85, interactive: false }).addTo(camRot);
    L.polyline(ll, { pane: "rotas", color: corLinha(m), weight: 3, opacity: 0.95 })
      .bindTooltip(`${esc(m.nome)} → Manaus · ${hm(m.tempo_manaus_min)}`, { sticky: true }).on("click", () => selecionar(m)).addTo(camRot);
    f.properties.balsas.forEach(b => L.polyline(linha(b), { pane: "rotas", color: ouro, weight: 2.6, dashArray: "4 5", interactive: false }).addTo(camRot));
  });
  const cRot = $("#cRot", el);
  if (!rotas) { cRot.disabled = true; cRot.parentElement.title = "O traçado das rotas sai na próxima rodada do robô"; cRot.parentElement.style.opacity = .55; }
  const pintaRot = () => { estado.rot && rotas ? camRot.addTo(mapa) : camRot.remove(); };
  pintaRot();

  // hospitais e terminais mais próximos de cada sede (coordenada vem do robô a partir de 25/11/2026)
  const camAlv = L.layerGroup(), vistos = new Set();
  const iconeAlvo = (tipo, grande) => L.divIcon({ className: "", iconSize: grande ? [26, 26] : [22, 22],
    html: `<span class="ac-alvo" style="color:${cor[tipo]}${grande ? ";width:26px;height:26px" : ""}">${ICONE[tipo]}</span>` });
  mun.forEach(m => [["Hospital", m.hospital_mais_proximo], ["Terminal", m.terminal_mais_proximo]].forEach(([tipo, a]) => {
    const k = `${tipo}|${a?.nome}|${a?.lat}`;
    if (a?.lat == null || vistos.has(k)) return;
    vistos.add(k);
    L.marker([a.lat, a.lon], { pane: "sedes", icon: iconeAlvo(tipo), keyboard: false }).bindTooltip(`${tipo === "Hospital" ? "Hospital" : "Terminal flutuante"}: ${esc(a.nome)}`).addTo(camAlv);
  }));
  const cAlv = $("#cAlv", el);
  if (!vistos.size) { cAlv.disabled = true; cAlv.parentElement.title = "A localização sai na próxima rodada do robô"; cAlv.parentElement.style.opacity = .55; }
  const pintaAlv = () => { estado.alv && vistos.size ? camAlv.addTo(mapa) : camAlv.remove(); };
  pintaAlv();

  // rio: menor caminho na malha hidroviária do SNV (DNIT); o trecho sede→rio fora da malha vai pontilhado
  const camRio = L.layerGroup(), rioDe = new Map();
  (rotas?.features || []).filter(f => f.properties.destino === "Manaus pelo rio").forEach(f => {
    const m = porCod.get(f.properties.cod);
    if (!m) return;
    rioDe.set(m.cod, f);
    L.polyline(linha(f.geometry.coordinates), { pane: "rotas", color: corRio, weight: 2, opacity: 0.75, dashArray: "8 4" })
      .bindTooltip(`${esc(m.nome)} → Manaus pelo rio · ${num(f.properties.km)} km`, { sticky: true }).on("click", () => selecionar(m)).addTo(camRio);
  });
  const cRio = $("#cRio", el);
  if (!rioDe.size) { cRio.disabled = true; cRio.parentElement.title = "O traçado pelo rio sai na próxima rodada do robô"; cRio.parentElement.style.opacity = .55; }
  const pintaRio = () => { estado.rio && rioDe.size ? camRio.addTo(mapa) : camRio.remove(); };
  pintaRio();

  // avião: aeródromo público (ANAC) de cada sede; arco até Manaus (SBEG) quando há voo regular
  const SBEG = R.aeroporto_manaus ? [R.aeroporto_manaus.lat, R.aeroporto_manaus.lon] : [-3.0411, -60.0506];
  const arco = (a, b) => {   // curva de Bézier quadrática: distingue o voo da estrada e do rio
    const [y1, x1] = a, [y2, x2] = b, k = 0.18, cy = (y1 + y2) / 2 + (x2 - x1) * k, cx = (x1 + x2) / 2 - (y2 - y1) * k;
    return Array.from({ length: 33 }, (_, i) => { const t = i / 32, u = 1 - t; return [u * u * y1 + 2 * u * t * cy + t * t * y2, u * u * x1 + 2 * u * t * cx + t * t * x2]; });
  };
  const iconeAer = grande => L.divIcon({ className: "", iconSize: grande ? [26, 26] : [20, 20],
    html: `<span class="ac-alvo" style="color:${corAer};width:${grande ? 26 : 20}px;height:${grande ? 26 : 20}px">${ICONE.Aviao}</span>` });
  const vooTxt = a => a.voo_regular ? `voo regular · ${num(a.voos_semana, 1)} por semana${a.tempo_voo_min ? ` · ${hm(a.tempo_voo_min)} de voo` : ""}` : "sem voo regular (pista pública)";
  const camAer = L.layerGroup(), aeroVistos = new Set();
  mun.forEach(m => {
    const a = m.aereo;
    if (!a || aeroVistos.has(a.oaci)) return;
    aeroVistos.add(a.oaci);
    if (a.voo_regular) L.polyline(arco([a.lat, a.lon], SBEG), { pane: "rotas", color: corAer, weight: 1.6, opacity: 0.8, dashArray: "2 5", interactive: false }).addTo(camAer);
    L.marker([a.lat, a.lon], { pane: "sedes", icon: iconeAer(), keyboard: false })
      .bindTooltip(`${esc(a.nome)} (${esc(a.oaci)}) · ${vooTxt(a)}`).on("click", () => selecionar(m)).addTo(camAer);
  });
  if (aeroVistos.size) L.marker(SBEG, { pane: "sedes", icon: iconeAer(), keyboard: false }).bindTooltip("Aeroporto Eduardo Gomes (SBEG), Manaus").addTo(camAer);
  const cAer = $("#cAer", el);
  if (!aeroVistos.size) { cAer.disabled = true; cAer.parentElement.title = "Os aeródromos saem na próxima rodada do robô"; cAer.parentElement.style.opacity = .55; }
  const pintaAer = () => { estado.aer && aeroVistos.size ? camAer.addTo(mapa) : camAer.remove(); };
  pintaAer();
  cRio.onchange = e => { estado.rio = e.target.checked; pintaRio(); };
  cAer.onchange = e => { estado.aer = e.target.checked; pintaAer(); };

  $("#cIso", el).onchange = e => { estado.iso = e.target.checked; pintaIso(); };
  cRot.onchange = e => { estado.rot = e.target.checked; pintaRot(); };
  cAlv.onchange = e => { estado.alv = e.target.checked; pintaAlv(); };

  // sedes
  const borda = css("--tinta-2") || "#33415A";  // contorno escuro: a faixa mais clara some no fundo claro sem ele
  mun.forEach(m => {
    const mk = L.circleMarker([m.lat, m.lon], { pane: "sedes", radius: m.nome === "Manaus" ? 8 : 5.5, color: borda, weight: 1, fillColor: faixa(m).cor, fillOpacity: 1 })
      .bindTooltip(`${esc(m.nome)} · ${m.ligacao_rodoviaria ? hm(m.tempo_manaus_min) + " até Manaus" : "só fluvial / aéreo"}`).on("click", () => selecionar(m)).addTo(mapa);
    if (m.nome === "Manaus") mk.bindTooltip("Manaus", { permanent: true, direction: "right", offset: [8, 0], className: "ac-rot" });
  });

  // município escolhido: caminho desenhado do início ao fim, alvos marcados e cartão com os tempos
  const camSel = L.layerGroup().addTo(mapa), card = $("#acCard", el), fMun = $("#fMun", el);
  const semMov = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desenhar = pl => {   // traço que "anda" da sede até o destino
    const p = pl.getElement?.();
    if (!p || semMov) return;
    const n = p.getTotalLength();
    p.style.strokeDasharray = n; p.style.strokeDashoffset = n;
    p.getBoundingClientRect();
    p.style.transition = "stroke-dashoffset 1.4s ease-out"; p.style.strokeDashoffset = 0;
    p.addEventListener("transitionend", () => { p.style.strokeDasharray = ""; p.style.transition = ""; }, { once: true });
  };
  const linhaCard = (tipo, rot, a) => `<li><i style="background:${cor[tipo]}"></i><span>${rot}${a?.nome && tipo !== "Manaus" ? `<small>${esc(a.nome)}</small>` : ""}</span>` +
    `<span>${a?.min != null ? `<b>${hm(a.min)}</b><small>${num(a.km, 1)} km${a.estimado ? " · estimado" : ""}</small>` : `<b>sem estrada</b>${a?.km_linha_reta != null ? `<small>${num(a.km_linha_reta, 1)} km em linha reta</small>` : ""}`}</span></li>`;
  const linhaRio = f => !f ? "" : `<li><i style="background:${corRio}"></i><span>Pelo rio até Manaus<small>${f.na_malha ? `${num(f.km)} km pela malha do DNIT` : "fora da malha hidroviária mapeada"}</small></span>` +
    (f.na_malha ? `<span><b>~${hd(f.h_barco)}</b><small>barco · lancha ~${hd(f.h_lancha)}</small></span>` : `<span><b>—</b></span>`) + `</li>`;
  const linhaAer = a => `<li><i style="background:${corAer}"></i><span>Avião${a ? `<small>${esc(a.nome)} (${esc(a.oaci)})</small>` : ""}</span>` +
    (!a ? `<span><b>sem aeródromo público</b></span>` : a.voo_regular ? `<span><b>${a.tempo_voo_min ? hm(a.tempo_voo_min) : "voo regular"}</b><small>${num(a.voos_semana, 1)} voo(s)/semana</small></span>`
      : `<span><b>sem voo regular</b><small>${num(a.km_reta)} km em linha reta</small></span>`) + `</li>`;
  const limpar = () => {
    camSel.clearLayers(); card.hidden = true; estado.sel = ""; fMun.value = "";
    camRot.eachLayer(l => l.options.interactive !== false && l.setStyle({ opacity: 0.95 }));
    camRio.eachLayer(l => l.setStyle({ opacity: 0.75 }));
    pintaIso();
  };
  selecionar = m => {
    if (!m) return limpar();
    camSel.clearLayers(); estado.sel = m.cod; fMun.value = m.cod;
    pintaIso();   // isócronas esmaecidas: o caminho fica em primeiro plano
    camRot.eachLayer(l => l.options.interactive !== false && l.setStyle({ opacity: 0.3 }));
    camRio.eachLayer(l => l.setStyle({ opacity: 0.25 }));
    const pts = [[m.lat, m.lon]], fs = rotasDe(m.cod).sort((a, b) => (a.properties.destino === "Manaus") - (b.properties.destino === "Manaus"));
    fs.forEach(f => {
      const ll = linha(f.geometry.coordinates), c = cor[f.properties.destino];
      pts.push(...ll);
      L.polyline(ll, { pane: "sel", color: fundo, weight: 9, opacity: 0.9, interactive: false }).addTo(camSel);
      desenhar(L.polyline(ll, { pane: "sel", color: c, weight: 5, opacity: 1, lineCap: "round", interactive: false }).addTo(camSel));
      if (f.properties.destino === "Manaus pelo rio") {   // trecho sede→eixo do rio, pontilhado
        L.polyline(linha(f.properties.aproximacao), { pane: "sel", color: c, weight: 3, dashArray: "1 6", lineCap: "round", interactive: false }).addTo(camSel);
        return;
      }
      (f.properties.balsas || []).forEach(b => L.polyline(linha(b), { pane: "sel", color: fundo, weight: 5, dashArray: "2 7", interactive: false }).addTo(camSel));
    });
    if (m.aereo) {   // aeródromo do município e, com voo regular, o arco até Manaus
      const a = m.aereo;
      pts.push([a.lat, a.lon]);
      if (a.voo_regular) {
        const ll = arco([a.lat, a.lon], SBEG); pts.push(SBEG);
        L.polyline(ll, { pane: "sel", color: fundo, weight: 7, opacity: 0.85, interactive: false }).addTo(camSel);
        desenhar(L.polyline(ll, { pane: "sel", color: corAer, weight: 3.5, lineCap: "round", interactive: false }).addTo(camSel));
      }
      L.marker([a.lat, a.lon], { pane: "sedes", icon: iconeAer(true), keyboard: false })
        .bindTooltip(esc(a.oaci), { permanent: true, direction: "bottom", offset: [0, 12], className: "ac-rot" }).addTo(camSel);
    }
    [["Hospital", m.hospital_mais_proximo], ["Terminal", m.terminal_mais_proximo]].forEach(([tipo, a]) => {
      if (a?.lat == null) return;
      pts.push([a.lat, a.lon]);
      L.marker([a.lat, a.lon], { pane: "sedes", icon: iconeAlvo(tipo, true), keyboard: false })
        .bindTooltip(esc(a.nome), { permanent: true, direction: "right", offset: [14, 0], className: "ac-rot" }).addTo(camSel);
    });
    L.circleMarker([m.lat, m.lon], { pane: "sedes", radius: 9, color: ouro, weight: 3, fill: false, interactive: false }).addTo(camSel);
    L.marker([m.lat, m.lon], { pane: "sedes", opacity: 0, keyboard: false, interactive: false })
      .bindTooltip(esc(m.nome), { permanent: true, direction: "left", offset: [-10, 0], className: "ac-rot" }).addTo(camSel);
    const manaus = { nome: "Manaus", min: m.tempo_manaus_min, km: m.km_manaus, km_linha_reta: m.km_linha_reta_manaus };
    card.innerHTML = `<button type="button" class="fechar" aria-label="Fechar">×</button><h3>${esc(m.nome)}</h3>
      <p class="sub">${num(m.pop)} habitantes · ${m.ligacao_rodoviaria ? (m.travessia_balsa ? "estrada com travessia de balsa" : "ligada a Manaus por estrada") : "só fluvial / aéreo até Manaus"}</p>
      <ul>${m.nome === "Manaus" ? "" : linhaCard("Manaus", "Por estrada até Manaus", manaus)}${m.nome === "Manaus" ? "" : linhaRio(m.fluvial) + linhaAer(m.aereo)}${linhaCard("Hospital", "Hospital mais próximo", m.hospital_mais_proximo)}${linhaCard("Terminal", "Terminal flutuante mais próximo", m.terminal_mais_proximo)}</ul>
      ${m.travessia_balsa ? `<p class="sub" style="margin:8px 0 0">Tempo sem a espera da balsa.</p>` : ""}${m.fluvial?.na_malha ? `<p class="sub" style="margin:8px 0 0">Barco: estimativa por velocidade média de referência, sem horário nem paradas.</p>` : ""}${rotas ? "" : `<p class="sub" style="margin:8px 0 0">O traçado das rotas aparece após a próxima rodada do robô.</p>`}`;
    card.hidden = false;
    card.querySelector(".fechar").onclick = () => { limpar(); mapa.fitBounds(L.latLngBounds(mun.map(x => [x.lat, x.lon])), { padding: [20, 20] }); };
    if (pts.length > 1) mapa[semMov ? "fitBounds" : "flyToBounds"](L.latLngBounds(pts), { padding: [60, 60], maxZoom: 11, duration: 0.8 });
    else mapa.setView([m.lat, m.lon], 9, { animate: !semMov });
  };
  fMun.onchange = e => selecionar(porCod.get(e.target.value));
  if (estado.sel) selecionar(porCod.get(estado.sel));
}

// Contratos ativos de rodovia/ramal/ponte por município (e-Obras). Qualitativo: sem simular a malha nova.
async function ganhoObra(box, mun) {
  let lista;
  try { ({ lista } = await contratos()); } catch { box.innerHTML = `<p class="peq">e-Obras indisponível.</p>`; return; }
  const porNome = new Map(mun.map(m => [semAcento(m.nome), m]));
  const obras = new Map();
  lista.filter(c => c.grupo === "ativo" && ["Rodovia / estrada", "Ramal", "Ponte / OAE"].includes(c.modal)).forEach(c =>
    municipios(c).forEach(n => { const m = porNome.get(semAcento(n)); if (m) (obras.get(m) || obras.set(m, []).get(m)).push(c); }));
  const leitura = m => !m.ligacao_rodoviaria
    ? "Obra na malha local. Pela malha atual não cria ligação por estrada com Manaus; melhora o acesso dentro do município (sede, comunidades, porto)."
    : m.tempo_manaus_min > 240 ? "Ligado, mas a mais de 4 h de Manaus: melhoria de pista ou ponte tende a reduzir tempo e risco de interrupção."
    : "Ligado e perto de Manaus: ganho esperado em regularidade (trafegabilidade o ano todo) e segurança, mais que em tempo.";
  const ls = [...obras].map(([m, cs]) => ({ ...m, cs, n: cs.length }));
  tabela(box, [
    { k: "nome", rot: "Município", html: m => `<b style="color:var(--tinta)">${esc(m.nome)}</b><div class="peq">${hm(m.tempo_manaus_min)} até Manaus</div>` },
    { k: "lig", rot: "Ligação", v: m => m.ligacao_rodoviaria ? 1 : 0, html: ligTxt },
    { k: "n", rot: "Contratos ativos", n: 1, html: m => `${num(m.n)}<div class="peq">${[...new Set(m.cs.map(c => c.modal))].map(esc).join(", ")}</div>` },
    { k: "cts", rot: "Contratos", sem_ord: 1, html: m => m.cs.slice(0, 4).map(c => `<div class="peq" title="${esc(c.obj)}">${esc(c.id)}: ${esc(String(c.obj || "").slice(0, 90))}${String(c.obj || "").length > 90 ? "…" : ""}</div>`).join("") + (m.n > 4 ? `<div class="peq">+${m.n - 4}</div>` : "") },
    { k: "leitura", rot: "Leitura", sem_ord: 1, html: m => `<div class="obj" style="font-size:13.5px">${esc(leitura(m))}</div>` },
  ], ls, { ordem: { k: "n", dir: -1 }, vazio: "Nenhum contrato ativo de rodovia, ramal ou ponte casou com os municípios." });
}

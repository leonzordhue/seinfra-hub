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
const estado = { lig: "", q: "", origem: "Manaus" };
let mapa = null;

const faixa = m => m.tempo_manaus_min == null ? SEM : FAIXAS.find(f => m.tempo_manaus_min <= f.ate);
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
  .mapa-acesso { height: 480px; border-radius: var(--raio); border: 1px solid var(--borda); background: var(--sup-2); }
  @media (max-width: 640px) { .mapa-acesso { height: 360px; } }
  .mapa-acesso .leaflet-popup-content { font-family: var(--f-corpo); font-size: 13px; line-height: 1.45; }
  .leg-circ i { border-radius: 50% !important; }
  .ac-leg { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin-top: 10px; font-size: 12.5px; color: var(--tinta-2); }
  .ac-leg .rampa { display: inline-flex; gap: 1px; border-radius: 2px; overflow: hidden; vertical-align: middle; }
  .ac-leg .rampa i { width: 34px; height: 10px; }
  .ac-leg .rot-r { display: inline-flex; gap: 1px; }
  .ac-leg .rot-r span { width: 34px; text-align: center; font-size: 11px; color: var(--tinta-3); }
  .ac-leg b { font-weight: 600; color: var(--tinta); margin-right: 4px; }
  .ac-leg .pt { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: -1px; margin-right: 5px; }
  .ac-graf { position: relative; height: 196px; }
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

    <section class="secao cartao"><header><div><h2>Mapa de isócronas</h2><p>Área alcançável por estrada em 1, 2 e 4 horas. Sedes coloridas pelo tempo até Manaus.</p></div></header>
        <div class="corpo">
          <div class="filtros"><div class="seg" id="fOrig" role="group" aria-label="Origem das isócronas">
            <button type="button" data-v="Manaus" aria-pressed="${estado.origem === "Manaus"}">A partir de Manaus</button>
            <button type="button" data-v="Sede municipal mais próxima" aria-pressed="${estado.origem !== "Manaus"}">A partir da sede mais próxima</button></div></div>
          <div id="mapa" class="mapa-acesso" role="region" aria-label="Mapa do Amazonas com isócronas e sedes municipais. Os mesmos dados estão na tabela abaixo."></div>
          <div class="ac-leg"><span><b>Tempo por estrada</b></span>
            <span><span class="rampa">${FAIXAS.map(f => `<i style="background:${f.cor}"></i>`).join("")}</span><br><span class="rot-r">${["1 h", "2 h", "4 h", "+4 h"].map(t => `<span>${t}</span>`).join("")}</span></span>
            <span><i class="pt" style="background:${SEM.cor}"></i>Sede sem ligação rodoviária</span>
            <span><i class="pt" style="background:${FAIXAS[0].cor};outline:2px solid var(--sup);outline-offset:-3px"></i>Sede municipal (cor = tempo até Manaus)</span></div>
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
      { k: "hosp", rot: "Hospital mais próximo", n: 1, v: m => m.hospital_mais_proximo?.min ?? 1e9, html: m => alvo(m.hospital_mais_proximo) },
      { k: "term", rot: "Terminal flutuante mais próximo", n: 1, v: m => m.terminal_mais_proximo?.min ?? 1e9, html: m => alvo(m.terminal_mais_proximo) },
    ], fl, { ordem: { k: "tempo_manaus_min", dir: 1 }, onLinha: m => mapa?.setView([m.lat, m.lon], 9) });
  };
  $("#fLig", el).onchange = e => { estado.lig = e.target.value; pinta(); };
  $("#fQ", el).oninput = e => { estado.q = e.target.value; pinta(); };
  pinta();

  ganhoObra($("#obras", el), mun);
  desenharMapa(el, mun).catch(e => { $("#mapa", el).innerHTML = `<div class="aviso" style="margin:12px">Mapa indisponível: ${esc(e.message)}. A tabela abaixo tem os mesmos dados.</div>`; });
}



async function desenharMapa(el, mun) {
  const L = await carregarLeaflet();
  const box = $("#mapa", el);
  if (!box?.isConnected) return;   // usuário já saiu da rota
  const r = document.documentElement;
  const escuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  mapa = L.map(box, { scrollWheelZoom: false }).setView(AM, 6);
  // Fundo: Esri World Gray Canvas (sem chave; o CARTO passou a exigir chave e mostrava "API KEY REQUIRED")
  L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${escuro ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16, attribution: "Fundo: Esri, HERE, Garmin, &copy; colaboradores do OpenStreetMap" }).addTo(mapa);

  const geo = await fetch("../data/acesso_isocronas.geojson", { cache: "no-cache" }).then(x => x.ok ? x.json() : null).catch(() => null);
  const corIso = { 60: FAIXAS[0].cor, 120: FAIXAS[1].cor, 240: FAIXAS[2].cor };
  let camada = null;
  const pintaIso = () => {
    camada?.remove();
    if (!geo) return;
    const fs = geo.features.filter(f => f.properties.origem === estado.origem).sort((a, b) => b.properties.ate_min - a.properties.ate_min);
    camada = L.geoJSON({ type: "FeatureCollection", features: fs }, {
      style: f => ({ color: corIso[f.properties.ate_min], weight: 0.8, opacity: 0.7, fillColor: corIso[f.properties.ate_min], fillOpacity: 0.22 }),
      onEachFeature: (f, l) => l.bindTooltip(`Até ${hm(f.properties.ate_min)} ${f.properties.origem === "Manaus" ? "de Manaus" : "da sede mais próxima"}`, { sticky: true }),
    }).addTo(mapa);
    camada.bringToBack();
  };
  pintaIso();
  el.querySelectorAll("#fOrig button").forEach(b => b.onclick = () => {
    estado.origem = b.dataset.v;
    el.querySelectorAll("#fOrig button").forEach(x => x.setAttribute("aria-pressed", x === b));
    pintaIso();
  });

  const borda = css("--tinta-2") || "#33415A";  // contorno escuro: a faixa mais clara some no fundo claro sem ele
  mun.forEach(m => {
    const f = faixa(m), h = m.hospital_mais_proximo, t = m.terminal_mais_proximo;
    L.circleMarker([m.lat, m.lon], { radius: m.nome === "Manaus" ? 8 : 6, color: borda, weight: 1, fillColor: f.cor, fillOpacity: 1 })
      .bindPopup(`<b>${esc(m.nome)}</b> · ${num(m.pop)} hab.<br>Manaus: ${m.ligacao_rodoviaria ? `${hm(m.tempo_manaus_min)} (${num(m.km_manaus)} km)${m.travessia_balsa ? ", com balsa" : ""}` : "sem ligação rodoviária"}<br>` +
        `Hospital: ${esc(h?.nome || "—")}${h?.min != null ? ` · ${hm(h.min)}` : ""}<br>Terminal: ${esc(t?.nome || "—")}${t?.min != null ? ` · ${hm(t.min)}` : ""}`)
      .addTo(mapa);
  });
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

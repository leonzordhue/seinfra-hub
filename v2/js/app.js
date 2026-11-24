// DMOB Hub v2 · roteador e build log AKE. [Nexus] 23/11/2026
import { destruirGraficos, fecharGaveta, $ } from "./ui.js";
import { teste, data } from "./fmt.js";
import { carregar } from "./dados.js";
import { abrirBusca, fecharBusca } from "./busca.js";

// AKE UFT-1.0: build log append-only
window._VERSION_LOG = [
  { v: "2.0.0", data: "2026-11-23", agente: "[Nexus] a partir da passagem do [Proton]",
    descricao: "v2 em módulos ES sem build: Início, Obras rodoviárias (alertas Lei 14.133 + curva de medição), Sinistros (índice de prioridade, acervo com Wayback), Licitações (PNCP + CSC), Briefings por município/rodovia. Módulos ainda não portados abrem a v1 por index.html#mod=." },
  { v: "2.1.0", data: "2026-11-23", agente: "[Nexus] + subagentes",
    descricao: "Mapa (MapLibre/PMTiles), Acessibilidade (OSRM), Rios e queimadas (ANA/INPE), Sinistros oficiais (RENAEST/PRF), Preços x SICRO, previsão de conclusão e nota de risco, IRI pelo celular, buracos por foto (YOLO ONNX), Consulta livre (DuckDB-WASM)." },
  { v: "3.0.0", data: "2026-11-23", agente: "[Nexus]",
    descricao: "Design 'prancha técnica': faixa institucional, menu claro por tema, barra com trilha e busca global (Ctrl K), régua de KPIs, seções numeradas, escudo AM-xxx automático, malha do Amazonas em SVG próprio, painel do dia." },
];
window._VICIOS_CONHECIDOS = [
  { id: "VK-01", desc: "v1 tem API_KEY do Google exposta; a v2 só lê ../data/*.json gerado pelas rotinas (sem chave)." },
  { id: "VK-02", desc: "Sinistros vêm de notícias: rodovias perto de Manaus têm mais cobertura; a tendência cai quando a carga histórica ainda não terminou." },
];
window._TENTATIVAS_FALHAS = [
  { data: "2026-11-23", o_que: "CDX do Wayback como fonte única do histórico", porque: "instável (offline de manhã, 503 em lote); fica como complemento do Google News, com retentativa e cache" },
  { data: "2026-11-23", o_que: "índice de prioridade com normalização min-max", porque: "com 2 a 3 rodovias forçava 0 ou 1 (AM-010 ganhava tendência 1,0 com queda real); trocado por proporção da pior e escalas fixas" },
];

const ROTAS = {
  inicio: () => import("./mod/inicio.js"),
  obras: () => import("./mod/obras.js"),
  sinistros: () => import("./mod/sinistros.js"),
  licitacoes: () => import("./mod/licitacoes.js"),
  briefings: () => import("./mod/briefings.js"),
  consulta: () => import("./mod/consulta.js"),
  mapa: () => import("./mod/mapa.js"),
  acesso: () => import("./mod/acesso.js"),
  ambiente: () => import("./mod/ambiente.js"),
  terminais: () => import("./mod/terminais.js"),
  "sinistros-oficiais": () => import("./mod/sinistros_oficiais.js"),
  "campo-iri": () => import("./mod/campo_iri.js"),
  "campo-buracos": () => import("./mod/campo_buracos.js"),
};
const TITULOS = { inicio: "Painel do dia", obras: "Obras e contratos", sinistros: "Sinistros", licitacoes: "Licitações", briefings: "Briefings", consulta: "Consulta livre", mapa: "Mapa do Amazonas", acesso: "Acessibilidade rodoviária", ambiente: "Ambiente e rios", terminais: "Terminais fluviais", "sinistros-oficiais": "Sinistros: bases oficiais", "campo-iri": "IRI pelo celular", "campo-buracos": "Buracos por foto" };

// Módulos de mapa e cadastro (Rodovias, Ramais, Viário...) rodam do index.html raiz em modo embutido, dentro desta casca.
// Um só iframe fica carregado: trocar de módulo chama loadModule() lá dentro, sem recarregar os dados.
const EMBUTIDOS = { rodovias: "Rodovias estaduais", ramais: "Ramais", viario: "Viário urbano", aerodromos: "Aeródromos", terminais: "Terminais fluviais",
  icm: "Condição do pavimento", atlas: "Atlas", bi: "BI e análises" };
// Trilha (grupo do menu > página), sobrelinha no título e escudos AM-xxx/BR-xxx em todo texto do módulo.
const grupoDe = rota => { const a = document.querySelector(`.nav a[data-rota="${rota}"]`); let p = a?.previousElementSibling; while (p && !p.classList.contains("nav-grupo")) p = p.previousElementSibling; return p?.textContent.trim() || ""; };
function trilha(rota, titulo) {
  const g = rota === "inicio" ? "" : grupoDe(rota);
  $("#trilha").innerHTML = `<a href="#/inicio">DMOB Hub</a>${g ? `<i>/</i><span>${g}</span>` : ""}<i>/</i><b>${titulo}</b>`;
  return g;
}
const RX_ROD = /\b(AM|BR)-\d{3}\b/g;
const PULA = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CANVAS", "svg", "CODE", "PRE", "TITLE"]);
function escudos(raiz) {
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, { acceptNode: n => {
    for (let p = n.parentNode; p && p !== raiz; p = p.parentNode) if (PULA.has(p.nodeName) || p.classList?.contains("escudo") || p.closest?.(".leaflet-container, .maplibregl-map, .t td.obj, .obj, .d, .t2")) return NodeFilter.FILTER_REJECT;
    RX_ROD.lastIndex = 0; return RX_ROD.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
  const nos = []; while (w.nextNode()) nos.push(w.currentNode);
  nos.forEach(n => {
    const f = document.createDocumentFragment(); let i = 0; RX_ROD.lastIndex = 0;
    for (const m of n.data.matchAll(RX_ROD)) {
      f.append(n.data.slice(i, m.index));
      f.append(Object.assign(document.createElement("span"), { className: `escudo${m[1] === "BR" ? " br" : ""}`, textContent: m[0] }));
      i = m.index + m[0].length;
    }
    f.append(n.data.slice(i)); n.replaceWith(f);
  });
}
let decorando = false;
const obs = new MutationObserver(() => { if (decorando) return; decorando = true; requestAnimationFrame(() => { escudos($("#conteudo")); decorando = false; }); });
obs.observe(document.getElementById("conteudo"), { childList: true, subtree: true });
carregar("eobras").then(d => { $("#atualizado").textContent = `e-Obras posição ${d._meta.posicao || data(d._meta.gerado)}`; }).catch(() => { $("#atualizado").textContent = "dados indisponíveis"; });

let quadro = null;
function abrirEmbutido(mod) {
  const caixa = $("#embutido");
  if (!quadro) {
    quadro = document.createElement("iframe");
    quadro.title = "Módulo do DMOB Hub";
    quadro.src = `../index.html?embed=1#mod=${mod}`;
    caixa.append(quadro);
  } else {
    try { quadro.contentWindow.loadModule(mod); } catch { quadro.src = `../index.html?embed=1#mod=${mod}`; }  // ainda carregando: o hash abre o módulo
  }
  caixa.hidden = false; $("#conteudo").hidden = true;
}

let navId = 0;
async function navegar() {
  const meu = ++navId;  // rota trocada durante um render lento: a antiga não mexe mais na página
  const [rota, qs] = (location.hash.replace(/^#\/?/, "") || "inicio").split("?");
  const emb = rota.startsWith("m/") && EMBUTIDOS[rota.slice(2)] ? rota.slice(2) : null;
  const id = emb ? rota : ROTAS[rota] ? rota : "inicio";
  const el = $("#conteudo");
  fecharGaveta(); destruirGraficos();
  document.querySelectorAll(".nav a[data-rota]").forEach(a => a.dataset.rota === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const titulo = emb ? EMBUTIDOS[emb] : TITULOS[id];
  document.title = `${titulo} · DMOB Hub`;
  const grupo = trilha(id, titulo);
  fecharBusca();
  $(".lateral").classList.remove("aberta"); $("#menu").setAttribute("aria-expanded", "false");
  if (emb) { abrirEmbutido(emb); return; }
  $("#embutido").hidden = true; el.hidden = false;
  el.innerHTML = `<div class="grade g-kpi" aria-busy="true"><div class="esq"></div><div class="esq"></div><div class="esq"></div><div class="esq"></div></div>`;
  try {
    const m = await ROTAS[id]();
    await m.render(el, new URLSearchParams(qs || ""));
    if (meu !== navId) return;
    const h1 = el.querySelector(".cab h1");
    if (h1 && grupo && !h1.previousElementSibling?.classList.contains("sobre")) h1.insertAdjacentHTML("beforebegin", `<span class="sobre">${grupo}</span>`);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="aviso"><b>Não consegui abrir este módulo.</b> ${String(e.message || e).replace(/</g, "&lt;")}<br>Recarregue a página; se continuar, os dados podem estar sendo atualizados.</div>`;
  }
  // leitor de tela: focar o título anuncia a página nova (focar o <main> leria tudo de uma vez)
  const h1f = el.querySelector("h1");
  if (h1f) { h1f.setAttribute("tabindex", "-1"); h1f.focus({ preventScroll: true }); } else el.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", navegar);
const menu = $("#menu"), lat = $(".lateral");
lat.id = "nav-lateral"; menu.setAttribute("aria-controls", "nav-lateral"); menu.setAttribute("aria-expanded", "false");
const menuAberto = v => { lat.classList.toggle("aberta", v); menu.setAttribute("aria-expanded", String(v)); if (v) lat.querySelector("a")?.focus(); else menu.focus(); };
menu.onclick = () => menuAberto(!lat.classList.contains("aberta"));
document.addEventListener("keydown", e => { if (e.key === "Escape" && lat.classList.contains("aberta")) menuAberto(false); });
const temaEscuro = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
$("#tema").setAttribute("aria-pressed", String(temaEscuro()));
$("#busca").onclick = abrirBusca;
$("#tema").onclick = () => {
  const r = document.documentElement, escuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = escuro ? "light" : "dark";
  $("#tema").setAttribute("aria-pressed", String(!escuro));
  try { localStorage.setItem("dmob-tema", r.dataset.theme); } catch {}
  navegar();  // recria os gráficos com as cores do tema
};
if (new URLSearchParams(location.search).has("teste")) teste();
navegar();

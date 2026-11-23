// DMOB Hub v2 · roteador e build log AKE. [Nexus] 23/11/2026
import { destruirGraficos, fecharGaveta, $ } from "./ui.js";
import { teste } from "./fmt.js";

// AKE UFT-1.0: build log append-only
window._VERSION_LOG = [
  { v: "2.0.0", data: "2026-11-23", agente: "[Nexus] a partir da passagem do [Proton]",
    descricao: "v2 em módulos ES sem build: Início, Obras rodoviárias (alertas Lei 14.133 + curva de medição), Sinistros (índice de prioridade, acervo com Wayback), Licitações (PNCP + CSC), Briefings por município/rodovia. Módulos ainda não portados abrem a v1 por index.html#mod=." },
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
};
const TITULOS = { inicio: "Início", obras: "Obras e contratos", sinistros: "Sinistros", licitacoes: "Licitações", briefings: "Briefings", consulta: "Consulta livre", mapa: "Mapa do Amazonas" };

// Módulos de mapa e cadastro (Rodovias, Ramais, Viário...) rodam do index.html raiz em modo embutido, dentro desta casca.
// Um só iframe fica carregado: trocar de módulo chama loadModule() lá dentro, sem recarregar os dados.
const EMBUTIDOS = { rodovias: "Rodovias", ramais: "Ramais", viario: "Viário urbano", aerodromos: "Aeródromos", terminais: "Terminais",
  icm: "Condição viária", atlas: "Atlas", bi: "BI e análises" };
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

async function navegar() {
  const [rota, qs] = (location.hash.replace(/^#\/?/, "") || "inicio").split("?");
  const emb = rota.startsWith("m/") && EMBUTIDOS[rota.slice(2)] ? rota.slice(2) : null;
  const id = emb ? rota : ROTAS[rota] ? rota : "inicio";
  const el = $("#conteudo");
  fecharGaveta(); destruirGraficos();
  document.querySelectorAll(".nav a[data-rota]").forEach(a => a.dataset.rota === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.title = `${emb ? EMBUTIDOS[emb] : TITULOS[id]} · DMOB Hub`;
  $(".lateral").classList.remove("aberta");
  if (emb) { abrirEmbutido(emb); return; }
  $("#embutido").hidden = true; el.hidden = false;
  el.innerHTML = `<div class="grade g-kpi" aria-busy="true"><div class="esq"></div><div class="esq"></div><div class="esq"></div><div class="esq"></div></div>`;
  try {
    const m = await ROTAS[id]();
    await m.render(el, new URLSearchParams(qs || ""));
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="aviso"><b>Não consegui abrir este módulo.</b> ${String(e.message || e).replace(/</g, "&lt;")}<br>Recarregue a página; se continuar, os dados podem estar sendo atualizados.</div>`;
  }
  el.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", navegar);
$("#menu").onclick = () => $(".lateral").classList.toggle("aberta");
$("#tema").onclick = () => {
  const r = document.documentElement, escuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = escuro ? "light" : "dark";
  try { localStorage.setItem("dmob-tema", r.dataset.theme); } catch {}
  navegar();  // recria os gráficos com as cores do tema
};
if (new URLSearchParams(location.search).has("teste")) teste();
navegar();

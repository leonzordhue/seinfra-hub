// Busca global (Ctrl K / "/"): contratos, municípios, rodovias e módulos, num só campo. [Nexus] 23/11/2026
import { contratos, municipios, talvez, PUBLICO } from "./dados.js";
import { esc, semAcento, brlCurto, data } from "./fmt.js";

// [Claude] 25/11/2026: licitações, terminais e nomes alternativos das rodovias no índice; resultados agrupados por
// tipo; com o campo vazio, os últimos itens abertos (localStorage, só neste aparelho) antes dos módulos.
const ORDEM = ["Recente", "Rodovia", "Município", "Contrato", "Licitação", "Terminal", "Módulo"];
const CHAVE_REC = "dmob-busca-recentes";
const recentes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_REC) || "[]"); } catch { return []; } };
function lembrar(o) {
  try {
    const r = [{ tipo: o.tipo, t: o.t, d: o.d, href: o.href, ext: o.ext }, ...recentes().filter(x => x.href !== o.href)].slice(0, 6);
    localStorage.setItem(CHAVE_REC, JSON.stringify(r));
  } catch { /* navegação privada: segue sem lembrar */ }
}

let indice = null, veu = null, sel = 0, itens = [], volta = null;

async function montar() {
  const [{ lista }, an, icm, lic, term, rodj] = await Promise.all([contratos(), talvez("sinistros_analise"), talvez("icm"), talvez("licitacoes"), talvez("terminais"),
    fetch("../pipelines/sinistros/rodovias.json").then(r => r.ok ? r.json() : null).catch(() => null)]);
  const out = [];
  document.querySelectorAll(".nav a[href]").forEach(a => out.push({ tipo: "Módulo", t: a.textContent.trim(), d: a.closest(".nav") ? grupoDe(a) : "", href: a.getAttribute("href"), ext: a.target === "_blank" }));
  const muns = new Map();
  lista.forEach(c => {
    out.push({ tipo: "Contrato", t: c.id, d: `${c.sit || ""} · ${brlCurto(c.v_atual)} · ${(c.obj || "").slice(0, 110)}`, extra: `${c.emp} ${c.mun} ${c.obj}`, href: `#/briefings?contrato=${encodeURIComponent(c.id)}`, peso: c.grupo === "ativo" ? 1 : 0 });
    municipios(c).forEach(m => muns.set(m, (muns.get(m) || 0) + 1));
  });
  muns.forEach((n, m) => out.push({ tipo: "Município", t: m, d: `${n} contrato${n > 1 ? "s" : ""} no e-Obras · briefing do município`, href: `#/briefings?municipio=${encodeURIComponent(m)}`, peso: 2 }));
  const rods = new Set([...Object.keys(an?.rodovias || {}), ...((icm?.rodovias || []).map(r => r.codigo))]);
  const nomesRod = Object.fromEntries(Object.entries(rodj?.rodovias || rodj || {}).filter(([k]) => /^AM-/.test(k)).map(([k, v]) => [k, v.nomes_fortes || []]));
  rods.forEach(r => out.push({ tipo: "Rodovia", t: r, d: `${(nomesRod[r] || []).slice(0, 2).join(" · ") || "rodovia estadual"} · briefing: obras, condição, sinistros, municípios`,
    extra: (nomesRod[r] || []).join(" "), href: `#/briefings?rodovia=${encodeURIComponent(r)}`, peso: 3 }));
  const hoje = new Date().toISOString().slice(0, 10);
  (lic?.pncp || []).filter(l => l.rodoviario).forEach(l => out.push({ tipo: "Licitação", t: l.edital || "Edital", d: `${l.situacao || ""}${l.encerramento ? ` · até ${data(l.encerramento)}` : ""} · ${(l.descricao || l.objeto || "").slice(0, 110)}`,
    extra: `${l.objeto || ""} ${l.processo || ""}`, href: l.link || "#/licitacoes", ext: !!l.link, peso: l.encerramento >= hoje ? 1 : 0 }));
  [...(term?.entregues || []), ...(term?.pedidos || [])].forEach(t => out.push({ tipo: "Terminal", t: `${t.localidade || "Terminal"} (${t.municipio})`, d: `terminal flutuante · ${t.status || ""}`,
    href: "#/terminais", peso: 0 }));
  out.forEach(o => { o.k = semAcento(`${o.t} ${o.d} ${o.extra || ""}`); });
  return out;
}
const grupoDe = a => { let p = a.previousElementSibling; while (p && !p.classList.contains("nav-grupo")) p = p.previousElementSibling; return p?.textContent.trim() || ""; };

function filtrar(q) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return [...recentes().map(o => ({ ...o, tipo: "Recente", tipoReal: o.tipo })), ...indice.filter(o => o.tipo === "Módulo").slice(0, 30)];
  const tq = semAcento(q).replace(/\s+/g, "");
  return indice.filter(o => termos.every(t => o.k.includes(t)))
    .map(o => ({ o, s: (semAcento(o.t).replace(/\s+/g, "").startsWith(tq) ? 10 : 0) + (o.peso || 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.o)
    .sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));   // agrupa por tipo (sort estável mantém a relevância dentro do grupo)
}

function pinta(q) {
  itens = filtrar(q); sel = 0;
  const ul = veu.querySelector("ul");
  ul.innerHTML = itens.length ? itens.map((o, i) => `${i === 0 || itens[i - 1].tipo !== o.tipo ? `<li class="grupo" role="presentation">${o.tipo === "Recente" ? "Abertos recentemente" : o.tipo}</li>` : ""}<li><a href="${esc(o.href)}"${o.ext ? ' target="_blank" rel="noopener"' : ""} id="pb${i}" data-i="${i}" role="option" aria-selected="${i === 0}"><span>${esc(o.tipoReal || o.tipo)}</span><div>${esc(o.t)}<small>${esc(o.d)}</small></div></a></li>`).join("")
    : `<li class="nada">Nada encontrado para “${esc(q)}”.</li>`;
  veu.querySelector("input").setAttribute("aria-activedescendant", itens.length ? "pb0" : "");
}

function mover(d) {
  if (!itens.length) return;
  veu.querySelector(`#pb${sel}`)?.setAttribute("aria-selected", "false");
  sel = (sel + d + itens.length) % itens.length;
  const a = veu.querySelector(`#pb${sel}`); a.setAttribute("aria-selected", "true"); a.scrollIntoView({ block: "nearest" });
  veu.querySelector("input").setAttribute("aria-activedescendant", "pb" + sel);
}

export async function abrirBusca() {
  if (!veu) {
    veu = Object.assign(document.createElement("div"), { className: "paleta-veu", hidden: true });
    veu.innerHTML = `<div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar no DMOB Hub">
      <input type="search" placeholder="Rodovia, município, contrato, licitação, terminal ou módulo" aria-label="Buscar" role="combobox" aria-controls="pbl" aria-expanded="true">
      <ul id="pbl" role="listbox"><li class="nada">Carregando o índice…</li></ul>
      <div class="dica"><kbd>↑</kbd> <kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</div></div>`;
    document.body.append(veu);
    const inp = veu.querySelector("input");
    veu.addEventListener("click", e => { if (e.target === veu) fecharBusca(true); else if (e.target.closest("a")) { const o = itens[+e.target.closest("a").dataset.i]; if (o) lembrar({ ...o, tipo: o.tipoReal || o.tipo }); fecharBusca(); } });
    inp.addEventListener("input", () => indice && pinta(inp.value));
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
      else if (e.key === "Enter") { const a = veu.querySelector(`#pb${sel}`); if (a) { e.preventDefault(); a.click(); } }
      else if (e.key === "Escape") fecharBusca(true);
      else if (e.key === "Tab") e.preventDefault();  // o campo é o único foco do diálogo; as setas navegam
    });
  }
  if (veu.hidden) volta = document.activeElement;
  veu.hidden = false;
  const inp = veu.querySelector("input"); inp.value = ""; inp.focus();
  if (!indice) { try { indice = await montar(); } catch (e) { veu.querySelector("ul").innerHTML = `<li class="nada">Não consegui montar o índice: ${esc(e.message)}</li>`; return; } }
  pinta(inp.value);
}
export function fecharBusca(devolver = false) { if (!veu || veu.hidden) return; veu.hidden = true; if (devolver) volta?.focus?.(); }

// versão pública não tem busca: o índice cobre contratos, licitações e sinistros
if (!PUBLICO) document.addEventListener("keydown", e => {
  const campo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); abrirBusca(); }
  else if (e.key === "/" && !campo) { e.preventDefault(); abrirBusca(); }
});

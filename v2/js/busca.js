// Busca global (Ctrl K / "/"): contratos, municípios, rodovias e módulos, num só campo. [Nexus] 23/11/2026
import { contratos, municipios, talvez } from "./dados.js";
import { esc, semAcento, brlCurto } from "./fmt.js";

let indice = null, veu = null, sel = 0, itens = [];

async function montar() {
  const [{ lista }, an, icm] = await Promise.all([contratos(), talvez("sinistros_analise"), talvez("icm")]);
  const out = [];
  document.querySelectorAll(".nav a[href]").forEach(a => out.push({ tipo: "Módulo", t: a.textContent.trim(), d: a.closest(".nav") ? grupoDe(a) : "", href: a.getAttribute("href"), ext: a.target === "_blank" }));
  const muns = new Map();
  lista.forEach(c => {
    out.push({ tipo: "Contrato", t: c.id, d: `${c.sit || ""} · ${brlCurto(c.v_atual)} · ${(c.obj || "").slice(0, 110)}`, extra: `${c.emp} ${c.mun} ${c.obj}`, href: `#/briefings?contrato=${encodeURIComponent(c.id)}`, peso: c.grupo === "ativo" ? 1 : 0 });
    municipios(c).forEach(m => muns.set(m, (muns.get(m) || 0) + 1));
  });
  muns.forEach((n, m) => out.push({ tipo: "Município", t: m, d: `${n} contrato${n > 1 ? "s" : ""} no e-Obras · briefing do município`, href: `#/briefings?municipio=${encodeURIComponent(m)}`, peso: 2 }));
  const rods = new Set([...Object.keys(an?.rodovias || {}), ...((icm?.rodovias || []).map(r => r.codigo))]);
  rods.forEach(r => out.push({ tipo: "Rodovia", t: r, d: "briefing da rodovia: obras, condição e sinistros", href: `#/briefings?rodovia=${encodeURIComponent(r)}`, peso: 3 }));
  out.forEach(o => { o.k = semAcento(`${o.t} ${o.d} ${o.extra || ""}`); });
  return out;
}
const grupoDe = a => { let p = a.previousElementSibling; while (p && !p.classList.contains("nav-grupo")) p = p.previousElementSibling; return p?.textContent.trim() || ""; };

function filtrar(q) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return indice.filter(o => o.tipo === "Módulo").slice(0, 30);
  const tq = semAcento(q).replace(/\s+/g, "");
  return indice.filter(o => termos.every(t => o.k.includes(t)))
    .map(o => ({ o, s: (semAcento(o.t).replace(/\s+/g, "").startsWith(tq) ? 10 : 0) + (o.peso || 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.o);
}

function pinta(q) {
  itens = filtrar(q); sel = 0;
  const ul = veu.querySelector("ul");
  ul.innerHTML = itens.length ? itens.map((o, i) => `<li><a href="${esc(o.href)}"${o.ext ? ' target="_blank" rel="noopener"' : ""} id="pb${i}" role="option" aria-selected="${i === 0}"><span>${o.tipo}</span><div>${esc(o.t)}<small>${esc(o.d)}</small></div></a></li>`).join("")
    : `<li class="nada">Nada encontrado para “${esc(q)}”.</li>`;
}

function mover(d) {
  if (!itens.length) return;
  veu.querySelector(`#pb${sel}`)?.setAttribute("aria-selected", "false");
  sel = (sel + d + itens.length) % itens.length;
  const a = veu.querySelector(`#pb${sel}`); a.setAttribute("aria-selected", "true"); a.scrollIntoView({ block: "nearest" });
}

export async function abrirBusca() {
  if (!veu) {
    veu = Object.assign(document.createElement("div"), { className: "paleta-veu", hidden: true });
    veu.innerHTML = `<div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar no DMOB Hub">
      <input type="search" placeholder="Contrato, município, rodovia, empresa ou módulo" aria-label="Buscar" role="combobox" aria-controls="pbl" aria-expanded="true">
      <ul id="pbl" role="listbox"><li class="nada">Carregando o índice…</li></ul>
      <div class="dica"><kbd>↑</kbd> <kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</div></div>`;
    document.body.append(veu);
    const inp = veu.querySelector("input");
    veu.addEventListener("click", e => { if (e.target === veu || e.target.closest("a")) fecharBusca(); });
    inp.addEventListener("input", () => indice && pinta(inp.value));
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
      else if (e.key === "Enter") { const a = veu.querySelector(`#pb${sel}`); if (a) { e.preventDefault(); a.click(); } }
      else if (e.key === "Escape") fecharBusca();
    });
  }
  veu.hidden = false;
  const inp = veu.querySelector("input"); inp.value = ""; inp.focus();
  if (!indice) { try { indice = await montar(); } catch (e) { veu.querySelector("ul").innerHTML = `<li class="nada">Não consegui montar o índice: ${esc(e.message)}</li>`; return; } }
  pinta(inp.value);
}
export function fecharBusca() { if (veu) veu.hidden = true; }

document.addEventListener("keydown", e => {
  const campo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); abrirBusca(); }
  else if (e.key === "/" && !campo) { e.preventDefault(); abrirBusca(); }
});

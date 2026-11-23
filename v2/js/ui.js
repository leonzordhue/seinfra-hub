// Componentes de tela: KPI, chip, tabela ordenável, gráfico (Chart.js), gaveta. [Nexus] 23/11/2026
import { esc, num } from "./fmt.js";

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const kpi = (rot, val, sub = "", destaque = false) =>
  `<div class="cartao kpi${destaque ? " destaque" : ""}"><div class="rot">${esc(rot)}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

const ICONE = {
  critico: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
};
// status sempre com ícone + texto (nunca só cor)
export const chip = (txt, nivel = "", titulo = "") =>
  `<span class="chip ${nivel}"${titulo ? ` title="${esc(titulo)}"` : ""}>${ICONE[nivel] || ""}${esc(txt)}</span>`;

export function chipSit(s) {
  const n = /Paralis|Tomada/.test(s) ? "critico" : /Expirad/.test(s) ? "alerta" : /Andamento|Vigente|A Iniciar|recebimento/.test(s) ? "ok" : "";
  return chip(s || "—", n);
}

export const barra = (v, max = 100) =>
  `<div class="barra" role="img" aria-label="${num(v, 1)}%"><i style="width:${Math.max(0, Math.min(100, (v || 0) / max * 100))}%"></i></div>`;

/**
 * Tabela ordenável. cols: [{k, rot, n (numérica), html(row), v(row) valor de ordenação}]
 * Clique no cabeçalho ordena; onLinha(row) torna a linha clicável.
 */
export function tabela(el, cols, linhas, { ordem = null, limite = 300, onLinha = null, vazio = "Nada encontrado com esses filtros." } = {}) {
  let ord = ordem || { k: null, dir: -1 };
  const valor = (c, r) => (c.v ? c.v(r) : r[c.k]);
  function pinta() {
    let ls = linhas;
    if (ord.k) {
      const c = cols.find(x => x.k === ord.k);
      ls = [...linhas].sort((a, b) => {
        const va = valor(c, a), vb = valor(c, b);
        if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR")) * ord.dir;
      });
    }
    const corpo = ls.slice(0, limite).map((r, i) =>
      `<tr${onLinha ? ` class="clic" tabindex="0" data-i="${linhas.indexOf(r)}"` : ""}>${cols.map(c =>
        `<td class="${c.n ? "n" : ""} ${c.cls || ""}">${c.html ? c.html(r) : esc(r[c.k] ?? "—")}</td>`).join("")}</tr>`).join("");
    el.innerHTML = `<div class="tab-rolo"><table class="t"><thead><tr>${cols.map(c =>
      `<th scope="col" class="${c.n ? "n" : ""}" ${c.sem_ord ? "" : `data-ord="${c.k}"`} ${ord.k === c.k ? `aria-sort="${ord.dir > 0 ? "ascending" : "descending"}"` : ""}>${esc(c.rot)}</th>`).join("")}</tr></thead>
      <tbody>${corpo || `<tr><td colspan="${cols.length}" class="vazio">${esc(vazio)}</td></tr>`}</tbody></table></div>
      ${ls.length > limite ? `<p class="peq" style="padding:8px 10px;color:var(--tinta-3);font-size:13px">Mostrando ${num(limite)} de ${num(ls.length)}. Use os filtros para refinar.</p>` : ""}`;
  }
  el.onclick = ev => {
    const th = ev.target.closest("th[data-ord]");
    if (th) { const k = th.dataset.ord; ord = { k, dir: ord.k === k ? -ord.dir : -1 }; pinta(); return; }
    const tr = ev.target.closest("tr.clic");
    if (tr && onLinha && !ev.target.closest("a")) onLinha(linhas[+tr.dataset.i]);
  };
  el.onkeydown = ev => { const tr = ev.target.closest("tr.clic"); if (tr && ev.key === "Enter" && onLinha) onLinha(linhas[+tr.dataset.i]); };
  pinta();
}

// ── gráficos ── (CLAUDE.md: Chart.js sempre destroy() antes de recriar)
const graficos = new Map();
export function grafico(canvas, cfg) {
  const id = canvas.id || (canvas.id = "g" + Math.random().toString(36).slice(2));
  graficos.get(id)?.destroy();
  const C = window.Chart;
  if (!C) { canvas.replaceWith(Object.assign(document.createElement("p"), { className: "vazio", textContent: "Gráfico indisponível (Chart.js não carregou)." })); return; }
  const tinta = css("--tinta-3"), grade = css("--grade");
  C.defaults.font.family = css("--f-corpo") || "Outfit, sans-serif";
  C.defaults.color = tinta;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 },
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--sup"), titleColor: css("--tinta"), bodyColor: css("--tinta-2"), borderColor: css("--borda-2"), borderWidth: 1, padding: 10 } },
    scales: cfg.type === "doughnut" ? undefined : {
      x: { grid: { display: false }, border: { color: css("--eixo") }, ticks: { color: tinta } },
      y: { grid: { color: grade }, border: { display: false }, ticks: { color: tinta, precision: 0 }, beginAtZero: true },
    },
  };
  const g = new C(canvas, { ...cfg, options: fundir(base, cfg.options || {}) });
  graficos.set(id, g);
  return g;
}
export const destruirGraficos = () => { graficos.forEach(g => g.destroy()); graficos.clear(); };
function fundir(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] ? fundir(a[k], v) : v;
  return o;
}
export const serie = i => css(`--s${i}`);
// barras: ponta arredondada de 4px só no topo, 2px de respiro entre barras
export const estiloBarra = cor => ({ backgroundColor: cor, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 36, borderColor: css("--sup"), borderWidth: { left: 1, right: 1 } });

// ── gaveta lateral ──
export function gaveta(html) {
  let g = $(".gaveta"), v = $(".veu");
  if (!g) {
    v = Object.assign(document.createElement("div"), { className: "veu" });
    g = Object.assign(document.createElement("aside"), { className: "gaveta" });
    g.setAttribute("role", "dialog"); g.setAttribute("aria-modal", "true");
    document.body.append(v, g);
    v.onclick = fecharGaveta;
    document.addEventListener("keydown", e => { if (e.key === "Escape") fecharGaveta(); });
  }
  g.innerHTML = `<button class="btn fechar" type="button" aria-label="Fechar">Fechar</button>${html}`;
  $(".fechar", g).onclick = fecharGaveta;
  v.classList.add("aberto"); g.classList.add("aberta");
  $(".fechar", g).focus();
  return g;
}
export function fecharGaveta() { $(".gaveta")?.classList.remove("aberta"); $(".veu")?.classList.remove("aberto"); }

export const fonte = (rot, val) => `<span class="fonte">${esc(rot)}: <b>${esc(val)}</b></span>`;
export const opcoes = (vals, sel = "", todos = "Todos") =>
  `<option value="">${esc(todos)}</option>` + vals.map(v => `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");

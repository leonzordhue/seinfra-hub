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
  const n = /^Conclu/.test(s) ? "" : /Paralis|Tomada|Suspens/.test(s) ? "critico" : /Expirad|Pend[êe]ncia|PGE|MP$|Tr[âa]mite/.test(s) ? "alerta" : /Andamento|Vigente|A Iniciar|recebimento/.test(s) ? "ok" : "";
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
    el.innerHTML = `<div class="tab-rolo" tabindex="0"><table class="t"><thead><tr>${cols.map(c =>
      `<th scope="col" class="${c.n ? "n" : ""}" ${c.sem_ord ? "" : `data-ord="${c.k}"`} ${ord.k === c.k ? `aria-sort="${ord.dir > 0 ? "ascending" : "descending"}"` : ""}>${c.sem_ord ? esc(c.rot) : `<button type="button" class="ord">${esc(c.rot)}</button>`}</th>`).join("")}</tr></thead>
      <tbody>${corpo || `<tr><td colspan="${cols.length}" class="vazio">${esc(vazio)}</td></tr>`}</tbody></table></div>
      ${ls.length > limite ? `<p class="peq" style="padding:8px 10px;color:var(--tinta-3);font-size:13px">Mostrando ${num(limite)} de ${num(ls.length)}. Use os filtros para refinar.</p>` : ""}`;
  }
  el.onclick = ev => {
    const th = ev.target.closest("th[data-ord]");
    if (th) { const k = th.dataset.ord; ord = { k, dir: ord.k === k ? -ord.dir : -1 }; pinta(); el.querySelector(`th[data-ord="${k}"] .ord`)?.focus(); return; }
    const tr = ev.target.closest("tr.clic");
    if (tr && onLinha && !ev.target.closest("a")) onLinha(linhas[+tr.dataset.i]);
  };
  // linha clicável: Enter ou Espaço abre (a11y: mesmo efeito do clique)
  el.onkeydown = ev => { const tr = ev.target.closest("tr.clic"); if (tr && ev.target === tr && (ev.key === "Enter" || ev.key === " ") && onLinha) { ev.preventDefault(); onLinha(linhas[+tr.dataset.i]); } };
  pinta();
}

// ── gráficos ── (CLAUDE.md: Chart.js sempre destroy() antes de recriar)
// v3.1: barras com valor escrito na ponta (sem eixo de valores redundante), barras finas, grade leve,
// linhas com no máximo 5 marcas no eixo. Desligar rótulos: options.plugins.rotulos = false; formatar: { fmt: v => ... }.
const graficos = new Map();
const ROTULOS = {
  id: "rotulos",
  afterDatasetsDraw(ch, _a, op) {
    if (op === false || op?.ativo === false || ch.config.type !== "bar") return;
    const { ctx, chartArea: area } = ch, hz = ch.options.indexAxis === "y";
    const sc = ch.options.scales || {}, empilhado = !!(sc.x?.stacked || sc.y?.stacked);
    const fmt = op?.fmt || (v => num(v, Math.abs(v) < 10 && v % 1 ? 1 : 0));
    const vis = ch.data.datasets.map((d, i) => i).filter(i => ch.isDatasetVisible(i));
    if (!vis.length) return;
    ctx.save();
    ctx.font = `600 12px ${css("--f-corpo") || "Outfit"}`; ctx.fillStyle = css("--tinta-2");
    const escreve = (el, v) => {
      if (v == null || isNaN(v) || (!v && !op?.zeros)) return;
      const t = fmt(v), w = ctx.measureText(t).width;
      if (hz) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, Math.min(el.x + 6, area.right + 40 - w), el.y); }
      else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; if (el.width >= w * .6 || ch.data.labels.length <= 16) ctx.fillText(t, el.x, el.y - 4); }
    };
    if (empilhado) {
      const ult = vis[vis.length - 1];
      ch.getDatasetMeta(ult).data.forEach((el, j) => escreve(el, vis.reduce((s, i) => s + (+ch.data.datasets[i].data[j] || 0), 0)));
    } else vis.forEach(i => ch.getDatasetMeta(i).data.forEach((el, j) => escreve(el, +ch.data.datasets[i].data[j])));
    ctx.restore();
  },
};
export function grafico(canvas, cfg) {
  const id = canvas.id || (canvas.id = "g" + Math.random().toString(36).slice(2));
  graficos.get(id)?.destroy();
  const C = window.Chart;
  if (!C) { canvas.replaceWith(Object.assign(document.createElement("p"), { className: "vazio", textContent: "Gráfico indisponível (Chart.js não carregou)." })); return; }
  if (!C.registry.plugins.get("rotulos")) C.register(ROTULOS);
  const tinta = css("--tinta-3"), grade = css("--grade");
  C.defaults.font.family = css("--f-corpo") || "Outfit, sans-serif";
  C.defaults.color = tinta;
  const o = cfg.options || {}, barra = cfg.type === "bar", hz = o.indexAxis === "y";
  const rot = barra && o.plugins?.rotulos !== false;
  const eixoVal = hz ? "x" : "y", eixoCat = hz ? "y" : "x";
  // o formato do eixo de valores do módulo (ex.: R$ mi) vira o formato do rótulo
  const cbEixo = o.scales?.[eixoVal]?.ticks?.callback;
  const fmtRot = o.plugins?.rotulos?.fmt || (cbEixo ? v => cbEixo(v) : null);
  const base = {
    responsive: true, maintainAspectRatio: false, animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 },
    interaction: { mode: "index", intersect: false, axis: hz ? "y" : "x" },
    layout: { padding: rot ? (hz ? { right: 44 } : { top: 20 }) : 0 },
    plugins: { rotulos: fmtRot ? { fmt: fmtRot } : {}, legend: { display: false, align: "start", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, boxHeight: 10, padding: 16, color: css("--tinta-2"), font: { size: 12.5 } } },
      tooltip: { backgroundColor: "#00173D", titleColor: "#fff", bodyColor: "rgba(255,255,255,.88)", borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
        padding: { x: 12, y: 10 }, cornerRadius: 6, boxPadding: 4, usePointStyle: true, titleFont: { weight: "600" } } },
    elements: { line: { borderWidth: 2.25, tension: .3, borderCapStyle: "round" }, point: { radius: 0, hoverRadius: 5, hitRadius: 10, hoverBorderWidth: 2, hoverBorderColor: css("--sup") },
      bar: { borderRadius: 3, borderSkipped: "start" } },
    datasets: { bar: { maxBarThickness: hz ? 18 : 30, categoryPercentage: .72, barPercentage: .92 } },
    scales: cfg.type === "doughnut" || cfg.type === "pie" ? undefined : {
      [eixoCat]: { grid: { display: false }, border: { color: css("--eixo") }, ticks: { color: hz ? css("--tinta-2") : tinta, maxRotation: 0, autoSkipPadding: 14, font: { size: hz ? 12.5 : 12 } } },
      [eixoVal]: rot ? { display: false, beginAtZero: true, grid: { display: false } }
        : { grid: { color: grade, drawTicks: false }, border: { display: false }, ticks: { color: tinta, precision: 0, padding: 8, maxTicksLimit: 5, font: { size: 12 } }, beginAtZero: true },
    },
  };
  const g = new C(canvas, { ...cfg, options: fundir(base, o) });
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
export const estiloBarra = cor => ({ backgroundColor: cor, borderRadius: 3, borderSkipped: "start", borderColor: css("--sup"), borderWidth: 0 });

// ── gaveta lateral ── (diálogo modal: foco entra, fica preso no Tab, Esc fecha e o foco volta para quem abriu)
let origemGaveta = null;
const focaveis = g => $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', g).filter(e => e.offsetParent !== null);
export function gaveta(html) {
  let g = $(".gaveta"), v = $(".veu");
  if (!g) {
    v = Object.assign(document.createElement("div"), { className: "veu" });
    g = Object.assign(document.createElement("aside"), { className: "gaveta" });
    g.setAttribute("role", "dialog"); g.setAttribute("aria-modal", "true");
    document.body.append(v, g);
    v.onclick = fecharGaveta;
    document.addEventListener("keydown", e => {
      if (!g.classList.contains("aberta")) return;
      if (e.key === "Escape") { fecharGaveta(); return; }
      if (e.key !== "Tab") return;
      const f = focaveis(g); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  }
  if (!g.classList.contains("aberta")) origemGaveta = document.activeElement;
  g.innerHTML = `<button class="btn fechar" type="button">Fechar</button>${html}`;
  const tit = $("h1, h2, h3", g);
  if (tit) { tit.id ||= "gaveta-tit"; g.setAttribute("aria-labelledby", tit.id); g.removeAttribute("aria-label"); }
  else { g.removeAttribute("aria-labelledby"); g.setAttribute("aria-label", "Detalhe"); }
  $(".fechar", g).onclick = fecharGaveta;
  v.classList.add("aberto"); g.classList.add("aberta");
  $(".fechar", g).focus();
  return g;
}
export function fecharGaveta() {
  const g = $(".gaveta"); if (!g?.classList.contains("aberta")) return;
  g.classList.remove("aberta"); $(".veu")?.classList.remove("aberto");
  if (origemGaveta?.isConnected) origemGaveta.focus({ preventScroll: true });
  origemGaveta = null;
}

export const fonte = (rot, val) => `<span class="fonte">${esc(rot)}: <b>${esc(val)}</b></span>`;
export const opcoes = (vals, sel = "", todos = "Todos") =>
  `<option value="">${esc(todos)}</option>` + vals.map(v => `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");

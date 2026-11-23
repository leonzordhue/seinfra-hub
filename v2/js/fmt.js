// Formatação pt-BR. [Nexus] 23/11/2026
const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const n0 = nf(0, 0), n1 = nf(1, 1), n2 = nf(2, 2);

export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const num = (v, d = 0) => v == null || isNaN(v) ? "—" : (d === 0 ? n0 : d === 1 ? n1 : n2).format(v);
export const pct = (v, d = 1) => v == null || isNaN(v) ? "—" : `${num(v, d)}%`;
export const brl = v => v == null ? "—" : `R$ ${n2.format(v)}`;
export function brlCurto(v) {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `R$ ${n2.format(v / 1e9)} bi`;
  if (a >= 1e6) return `R$ ${n1.format(v / 1e6)} mi`;
  if (a >= 1e3) return `R$ ${n0.format(v / 1e3)} mil`;
  return `R$ ${n0.format(v)}`;
}
export function data(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
export const plural = (n, s, p) => `${num(n)} ${n === 1 ? s : p}`;
export const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// títulos de notícia chegam com entidades HTML (&#8216;)
export function desentidade(s) { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; }

// autoteste mínimo (roda no console em ?teste)
export function teste() {
  console.assert(brlCurto(2_410_982.61) === "R$ 2,4 mi", brlCurto(2_410_982.61));
  console.assert(data("2025-05-09") === "09/05/2025");
  console.assert(esc("<a>") === "&lt;a&gt;");
  console.assert(semAcento("Ponte São José") === "ponte sao jose");
}

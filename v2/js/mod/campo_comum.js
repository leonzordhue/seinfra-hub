// Apoio comum às ferramentas de campo (IRI pelo celular, Buracos por foto). [Claude] 23/11/2026
// Carrega bibliotecas externas sob demanda (versão exata, jsDelivr), mapa Leaflet e exportação de arquivos.

const carregados = new Map();
export function script(url) {
  if (!carregados.has(url)) carregados.set(url, new Promise((ok, erro) => {
    const s = Object.assign(document.createElement("script"), { src: url, async: true, crossOrigin: "anonymous" });
    s.onload = ok; s.onerror = () => { carregados.delete(url); erro(new Error("Não carregou " + url)); };
    document.head.append(s);
  }));
  return carregados.get(url);
}
export function folha(url) {
  if (!document.querySelector(`link[href="${url}"]`)) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: url }));
}
export function estilo(id, texto) {
  if (!document.getElementById(id)) document.head.append(Object.assign(document.createElement("style"), { id, textContent: texto }));
}

// Visual de app de campo (celular na mão, sol, pressa): botões grandes, estado claro, leitura grande.
const CSS_CAMPO = `
.cp-painel{display:grid;gap:14px}
.cp-estado{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--raio);background:var(--sup-2);border:1px solid var(--borda);font-size:14.5px;color:var(--tinta-2);min-height:46px}
.cp-estado .ponto{width:12px;height:12px;border-radius:50%;background:var(--tinta-3);flex:none}
.cp-estado p{margin:0}
.gravando .cp-estado{background:var(--critico-bg);border-color:var(--critico);color:var(--tinta)}
.gravando .cp-estado .ponto{background:var(--critico);animation:cp-pulso 1.2s ease-in-out infinite}
.gravando .cp-estado b.cp-rot{color:var(--critico)}
@keyframes cp-pulso{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.gravando .cp-estado .ponto{animation:none}}
.cp-btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px}
.cp-btns .btn{justify-content:center;min-height:56px;font-size:17px;font-weight:600;border-radius:8px;position:relative}
.cp-btns .btn:disabled{opacity:.45;cursor:not-allowed}
.btn.cp-parar{border:2px solid var(--critico);color:var(--critico);background:var(--sup)}
.btn.cp-parar:not(:disabled){background:var(--critico);color:#fff}
:root[data-theme="dark"] .btn.cp-parar:not(:disabled){color:#1A0B0A}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .btn.cp-parar:not(:disabled){color:#1A0B0A}}
.cp-btns label.btn input{position:absolute;width:1px;height:1px;opacity:0}
.cp-btns label.btn:focus-within{outline:2px solid var(--ouro);outline-offset:2px}
.cp-leit{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--borda);border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden}
.cp-leit > div{background:var(--sup);padding:14px 16px 16px;min-width:0}
.cp-leit .rot{font-size:12.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--tinta-3)}
.cp-num{font:600 clamp(44px,11vw,68px)/1 var(--f-titulo);color:var(--tinta);font-variant-numeric:tabular-nums;margin-top:8px;letter-spacing:-.02em}
.cp-num small{font:400 16px var(--f-corpo);color:var(--tinta-3);margin-left:4px;letter-spacing:0}
.cp-sub{font-size:13.5px;color:var(--tinta-2);margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cp-classe{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--tinta)}
.cp-classe::before{content:"";width:14px;height:14px;border-radius:3px;background:var(--c)}
.cp-fora{background:var(--alerta-bg) !important}
.cp-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--borda);border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden}
.cp-mini > div{background:var(--sup);padding:10px 12px}
.cp-mini .rot{font-size:12px;color:var(--tinta-3)}
.cp-mini .v{font:600 20px/1.2 var(--f-titulo);color:var(--tinta);font-variant-numeric:tabular-nums;margin-top:2px}
.cp-mini .s{font-size:11.5px;color:var(--tinta-3)}
.cp-sec{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:12px;border-top:1px dashed var(--borda);font-size:13.5px;color:var(--tinta-3)}
.cp-sec .btn{padding:6px 11px;font-size:13.5px}
.cp-ajuda{font-size:13.5px;color:var(--tinta-2)}
.cp-ajuda summary{cursor:pointer;font-weight:600;color:var(--tinta)}
.cp-ajuda ul{margin:6px 0 0;padding-left:18px}
@media (max-width:600px){.cp-mini{grid-template-columns:1fr 1fr 1fr}.cp-mini .v{font-size:17px}.cp-leit > div{padding:12px}}
`;
export const estiloCampo = () => estilo("campo-css", CSS_CAMPO);

const LEAFLET ="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/";
export async function mapa(el) {
  folha(LEAFLET + "leaflet.css");
  await script(LEAFLET + "leaflet.js");
  const L = window.L;
  const m = L.map(el, { preferCanvas: true }).setView([-3.4653, -62.2159], 6);  // centro AM (CLAUDE.md)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
  return { L, m };
}

export function baixar(nome, conteudo, tipo) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// CSV separado por ";" com ponto decimal (abre direto em GIS); BOM para o Excel ler acento
export const csv = (cab, linhas) => "﻿" + [cab, ...linhas].map(l => l.map(v => {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(";")).join("\n");

// distância em metros (haversine, raio médio 6.371 km)
export function dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn(e); return false; } };
export const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } };

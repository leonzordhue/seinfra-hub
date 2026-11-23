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

const LEAFLET = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/";
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

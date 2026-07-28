// Sonda das fontes de dados do DMOB Hub.
// Roda no GitHub Actions (semanal) e localmente: `node scripts/sonda_fontes.mjs`
// Sai com código 1 se qualquer fonte crítica falhar — o workflow abre issue.
//
// As URLs/keys abaixo espelham as constantes do index.html (são públicas lá).

const CHECKS = [
  {
    nome: "Planilha Geral (contratos, Sheets API v4)",
    url: "https://sheets.googleapis.com/v4/spreadsheets/1LJTtvldaYyHuMnsF04gim2eZPhIqzy5CbEnOZ1zTCoM/values/" +
         encodeURIComponent("Planilha Geral!A:DB") + "?key=AIzaSyDaitkJNDTZi3BMFAe9u4wV6U-DIgUS7NA",
    valida: async r => {
      const j = await r.json();
      const n = (j.values || []).length;
      return n >= 100 ? { ok: true, detalhe: `${n} linhas` } : { ok: false, detalhe: `só ${n} linhas (esperado ≥100)` };
    },
  },
  {
    nome: "Planilha Ramais (Sheets API v4)",
    url: "https://sheets.googleapis.com/v4/spreadsheets/1Cr5Qbj_My7oOcIYiIjZ6NgJiCsij4ZAQCSxdP49cffc/values/" +
         encodeURIComponent("Ramais!A:BK") + "?key=AIzaSyBrK45p0mev1t5NyDJomdDIvJTe2DWaojA",
    valida: async r => {
      const j = await r.json();
      const n = (j.values || []).length;
      return n >= 500 ? { ok: true, detalhe: `${n} linhas` } : { ok: false, detalhe: `só ${n} linhas (esperado ≥500)` };
    },
  },
  {
    nome: "Rodovias estaduais (gviz)",
    url: "https://docs.google.com/spreadsheets/d/1bYf2anVF4un84-lusSOeSRaNLiod9fq0joUEnbgHxnM/gviz/tq?tqx=out:json",
    valida: async r => {
      const t = await r.text();
      const m = t.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
      if (!m) return { ok: false, detalhe: "resposta gviz inválida" };
      const rows = (JSON.parse(m[1]).table || {}).rows || [];
      return rows.length >= 40 ? { ok: true, detalhe: `${rows.length} trechos` } : { ok: false, detalhe: `só ${rows.length} trechos (esperado ≥40) — filtro interno na planilha?` };
    },
  },
  {
    nome: "Sinistros (gviz)",
    url: "https://docs.google.com/spreadsheets/d/1y7h-FRn0jBfhlr9e7EwDBNES-0hCUhSeAf5s4tVEWxE/gviz/tq?tqx=out:json",
    valida: async r => {
      const t = await r.text();
      return /setResponse\(/.test(t) ? { ok: true, detalhe: "responde" } : { ok: false, detalhe: "resposta gviz inválida" };
    },
  },
  {
    nome: "ICM (gviz)",
    url: "https://docs.google.com/spreadsheets/d/1m9p9nSTwEJJcuIyEXk8KJ8XO9TtzG7spqVUFKC6KBiM/gviz/tq?tqx=out:json&gid=1165654835",
    valida: async r => {
      const t = await r.text();
      return /setResponse\(/.test(t) ? { ok: true, detalhe: "responde" } : { ok: false, detalhe: "resposta gviz inválida" };
    },
  },
  {
    nome: "Licitações SEAPLANC (CSV publicado, aba 2025/2026)",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ8TaCyviHwgIVX4pYCFec13YRBNfwDgfY_eJlI7cVN-uFqdyp-UK7EckBrLr2MdpTRrRTmKPGxknfe/pub?gid=32069800&single=true&output=csv",
    valida: async r => {
      const t = await r.text();
      return /OBJETO DA OBRA/i.test(t) ? { ok: true, detalhe: `${t.length} bytes, header presente` } : { ok: false, detalhe: "header 'OBJETO DA OBRA' não encontrado — planilha despublicada ou reestruturada" };
    },
  },
  {
    nome: "GeoJSON Ramais (CDN atlas-amazonas)",
    url: "https://leonzordhue.github.io/atlas-amazonas/geojson/RAMAIS_SEINFRA.geojson",
    valida: async r => {
      const n = ((await r.json()).features || []).length;
      return n >= 900 ? { ok: true, detalhe: `${n} features` } : { ok: false, detalhe: `só ${n} features (esperado ≥900)` };
    },
  },
  {
    nome: "GeoJSON Rodovias estaduais (CDN atlas-amazonas)",
    url: "https://leonzordhue.github.io/atlas-amazonas/geojson/RODOVIAS_ESTADUAIS_AMAZONAS.geojson",
    valida: async r => {
      const n = ((await r.json()).features || []).length;
      return n >= 40 ? { ok: true, detalhe: `${n} features` } : { ok: false, detalhe: `só ${n} features (esperado ≥40)` };
    },
  },
  {
    nome: "GeoJSON Municípios (CDN atlas-amazonas)",
    url: "https://leonzordhue.github.io/atlas-amazonas/geojson/AM_MUNICIPIOS.geojson",
    valida: async r => {
      const n = ((await r.json()).features || []).length;
      return n >= 60 ? { ok: true, detalhe: `${n} municípios` } : { ok: false, detalhe: `só ${n} (esperado 62)` };
    },
  },
  {
    nome: "Hub publicado (GitHub Pages)",
    url: "https://leonzordhue.github.io/seinfra-hub/index.html",
    valida: async r => {
      const t = await r.text();
      return t.includes("DMOB") ? { ok: true, detalhe: `${t.length} bytes` } : { ok: false, detalhe: "conteúdo inesperado" };
    },
  },
];

const falhas = [];
for (const c of CHECKS) {
  try {
    const r = await fetch(c.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) { falhas.push(`${c.nome}: HTTP ${r.status}`); console.log(`FALHA  ${c.nome} — HTTP ${r.status}`); continue; }
    const v = await c.valida(r);
    if (v.ok) console.log(`OK     ${c.nome} — ${v.detalhe}`);
    else { falhas.push(`${c.nome}: ${v.detalhe}`); console.log(`FALHA  ${c.nome} — ${v.detalhe}`); }
  } catch (e) {
    falhas.push(`${c.nome}: ${e.message}`);
    console.log(`FALHA  ${c.nome} — ${e.message}`);
  }
}

console.log(`\n${CHECKS.length - falhas.length}/${CHECKS.length} fontes OK`);
if (falhas.length) {
  // Resumo para o corpo da issue (lido pelo workflow)
  const fs = await import("fs");
  fs.writeFileSync("sonda_falhas.txt", falhas.join("\n"));
  process.exit(1);
}

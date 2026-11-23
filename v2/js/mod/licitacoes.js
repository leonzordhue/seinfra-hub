// Licitações da SEINFRA (PNCP + CSC-AM). [Nexus] 23/11/2026
// Fonte: data/licitacoes.json (pipelines/licitacoes/coletar.py, dias úteis 07h30). Desconto = 1 − homologado/estimado.
import { talvez } from "../dados.js";
import { esc, num, pct, data, brlCurto, semAcento } from "../fmt.js";
import { $, kpi, chip, tabela, fonte, opcoes } from "../ui.js";

const estado = { rod: true, sit: "", mod: "", q: "" };
const aberta = l => /Divulgada|aberta|andamento/i.test(l.situacao || "") && (!l.encerramento || l.encerramento >= hoje());
const hoje = () => new Date().toISOString().slice(0, 10);

export async function render(el) {
  const d = await talvez("licitacoes");
  if (!d) {
    el.innerHTML = `<div class="cab"><div><h1>Licitações</h1></div></div><div class="aviso">Os dados de licitações ainda não foram gerados. A rotina <code>pipelines/licitacoes/coletar.py</code> roda nos dias úteis às 07h30.</div>`;
    return;
  }
  const M = d._meta, P = d.pncp;
  const sits = [...new Set(P.map(l => l.situacao).filter(Boolean))].sort();
  const mods = [...new Set(P.map(l => l.modalidade).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="cab"><div><h1>Licitações</h1>
      <p>Editais da SEINFRA publicados no PNCP e na lista do CSC-AM. O filtro "modal rodoviário" separa os objetos de rodovia, ramal, estrada, ponte, drenagem e viário.</p></div>
      <div class="fontes">${fonte("PNCP e CSC", data(M.gerado))}${fonte("editais no PNCP", num(M.total_pncp))}</div></div>
    <div class="filtros">
      <div class="seg" id="fRod"><button type="button" data-v="1" aria-pressed="${estado.rod}">Modal rodoviário</button><button type="button" data-v="" aria-pressed="${!estado.rod}">Todas</button></div>
      <select id="fSit" aria-label="Situação">${opcoes(sits, estado.sit, "Todas as situações")}</select>
      <select id="fMod" aria-label="Modalidade">${opcoes(mods, estado.mod, "Todas as modalidades")}</select>
      <input type="search" id="fQ" placeholder="Buscar objeto, edital, processo…" aria-label="Buscar">
    </div>
    <div id="kpis" class="grade g-kpi"></div>
    <section class="secao cartao"><header><div><h2>Editais no PNCP</h2><p>${esc(M.regras)}</p></div><span class="contagem" id="cont"></span></header><div class="corpo" id="tab"></div></section>
    <section class="secao cartao"><header><div><h2>Lista do CSC-AM (SEINFRA)</h2><p>O site do CSC não lista as concorrências eletrônicas de 2024 em diante; para elas vale o PNCP.</p></div></header><div class="corpo" id="tabCsc"></div></section>`;

  const pinta = () => {
    const q = semAcento(estado.q);
    const fl = P.filter(l => (!estado.rod || l.rodoviario) && (!estado.sit || l.situacao === estado.sit) && (!estado.mod || l.modalidade === estado.mod) &&
      (!q || semAcento(`${l.objeto} ${l.edital} ${l.processo}`).includes(q)));
    const ab = fl.filter(aberta);
    const hom = fl.filter(l => l.desconto != null);
    const descMed = hom.length ? hom.reduce((s, l) => s + l.desconto * l.estimado, 0) / hom.reduce((s, l) => s + l.estimado, 0) : null;
    $("#kpis", el).innerHTML =
      kpi("Editais", num(fl.length), `${num(fl.filter(l => l.publicacao >= `${new Date().getFullYear()}-01-01`).length)} publicados neste ano`) +
      kpi("Abertos", num(ab.length), "propostas ainda não encerradas", true) +
      kpi("Estimado (abertos)", brlCurto(ab.reduce((s, l) => s + (l.estimado || 0), 0)), "valor estimado publicado") +
      kpi("Homologado", brlCurto(hom.reduce((s, l) => s + l.homologado, 0)), `${num(hom.length)} editais com resultado`) +
      kpi("Desconto médio", pct(descMed == null ? null : descMed * 100), "ponderado pelo estimado");
    $("#cont", el).textContent = `${num(fl.length)} editais`;
    tabela($("#tab", el), [
      { k: "publicacao", rot: "Publicação", html: l => data(l.publicacao) },
      { k: "edital", rot: "Edital", html: l => `<a href="${esc(l.link)}" target="_blank" rel="noopener"><b>${esc(l.edital)}</b></a><div class="peq">${esc(l.modalidade)}</div>` },
      { k: "objeto", rot: "Objeto", html: l => `<div class="obj">${esc(l.objeto.slice(0, 220))}</div>${l.processo ? `<div class="peq">Processo ${esc(l.processo)}</div>` : ""}` },
      { k: "situacao", rot: "Situação", html: l => chip(l.situacao || "—", aberta(l) ? "ok" : /Revogada|Anulada|Deserta|Fracassada|Suspensa/i.test(l.situacao) ? "alerta" : "") },
      { k: "encerramento", rot: "Propostas até", html: l => data(l.encerramento) },
      { k: "estimado", rot: "Estimado", n: 1, html: l => l.estimado ? brlCurto(l.estimado) : "sigiloso" },
      { k: "homologado", rot: "Homologado", n: 1, html: l => l.homologado ? brlCurto(l.homologado) : "—" },
      { k: "desconto", rot: "Desconto", n: 1, html: l => l.desconto == null ? "—" : pct(l.desconto * 100) },
    ], fl, { ordem: { k: "publicacao", dir: -1 } });
    const csc = d.csc.filter(l => (!estado.rod || l.rodoviario) && (!q || semAcento(`${l.objeto} ${l.numero}`).includes(q)));
    tabela($("#tabCsc", el), [
      { k: "numero", rot: "Número", html: l => l.link ? `<a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.numero)}</a>` : esc(l.numero) },
      { k: "objeto", rot: "Objeto", html: l => `<div class="obj">${esc((l.objeto || "").slice(0, 220))}</div>` },
      { k: "tipo", rot: "Tipo" }, { k: "data", rot: "Data" }, { k: "status", rot: "Status" },
    ], csc, { limite: 100 });
  };
  $("#fRod", el).onclick = e => { const b = e.target.closest("button"); if (!b) return; estado.rod = !!b.dataset.v;
    $("#fRod", el).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); pinta(); };
  $("#fSit", el).onchange = e => { estado.sit = e.target.value; pinta(); };
  $("#fMod", el).onchange = e => { estado.mod = e.target.value; pinta(); };
  let t; $("#fQ", el).oninput = e => { clearTimeout(t); t = setTimeout(() => { estado.q = e.target.value; pinta(); }, 150); };
  pinta();
}

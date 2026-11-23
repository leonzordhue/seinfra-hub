// Licitações da SEINFRA (PNCP + CSC-AM). [Nexus] 23/11/2026
// Fonte: data/licitacoes.json (pipelines/licitacoes/coletar.py, dias úteis 07h30). Desconto = 1 − homologado/estimado.
import { talvez } from "../dados.js";
import { esc, num, pct, data, brl, brlCurto, semAcento } from "../fmt.js";
import { $, kpi, chip, tabela, fonte, opcoes } from "../ui.js";

const estado = { rod: true, sit: "", mod: "", q: "" };
const aberta = l => /Divulgada|aberta|andamento/i.test(l.situacao || "") && (!l.encerramento || l.encerramento >= hoje());
// o objeto do PNCP vem cortado; a descrição do 1º item tem o texto inteiro
const texto = l => l.descricao || l.objeto || "";
const hoje = () => new Date().toISOString().slice(0, 10);
// v3: tabelas enxutas, preços × SICRO com distribuição por faixa e barra de desvio. [Claude] 23/11/2026
const ESTILO = `<style>
  #tab .obj, #tabCsc .obj, #pTab .obj, #pCompras .obj, #sTab .obj { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .dist { margin: 16px 0 14px; }
  .dist-b { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--sup-3); }
  .dist-b i { display: block; height: 100%; }
  .dist .legenda { margin: 8px 0 0; }
  .dist .legenda b { color: var(--tinta); font-weight: 600; margin-left: 4px; }
  .dv { display: grid; justify-items: end; gap: 4px; }
  .dv b { font-weight: 600; color: var(--tinta); }
  .dv-b { position: relative; display: block; width: 96px; height: 6px; background: var(--sup-3); border-radius: 3px; }
  .dv-b::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: var(--eixo); }
  .dv-b i { position: absolute; top: 0; bottom: 0; background: var(--s6); }
  .dv-b.ok i { background: var(--ok); } .dv-b.alerta i { background: var(--alerta); } .dv-b.critico i { background: var(--critico); }
  #precos h3.sub { font: 600 11.5px var(--f-corpo); letter-spacing: .06em; text-transform: uppercase; color: var(--tinta-3); margin: 24px 0 8px; padding-bottom: 6px; border-bottom: 2px solid var(--azul); }
</style>`;

export async function render(el) {
  const d = await talvez("licitacoes");
  if (!d) {
    el.innerHTML = `<div class="cab"><div><h1>Licitações</h1></div></div><div class="aviso">Os dados de licitações ainda não foram gerados. A rotina <code>pipelines/licitacoes/coletar.py</code> roda nos dias úteis às 07h30.</div>`;
    return;
  }
  const M = d._meta, P = d.pncp;
  const sits = [...new Set(P.map(l => l.situacao).filter(Boolean))].sort();
  const mods = [...new Set(P.map(l => l.modalidade).filter(Boolean))].sort();
  el.innerHTML = `${ESTILO}
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
    <section class="secao cartao"><header><div><h2>Lista do CSC-AM (SEINFRA)</h2><p>O site do CSC não lista as concorrências eletrônicas de 2024 em diante; para elas vale o PNCP.</p></div></header><div class="corpo" id="tabCsc"></div></section>
    <div id="precos"></div>`;
  precos($("#precos", el));

  const pinta = () => {
    const q = semAcento(estado.q);
    const fl = P.filter(l => (!estado.rod || l.rodoviario) && (!estado.sit || l.situacao === estado.sit) && (!estado.mod || l.modalidade === estado.mod) &&
      (!q || semAcento(`${texto(l)} ${l.edital} ${l.processo}`).includes(q)));
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
      { k: "objeto", rot: "Objeto", html: l => `<div class="obj" title="${esc(texto(l))}">${esc(texto(l))}</div>${l.processo ? `<div class="peq">Processo ${esc(l.processo)}</div>` : ""}` },
      { k: "situacao", rot: "Situação", html: l => chip(l.situacao || "—", aberta(l) ? "ok" : /Revogada|Anulada|Deserta|Fracassada|Suspensa/i.test(l.situacao) ? "alerta" : "") },
      { k: "encerramento", rot: "Propostas até", html: l => data(l.encerramento) },
      { k: "estimado", rot: "Estimado", n: 1, html: l => l.estimado ? brlCurto(l.estimado) : "sigiloso" },
      { k: "homologado", rot: "Homologado", n: 1, html: l => l.homologado ? brlCurto(l.homologado) : "—" },
      { k: "desconto", rot: "Desconto", n: 1, html: l => l.desconto == null ? "—" : pct(l.desconto * 100) },
    ], fl, { ordem: { k: "publicacao", dir: -1 } });
    const csc = d.csc.filter(l => (!estado.rod || l.rodoviario) && (!q || semAcento(`${l.objeto} ${l.numero}`).includes(q)));
    tabela($("#tabCsc", el), [
      { k: "numero", rot: "Número", html: l => l.link ? `<a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.numero)}</a>` : esc(l.numero) },
      { k: "objeto", rot: "Objeto", html: l => `<div class="obj" title="${esc(l.objeto)}">${esc(l.objeto || "")}</div>` },
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

// ── Preços x SICRO ── [Claude] 23/11/2026
// Fonte: data/precos.json (pipelines/licitacoes/precos.py) e data/sicro_am.json (DNIT, SICRO AM, sintético).
// desvio = (preço unitário / (1 + BDI do orçamento)) / custo SICRO da mesma data-base - 1 (SICRO = custo direto, sem BDI).
// Faixas de TRIAGEM (não é conclusão de sobrepreço): |desvio| <= 10% dentro; > 25% muito acima.
const pe = { faixa: "casadas", conf: "", ed: "", q: "" };
const FAIXA = { dentro: ["dentro de ±10%", "ok"], acima: ["acima", "alerta"], "muito acima": ["muito acima (>25%)", "critico"], abaixo: ["abaixo", ""] };
const fx = d => d == null ? "—" : `${d > 0 ? "+" : ""}${pct(d * 100)}`;
const refBr = r => r ? `${r.slice(5)}/${r.slice(0, 4)}` : "—";
// cor da faixa: status (ok/alerta/crítico); "abaixo" fica neutro
const COR_FX = { abaixo: "var(--s6)", dentro: "var(--ok)", acima: "var(--alerta)", "muito acima": "var(--critico)" };
// barra divergente: centro = SICRO; escala ±100% (desvios maiores encostam na ponta)
function barraDesvio(i) {
  if (i.desvio == null) return "—";
  const v = Math.max(-1, Math.min(1, i.desvio)) * 50;
  return `<div class="dv"><b>${fx(i.desvio)}</b><span class="dv-b ${FAIXA[i.faixa]?.[1] || ""}" aria-hidden="true"><i style="${v >= 0 ? `left:50%;width:${v}%` : `right:50%;width:${-v}%`}"></i></span></div>`;
}

async function precos(el) {
  const d = await talvez("precos");
  if (!d) { el.innerHTML = `<section class="secao cartao"><header><div><h2>Preços × SICRO</h2></div></header><div class="corpo"><p class="vazio">O comparativo ainda não foi gerado (<code>pipelines/licitacoes/precos.py</code>).</p></div></section>`; return; }
  const M = d._meta, I = d.itens, C = d.compras;
  const eds = [...new Set(I.map(i => i.edital))].sort();
  el.innerHTML = `
    <section class="secao cartao"><header><div><h2>Preços × SICRO</h2>
      <p>Preço unitário da planilha orçamentária anexada ao edital no PNCP contra o custo SICRO AM (DNIT) da mesma data-base, descontado o BDI declarado no orçamento. As faixas são critério de <b>triagem</b> para olhar a composição, não conclusão de sobrepreço.</p></div>
      <div class="fontes">${fonte("PNCP + SICRO", data(M.gerado_em))}${fonte("linhas casadas", `${num(M.casadas)} de ${num(M.linhas_planilha)}`)}</div></header>
      <div class="corpo">
        <div class="filtros">
          <select id="pFx" aria-label="Faixa"><option value="casadas">Com par no SICRO</option><option value="">Todas as linhas</option>${Object.entries(FAIXA).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join("")}<option value="sem">Sem par no SICRO</option></select>
          <select id="pConf" aria-label="Confiança"><option value="">Qualquer confiança</option><option value="alta">Pelo código SICRO</option><option value="texto">Por semelhança de texto</option></select>
          <select id="pEd" aria-label="Edital">${opcoes(eds, pe.ed, "Todos os editais")}</select>
          <input type="search" id="pQ" placeholder="Buscar serviço ou código…" aria-label="Buscar serviço">
        </div>
        <div id="pKpi" class="grade g-kpi"></div>
        <div id="pDist" class="dist"></div>
        <div id="pTab"></div>
        <h3 class="sub">Compras analisadas</h3>
        <div id="pCompras"></div>
        <p class="peq" style="color:var(--tinta-3);font-size:12.5px;margin-top:10px">${esc(M.metodologia)} BDI de referência para obra rodoviária: cerca de 20% a 30% (Acórdão TCU 2622/2013-Plenário).</p>
      </div></section>
    <section class="secao cartao"><header><div><h2>Consultar o SICRO AM</h2><p>Busca no extrato do SICRO (composições, materiais, equipamentos e mão de obra) por código ou termo. Custo de composição = custo direto sem BDI, sem desoneração.</p></div><span class="contagem" id="sCont"></span></header>
      <div class="corpo"><div class="filtros"><input type="search" id="sQ" placeholder="Ex.: 4011459, concreto asfáltico, imprimação…" aria-label="Buscar no SICRO"></div><div id="sTab"><p class="vazio">Digite ao menos 3 letras ou um código.</p></div></div></section>`;

  const pinta = () => {
    const q = semAcento(pe.q);
    const fl = I.filter(i => (pe.faixa === "" || (pe.faixa === "casadas" ? i.sicro_codigo : pe.faixa === "sem" ? !i.sicro_codigo : i.faixa === pe.faixa)) &&
      (!pe.conf || (i.confianca || "").includes(pe.conf)) && (!pe.ed || i.edital === pe.ed) &&
      (!q || semAcento(`${i.codigo} ${i.descricao} ${i.sicro_codigo || ""}`).includes(q)));
    const cas = fl.filter(i => i.desvio != null);
    $("#pKpi", el).innerHTML =
      kpi("Linhas", num(fl.length), `de ${num(I.length)} lidas em ${num(M.com_planilha_lida)} planilhas`) +
      kpi("Com par no SICRO", pct(I.length ? M.casadas / I.length * 100 : null), `${num(M.casadas_por_codigo)} pelo código; ${pct((M.valor_casado_pct || 0) * 100)} do valor`) +
      kpi("Dentro de ±10%", num(cas.filter(i => i.faixa === "dentro").length), "linhas filtradas", true) +
      kpi("Muito acima (>25%)", num(cas.filter(i => i.faixa === "muito acima").length), "olhar a composição");
    // distribuição das linhas casadas por faixa (parte-todo: barra 100% empilhada)
    const fxs = ["abaixo", "dentro", "acima", "muito acima"].map(k => ({ k, n: cas.filter(i => i.faixa === k).length })).filter(x => x.n);
    $("#pDist", el).innerHTML = cas.length ? `<div class="dist-b" role="img" aria-label="${esc(fxs.map(x => `${FAIXA[x.k][0]}: ${x.n}`).join("; "))}">${fxs.map(x => `<i style="width:${x.n / cas.length * 100}%;background:${COR_FX[x.k]}" title="${esc(FAIXA[x.k][0])}: ${num(x.n)}"></i>`).join("")}</div>
      <div class="legenda">${fxs.map(x => `<span><i style="background:${COR_FX[x.k]}"></i>${esc(FAIXA[x.k][0])}<b>${num(x.n)}</b> (${pct(x.n / cas.length * 100, 0)})</span>`).join("")}</div>` : "";
    tabela($("#pTab", el), [
      { k: "edital", rot: "Edital", html: i => `<b>${esc(i.edital)}</b><div class="peq">item ${esc(i.item)}</div>` },
      { k: "descricao", rot: "Serviço (planilha)", html: i => `<div class="obj" title="${esc(i.descricao)}">${esc(i.descricao)}</div><div class="peq">${esc(i.tabela)} ${esc(i.codigo)} · ${num(i.quantidade, 2)} ${esc(String(i.unidade || "").toLowerCase())}</div>` },
      { k: "preco_unitario", rot: "Preço orçado", n: 1, html: i => `${brl(i.preco_unitario)}<div class="peq">BDI ${i.bdi == null ? "não declarado" : pct(i.bdi * 100, 2)}</div>` },
      { k: "sicro_custo_ref", rot: "SICRO", n: 1, html: i => i.sicro_codigo ? `${brl(i.sicro_custo_ref)}<div class="peq" title="${esc(i.sicro_descricao)}">${esc(i.sicro_codigo)} · ${refBr(i.sicro_ref)}</div>` : "—" },
      { k: "desvio", rot: "Desvio", n: 1, html: barraDesvio },
      { k: "faixa", rot: "Triagem", v: i => i.desvio, html: i => (i.faixa ? chip(FAIXA[i.faixa][0], FAIXA[i.faixa][1]) : `<span class="peq">${i.sicro_codigo ? "sem custo na data-base" : "sem par"}</span>`)
        + (i.confianca ? `<div class="peq" title="Como a linha foi casada com o SICRO">par ${esc(i.confianca)}${i.similaridade != null ? ` · ${num(i.similaridade * 100)}%` : ""}</div>` : "") },
    ], fl, { ordem: { k: "desvio", dir: -1 }, limite: 80 });
  };
  tabela($("#pCompras", el), [
    { k: "edital", rot: "Edital", html: c => `<a href="${esc(c.link)}" target="_blank" rel="noopener"><b>${esc(c.edital)}</b></a><div class="peq">${data(c.publicacao)}</div>` },
    { k: "objeto", rot: "Objeto e achados", html: c => `<div class="obj" title="${esc(c.objeto)}">${esc(c.objeto || "")}</div>${c.achados.map(a => `<div class="peq">${esc(a)}</div>`).join("")}` },
    { k: "planilha", rot: "Planilha", v: c => c.planilha?.linhas || 0, html: c => c.planilha ? `<a href="${esc(c.planilha.url)}" target="_blank" rel="noopener">PDF</a><div class="peq">${c.planilha.linhas ? `${num(c.planilha.casadas)}/${num(c.planilha.linhas)} casadas · base ${c.planilha.data_base.map(refBr).join(", ")}` : "não lida"}</div>` : "—" },
    { k: "estimado", rot: "Estimado", n: 1, html: c => brlCurto(c.estimado) },
    { k: "homologado", rot: "Homologado", n: 1, html: c => brlCurto(c.homologado) },
    { k: "valor_por_km", rot: "Valor por km", n: 1, html: c => c.valor_por_km ? `${brlCurto(c.valor_por_km)}<div class="peq">${num(c.extensao_km, 2)} km</div>` : "—" },
  ], C, { ordem: { k: "planilha", dir: -1 } });
  $("#pFx", el).value = pe.faixa; $("#pConf", el).value = pe.conf;
  $("#pFx", el).onchange = e => { pe.faixa = e.target.value; pinta(); };
  $("#pConf", el).onchange = e => { pe.conf = e.target.value; pinta(); };
  $("#pEd", el).onchange = e => { pe.ed = e.target.value; pinta(); };
  let t; $("#pQ", el).oninput = e => { clearTimeout(t); t = setTimeout(() => { pe.q = e.target.value; pinta(); }, 150); };
  pinta();

  // o extrato SICRO tem ~1,2 MB: só baixa quando a pessoa começa a buscar
  let S = null, ts;
  $("#sQ", el).oninput = e => { clearTimeout(ts); ts = setTimeout(async () => {
    const q = semAcento(e.target.value.trim());
    if (q.length < 3) { $("#sTab", el).innerHTML = `<p class="vazio">Digite ao menos 3 letras ou um código.</p>`; $("#sCont", el).textContent = ""; return; }
    if (!S) {
      $("#sTab", el).innerHTML = `<p class="vazio">Carregando o SICRO…</p>`;
      const s = await talvez("sicro_am");
      if (!s) { $("#sTab", el).innerHTML = `<p class="vazio">Extrato SICRO indisponível.</p>`; return; }
      S = { ref: s._meta.referencia, l: [
        ...s.comp.map(c => ({ tipo: "Composição", cod: c[0], desc: c[1], un: c[2], v: c[3], vd: null })),
        ...s.mat.map(c => ({ tipo: "Material", cod: c[0], desc: c[1], un: c[2], v: c[3], vd: null })),
        ...s.equip.map(c => ({ tipo: "Equipamento", cod: c[0], desc: c[1], un: "h (produtivo)", v: c[2], vd: c[4] })),
        ...s.mo.map(c => ({ tipo: "Mão de obra", cod: c[0], desc: c[1], un: c[2], v: c[3], vd: c[4] })),
      ].map(x => ({ ...x, k: semAcento(`${x.cod} ${x.desc}`) })) };
    }
    const r = S.l.filter(x => q.split(/\s+/).every(w => x.k.includes(w)));
    $("#sCont", el).textContent = `${num(r.length)} itens · SICRO AM ${refBr(S.ref)}`;
    tabela($("#sTab", el), [
      { k: "cod", rot: "Código", html: x => `<b>${esc(x.cod)}</b><div class="peq">${esc(x.tipo)}</div>` },
      { k: "desc", rot: "Descrição", html: x => `<div class="obj" title="${esc(x.desc)}">${esc(x.desc)}</div>` },
      { k: "un", rot: "Unid." },
      { k: "v", rot: "Custo (sem deson.)", n: 1, html: x => brl(x.v) },
      { k: "vd", rot: "Com desoneração", n: 1, html: x => x.vd == null ? "—" : brl(x.vd) },
    ], r, { limite: 100 });
  }, 200); };
}

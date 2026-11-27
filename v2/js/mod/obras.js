// Obras e contratos do modal rodoviário (e-Obras). [Nexus] 23/11/2026
// Fonte: data/eobras.json (exportar_hub.py, rotina de segunda 10h). Regras: valor atual = original + aditado;
// % financeiro = medido / valor atual; saldo = valor atual - medido (ver _meta.regras).
import { contratos, MODAIS, REGRAS, municipios, RISCO_PESOS, FAIXAS_RISCO } from "../dados.js";
import { esc, brl, brlCurto, pct, data, num, semAcento } from "../fmt.js";
import { $, kpi, chip, chipSit, barra, tabela, grafico, gaveta, fonte, opcoes, serie } from "../ui.js";
import { curvaContrato, legendaCurva } from "./briefings.js";

// v3: gráfico de modal com rótulo, tabela enxuta, ficha diagramada. [Claude] 23/11/2026
const ESTILO = `<style>
  .nota-risco.pq { width: 30px; height: 26px; font-size: 13px; display: inline-grid; }
  .ob-al { font-size: 12px; margin-top: 4px; max-width: 24ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ob-al.critico { color: var(--critico); } .ob-al.alerta { color: var(--alerta); }
  #tab .obj { min-width: 220px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .t-modal { font-size: 13px; margin-top: 10px; }
  .t-modal td, .t-modal th { padding: 6px 10px; }
  .fc-tipo { display: block; font: 600 12px var(--f-corpo); letter-spacing: .06em; text-transform: uppercase; color: var(--ouro-2); margin: 6px 0 4px; }
  .fc-id { font-size: 1.3rem; }
  .fc-obj { color: var(--tinta); margin: 8px 0 10px; line-height: 1.5; }
  .fc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .fc-kpi { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--borda); border: 1px solid var(--borda); border-radius: var(--raio); overflow: hidden; margin: 16px 0 4px; }
  .fc-kpi div { background: var(--sup); padding: 10px 12px; }
  .fc-kpi span { display: block; font-size: 12px; color: var(--tinta-3); }
  .fc-kpi b { display: block; font: 600 1.05rem/1.25 var(--f-titulo); color: var(--tinta); margin-top: 2px; font-variant-numeric: tabular-nums; }
  .fc-kpi small { font-size: 12px; color: var(--tinta-3); }
  .gaveta h3.fc-h { font: 600 12px var(--f-corpo); letter-spacing: .06em; text-transform: uppercase; color: var(--tinta-3); margin: 20px 0 4px; padding-bottom: 6px; border-bottom: 2px solid var(--azul); }
  .gaveta dl.ficha { gap: 0; margin: 0; }
  .gaveta dl.ficha dt, .gaveta dl.ficha dd { padding: 6px 0; border-bottom: 1px solid var(--borda); }
  .gaveta dl.ficha dd { text-align: right; font-variant-numeric: tabular-nums; }
  .fc-risco { display: flex; align-items: center; gap: 12px; padding: 10px 0; font-size: 14px; }
  .fc-risco b { color: var(--tinta); }
  .fc-rod { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 16px; font-size: 12.5px; color: var(--tinta-3); }
  .t-modal td:first-child { white-space: nowrap; }
  #fModal, #fGrupo { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  #fModal button, #fGrupo button { white-space: nowrap; }
  @media (max-width: 560px) { .fc-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } .t-modal th:nth-child(3), .t-modal td:nth-child(3) { display: none; } }
</style>`;

const estado = { modal: "rodoviario", grupo: "ativo", mun: "", alerta: "", risco: "", q: "" };
// chip da nota de risco (0-100) e coluna "conclusão prevista": ver previsao() e risco() em dados.js [Claude] 23/11/2026
export const chipRisco = r => r ? chip(`${r.nota} · ${r.faixa}`, r.nivel, "Nota de risco de gestão (0 a 100)") : "—";
const notaRisco = r => r ? `<span class="nota-risco pq ${r.nivel}" title="Risco ${esc(r.faixa)}: nota ${r.nota} de 100">${r.nota}</span>` : `<span class="peq">—</span>`;
export function txtConclusao(p) {
  if (p.situacao === "projetada") return `${data(p.conclusao)}${p.atraso > 0 ? `<div class="peq">${num(p.atraso)} dias além do prazo</div>` : `<div class="peq">no prazo</div>`}`;
  return { concluida: "concluída", encerrado: "—", parada: "sem avanço", "sem-dados": "sem ritmo" }[p.situacao] || "—";
}

export async function render(el) {
  const { meta, lista } = await contratos();
  const muns = [...new Set(lista.flatMap(municipios))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  el.innerHTML = `${ESTILO}
    <div class="cab"><div><h1>Obras e contratos rodoviários</h1>
      <p>Contratos da SEINFRA no e-Obras ligados ao modal rodoviário: rodovias e estradas, ramais, viário urbano e pontes. Clique num contrato para ver a ficha e a curva de medição.</p></div>
      <div class="fontes">${fonte("e-Obras, posição", meta.posicao)}${fonte("gerado", data(meta.gerado))}</div></div>
    <div class="filtros" role="group" aria-label="Filtros">
      <div class="seg" id="fModal">${[["rodoviario", "Modal rodoviário"], ...MODAIS.map(m => [m, m]), ["todos", "Todos os contratos"]]
        .map(([v, r]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${estado.modal === v}">${esc(r)}</button>`).join("")}</div>
    </div>
    <div class="filtros">
      <div class="seg" id="fGrupo">${[["ativo", "Ativos"], ["atencao", "Paralisados / expirados"], ["encerrado", "Encerrados"], ["", "Todas as situações"]]
        .map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${estado.grupo === v}">${r}</button>`).join("")}</div>
      <select id="fMun" aria-label="Município">${opcoes(muns, estado.mun, "Todos os municípios")}</select>
      <select id="fAlerta" aria-label="Alerta">${opcoes(REGRAS.map(r => r.txt), estado.alerta, "Com ou sem alerta")}</select>
      <select id="fRisco" aria-label="Faixa de risco">${opcoes(FAIXAS_RISCO.map(f => f[0]), estado.risco, "Qualquer risco")}</select>
      <input type="search" id="fQ" placeholder="Buscar contrato, objeto, empresa, rodovia…" value="${esc(estado.q)}" aria-label="Buscar">
    </div>
    <div id="kpis" class="grade g-kpi"></div>
    <section class="secao grade g-2">
      <div class="cartao"><header><div><h2 id="tModal">Investimento por modal</h2><p>Valor atual (original + aditivos) dos contratos filtrados</p></div></header><div class="corpo"><div class="graf" id="gModalBox"><canvas id="gModal" aria-label="Valor por modal"></canvas></div><div id="tModalTab"></div><p class="nota" style="margin:10px 0 0;font-size:12px;color:var(--tinta-3)">Fonte: e-Obras. Valor atual = original + aditivos; saldo = valor atual − medido.</p></div></div>
      <div class="cartao"><header><div><h2>O que pede atenção</h2><p>Regras de gestão aplicadas aos contratos filtrados; passe o mouse para ver a base legal</p></div></header><div class="corpo" id="alertas"></div></div>
    </section>
    <section class="secao cartao"><header><div><h2>Contratos</h2></div><span class="contagem" id="cont"></span></header><div class="corpo" id="tab"></div>
      <details class="corpo" style="border-top:1px solid var(--borda)"><summary style="cursor:pointer;color:var(--azul)">Como se calcula a nota de risco e a conclusão prevista</summary>
        <p class="peq" style="font-size:13px">Nota de 0 a 100 = soma dos pontos dos componentes abaixo (cada um vale de 0 a 1 vezes o peso). Faixas: ${FAIXAS_RISCO.map((f, i) => `${f[0]} ${f[1]}${FAIXAS_RISCO[i + 1] ? `–${FAIXAS_RISCO[i + 1][1] - 1}` : "–100"}`).join("; ")}. Contratos encerrados não recebem nota.</p>
        <table class="t"><thead><tr><th>Componente</th><th class="n">Peso</th><th>Como pontua</th><th>Base</th></tr></thead><tbody>
          ${RISCO_PESOS.map(r => `<tr><td>${esc(r.rot)}</td><td class="n">${r.peso}</td><td>${esc(r.regra)}</td><td>${esc(r.base)}</td></tr>`).join("")}</tbody></table>
        <p class="peq" style="font-size:13px">Conclusão prevista: regressão linear (mínimos quadrados) do % físico acumulado nas últimas 6 medições (financeiro, se não houver físico), projetada até 100%. Se a última medição tem mais de 90 dias, a projeção supõe retomada hoje no mesmo ritmo. É estimativa, não substitui o cronograma do contrato.</p>
      </details></section>`;

  const pinta = () => {
    const q = semAcento(estado.q);
    const fl = lista.filter(c =>
      (estado.modal === "todos" || (estado.modal === "rodoviario" ? c.modal : c.modal === estado.modal)) &&
      (!estado.grupo || c.grupo === estado.grupo) &&
      (!estado.mun || municipios(c).includes(estado.mun)) &&
      (!estado.alerta || c.alertas.some(a => a.txt === estado.alerta)) &&
      (!estado.risco || c.risco?.faixa === estado.risco) &&
      (!q || semAcento(`${c.id} ${c.obj} ${c.emp} ${c.mun} ${c.rod || ""} ${c.bem}`).includes(q)));
    const soma = k => fl.reduce((s, c) => s + (c[k] || 0), 0);
    const vAtual = soma("v_atual"), med = soma("medido");
    const comAlerta = fl.filter(c => c.alertas.length).length;
    const fisMed = fl.filter(c => c.fis != null && c.v_atual);
    const fisPond = fisMed.reduce((s, c) => s + c.fis * c.v_atual, 0) / (fisMed.reduce((s, c) => s + c.v_atual, 0) || 1);
    $("#kpis", el).innerHTML =
      kpi("Contratos", num(fl.length), `${num(new Set(fl.map(c => c.emp)).size)} empresas`) +
      kpi("Valor atual", brlCurto(vAtual), "original + aditivos", true) +
      kpi("Medido", brlCurto(med), `${pct(vAtual ? med / vAtual * 100 : null)} do valor atual`) +
      kpi("Saldo a medir", brlCurto(soma("saldo")), "valor atual − medido") +
      kpi("Avanço físico", pct(fisMed.length ? fisPond : null), "média ponderada pelo valor") +
      kpi("Com alerta", num(comAlerta), `${pct(fl.length ? comAlerta / fl.length * 100 : null, 0)} dos contratos`);
    $("#cont", el).textContent = `${num(fl.length)} contratos`;

    // investimento por modal: ranking em barra horizontal, rótulo em R$ na ponta (1 série, sem legenda; destaque no maior)
    const porModal = MODAIS.map(m => { const cs = fl.filter(c => c.modal === m); return { m, n: cs.length, v: cs.reduce((s, c) => s + (c.v_atual || 0), 0), med: cs.reduce((s, c) => s + (c.medido || 0), 0), saldo: cs.reduce((s, c) => s + (c.saldo || 0), 0) }; })
      .filter(x => x.n).sort((a, b) => b.v - a.v);
    const top = porModal[0], vModal = porModal.reduce((s, x) => s + x.v, 0);
    $("#tModal", el).textContent = top && vModal ? `${top.m}: ${pct(top.v / vModal * 100, 0)} do valor` : "Investimento por modal";
    $("#gModalBox", el).style.height = `${Math.max(1, porModal.length) * 34 + 12}px`;
    grafico($("#gModal", el), { type: "bar", data: { labels: porModal.map(x => x.m), datasets: [{ label: "Valor atual", data: porModal.map(x => x.v), backgroundColor: porModal.map((x, i) => i ? serie(6) : serie(1)) }] },
      options: { indexAxis: "y", layout: { padding: { right: 70 } }, plugins: { rotulos: { fmt: brlCurto }, tooltip: { callbacks: { label: x => ` ${brlCurto(x.raw)} · ${num(porModal[x.dataIndex].n)} contratos` } } } } });
    $("#tModalTab", el).innerHTML = porModal.length ? `<div class="tab-rolo" tabindex="0"><table class="t t-modal"><thead><tr><th>Modal</th><th class="n">Contratos</th><th class="n">Medido</th><th class="n">Saldo</th></tr></thead><tbody>
      ${porModal.map(x => `<tr><td>${esc(x.m)}</td><td class="n">${num(x.n)}</td><td class="n">${brlCurto(x.med)}</td><td class="n">${brlCurto(x.saldo)}</td></tr>`).join("")}</tbody></table></div>` : "";

    // alertas agregados
    const cont = REGRAS.map(r => ({ r, n: fl.filter(c => c.alertas.includes(r)).length })).filter(x => x.n);
    $("#alertas", el).innerHTML = cont.length ? `<ul class="lista">${cont.map(({ r, n }) => `<li>${chip(num(n), r.nivel)}
      <div><button type="button" class="btn" style="border:0;padding:0;background:none;color:var(--azul);text-align:left" data-alerta="${esc(r.txt)}" title="${esc(r.base)}">${esc(r.txt)}</button>
      <div class="d">${esc(r.base)}</div></div></li>`).join("")}</ul>` : `<p class="vazio">Nenhum alerta nos contratos filtrados.</p>`;
    el.querySelectorAll("[data-alerta]").forEach(b => b.onclick = () => { estado.alerta = b.dataset.alerta; $("#fAlerta", el).value = estado.alerta; pinta(); });

    tabela($("#tab", el), [
      { k: "id", rot: "Contrato", html: c => `<b style="color:var(--tinta)" title="${esc(c.id)}">${esc(c.id.replace(/-SEINFRA$/, ""))}</b><div class="peq">${esc(c.modal || c.cat)}</div>` },
      { k: "obj", rot: "Objeto", html: c => `<div class="obj" title="${esc(c.obj)}">${esc(c.obj || "")}</div><div class="peq">${esc(c.mun)} · ${esc(c.emp)}</div>` },
      { k: "sit", rot: "Situação", html: c => chipSit(c.sit) + (c.alertas.length ? `<div class="ob-al ${c.alertas[0].nivel}" title="${esc(c.alertas.map(a => a.txt).join("; "))}">${esc(c.alertas[0].txt)}${c.alertas.length > 1 ? ` +${c.alertas.length - 1}` : ""}</div>` : "") },
      { k: "v_atual", rot: "Valor atual", n: 1, html: c => `${brlCurto(c.v_atual)}<div class="peq">saldo ${brlCurto(c.saldo)}</div>` },
      { k: "fis", rot: "Físico", n: 1, html: c => `${c.fis == null ? "—" : pct(c.fis) + barra(c.fis)}<div class="peq">financeiro ${pct(c.fin)}</div>` },
      { k: "conclusao", rot: "Conclusão", v: c => c.prev.conclusao, html: c => txtConclusao(c.prev) },
      { k: "risco", rot: "Risco", n: 1, v: c => c.risco?.nota, html: c => notaRisco(c.risco) },
    ], fl, { ordem: { k: "v_atual", dir: -1 }, onLinha: ficha });
  };

  const liga = (id, k) => $(id, el).addEventListener("click", e => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    estado[k] = b.dataset.v; $(id, el).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); pinta();
  });
  liga("#fModal", "modal"); liga("#fGrupo", "grupo");
  $("#fMun", el).onchange = e => { estado.mun = e.target.value; pinta(); };
  $("#fAlerta", el).onchange = e => { estado.alerta = e.target.value; pinta(); };
  $("#fRisco", el).onchange = e => { estado.risco = e.target.value; pinta(); };
  let t; $("#fQ", el).oninput = e => { clearTimeout(t); t = setTimeout(() => { estado.q = e.target.value; pinta(); }, 150); };
  pinta();
}

// Ficha do contrato + curva de medição (% acumulado financeiro e físico)
export function ficha(c) {
  const lin = (r, v) => `<dt>${r}</dt><dd>${v}</dd>`;
  const g = gaveta(`
    <span class="fc-tipo">Contrato${c.modal ? ` · ${esc(c.modal)}` : ""}</span>
    <h2 class="fc-id">${esc(c.id)}</h2>
    <p class="fc-obj">${esc(c.obj)}</p>
    <div class="fc-chips">${chipSit(c.sit)} ${c.alertas.map(a => chip(a.txt, a.nivel, a.base)).join(" ")}</div>
    <div class="fc-kpi">
      <div><span>Valor atual</span><b>${brlCurto(c.v_atual)}</b></div>
      <div><span>Medido</span><b>${pct(c.fin)}</b><small>${brlCurto(c.medido)}</small></div>
      <div><span>Físico</span><b>${pct(c.fis)}</b></div>
      <div><span>Saldo</span><b>${brlCurto(c.saldo)}</b></div>
    </div>
    <h3 class="fc-h">Identificação</h3>
    <dl class="ficha">
      ${lin("Empresa", esc(c.emp))}${lin("Município", esc(c.mun))}${c.rod ? lin("Rodovia", esc(c.rod)) : ""}
      ${c.dim ? lin("Dimensão", `${num(c.dim, 2)} ${esc(c.un || "")}`) : ""}
    </dl>
    <h3 class="fc-h">Prazos</h3>
    <dl class="ficha">
      ${lin("Assinatura", data(c.ass))}${lin("Vigência até", data(c.fim_vig))}${c.fim_exec ? lin("Execução até", data(c.fim_exec)) : ""}
      ${lin("Medições", `${num(c.n_med)}${c.ult_med ? `, última em ${data(c.ult_med)}` : ""}`)}
      ${c.prev ? lin("Conclusão prevista", txtConclusao(c.prev)) : ""}
    </dl>
    <h3 class="fc-h">Valores</h3>
    <dl class="ficha">
      ${lin("Valor original", brl(c.v_orig))}
      ${lin(`Aditivos (${num(c.n_adit)})`, `${brl(c.v_adit)}${c.v_orig ? `<div class="peq">${pct(c.v_adit / c.v_orig * 100)} do original</div>` : ""}`)}
      ${lin("Valor atual", `<b>${brl(c.v_atual)}</b>`)}${lin("Medido", `${brl(c.medido)} (${pct(c.fin)})`)}
      ${c.reaj_med ? lin("Reajuste medido", `${brl(c.reaj_med)}<div class="peq">fora do medido, como na ficha do e-Obras</div>`) : ""}
      ${c.reeq ? lin("Reequilíbrio", brl(c.reeq)) : ""}${c.corr ? lin("Correção de medição", brl(c.corr)) : ""}
      ${lin("Pago", brl(c.pago))}${lin("Saldo", brl(c.saldo))}
    </dl>
    ${c.risco ? `<h3 class="fc-h">Nota de risco</h3><div class="fc-risco">${notaRisco(c.risco).replace(" pq", "")}<div><b>Risco ${esc(c.risco.faixa)}</b><div class="peq">nota de 0 a 100 · <a href="#/briefings?contrato=${encodeURIComponent(c.id)}">ver componentes</a></div></div></div>` : ""}
    ${(c.med || []).length > 1 ? `<h3 class="fc-h">Curva de medição e previsão</h3>${legendaCurva(c)}<div class="graf"><canvas id="gCurva" aria-label="Curva de medição acumulada e previsão"></canvas></div>` : ""}
    <div class="fc-rod"><span>Fonte: e-Obras, Ficha Resumida e Analítica do contrato.</span><a href="#/briefings?contrato=${encodeURIComponent(c.id)}">Abrir briefing para imprimir</a></div>`);
  curvaContrato($("#gCurva", g), c);
}

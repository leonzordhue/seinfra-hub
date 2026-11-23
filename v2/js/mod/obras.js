// Obras e contratos do modal rodoviário (e-Obras). [Nexus] 23/11/2026
// Fonte: data/eobras.json (exportar_hub.py, rotina de segunda 10h). Regras: valor atual = original + aditado;
// % financeiro = medido / valor atual; saldo = valor atual - medido (ver _meta.regras).
import { contratos, MODAIS, REGRAS, municipios, RISCO_PESOS, FAIXAS_RISCO } from "../dados.js";
import { esc, brl, brlCurto, pct, data, num, semAcento } from "../fmt.js";
import { $, kpi, chip, chipSit, barra, tabela, grafico, gaveta, fonte, opcoes, serie, css } from "../ui.js";

const estado = { modal: "rodoviario", grupo: "ativo", mun: "", alerta: "", risco: "", q: "" };
// chip da nota de risco (0-100) e coluna "conclusão prevista": ver previsao() e risco() em dados.js [Claude] 23/11/2026
export const chipRisco = r => r ? chip(`${r.nota} · ${r.faixa}`, r.nivel, "Nota de risco de gestão (0 a 100)") : "—";
export function txtConclusao(p) {
  if (p.situacao === "projetada") return `${data(p.conclusao)}${p.atraso > 0 ? `<div class="peq">${num(p.atraso)} dias além do prazo</div>` : `<div class="peq">no prazo</div>`}`;
  return { concluida: "concluída", encerrado: "—", parada: "sem avanço", "sem-dados": "sem ritmo" }[p.situacao] || "—";
}

export async function render(el) {
  const { meta, lista } = await contratos();
  const muns = [...new Set(lista.flatMap(municipios))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  el.innerHTML = `
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
      <div class="cartao"><header><div><h2>Investimento por modal</h2><p>Valor atual (original + aditivos) dos contratos filtrados, em R$ milhões</p></div></header><div class="corpo"><div class="graf"><canvas id="gModal" aria-label="Valor por modal"></canvas></div></div></div>
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

    // investimento por modal (1 série: azul; a categoria está no eixo)
    const porModal = MODAIS.map(m => fl.filter(c => c.modal === m).reduce((s, c) => s + (c.v_atual || 0), 0) / 1e6);
    grafico($("#gModal", el), { type: "bar", data: { labels: MODAIS, datasets: [{ label: "R$ milhões", data: porModal, backgroundColor: serie(1), borderRadius: 4, maxBarThickness: 48 }] },
      options: { indexAxis: "y", scales: { x: { grid: { color: css("--grade") }, ticks: { callback: v => num(v) } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: x => ` ${brlCurto(x.raw * 1e6)} · ${num(fl.filter(c => c.modal === MODAIS[x.dataIndex]).length)} contratos` } } } } });

    // alertas agregados
    const cont = REGRAS.map(r => ({ r, n: fl.filter(c => c.alertas.includes(r)).length })).filter(x => x.n);
    $("#alertas", el).innerHTML = cont.length ? `<ul class="lista">${cont.map(({ r, n }) => `<li>${chip(num(n), r.nivel)}
      <div><button type="button" class="btn" style="border:0;padding:0;background:none;color:var(--azul);text-align:left" data-alerta="${esc(r.txt)}" title="${esc(r.base)}">${esc(r.txt)}</button>
      <div class="d">${esc(r.base)}</div></div></li>`).join("")}</ul>` : `<p class="vazio">Nenhum alerta nos contratos filtrados.</p>`;
    el.querySelectorAll("[data-alerta]").forEach(b => b.onclick = () => { estado.alerta = b.dataset.alerta; $("#fAlerta", el).value = estado.alerta; pinta(); });

    tabela($("#tab", el), [
      { k: "id", rot: "Contrato", html: c => `<b style="color:var(--tinta)">${esc(c.id)}</b><div class="peq">${esc(c.modal || c.cat)}</div>` },
      { k: "obj", rot: "Objeto", html: c => `<div class="obj">${esc((c.obj || "").slice(0, 170))}${(c.obj || "").length > 170 ? "…" : ""}</div><div class="peq">${esc(c.mun)} · ${esc(c.emp)}</div>` },
      { k: "sit", rot: "Situação", html: c => chipSit(c.sit) + (c.alertas.length ? `<div style="margin-top:4px">${c.alertas.map(a => chip(a.txt, a.nivel, a.base)).join(" ")}</div>` : "") },
      { k: "v_atual", rot: "Valor atual", n: 1, html: c => brlCurto(c.v_atual) },
      { k: "fis", rot: "Físico", n: 1, html: c => c.fis == null ? "—" : `${pct(c.fis)}${barra(c.fis)}` },
      { k: "fin", rot: "Financeiro", n: 1, html: c => `${pct(c.fin)}${barra(c.fin)}` },
      { k: "saldo", rot: "Saldo", n: 1, html: c => brlCurto(c.saldo) },
      { k: "fim_vig", rot: "Vigência até", html: c => data(c.fim_vig) },
      { k: "conclusao", rot: "Conclusão prevista", v: c => c.prev.conclusao, html: c => txtConclusao(c.prev) },
      { k: "risco", rot: "Risco", n: 1, v: c => c.risco?.nota, html: c => chipRisco(c.risco) },
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
  const g = gaveta(`
    <h2 style="margin-top:4px">${esc(c.id)}</h2>
    <p style="margin:6px 0 0">${chipSit(c.sit)} ${c.modal ? chip(c.modal) : ""} ${c.alertas.map(a => chip(a.txt, a.nivel, a.base)).join(" ")}</p>
    <p style="color:var(--tinta)">${esc(c.obj)}</p>
    <dl class="ficha">
      <dt>Empresa</dt><dd>${esc(c.emp)}</dd>
      <dt>Município</dt><dd>${esc(c.mun)}</dd>
      ${c.rod ? `<dt>Rodovia</dt><dd>${esc(c.rod)}</dd>` : ""}
      ${c.dim ? `<dt>Dimensão</dt><dd>${num(c.dim, 2)} ${esc(c.un || "")}</dd>` : ""}
      <dt>Assinatura</dt><dd>${data(c.ass)}</dd>
      <dt>Vigência até</dt><dd>${data(c.fim_vig)}</dd>
      ${c.fim_exec ? `<dt>Execução até</dt><dd>${data(c.fim_exec)}</dd>` : ""}
      <dt>Valor original</dt><dd>${brl(c.v_orig)}</dd>
      <dt>Aditivos (${num(c.n_adit)})</dt><dd>${brl(c.v_adit)} ${c.v_orig ? `(${pct(c.v_adit / c.v_orig * 100)} do original)` : ""}</dd>
      <dt>Valor atual</dt><dd><b>${brl(c.v_atual)}</b></dd>
      <dt>Medido</dt><dd>${brl(c.medido)} (${pct(c.fin)})</dd>
      ${c.reaj_med ? `<dt>Reajuste medido</dt><dd>${brl(c.reaj_med)}</dd>` : ""}
      <dt>Pago</dt><dd>${brl(c.pago)}</dd>
      <dt>Saldo</dt><dd>${brl(c.saldo)}</dd>
      <dt>Físico</dt><dd>${pct(c.fis)}</dd>
      <dt>Medições</dt><dd>${num(c.n_med)}${c.ult_med ? `, última em ${data(c.ult_med)}` : ""}</dd>
      ${c.prev ? `<dt>Conclusão prevista</dt><dd>${txtConclusao(c.prev)}</dd>` : ""}
      ${c.risco ? `<dt>Nota de risco</dt><dd>${chipRisco(c.risco)} <a href="#/briefings?contrato=${encodeURIComponent(c.id)}">ver componentes</a></dd>` : ""}
    </dl>
    ${(c.med || []).length > 1 ? `<h3>Curva de medição</h3><div class="legenda"><span><i style="background:${serie(1)}"></i>% financeiro acumulado</span>${c.med.some(m => m[3] != null) ? `<span><i style="background:${serie(2)}"></i>% físico</span>` : ""}</div><div class="graf"><canvas id="gCurva" aria-label="Curva de medição"></canvas></div>` : ""}
    <p class="peq" style="font-size:12.5px;color:var(--tinta-3);margin-top:14px">Fonte: e-Obras, Ficha Resumida e Analítica do contrato.</p>`);
  const cv = $("#gCurva", g);
  if (cv) {
    const ds = [{ label: "% financeiro", data: c.med.map(m => m[2]), borderColor: serie(1), backgroundColor: serie(1), borderWidth: 2, pointRadius: 3, tension: 0 }];
    if (c.med.some(m => m[3] != null)) ds.push({ label: "% físico", data: c.med.map(m => m[3]), borderColor: serie(2), backgroundColor: serie(2), borderWidth: 2, pointRadius: 3, spanGaps: true, tension: 0 });
    grafico(cv, { type: "line", data: { labels: c.med.map(m => data(m[0])), datasets: ds },
      options: { scales: { y: { max: 100, ticks: { callback: v => v + "%" } } }, plugins: { tooltip: { callbacks: { label: x => ` ${x.dataset.label}: ${pct(x.raw)}` } } } } });
  }
}

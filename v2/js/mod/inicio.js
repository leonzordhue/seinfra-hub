// Início: visão do DMOB em uma tela — o que pede decisão agora. [Nexus] 23/11/2026
import { contratos, talvez } from "../dados.js";
import { esc, num, pct, data, brlCurto } from "../fmt.js";
import { $, kpi, chip, fonte } from "../ui.js";

export async function render(el) {
  const [{ meta, lista }, an, lic] = await Promise.all([contratos(), talvez("sinistros_analise"), talvez("licitacoes")]);
  const rod = lista.filter(c => c.modal);
  const at = rod.filter(c => c.grupo === "ativo");
  const soma = (cs, k) => cs.reduce((s, c) => s + (c[k] || 0), 0);
  const criticos = at.concat(rod.filter(c => c.grupo === "atencao")).filter(c => c.alertas.some(a => a.nivel === "critico"))
    .sort((a, b) => b.v_atual - a.v_atual).slice(0, 6);
  const hoje = new Date().toISOString().slice(0, 10), em15 = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const abrindo = (lic?.pncp || []).filter(l => l.rodoviario && l.encerramento && l.encerramento >= hoje && l.encerramento <= em15)
    .sort((a, b) => a.encerramento.localeCompare(b.encerramento));
  const top = (an?.ranking || []).slice(0, 3).map(c => ({ cod: c, ...an.rodovias[c] }));

  el.innerHTML = `
    <div class="cab"><div><h1>DMOB Hub</h1>
      <p>Obras, contratos, sinistros e licitações do modal rodoviário do Amazonas, atualizados pelas rotinas do DMOB.</p></div>
      <div class="fontes">${fonte("e-Obras", meta.posicao)}${an ? fonte("sinistros", an._meta.gerado.slice(0, 10).split("-").reverse().join("/")) : ""}${lic ? fonte("licitações", data(lic._meta.gerado)) : ""}</div></div>
    <div class="grade g-kpi">
      ${kpi("Contratos rodoviários ativos", num(at.length), `${num(rod.length)} no total`)}
      ${kpi("Valor atual dos ativos", brlCurto(soma(at, "v_atual")), "original + aditivos", true)}
      ${kpi("Saldo a medir", brlCurto(soma(at, "saldo")), `${pct(soma(at, "v_atual") ? soma(at, "medido") / soma(at, "v_atual") * 100 : null)} já medido`)}
      ${kpi("Ativos com alerta", num(at.filter(c => c.alertas.length).length), "vigência, medição, físico × financeiro")}
      ${an ? kpi("Sinistros nos últimos 12 meses", num(an.totais.ultimos_12m), `${num(an.totais.fatais_ultimos_12m)} com morte`) : ""}
    </div>
    <section class="secao grade g-3">
      <div class="cartao"><header><div><h2>Contratos com alerta crítico</h2><p>Maiores valores primeiro</p></div><a href="#/obras" class="btn">Ver obras</a></header>
        <div class="corpo">${criticos.length ? `<ul class="lista">${criticos.map(c => `<li><div><div class="q"><b>${esc(c.id)}</b> · ${brlCurto(c.v_atual)}</div>
          <div class="d">${esc((c.obj || "").slice(0, 110))}…</div><div style="margin-top:4px">${c.alertas.map(a => chip(a.txt, a.nivel, a.base)).join(" ")}</div></div></li>`).join("")}</ul>` : `<p class="vazio">Nenhum contrato rodoviário com alerta crítico.</p>`}</div></div>
      <div class="cartao"><header><div><h2>Onde agir primeiro (sinistros)</h2><p>Índice de prioridade por rodovia</p></div><a href="#/sinistros" class="btn">Ver sinistros</a></header>
        <div class="corpo">${top.length ? `<ul class="lista">${top.map(r => `<li>${chip(num(r.prioridade, 0), r.faixa === "Alta" ? "critico" : r.faixa === "Média" ? "alerta" : "")}<div><div class="q"><b>${esc(r.cod)}</b> · ${num(r.ocorrencias)} ocorrências, ${num(r.fatais)} com morte</div><div class="d">${esc(r.leitura.slice(0, 170))}…</div></div></li>`).join("")}</ul>` : `<p class="vazio">Sem dados de sinistros.</p>`}</div></div>
      <div class="cartao"><header><div><h2>Licitações fechando em 15 dias</h2><p>Objetos do modal rodoviário no PNCP</p></div><a href="#/licitacoes" class="btn">Ver licitações</a></header>
        <div class="corpo">${abrindo.length ? `<ul class="lista">${abrindo.map(l => `<li><div><div class="q"><a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.edital)}</a> · propostas até ${data(l.encerramento)}</div><div class="d">${esc(l.objeto.slice(0, 120))}${l.estimado ? ` · ${brlCurto(l.estimado)}` : ""}</div></div></li>`).join("")}</ul>` : `<p class="vazio">${lic ? "Nenhuma licitação rodoviária fechando nos próximos 15 dias." : "Dados de licitações ainda não gerados."}</p>`}</div></div>
    </section>
    <section class="secao"><h2>Módulos</h2><div class="grade g-3 mods">
      ${[["#/obras", "Obras e contratos", "Ramal, rodovia, viário urbano e pontes, com alertas e curva de medição"],
         ["#/sinistros", "Sinistros", "Acidentes nas AM-XXX desde 2019, ranking de prioridade e acervo de notícias"],
         ["#/licitacoes", "Licitações", "Editais da SEINFRA no PNCP e no CSC"],
         ["#/briefings", "Briefings", "Uma página por município ou rodovia, pronta para imprimir"],
         ["../index.html#mod=rodovias", "Rodovias (v1)", "Malha estadual, quadros e mapas"],
         ["../index.html#mod=icm", "Condição viária (v1)", "IRI e buracos do levantamento RoadLab"]]
        .map(([h, t, s]) => `<a class="cartao" href="${h}"><strong>${t}</strong><span>${s}</span></a>`).join("")}</div></section>`;
}

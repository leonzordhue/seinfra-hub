// Painel do dia: o que pede decisão agora, em uma tela. [Nexus] 23/11/2026 · v3 "prancha técnica"
import { contratos, talvez } from "../dados.js";
import { esc, num, pct, data, brlCurto } from "../fmt.js";
import { $, kpi, chip, fonte } from "../ui.js";

// descrição curta de cada módulo no índice (o índice segue os grupos do menu, sem lista duplicada)
const DESCR = {
  "#/inicio": "Resumo do dia, riscos e prazos", "#/mapa": "Malha, condição, sinistros e investimento por município",
  "#/m/rodovias": "Cadastro da malha estadual, quadros e mapas", "#/m/ramais": "Ramais por município, acervo e mapas",
  "#/m/viario": "Obras urbanas por município", "#/m/aerodromos": "Aeródromos da SEINFRA", "#/m/terminais": "Terminais flutuantes",
  "#/m/icm": "IRI e buracos do levantamento RoadLab", "#/obras": "Contratos, alertas da Lei 14.133, risco e previsão",
  "#/licitacoes": "Editais no PNCP e no CSC, preços × SICRO", "#/briefings": "Uma página por município, rodovia ou contrato",
  "#/sinistros": "Notícias desde 2019, prioridade por rodovia", "#/sinistros-oficiais": "RENAEST e PRF; cobertura do monitor",
  "#/acesso": "Tempo de viagem às sedes, hospitais e portos", "#/ambiente": "Cotas dos rios (ANA) e focos (INPE) junto às AM",
  "#/m/atlas": "Mapa integrado dos modais", "#/consulta": "SQL no navegador sobre todos os dados", "#/m/bi": "Indicadores e cruzamentos",
  "#/campo-iri": "Estimativa de IRI com o acelerômetro", "#/campo-buracos": "Detecção de buracos em fotos",
};

export async function render(el) {
  const [{ meta, lista }, an, lic, svg] = await Promise.all([contratos(), talvez("sinistros_analise"), talvez("licitacoes"),
    fetch("img/malha-am.svg").then(r => r.ok ? r.text() : "").catch(() => "")]);
  const rod = lista.filter(c => c.modal);
  const at = rod.filter(c => c.grupo === "ativo");
  const soma = (cs, k) => cs.reduce((s, c) => s + (c[k] || 0), 0);
  // top 5 pela nota de risco (0-100, ver risco() em dados.js); empate: maior valor primeiro
  const criticos = at.concat(rod.filter(c => c.grupo === "atencao")).filter(c => c.risco)
    .sort((a, b) => b.risco.nota - a.risco.nota || b.v_atual - a.v_atual).slice(0, 5);
  const hoje = new Date().toISOString().slice(0, 10), em15 = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const abertas = (lic?.pncp || []).filter(l => l.rodoviario && l.encerramento && l.encerramento >= hoje).sort((a, b) => a.encerramento.localeCompare(b.encerramento));
  const abrindo = abertas.filter(l => l.encerramento <= em15);
  const top = (an?.ranking || []).slice(0, 4).map(c => ({ cod: c, ...an.rodovias[c] }));
  const em30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const venc30 = at.filter(c => c.fim_vig && c.fim_vig >= hoje && c.fim_vig <= em30).sort((a, b) => a.fim_vig.localeCompare(b.fim_vig));
  const venc = at.filter(c => c.alertas.some(x => x.id === "vig-vencida")).length;
  const medido = soma(at, "v_atual") ? soma(at, "medido") / soma(at, "v_atual") * 100 : null;
  const dia = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const frase = [`<b>${num(at.length)} contratos rodoviários ativos</b> somam ${brlCurto(soma(at, "v_atual"))}, com ${brlCurto(soma(at, "saldo"))} ainda a medir`,
    venc ? `<b>${num(venc)}</b> estão com a vigência vencida no e-Obras` : "",
    top[0] ? `nos sinistros, a ${esc(top[0].cod)} lidera a prioridade (${num(top[0].prioridade, 0)} de 100)` : "",
    abrindo.length ? `<b>${num(abrindo.length)}</b> licitações rodoviárias fecham nos próximos 15 dias` : ""].filter(Boolean).join("; ") + ".";

  // grupos do índice = grupos do menu lateral
  const grupos = [];
  document.querySelectorAll(".nav > *").forEach(n => {
    if (n.classList.contains("nav-grupo")) grupos.push({ t: n.textContent.trim(), links: [] });
    else if (n.tagName === "A" && grupos.length && n.getAttribute("href") !== "#/inicio") grupos.at(-1).links.push(n);
  });

  el.innerHTML = `
    <div class="cab"><div><span class="sobre">${esc(dia)}</span><h1>Painel do dia</h1>
      <p>Situação dos contratos, da segurança viária e das licitações do modal rodoviário do Amazonas, calculada a partir das rotinas automáticas do DMOB.</p></div>
      <div class="fontes">${fonte("e-Obras", meta.posicao)}${an ? fonte("Sinistros", an._meta.gerado.slice(0, 10).split("-").reverse().join("/")) : ""}${lic ? fonte("Licitações", data(lic._meta.gerado)) : ""}</div></div>

    <div class="painel">
      <div class="resumo"><span class="eyebrow">Situação hoje</span>
        <p>${frase}</p>
        ${venc30.length ? `<div class="agenda"><span class="eyebrow">Vigências que vencem em 30 dias</span><ul>${venc30.slice(0, 4).map(c => `<li><a href="#/briefings?contrato=${encodeURIComponent(c.id)}">${esc(c.id.replace(/-SEINFRA$/, ""))}</a><span>${esc(c.mun || "")}</span><b>${data(c.fim_vig)}</b></li>`).join("")}</ul>${venc30.length > 4 ? `<a class="mais" href="#/obras">e mais ${num(venc30.length - 4)} →</a>` : ""}</div>` : `<div class="agenda"><span class="eyebrow">Vigências que vencem em 30 dias</span><p class="peq">Nenhum contrato ativo com vigência vencendo nos próximos 30 dias.</p></div>`}
        <div class="acoes"><a class="btn pri" href="#/obras">Contratos e alertas</a><a class="btn" href="#/mapa">Abrir o mapa</a><a class="btn" href="#/briefings">Gerar briefing</a></div>
      </div>
      <div class="mapa-mini"><header><h2>Malha rodoviária estadual</h2><a class="mais" href="#/mapa">Mapa completo →</a></header>
        <div id="malha">${svg || `<p class="vazio">Mapa indisponível.</p>`}</div>
        <div class="leg"><span><i></i>Rodovia estadual</span><span><i class="alta"></i>Prioridade alta (sinistros)</span><span><i class="media"></i>Prioridade média</span><span><i class="br"></i>Federal</span><span><i class="rio"></i>Hidrovia</span></div>
      </div>
    </div>


    <div class="grade g-kpi">
      ${kpi("Contratos rodoviários ativos", num(at.length), `${num(rod.length)} no cadastro`)}
      ${kpi("Valor atual dos ativos", brlCurto(soma(at, "v_atual")), "original + aditivos", true)}
      ${kpi("Saldo a medir", brlCurto(soma(at, "saldo")), `${pct(medido)} já medido`)}
      ${kpi("Ativos com alerta", num(at.filter(c => c.alertas.length).length), `${num(venc)} com vigência vencida`)}
      ${an ? kpi("Sinistros em 12 meses", num(an.totais.ultimos_12m), `${num(an.totais.fatais_ultimos_12m)} com morte`) : ""}
    </div>

    <section class="secao"><h2>Onde agir primeiro</h2>
      <div class="grade g-agir" style="margin-top:12px">
        <div class="cartao"><header><div><h2>Contratos de maior risco</h2><p>Nota de risco de gestão, 0 a 100</p></div><a href="#/obras" class="mais">Ver todos →</a></header>
          <div class="corpo">${criticos.length ? `<ul class="linhas">${criticos.map(c => `<li><span class="nota-risco ${c.risco.nivel}" title="Risco ${esc(c.risco.faixa)}">${num(c.risco.nota)}</span>
            <div><div class="t1"><a href="#/briefings?contrato=${encodeURIComponent(c.id)}">${esc(c.id.replace(/-SEINFRA$/, ""))}</a> · ${esc(c.mun || "")}</div>
              <div class="t2">${esc(c.obj || "")}</div><div class="t3">${c.alertas.slice(0, 2).map(a => chip(a.txt, a.nivel, a.base)).join("")}${c.alertas.length > 2 ? chip(`+${c.alertas.length - 2}`) : ""}</div></div>
            <div class="v">${brlCurto(c.v_atual)}${c.prev?.situacao === "projetada" ? `<small>conclusão ${data(c.prev.conclusao)}</small>` : ""}</div></li>`).join("")}</ul>`
            : `<p class="vazio">Nenhum contrato rodoviário ativo com nota de risco.</p>`}</div></div>

        <div class="cartao"><header><div><h2>Segurança viária</h2><p>Índice de prioridade por rodovia (sinistros)</p></div><a href="#/sinistros" class="mais">Ver sinistros →</a></header>
          <div class="corpo">${top.length ? `<ul class="linhas">${top.map(r => `<li><span class="nota-risco ${r.faixa === "Alta" ? "critico" : r.faixa === "Média" ? "alerta" : ""}" title="Prioridade ${esc(r.faixa || "")}">${num(r.prioridade, 0)}</span>
            <div><div class="t1"><a href="#/briefings?rodovia=${encodeURIComponent(r.cod)}">${esc(r.cod)}</a></div><div class="t2">${esc(r.leitura || "")}</div></div>
            <div class="v">${num(r.ocorrencias)}<small>${num(r.fatais)} com morte</small></div></li>`).join("")}</ul>` : `<p class="vazio">Sem dados de sinistros.</p>`}</div></div>

        <div class="cartao"><header><div><h2>Licitações em aberto</h2><p>Modal rodoviário no PNCP, por data de encerramento</p></div><a href="#/licitacoes" class="mais">Ver licitações →</a></header>
          <div class="corpo">${abertas.length ? `<ul class="linhas">${abertas.slice(0, 5).map(l => `<li><span class="nota-risco ${l.encerramento <= em15 ? "alerta" : ""}" title="Dias até o encerramento">${num(Math.max(0, Math.round((new Date(l.encerramento) - new Date(hoje)) / 864e5)))}d</span>
            <div><div class="t1"><a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.edital)}</a></div><div class="t2">${esc(l.descricao || l.objeto || "")}</div></div>
            <div class="v">${l.estimado ? brlCurto(l.estimado) : "—"}<small>até ${data(l.encerramento)}</small></div></li>`).join("")}</ul>`
            : `<p class="vazio">${lic ? "Nenhuma licitação rodoviária com propostas abertas no PNCP." : "Dados de licitações ainda não gerados."}</p>`}</div></div>
      </div>
    </section>

    <section class="secao"><h2>Módulos do DMOB Hub</h2>
      <div class="indice" style="margin-top:8px">${grupos.filter(g => g.links.length).map(g => `<section><h3>${esc(g.t)}</h3>${g.links.map(a => {
        const h = a.getAttribute("href"), ic = a.querySelector("use")?.getAttribute("href") || "#i-inicio";
        return `<a href="${esc(h)}"${a.target ? ' target="_blank" rel="noopener"' : ""}><svg aria-hidden="true"><use href="${ic}"/></svg><span><b>${esc(a.textContent.trim())}</b><small>${esc(DESCR[h] || (a.target ? "Abre em nova aba" : ""))}</small></span></a>`;
      }).join("")}</section>`).join("")}</div>
    </section>`;

  // malha: pinta rodovias pela faixa de prioridade de sinistros; clique abre o briefing da rodovia
  const mapa = $("#malha svg");
  if (mapa) {
    mapa.querySelectorAll("path.am").forEach(p => {
      const r = an?.rodovias?.[p.dataset.cod];
      if (r?.faixa === "Alta") p.classList.add("prio-alta"); else if (r?.faixa === "Média") p.classList.add("prio-media");
      p.setAttribute("tabindex", "0"); p.setAttribute("role", "link");
      const ir = () => { location.hash = `#/briefings?rodovia=${encodeURIComponent(p.dataset.cod)}`; };
      p.addEventListener("click", ir); p.addEventListener("keydown", e => { if (e.key === "Enter") ir(); });
    });
    mapa.querySelectorAll("path.am.prio-media, path.am.prio-alta").forEach(p => p.parentNode.append(p));  // destaque por cima
  }
}

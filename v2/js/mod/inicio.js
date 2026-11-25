// Painel do dia: o que pede decisão agora, em uma tela. [Nexus] 23/11/2026 · v3 "prancha técnica"
import { contratos, talvez } from "../dados.js";
import { esc, num, pct, data, brlCurto } from "../fmt.js";
import { $, kpi, chip, fonte } from "../ui.js";

// descrição curta de cada módulo no índice (o índice segue os grupos do menu, sem lista duplicada)
const DESCR = {
  "#/inicio": "Resumo do dia, riscos e prazos", "#/mapa": "Malha, condição, sinistros e investimento por município",
  "#/m/rodovias": "Cadastro da malha estadual, quadros e mapas", "#/m/ramais": "Ramais por município, acervo e mapas",
  "#/m/viario": "Obras urbanas por município", "#/m/aerodromos": "Aeródromos da SEINFRA", "#/terminais": "Entregues e pedidos de 2026 (Portos Autorizados)",
  "#/m/icm": "IRI e buracos do levantamento RoadLab", "#/obras": "Contratos, alertas da Lei 14.133, risco e previsão",
  "#/licitacoes": "Editais no PNCP e no CSC, preços × SICRO", "#/briefings": "Uma página por município, rodovia ou contrato",
  "#/sinistros": "Notícias desde 2019, prioridade por rodovia", "#/sinistros-oficiais": "RENAEST e PRF; cobertura do monitor",
  "#/acesso": "Tempo de viagem às sedes, hospitais e portos", "#/ambiente": "Cotas dos rios (ANA) e focos (INPE) junto às AM",
  "#/m/atlas": "Mapa integrado dos modais", "#/consulta": "SQL no navegador sobre todos os dados", "#/m/bi": "Indicadores e cruzamentos",
  "#/campo-iri": "Estimativa de IRI com o acelerômetro", "#/campo-buracos": "Detecção de buracos em fotos",
};

// Estado das fontes e "o que mudou" (data/painel.json, gerado no deploy por scripts/painel.py). [Claude] 25/11/2026
const ESTILO_PAINEL = `<style>
  .fontes-faixa { margin: 28px 0 0; border: 1px solid var(--borda); border-radius: 8px; background: var(--sup); }
  .fontes-faixa > summary { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 10px 14px; cursor: pointer; font-size: 13.5px; color: var(--tinta-2); list-style: none; min-height: 44px; }
  .fontes-faixa > summary::-webkit-details-marker { display: none; }
  .fontes-faixa > summary::after { content: "ver fontes"; margin-left: auto; color: var(--tinta-3); font-size: 12.5px; text-decoration: underline; }
  .fontes-faixa[open] > summary::after { content: "ocultar"; }
  .fontes-faixa table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .fontes-faixa th, .fontes-faixa td { text-align: left; padding: 7px 14px; border-top: 1px solid var(--borda); }
  .fontes-faixa th { font-weight: 600; color: var(--tinta-3); font-size: 12px; }
  .fontes-faixa td a { color: var(--tinta); }
  .mudou .t2 { white-space: normal; }
  @media (max-width: 640px) { .fontes-faixa th:nth-child(2), .fontes-faixa td:nth-child(2) { display: none; }
    .painel .mapa-mini { display: none; } }   /* no celular o mini-mapa empurrava "Onde agir" para 1.800 px; o botão "Abrir o mapa" fica nas ações */
</style>`;
const TIPO = { oficial: "dado oficial", monitoramento: "monitoramento (notícias)", estimativa: "estimativa calculada", derivado: "dado derivado", levantamento: "levantamento pontual" };
const idade = d => d ? Math.floor((Date.now() - new Date(`${d}T12:00:00`)) / 864e5) : null;
function estadoFonte(f) {
  if (!f.data) return { txt: "sem dado", nivel: "critico" };
  if (f.cadencia_dias == null) return { txt: "sem rotina", nivel: "" };
  return idade(f.data) <= f.cadencia_dias ? { txt: "em dia", nivel: "ok" } : { txt: `atrasada (${idade(f.data)} dias)`, nivel: "alerta" };
}
function faixaFontes(P) {
  if (!P?.fontes?.length) return "";
  const est = P.fontes.map(f => ({ ...f, e: estadoFonte(f) }));
  const ok = est.filter(f => f.e.nivel === "ok").length, atr = est.filter(f => f.e.nivel === "alerta" || f.e.nivel === "critico");
  return `<details class="fontes-faixa"><summary><b style="color:var(--tinta)">Fontes de dados</b>
      ${chip(`${num(ok)} em dia`, "ok")}${atr.length ? chip(`${num(atr.length)} ${atr.length > 1 ? "atrasadas" : "atrasada"}: ${atr.map(f => f.rotulo.replace(/ \(.*/, "")).join(", ")}`, "alerta") : ""}
      <span class="peq" style="color:var(--tinta-3)">conferido na publicação de ${data(P._meta.gerado_em.slice(0, 10))}</span></summary>
    <table><thead><tr><th>Fonte</th><th>Tipo</th><th>Atualizada em</th><th>Estado</th></tr></thead><tbody>
      ${est.map(f => `<tr><td><a href="${esc(f.modulo)}">${esc(f.rotulo)}</a></td><td>${esc(TIPO[f.tipo] || f.tipo)}</td><td>${f.data ? data(f.data) : "—"}</td>
        <td>${chip(f.e.txt, f.e.nivel, f.cadencia_dias ? `Rotina esperada a cada ${f.cadencia_dias} dias, no máximo` : "Base sem rotina automática")}</td></tr>`).join("")}
    </tbody></table></details>`;
}
function secaoMudou(P) {
  const M = P?.mudancas;
  if (!M) return "";
  const desde = data(M.desde), base = n => M.base?.[n] && M.base[n] > M.desde ? ` (comparado com ${data(M.base[n])})` : "";
  const cartao = (titulo, sub, link, itens, vazio) => `<div class="cartao mudou"><header><div><h2>${titulo}</h2><p>${sub}</p></div>${link ? `<a href="${link}" class="mais">Abrir →</a>` : ""}</header>
    <div class="corpo">${itens.length ? `<ul class="linhas">${itens.slice(0, 5).join("")}</ul>${itens.length > 5 ? `<p class="peq" style="margin:6px 0 0">e mais ${num(itens.length - 5)}</p>` : ""}` : `<p class="vazio">${vazio}</p>`}</div></div>`;
  const li = (t1, t2, v = "") => `<li><div><div class="t1">${t1}</div>${t2 ? `<div class="t2">${t2}</div>` : ""}</div>${v ? `<div class="v">${v}</div>` : ""}</li>`;
  const ct = M.contratos_novos.map(c => li(`<a href="#/briefings?contrato=${encodeURIComponent(c.id)}">${esc(c.id.replace(/-SEINFRA$/, ""))}</a> · novo`, esc(`${c.mun || ""} · ${c.obj || ""}`), c.valor ? brlCurto(c.valor) : ""))
    .concat(M.contratos_situacao.map(c => li(`<a href="#/briefings?contrato=${encodeURIComponent(c.id)}">${esc(c.id.replace(/-SEINFRA$/, ""))}</a> · ${esc(c.mun || "")}`, `${esc(c.de || "—")} → <b>${esc(c.para || "—")}</b>`)));
  const lc = M.licitacoes_novas.map(l => li(l.link ? `<a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.edital || "Edital")}</a>` : esc(l.edital || "Edital"), esc(l.objeto), l.encerramento ? `<small>até ${data(l.encerramento)}</small>` : ""));
  const sn = M.sinistros.map(o => li(`<a href="#/briefings?rodovia=${encodeURIComponent(o.rodovia)}">${esc(o.rodovia)}</a> · ${esc(o.tipo || "Acidente")}${o.fatal ? ` ${chip("com morte", "critico")}` : ""}`, esc(o.municipio || ""), `<small>${data(o.data)}</small>`));
  const tm = M.terminais_entregues.map(t => li(esc(t.municipio), esc(t.localidade)));
  return `<section class="secao"><h2>O que mudou desde ${desde}</h2>
    <div class="grade g-agir" style="margin-top:12px">
      ${cartao("Contratos", `Novos no e-Obras e mudanças de situação${base("contratos")}`, "#/obras", ct, "Nenhum contrato novo nem mudança de situação.")}
      ${cartao("Sinistros noticiados", "Ocorrências em rodovias estaduais, pela data da notícia", "#/sinistros", sn, "Nenhuma ocorrência noticiada no período.")}
      ${cartao("Licitações rodoviárias novas", `Publicadas no PNCP${base("licitacoes")}`, "#/licitacoes", lc, "Nenhuma licitação rodoviária nova.")}
      ${tm.length ? cartao("Terminais entregues", `Planilha do DMOB${base("terminais")}`, "#/terminais", tm, "") : ""}
    </div></section>`;
}

export async function render(el) {
  const [{ meta, lista }, an, lic, svg, P] = await Promise.all([contratos(), talvez("sinistros_analise"), talvez("licitacoes"),
    fetch("img/malha-am.svg").then(r => r.ok ? r.text() : "").catch(() => ""), talvez("painel")]);
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

  el.innerHTML = `${ESTILO_PAINEL}
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

    ${secaoMudou(P)}
    ${faixaFontes(P)}
    <section class="secao"><h2>Módulos do DMOB Hub</h2>
      <div class="indice" style="margin-top:8px">${grupos.filter(g => g.links.length).map(g => `<section><h3>${esc(g.t)}</h3>${g.links.map(a => {
        const h = a.getAttribute("href"), ic = a.querySelector("use")?.getAttribute("href") || "#i-inicio";
        return `<a href="${esc(h)}"${a.target ? ' target="_blank" rel="noopener"' : ""}><svg aria-hidden="true"><use href="${ic}"/></svg><span><b>${esc(a.textContent.trim())}</b><small>${esc(DESCR[h] || (a.target ? "Abre em nova aba" : ""))}</small></span></a>`;
      }).join("")}</section>`).join("")}</div>
    </section>`;

  // malha: pinta rodovias pela faixa de prioridade de sinistros; clique abre o briefing da rodovia
  const mapa = $("#malha svg");
  if (mapa) {
    // uma só parada de Tab no mapa ("roving tabindex", ARIA APG): setas passam de rodovia em rodovia, Enter abre o briefing.
    mapa.setAttribute("role", "group");  // role=img esconderia as rodovias clicáveis do leitor de tela
    mapa.setAttribute("aria-label", "Malha rodoviária estadual: use as setas para escolher a rodovia e Enter para abrir o briefing");
    mapa.querySelectorAll("path.am").forEach(p => {
      const r = an?.rodovias?.[p.dataset.cod];
      if (r?.faixa === "Alta") p.classList.add("prio-alta"); else if (r?.faixa === "Média") p.classList.add("prio-media");
      p.setAttribute("tabindex", "-1"); p.setAttribute("role", "link");
      p.setAttribute("aria-label", `${p.dataset.cod}${r?.faixa ? `, prioridade ${r.faixa.toLowerCase()} em sinistros` : ""}: abrir briefing`);
      p.addEventListener("click", () => { location.hash = `#/briefings?rodovia=${encodeURIComponent(p.dataset.cod)}`; });
    });
    mapa.querySelectorAll("path.am.prio-media, path.am.prio-alta").forEach(p => p.parentNode.append(p));  // destaque por cima
    // ordem das setas: prioridade alta primeiro, depois média, depois o código
    const peso = p => p.classList.contains("prio-alta") ? 0 : p.classList.contains("prio-media") ? 1 : 2;
    const rods = [...mapa.querySelectorAll("path.am")].sort((a, b) => peso(a) - peso(b) || a.dataset.cod.localeCompare(b.dataset.cod));
    let i = 0;
    if (rods.length) rods[0].setAttribute("tabindex", "0");
    const foca = k => { rods[i].setAttribute("tabindex", "-1"); i = (k + rods.length) % rods.length; rods[i].setAttribute("tabindex", "0"); rods[i].focus(); };
    mapa.addEventListener("keydown", e => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (k) { e.preventDefault(); foca(i + k); }
      else if (e.key === "Home") { e.preventDefault(); foca(0); }
      else if (e.key === "End") { e.preventDefault(); foca(rods.length - 1); }
      else if (e.key === "Enter" || e.key === " ") { const p = e.target.closest?.("path.am"); if (p) { e.preventDefault(); p.dispatchEvent(new MouseEvent("click")); } }
    });
    mapa.addEventListener("focusin", e => { const k = rods.indexOf(e.target); if (k >= 0) i = k; });
  }
}

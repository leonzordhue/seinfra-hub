// Briefings de uma página, por município ou por rodovia, montados dos dados do Hub e prontos para imprimir/PDF.
// [Nexus] 23/11/2026. Fontes: eobras.json, sinistros.json, sinistros_analise.json, licitacoes.json, icm.json.
// A IA não escreve nada aqui: toda frase sai de uma conta sobre os dados, com a fonte no rodapé.
import { contratos, talvez, municipios, obraDaRodovia } from "../dados.js";
import { esc, num, pct, data, brlCurto, semAcento, plural } from "../fmt.js";
import { $, chip, chipSit, opcoes } from "../ui.js";

const estado = { tipo: "municipio", alvo: "" };
const rxRod = cod => new RegExp(`\\bAM[\\s-]?0*${parseInt(cod.slice(3), 10)}\\b`, "i");

export async function render(el, params) {
  const [{ meta: eMeta, lista }, sin, an, lic, icm, rodj] = await Promise.all([
    contratos(), talvez("sinistros"), talvez("sinistros_analise"), talvez("licitacoes"), talvez("icm"),
    fetch("../pipelines/sinistros/rodovias.json").then(r => r.ok ? r.json() : null).catch(() => null)]);
  const icmPor = new Map((icm?.rodovias || []).map(r => [r.codigo, r]));
  const nomes = rodj ? Object.fromEntries(Object.entries(rodj.rodovias || rodj).filter(([k]) => /^AM-/.test(k)).map(([k, v]) => [k, v.nomes_fortes || []])) : {};
  const muns = [...new Set(lista.flatMap(municipios))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rods = [...new Set([...icmPor.keys(), ...Object.keys(an?.rodovias || {}), ...Object.keys(nomes)])].sort();
  if (params?.get("municipio")) Object.assign(estado, { tipo: "municipio", alvo: params.get("municipio") });
  if (params?.get("rodovia")) Object.assign(estado, { tipo: "rodovia", alvo: params.get("rodovia") });

  el.innerHTML = `
    <div class="cab nao-imprime"><div><h1>Briefings</h1>
      <p>Resumo de uma página para reunião, visita ou resposta a parlamentar: obras, sinistros, condição da via e licitações de um município ou de uma rodovia. Use "Imprimir / PDF" para salvar.</p></div></div>
    <div class="filtros nao-imprime">
      <div class="seg" id="fTipo"><button type="button" data-v="municipio" aria-pressed="${estado.tipo === "municipio"}">Município</button><button type="button" data-v="rodovia" aria-pressed="${estado.tipo === "rodovia"}">Rodovia</button></div>
      <select id="fAlvo" aria-label="Escolha"></select>
      <button type="button" class="btn pri" id="imprimir">Imprimir / PDF</button>
    </div>
    <div id="doc"></div>`;

  const sel = $("#fAlvo", el);
  const opts = () => { sel.innerHTML = opcoes(estado.tipo === "municipio" ? muns : rods, estado.alvo, estado.tipo === "municipio" ? "Escolha o município" : "Escolha a rodovia"); };
  const pinta = () => {
    const ctx = { lista, sin, an, lic, icmPor, nomes, eMeta };
    $("#doc", el).innerHTML = !estado.alvo ? `<p class="vazio">Escolha ${estado.tipo === "municipio" ? "um município" : "uma rodovia"} para montar o briefing.</p>`
      : estado.tipo === "municipio" ? docMunicipio(estado.alvo, ctx) : docRodovia(estado.alvo, ctx);
  };
  $("#fTipo", el).onclick = e => { const b = e.target.closest("button"); if (!b) return; estado.tipo = b.dataset.v; estado.alvo = "";
    $("#fTipo", el).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); opts(); pinta(); };
  sel.onchange = () => { estado.alvo = sel.value; history.replaceState(null, "", `#/briefings?${estado.tipo}=${encodeURIComponent(estado.alvo)}`); pinta(); };
  $("#imprimir", el).onclick = () => window.print();
  opts(); pinta();
}

const cab = (titulo, sub) => `<div class="doc-cab"><div><h1>${esc(titulo)}</h1><div class="nota">${esc(sub)}</div></div>
  <img src="../assets/marca_gov_seinfra.webp" alt="Governo do Amazonas · SEINFRA" width="250" height="40"></div>`;
const rodape = (ctx, extra = "") => `<p class="nota" style="margin-top:22px;border-top:1px solid var(--borda);padding-top:8px">
  DMOB/SEINFRA-AM · gerado em ${new Date().toLocaleDateString("pt-BR")}. Fontes: e-Obras (posição ${esc(ctx.eMeta.posicao)})${ctx.an ? `; sinistros por notícias (${esc(ctx.an._meta.gerado)})` : ""}${ctx.lic ? `; PNCP (${data(ctx.lic._meta.gerado)})` : ""}${extra}.
  Valores: valor atual = original + aditivos; saldo = valor atual − medido.</p>`;

function tabelaObras(cs) {
  if (!cs.length) return `<p>Nenhum contrato ativo.</p>`;
  return `<table class="t"><thead><tr><th>Contrato</th><th>Objeto</th><th>Situação</th><th class="n">Valor atual</th><th class="n">Físico</th><th class="n">Saldo</th></tr></thead><tbody>
    ${cs.sort((a, b) => b.v_atual - a.v_atual).map(c => `<tr><td><b>${esc(c.id)}</b><div class="peq">${esc(c.emp)}</div></td><td class="obj">${esc((c.obj || "").slice(0, 150))}</td>
    <td>${chipSit(c.sit)}${c.alertas.map(a => `<div class="peq">${esc(a.txt)}</div>`).join("")}</td><td class="n">${brlCurto(c.v_atual)}</td><td class="n">${pct(c.fis)}</td><td class="n">${brlCurto(c.saldo)}</td></tr>`).join("")}</tbody></table>`;
}
const soma = (cs, k) => cs.reduce((s, c) => s + (c[k] || 0), 0);

function blocoLic(lic, teste) {
  if (!lic) return "";
  const ls = lic.pncp.filter(l => teste(l.objeto || "")).slice(0, 8);
  return `<h2>Licitações relacionadas</h2>${ls.length ? `<ul class="lista">${ls.map(l => `<li><div><div class="q">${esc(l.edital)} · ${esc(l.situacao || "")} · publicado em ${data(l.publicacao)}</div>
    <div class="d">${esc(l.objeto.slice(0, 200))}${l.estimado ? ` · estimado ${brlCurto(l.estimado)}` : ""}${l.homologado ? ` · homologado ${brlCurto(l.homologado)}` : ""}</div></div></li>`).join("")}</ul>` : "<p>Nenhum edital no PNCP cita este local no objeto.</p>"}`;
}

function docMunicipio(mun, ctx) {
  const cs = ctx.lista.filter(c => municipios(c).includes(mun));
  const at = cs.filter(c => c.grupo === "ativo"), atn = cs.filter(c => c.grupo === "atencao");
  const lim = new Date(); lim.setFullYear(lim.getFullYear() - 2);
  const conc = cs.filter(c => c.grupo === "encerrado" && c.desde && new Date(c.desde) >= lim);
  const comAl = at.filter(c => c.alertas.length);
  const rodsMun = [...ctx.icmPor.values()].filter(r => (r.municipios || []).some(m => semAcento(m) === semAcento(mun)));
  const ocs = (ctx.sin?.ocorrencias || []).filter(o => semAcento(o.municipio) === semAcento(mun));
  const sintese = [
    `${plural(at.length, "contrato ativo", "contratos ativos")} da SEINFRA em ${mun}, somando ${brlCurto(soma(at, "v_atual"))}, com ${brlCurto(soma(at, "saldo"))} ainda a medir.`,
    atn.length ? `${plural(atn.length, "contrato está", "contratos estão")} paralisado(s), expirado(s) ou em tomada de contas.` : "",
    comAl.length ? `${plural(comAl.length, "contrato ativo tem", "contratos ativos têm")} alerta de gestão (vigência, medição ou descompasso físico-financeiro).` : "",
    conc.length ? `Nos últimos 24 meses, ${plural(conc.length, "contrato foi encerrado", "contratos foram encerrados")} (${brlCurto(soma(conc, "v_atual"))}).` : "",
    ocs.length ? `${plural(ocs.length, "acidente em rodovia estadual foi noticiado", "acidentes em rodovias estaduais foram noticiados")} no município desde 2019 (${num(ocs.filter(o => o.fatal).length)} com morte).` : "",
  ].filter(Boolean);
  const nome = semAcento(mun);
  return `<article class="doc">${cab(`Briefing · ${mun}`, "Departamento de Mobilidade (DMOB) · SEINFRA-AM")}
    <h2>Síntese</h2>${sintese.map(s => `<p>${esc(s)}</p>`).join("")}
    <h2>Obras em andamento (${num(at.length)})</h2>${tabelaObras(at)}
    ${atn.length ? `<h2>Paralisadas, expiradas ou em tomada de contas (${num(atn.length)})</h2>${tabelaObras(atn)}` : ""}
    ${rodsMun.length ? `<h2>Rodovias estaduais no município</h2><table class="t"><thead><tr><th>Rodovia</th><th>Trecho</th><th class="n">Extensão</th><th>Condição (IRI)</th><th class="n">Buracos</th></tr></thead><tbody>
      ${rodsMun.map(r => `<tr><td><b>${esc(r.codigo)}</b></td><td>${esc(r.inicio)} → ${esc(r.fim)}</td><td class="n">${num(r.extensao_total_km, 1)} km</td><td>${esc(r.nivel_geral)} (${num(r.iri_medio, 2)})</td><td class="n">${num(r.n_buracos)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${ocs.length ? `<h2>Sinistros noticiados (desde 2019)</h2><ul class="lista">${ocs.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6).map(o => `<li><div><div class="q">${data(o.data)} · ${esc(o.rodovia)} · ${esc(o.tipo)}${o.fatal ? " · com morte" : ""}</div></div></li>`).join("")}</ul>` : ""}
    ${blocoLic(ctx.lic, o => semAcento(o).includes(nome))}
    ${rodape(ctx, rodsMun.length ? "; condição: levantamento RoadLab (data/icm.json)" : "")}</article>`;
}

function docRodovia(cod, ctx) {
  const rx = rxRod(cod);
  // nomes sem repetição de grafia (Manaus-Itacoatiara / Manaus–Itacoatiara / Manaus/Itacoatiara)
  const vistos = new Set(), nomes = (ctx.nomes[cod] || []).filter(n => { const k = semAcento(n).replace(/[^a-z0-9]/g, ""); return !vistos.has(k) && vistos.add(k); });
  const cita = t => rx.test(t) || nomes.some(n => semAcento(t).includes(semAcento(n)));
  const cs = ctx.lista.filter(c => obraDaRodovia(c.obj, cod));
  const soLocal = ctx.lista.filter(c => c.grupo !== "encerrado" && rx.test(c.obj || "") && !obraDaRodovia(c.obj, cod));
  const at = cs.filter(c => c.grupo !== "encerrado");
  const r = ctx.icmPor.get(cod), s = ctx.an?.rodovias?.[cod];
  const sintese = [
    r ? `${cod}${nomes.length ? ` (${nomes.join(", ")})` : ""}: ${num(r.extensao_total_km, 1)} km, de ${r.inicio} a ${r.fim}; revestimento ${r.revestimento || "—"}. Condição geral ${String(r.nivel_geral).toLowerCase()} (IRI médio ${num(r.iri_medio, 2)} m/km), ${num(r.n_buracos)} buracos registrados no levantamento.` : `${cod}${nomes.length ? ` (${nomes.join(", ")})` : ""}.`,
    `${plural(at.length, "contrato ativo ou pendente cita", "contratos ativos ou pendentes citam")} a rodovia no objeto (${brlCurto(soma(at, "v_atual"))}; saldo ${brlCurto(soma(at, "saldo"))}).`,
    s ? `Sinistros: ${s.leitura}` : "Sem acidente noticiado nesta rodovia desde 2019.",
  ];
  return `<article class="doc">${cab(`Briefing · ${cod}`, "Departamento de Mobilidade (DMOB) · SEINFRA-AM")}
    <h2>Síntese</h2>${sintese.map(x => `<p>${esc(x)}</p>`).join("")}
    ${s ? `<p>${chip(`Prioridade ${num(s.prioridade, 0)} · ${s.faixa}`, s.faixa === "Alta" ? "critico" : s.faixa === "Média" ? "alerta" : "")} ${chip(`${num(s.fatais_100km_ano, 2)} fatais por 100 km/ano`)} ${chip(`tendência ${num(s.tendencia, 2)}×`)}</p>` : ""}
    <h2>Obras e contratos na rodovia (${num(at.length)})</h2>${tabelaObras(at)}
    ${soLocal.length ? `<h2>Obras com acesso pela rodovia (${num(soLocal.length)})</h2><p class="nota">Ramais, estradas e comunidades que citam a ${esc(cod)} só como localização; não entram nos números da rodovia.</p>${tabelaObras(soLocal)}` : ""}
    ${s?.trechos_criticos?.length ? `<h2>Trechos críticos</h2><p>${s.trechos_criticos.map(t => `km ${t.km_ini}–${t.km_fim}: ${t.ocorrencias} ocorrências (${t.fatais} com morte)`).join("; ")}.</p>` : ""}
    ${blocoLic(ctx.lic, cita)}
    ${rodape(ctx, r ? "; condição: levantamento RoadLab (data/icm.json)" : "")}</article>`;
}

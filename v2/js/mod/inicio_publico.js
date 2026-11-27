// Visão geral da versão pública (raiz do site): malha, modais, rios e queimadas, sem contratos nem sinistros. [Claude] 27/11/2026
// Números: data/rodovias_info.json (traçado SEINFRA × malha IBGE), acesso.json (OSRM/IBGE), terminais.json, icm.json (RoadLab), hidro.json (ANA), queimadas.json (INPE).
import { talvez, V2 } from "../dados.js";
import { esc, num, data } from "../fmt.js";
import { kpi } from "../ui.js";

const DESCR = {
  "#/mapa": "Rodovias estaduais e condição do pavimento",
  "#/m/rodovias": "Cadastro das rodovias estaduais", "#/m/ramais": "Ramais e estradas vicinais por município",
  "#/m/viario": "Ruas e vias urbanas por município", "#/m/aerodromos": "Aeródromos do estado",
  "#/terminais": "Terminais flutuantes entregues", "#/m/icm": "Irregularidade (IRI) e buracos medidos em campo",
  "#/acesso": "Tempo de viagem até Manaus, hospitais e portos", "#/ambiente": "Nível dos rios (ANA) e focos de queimada (INPE)",
  "#/m/atlas": "Todos os modais num só mapa",
};

export async function render(el) {
  const [info, ac, term, icm, H, Q, svg] = await Promise.all([talvez("rodovias_info"), talvez("acesso"), talvez("terminais"), talvez("icm"),
    talvez("hidro"), talvez("queimadas"), fetch(`${V2}img/malha-am.svg`).then(r => r.ok ? r.text() : "").catch(() => "")]);
  const rods = Object.values(info?.rodovias || {});
  const ext = rods.reduce((t, r) => t + (r.municipios || []).reduce((s, m) => s + m.km, 0), 0);
  const R = ac?.resumo;
  const kmLev = (icm?.rodovias || []).reduce((t, r) => t + (r.extensao_levantada_km || 0), 0);
  const est = H?.estacoes || [], emEst = est.filter(e => e.ultima.situacao === "estiagem");
  const qa = Q?.anos?.at(-1), q30 = (Q?.recentes || []).filter(p => p[4]).length;
  const dia = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const frase = [
    rods.length ? `O Amazonas tem <b>${num(rods.length)} rodovias estaduais</b>, com cerca de <b>${num(ext, 0)} km</b> de traçado` : "",
    R ? `<b>${num(R.com_ligacao)} das ${num(R.municipios)} sedes municipais</b> se ligam a Manaus por estrada, ${num(R.com_ligacao_via_balsa)} delas com travessia de balsa; nas demais, o acesso é só por rio ou avião` : "",
  ].filter(Boolean).join(". ") + ".";

  const grupos = [];
  document.querySelectorAll(".nav > *").forEach(n => {
    if (n.classList.contains("nav-grupo")) grupos.push({ t: n.textContent.trim(), links: [] });
    else if (n.tagName === "A" && grupos.length && n.getAttribute("href") !== "#/inicio") grupos.at(-1).links.push(n);
  });

  el.innerHTML = `
    <div class="cab"><div><span class="sobre">${esc(dia)}</span><h1>Visão geral</h1>
      <p>Rodovias, ramais, vias urbanas, aeródromos e terminais fluviais sob responsabilidade da Secretaria de Estado de Infraestrutura (SEINFRA), com dados abertos de cada fonte.</p></div></div>

    <div class="painel">
      <div class="resumo"><span class="eyebrow">Transporte no Amazonas</span>
        <p>${frase}</p>
        <div class="acoes"><a class="btn pri" href="#/mapa">Abrir o mapa</a><a class="btn" href="#/m/rodovias">Rodovias estaduais</a><a class="btn" href="#/acesso">Acessibilidade</a></div>
      </div>
      <div class="mapa-mini"><header><h2>Malha rodoviária estadual</h2><a class="mais" href="#/mapa">Mapa completo →</a></header>
        <div id="malha">${svg || `<p class="vazio">Mapa indisponível no momento.</p>`}</div>
        <div class="leg"><span><i></i>Rodovia estadual</span><span><i class="br"></i>Rodovia federal</span><span><i class="rio"></i>Hidrovia</span></div>
      </div>
    </div>

    <div class="grade g-kpi">
      ${rods.length ? kpi("Rodovias estaduais", num(rods.length), `cerca de ${num(ext, 0)} km de traçado`) : ""}
      ${R ? kpi("Sedes ligadas a Manaus por estrada", `${num(R.com_ligacao)} de ${num(R.municipios)}`, `${num(R.com_ligacao_via_balsa)} com travessia de balsa`, true) : ""}
      ${term ? kpi("Terminais fluviais entregues", num(term.entregues.length), `${num(new Set(term.entregues.map(t => t.municipio)).size)} municípios`) : ""}
      ${icm ? kpi("Pavimento avaliado em campo", `${num(kmLev, 0)} km`, `${num(icm.rodovias.length)} rodovias`) : ""}
      ${R ? kpi("Municípios com aeródromo", num(R.com_aerodromo), `${num(R.com_voo_regular)} com voo regular`) : ""}
    </div>

    ${H || Q ? `<section class="secao cartao"><header><div><h2>Rios e queimadas</h2><p>Situação mais recente, com dados da ANA e do INPE.</p></div><a class="mais" href="#/ambiente">Ver detalhes →</a></header>
      <div class="corpo"><div class="grade g-kpi">
        ${est.length ? kpi("Estações em estiagem", `${num(emEst.length)} de ${num(est.length)}`, emEst.length ? emEst.map(e => e.nome).join(", ") : "nenhuma abaixo da cota de estiagem", emEst.length > 0) : ""}
        ${qa ? kpi(`Focos perto de rodovias em ${qa}`, num(Q.em_buffer[qa]), `a até ${num(Q._meta.buffer_km)} km · até ${data(Q._meta.gerado_em)}`) : ""}
        ${Q ? kpi("Nos últimos 30 dias", num(q30), "focos perto de rodovias estaduais") : ""}
      </div></div></section>` : ""}

    <section class="secao"><h2>O que você encontra aqui</h2>
      <div class="indice" style="margin-top:8px">${grupos.filter(g => g.links.length).map(g => `<section><h3>${esc(g.t)}</h3>${g.links.map(a => {
        const h = a.getAttribute("href"), ic = a.querySelector("use")?.getAttribute("href") || "#i-inicio";
        return `<a href="${esc(h)}"><svg aria-hidden="true"><use href="${ic}"/></svg><span><b>${esc(a.textContent.trim())}</b><small>${esc(DESCR[h] || "")}</small></span></a>`;
      }).join("")}</section>`).join("")}</div>
    </section>`;

  const mapa = el.querySelector("#malha svg");
  if (mapa) { mapa.setAttribute("role", "img"); mapa.setAttribute("aria-label", "Mapa da malha rodoviária estadual do Amazonas"); }
}

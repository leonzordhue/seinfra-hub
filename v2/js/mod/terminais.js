// Terminais fluviais: flutuantes entregues + programa "Portos Autorizados" (termos de cessão 2026). [Nexus] 24/11/2026
// Dados: data/terminais.json (robô pipelines/terminais/coletar.py lê a planilha de acompanhamento do DMOB).
import { carregar } from "../dados.js";
import { esc, num, data, semAcento } from "../fmt.js";
import { $, kpi, chip, fonte, tabela, gaveta } from "../ui.js";
import { script, folha, estilo, dist, baixar, csv } from "./campo_comum.js";

// etapas do programa, na ordem do processo (SEAPLANC → SEAENG → AJU → assinatura → entrega)
const ETAPAS = [
  { id: "a_iniciar", rot: "Aguardando solicitação", cor: "var(--s6)" },
  { id: "producao", rot: "Termo em produção", cor: "#6FA0F0" },
  { id: "assinatura", rot: "Aguardando assinatura", cor: "var(--ouro)" },
  { id: "assinado", rot: "Termo assinado", cor: "#1baf7a" },
  { id: "pronto", rot: "Pronto para entrega", cor: "#0B7343" },
];
const ETAPA = Object.fromEntries(ETAPAS.map(e => [e.id, e]));
const nivel = e => e === "cancelado" ? "critico" : e === "assinado" || e === "pronto" || e === "entregue" ? "ok" : e === "assinatura" ? "alerta" : "";
const ANCORA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 1 3 3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1 3-3zM12 9v12M5 15a7 7 0 0 0 14 0M8 12h8"/></svg>`;
const hoje = new Date();
const dias = iso => iso ? Math.round((hoje - new Date(iso)) / 864e5) : null;

const CSS = `
.funil { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; border: 1px solid var(--borda); border-radius: var(--raio); overflow: hidden; background: var(--sup); }
.funil > div { padding: 14px 16px 16px; border-left: 1px solid var(--borda); position: relative; }
.funil > div:first-child { border-left: 0; }
.funil .n { font: 600 1.7rem/1.1 var(--f-titulo); color: var(--tinta); font-variant-numeric: tabular-nums; }
.funil .r { font-size: 12.5px; color: var(--tinta-3); margin-top: 4px; }
.funil .b { height: 6px; border-radius: 3px; margin-top: 12px; background: var(--sup-3); overflow: hidden; }
.funil .b i { display: block; height: 100%; border-radius: 3px; }
.funil .seta { position: absolute; right: -7px; top: 50%; width: 12px; height: 12px; transform: translateY(-50%) rotate(45deg); background: var(--sup); border-top: 1px solid var(--borda); border-right: 1px solid var(--borda); z-index: 1; }
.mapa-term { height: 520px; border-radius: 0 0 var(--raio) var(--raio); }
.mapa-term .leaflet-popup-content { font: 13px/1.45 var(--f-corpo); }
.leg-term { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--tinta-2); padding: 10px 18px; border-top: 1px solid var(--borda); }
.leg-term i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; border: 2px solid var(--sup); box-shadow: 0 0 0 1px var(--borda-2); }
.leg-term i.q { border-radius: 2px; }
.t .proc { font-variant-numeric: tabular-nums; white-space: nowrap; }
.aviso-coord { font-size: 12px; color: var(--alerta); }
/* pino e ficha dos entregues no estilo da v1 (Paulo, 25/11/2026) */
.pino-term { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #0077b6, #023e8a); border: 3px solid #fff; box-shadow: 0 3px 10px rgba(0,119,182,.5); display: grid; place-items: center; color: #fff; cursor: pointer; transition: transform .15s; }
.pino-term svg { width: 15px; height: 15px; }
.leaflet-marker-icon:hover .pino-term, .leaflet-marker-icon:focus-visible .pino-term { transform: scale(1.15); }
.leaflet-marker-icon:focus-visible { outline: none; }
.leaflet-marker-icon:focus-visible .pino-term { box-shadow: 0 0 0 3px var(--ouro), 0 3px 10px rgba(0,119,182,.5); }
.ft-cab { margin: 6px -22px 0; padding: 22px 22px 20px; background: linear-gradient(135deg, #0077b6, #023e8a); color: #fff; }
.ft-cab .ft-ic { width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,.16); display: grid; place-items: center; margin-bottom: 10px; }
.ft-cab .ft-ic svg { width: 24px; height: 24px; }
.ft-cab .ft-tipo { font-size: 12px; letter-spacing: .04em; opacity: .85; }
.ft-cab h2 { margin: 2px 0 4px; font: 600 1.45rem/1.2 var(--f-titulo); color: #fff; }
.ft-cab p { margin: 0; opacity: .9; }
.ft-grade { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; margin: 18px 0; }
.ft-grade dt { font-size: 12.5px; color: var(--tinta-3); }
.ft-grade dd { margin: 2px 0 0; font-weight: 600; color: var(--tinta); }
.ft-grade dd.n { font-variant-numeric: tabular-nums; }
.ft-mm { height: 240px; border-radius: var(--raio); border: 1px solid var(--borda); }
.ft-sobre { margin-top: 16px; padding: 12px 14px; border-radius: var(--raio); background: var(--sup-2, var(--sup-3)); font-size: 13.5px; line-height: 1.5; color: var(--tinta-2); }
.leg-term .pino-mini { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; background: linear-gradient(135deg, #0077b6, #023e8a); border: 2px solid #fff; box-shadow: 0 0 0 1px var(--borda-2); }
@media (max-width: 900px) { .funil { grid-template-columns: repeat(2, minmax(0, 1fr)); } .funil > div { border-top: 1px solid var(--borda); } .funil .seta { display: none; } .mapa-term { height: 380px; } }`;

export async function render(el) {
  estilo("terminais-css", CSS);
  const d = await carregar("terminais");
  const ped = d.pedidos, ent = d.entregues;
  const ativos = ped.filter(p => p.etapa !== "cancelado");
  const cont = id => ped.filter(p => p.etapa === id).length;
  const res = d.resumo_planilha || {};
  // pronto p/ entrega vem do quadro-resumo da planilha (não há linha com esse status)
  const nEtapa = { a_iniciar: cont("a_iniciar"), producao: cont("producao"), assinatura: cont("assinatura"), assinado: cont("assinado"), pronto: res["Terminais prontos p/ Entrega"] ?? cont("pronto") };
  const maxE = Math.max(...Object.values(nEtapa), 1);
  const munsPed = new Set(ativos.map(p => p.municipio));
  const munsEnt = new Set(ent.map(t => t.municipio));
  const novos = [...munsPed].filter(m => !munsEnt.has(m));
  // pedido a menos de 2 km de um terminal já entregue: possível duplicidade
  ped.forEach(p => { if (p.lat != null) { const t = ent.find(t => dist([p.lat, p.lon], [t.lat, t.lon]) < 2000); if (t) p.perto = t.localidade; } });
  const semCoord = ativos.filter(p => p.lat == null && p.localidade);
  const parados = ativos.filter(p => p.etapa === "assinatura" && dias(p.datas.protocolo) > 21);

  el.innerHTML = `
    <div class="cab"><div><h1>Terminais fluviais</h1>
      <p>Terminais flutuantes entregues pela SEINFRA e o programa Portos Autorizados de 2026: termos de cessão por município, da solicitação à entrega.</p></div>
      <div class="fontes">${fonte("Planilha DMOB", data(d._meta.gerado_em))}${fonte("Entregues", `${num(ent.length)} terminais`)}</div></div>

    <div class="grade g-kpi">
      ${kpi("Terminais entregues", num(ent.length), `${num(munsEnt.size)} municípios`)}
      ${kpi("Pedidos em andamento (2026)", num(ativos.length), `${num(munsPed.size)} municípios`, true)}
      ${kpi("Aguardando assinatura", num(nEtapa.assinatura), parados.length ? `${num(parados.length)} há mais de 21 dias do protocolo` : "dentro do prazo")}
      ${kpi("Municípios novos", num(novos.length), "sem terminal entregue até hoje")}
      ${kpi("Cancelados", num(cont("cancelado")), "pedidos encerrados")}
    </div>

    <section class="secao"><h2>Andamento do programa</h2>
      <p class="nota" style="margin:4px 0 12px;color:var(--tinta-3);font-size:13px">Termos de cessão por etapa. "Pronto para entrega" vem do quadro-resumo da planilha.</p>
      <div class="funil">${ETAPAS.map((e, i) => `<div><div class="n">${num(nEtapa[e.id])}</div><div class="r">${e.rot}</div>
        <div class="b"><i style="width:${nEtapa[e.id] / maxE * 100}%;background:${e.cor}"></i></div>${i < ETAPAS.length - 1 ? '<span class="seta" aria-hidden="true"></span>' : ""}</div>`).join("")}</div>
    </section>

    <section class="secao"><h2>Onde estão</h2>
      <div class="cartao" style="margin-top:12px"><header><div><h2>${num(ent.length)} entregues e ${num(ativos.filter(p => p.lat != null).length)} pedidos no mapa</h2><p>Clique num ponto para ver a ficha${semCoord.length ? ` · ${num(semCoord.length)} pedido(s) sem coordenada válida` : ""}</p></div></header>
        <div id="mapaTerm" class="mapa-term" role="region" aria-label="Mapa dos terminais fluviais"></div>
        <div class="leg-term"><span><span class="pino-mini"></span>Entregue</span>${ETAPAS.slice(1, 4).map(e => `<span><i style="background:${e.cor}"></i>${e.rot}</span>`).join("")}<span><i style="background:var(--critico)"></i>Cancelado</span></div>
      </div>
    </section>

    <section class="secao"><h2>Pedidos de 2026</h2>
      <div class="filtros" style="margin-top:12px"><input type="search" id="fT" placeholder="Buscar município, localidade ou processo" aria-label="Buscar pedidos">
        <select id="fE" aria-label="Etapa"><option value="">Todas as etapas</option>${ETAPAS.map(e => `<option value="${e.id}">${e.rot}</option>`).join("")}<option value="cancelado">Cancelado</option></select>
        <button class="btn" id="csvT" type="button">Baixar CSV</button><span class="contagem" id="nT"></span></div>
      <div class="cartao" id="tabPed"></div>
    </section>

    <section class="secao"><h2>Terminais entregues</h2>
      <div class="cartao" style="margin-top:12px" id="tabEnt"></div>
      <p class="nota" style="font-size:12.5px;color:var(--tinta-3);margin-top:10px">Fonte: ${esc(d._meta.fonte)}. ${esc(d._meta.metodologia)}</p>
    </section>`;

  const colsPed = [
    { k: "municipio", rot: "Município", html: p => `<b style="color:var(--tinta)">${esc(p.municipio)}</b>${p.processo ? `<div class="peq proc">Proc. ${esc(p.processo)}</div>` : ""}` },
    { k: "localidade", rot: "Localidade", html: p => `${esc(p.localidade || "—")}${p.coord_aviso && p.lat == null ? `<div class="aviso-coord">coordenada a conferir</div>` : ""}${p.perto ? `<div class="aviso-coord">a menos de 2 km do entregue “${esc(p.perto)}”</div>` : ""}` },
    { k: "etapa", rot: "Etapa", v: p => ETAPAS.findIndex(e => e.id === p.etapa), html: p => chip(p.status, nivel(p.etapa)) },
    { k: "protocolo", rot: "Protocolo", n: 1, v: p => p.datas.protocolo, html: p => p.datas.protocolo ? `${data(p.datas.protocolo)}<div class="peq">${num(dias(p.datas.protocolo))} dias</div>` : "—" },
    { k: "assin", rot: "Assinatura", n: 1, v: p => p.datas.assinatura, html: p => p.datas.assinatura ? data(p.datas.assinatura) : "—" },
    { k: "entrega", rot: "Entrega", n: 1, v: p => p.datas.entrega, html: p => p.datas.entrega ? data(p.datas.entrega) : "—" },
  ];
  const filtrar = () => {
    const q = semAcento($("#fT").value), e = $("#fE").value;
    const ls = ped.filter(p => (!e || p.etapa === e) && (!q || semAcento(`${p.municipio} ${p.localidade} ${p.processo}`).includes(q)));
    $("#nT").textContent = `${num(ls.length)} de ${num(ped.length)}`;
    tabela($("#tabPed"), colsPed, ls, { ordem: { k: "etapa", dir: -1 }, onLinha: ficha });
    return ls;
  };
  $("#fT").oninput = filtrar; $("#fE").onchange = filtrar;
  $("#csvT").onclick = () => baixar("pedidos_terminais_2026.csv", csv(["municipio", "localidade", "processo", "status", "lat", "lon", "protocolo", "assinatura", "entrega"],
    filtrar().map(p => [p.municipio, p.localidade, p.processo, p.status, p.lat, p.lon, p.datas.protocolo, p.datas.assinatura, p.datas.entrega])), "text/csv");
  filtrar();
  tabela($("#tabEnt"), [
    { k: "municipio", rot: "Município", html: t => `<b style="color:var(--tinta)">${esc(t.municipio)}</b>` },
    { k: "localidade", rot: "Localidade" },
    { k: "coord", rot: "Coordenada", n: 1, sem_ord: 1, html: t => `<span class="peq">${num(t.lat, 2)}, ${num(t.lon, 2)}</span>` },
  ], ent, { ordem: { k: "municipio", dir: 1 }, onLinha: t => { mapa?.flyTo([t.lat, t.lon], 9, { duration: .5 }); fichaEnt(t); } });

  let mapa = null, mini = null;
  // minimapa de satélite na ficha (como o modal da v1); recriado a cada ficha
  function miniMapa(g, lat, lon) {
    const box = g.querySelector(".ft-mm");
    if (!box || !window.L) return;
    if (mini) { try { mini.remove(); } catch { /* já removido com a gaveta */ } }
    const L = window.L;
    mini = L.map(box, { zoomControl: false, attributionControl: false, scrollWheelZoom: false }).setView([lat, lon], 13);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, className: "tile-sat-clara" }).addTo(mini);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }).addTo(mini);
    L.marker([lat, lon], { icon: pino(), keyboard: false, interactive: false }).addTo(mini);
    setTimeout(() => mini?.invalidateSize(), 220);   // a gaveta desliza em .18s
  }
  const pino = () => window.L.divIcon({ className: "", html: `<div class="pino-term">${ANCORA}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  const gms = v => v.toFixed(5).replace(".", ",");   // num() limita as casas; coordenada precisa de 5
  const coordTxt = (lat, lon) => `${num(Math.abs(lat), 4)}° S · ${num(Math.abs(lon), 4)}° O`;

  function fichaEnt(t) {
    const g = gaveta(`<div class="ft-cab"><div class="ft-ic">${ANCORA}</div><div class="ft-tipo">Terminal flutuante · entregue</div>
        <h2>${esc(t.localidade)}</h2><p>${esc(t.municipio)}</p></div>
      <dl class="ft-grade">
        <div><dt>Município</dt><dd>${esc(t.municipio)}</dd></div>
        <div><dt>Destino</dt><dd>${esc(t.localidade)}</dd></div>
        <div><dt>Latitude</dt><dd class="n">${gms(t.lat)}°</dd></div>
        <div><dt>Longitude</dt><dd class="n">${gms(t.lon)}°</dd></div>
      </dl>
      <div class="ft-mm" role="img" aria-label="Localização do terminal ${esc(t.localidade)}: ${coordTxt(t.lat, t.lon)}"></div>
      <p class="ft-sobre"><b>Sobre os terminais flutuantes:</b> estruturas de embarque e desembarque instaladas às margens dos rios, que ligam a sede do município às comunidades e distritos do interior.</p>
      <p style="font-size:12.5px;color:var(--tinta-3)">Fonte: planilha de acompanhamento do DMOB.</p>`);
    miniMapa(g, t.lat, t.lon);
  }

  function ficha(p) {
    const etapas = [["Protocolo", p.datas.protocolo], ["SEAPLANC", p.datas.seaplanc], ["SEAENG", p.datas.seaeng], ["AJU", p.datas.aju], ["SEAAF", p.datas.seaaf], ["Assinatura", p.datas.assinatura], ["Entrega", p.datas.entrega]];
    const g = gaveta(`<span class="sobre" style="display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ouro-2)">Terminal flutuante · pedido 2026</span>
      <h2 style="font-size:1.3rem;margin:4px 0 2px">${esc(p.localidade || p.municipio)}</h2><p style="margin:0;color:var(--tinta-3)">${esc(p.municipio)}${p.processo ? ` · processo ${esc(p.processo)}` : ""}</p>
      <p style="margin:12px 0">${chip(p.status, nivel(p.etapa))}</p>
      <dl class="ficha">${etapas.map(([r, v]) => `<dt>${r}</dt><dd>${v ? data(v) : "—"}</dd>`).join("")}
        <dt>Coordenada</dt><dd>${p.lat != null ? `${gms(p.lat)}, ${gms(p.lon)}` : `a conferir${p.coord_aviso ? ` (${esc(p.coord_aviso)})` : ""}`}</dd></dl>
      ${p.perto ? `<p class="aviso">Fica a menos de 2 km do terminal entregue “${esc(p.perto)}”: confirmar se não é o mesmo ponto.</p>` : ""}
      ${p.lat != null ? `<div class="ft-mm" role="img" aria-label="Localização do pedido ${esc(p.localidade || p.municipio)}: ${coordTxt(p.lat, p.lon)}"></div>` : ""}
      <p style="font-size:12.5px;color:var(--tinta-3)">Fonte: planilha de acompanhamento do DMOB.</p>`);
    if (p.lat != null) miniMapa(g, p.lat, p.lon);
  }

  // mapa (Leaflet; fundo satélite Esri sem chave, igual à v1)
  try {
    folha("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css");
    await script("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
    const L = window.L, box = $("#mapaTerm");
    if (!box) return;
    const m = mapa = L.map(box, { scrollWheelZoom: false, preferCanvas: true }).setView([-3.4653, -62.2159], 6);
    // fundo da v1 (Paulo, 25/11/2026): satélite clareado + estradas + limites/nomes; o cinza escondia rios e lagos
    const esri = (s, o) => L.tileLayer(`https://{s}.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
      Object.assign({ subdomains: ["server", "services"], maxZoom: 18, keepBuffer: 3, updateWhenZooming: false }, o)).addTo(m);
    esri("World_Imagery", { className: "tile-sat-clara", attribution: "© Esri World Imagery" });
    esri("Reference/World_Transportation", { opacity: 0.85, minZoom: 8 });
    esri("Reference/World_Boundaries_and_Places", {});
    const cor = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const sup = cor("--sup");
    const corEtapa = { producao: "#6FA0F0", assinatura: cor("--ouro"), assinado: "#1baf7a", pronto: "#0B7343", cancelado: cor("--critico"), a_iniciar: cor("--s6") };
    const pts = [];
    ped.filter(p => p.lat != null).forEach(p => {
      pts.push([p.lat, p.lon]);
      L.circleMarker([p.lat, p.lon], { radius: 7, color: sup, weight: 2, fillColor: corEtapa[p.etapa] || cor("--s6"), fillOpacity: p.etapa === "cancelado" ? .55 : 1 })
        .on("click", () => ficha(p)).bindTooltip(`${esc(p.localidade || p.municipio)} · ${esc(p.status)}`).addTo(m);
    });
    // entregues por último, como marcador HTML (pane acima do canvas dos pedidos): Tab + Enter também abrem a ficha
    ent.forEach(t => L.marker([t.lat, t.lon], { icon: pino(), title: `${t.localidade} (${t.municipio}) · entregue`, alt: `Terminal entregue: ${t.localidade}, ${t.municipio}`, riseOnHover: true })
      .on("click", () => fichaEnt(t)).addTo(m));
    const tudo = pts.concat(ent.map(t => [t.lat, t.lon]));
    if (tudo.length) m.fitBounds(tudo, { padding: [24, 24], maxZoom: 7 });
  } catch (e) {
    $("#mapaTerm").innerHTML = `<p class="vazio">Mapa indisponível: ${esc(e.message)}</p>`;
  }
}

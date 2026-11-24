// Carga dos dados gerados pelas rotinas (pasta ../data). Cada arquivo traz _meta com fonte e data. [Nexus] 23/11/2026
const cache = new Map();

export function carregar(nome) {
  if (!cache.has(nome)) {
    cache.set(nome, fetch(`../data/${nome}.json`, { cache: "no-cache" })
      .then(r => { if (!r.ok) throw new Error(`${nome}.json: HTTP ${r.status}`); return r.json(); })
      .catch(e => { cache.delete(nome); throw e; }));
  }
  return cache.get(nome);
}

// Arquivo ausente (ex.: licitacoes.json antes da 1ª rodada) não derruba o módulo: volta null.
export const talvez = nome => carregar(nome).catch(e => { console.warn(e); return null; });

// ── e-Obras ──────────────────────────────────────────────────────────────────
export const SIT = {
  ativo: ["Andamento", "Vigente", "A Iniciar", "Em recebimento"],
  atencao: ["Paralisado", "Expirado", "Tomada de Contas"],
};
export const grupoSit = s => SIT.ativo.includes(s) ? "ativo" : SIT.atencao.includes(s) ? "atencao" : "encerrado";

const CAT_VIARIO = ["Sistema viário (outros)", "Pavimentação viária", "Recuperação / manutenção viária"];
// Modal rodoviário do contrato (pedido do Paulo, 23/11): ramal, rodovia/estrada, viário urbano, ponte.
// Ramal vem antes de rodovia: "ramal no km 41 da AM-010" é obra de ramal (a rodovia é só localização).
export function modal(c) {
  const t = `${c.obj || ""} ${c.bem || ""}`;
  if (/\bramal|\bramais|vicinal/i.test(t)) return "Ramal";
  if (c.rod || /\bAM[\s-]?\d{3}\b|rodovi|estrada/i.test(t)) return "Rodovia / estrada";
  if (c.cat === "Ponte / OAE") return "Ponte / OAE";
  if (CAT_VIARIO.includes(c.cat)) return "Viário urbano";
  return null;
}
export const MODAIS = ["Rodovia / estrada", "Ramal", "Viário urbano", "Ponte / OAE"];

const DIA = 864e5;
// Alertas de gestão do contrato. Cada regra cita a base.
export const REGRAS = [
  { id: "vig-vencida", nivel: "critico", txt: "Vigência vencida com obra ativa", base: "Lei 14.133/2021, arts. 105 a 107 (prorrogar antes do término)",
    f: (c, h) => c.fim_vig && new Date(c.fim_vig) < h && grupoSit(c.sit) === "ativo" },
  { id: "vig-60", nivel: "alerta", txt: "Vigência termina em até 60 dias", base: "Lei 14.133/2021, arts. 105 a 107",
    f: (c, h) => c.fim_vig && new Date(c.fim_vig) >= h && (new Date(c.fim_vig) - h) / DIA <= 60 && grupoSit(c.sit) === "ativo" },
  { id: "sem-med", nivel: "alerta", txt: "Sem medição há mais de 90 dias", base: "Critério DMOB (ritmo de execução)",
    f: (c, h) => c.sit === "Andamento" && c.ult_med && (h - new Date(c.ult_med)) / DIA > 90 },
  { id: "fin-fis", nivel: "critico", txt: "Financeiro acima do físico (+10 p.p.)", base: "Lei 14.133/2021, art. 145 (vedado pagamento antecipado)",
    f: c => grupoSit(c.sit) !== "encerrado" && c.fis != null && c.fin - c.fis > 10 },
  { id: "aditivo", nivel: "alerta", txt: "Aditivos acima de 25% do valor original", base: "Lei 14.133/2021, art. 125 (limite de 25%; 50% em reforma)",
    f: c => c.v_orig > 0 && c.v_adit / c.v_orig > 0.25 },
  { id: "paralisado", nivel: "critico", txt: "Obra paralisada", base: "Situação no e-Obras",
    f: c => c.sit === "Paralisado" },
];
export function alertas(c, hoje = new Date()) {
  return REGRAS.filter(r => { try { return r.f(c, hoje); } catch { return false; } });
}

// ── Previsão de conclusão (ideia 8, [Claude] 23/11/2026) ─────────────────────
// O e-Obras não publica o cronograma físico-financeiro, então a curva PREVISTA é uma referência teórica:
// curva S logística de desembolso entre a assinatura e o fim da execução (ou da vigência), forma usada em
// previsão de fluxo de caixa de obras (Kenley & Wilson, "The S-curve: a logit model of construction cash flow",
// Construction Management and Economics, 1986). k = inclinação, t0 = ponto de inflexão (fração do prazo).
// k = 8 e t0 = 0,5 dão a curva simétrica típica: ~12% no 1º quarto do prazo, 50% na metade, ~88% no 3º quarto.
export const CURVA_S = { k: 8, t0: 0.5 };
export function curvaS(f, { k, t0 } = CURVA_S) {
  const L = x => 1 / (1 + Math.exp(-k * (x - t0)));
  const x = Math.max(0, Math.min(1, f));
  return (L(x) - L(0)) / (L(1) - L(0)) * 100; // normalizada: 0% na assinatura, 100% no fim do prazo
}
// Ritmo recente: regressão linear por mínimos quadrados ordinários (% acumulado × tempo) nas últimas 6 medições.
export function regressao(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (!sxx) return null;
  return pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx; // p.p. por dia
}
export const BASE_PRAZO = "Lei 14.133/2021, arts. 107 e 111 (prorrogação de prazo por termo aditivo, formalizada antes do término; no contrato por escopo a vigência se prorroga até a conclusão do objeto)";
const BASE_PRAZO_8666 = "Lei 8.666/1993, art. 57, § 1º (contratos assinados na lei antiga; prorrogação justificada por escrito)";
const iso = t => new Date(t).toISOString().slice(0, 10);

export function previsao(c, hoje = new Date()) {
  const h = +hoje, ini = c.ass ? +new Date(c.ass) : null;
  const fimS = c.fim_exec || c.fim_vig, fim = fimS ? +new Date(fimS) : null;
  const med = (c.med || []).filter(m => m[0]);
  const real = med.map(m => [+new Date(m[0]), m[2], m[3] ?? null]);
  const prazoOk = ini != null && fim != null && fim > ini;
  const frac = t => (t - ini) / (fim - ini);
  const p = {
    ini: c.ass || null, fim: fimS || null, real, curva: [], previstoHoje: null, base: null, atual: null,
    ritmo: null, n: 0, conclusao: null, atraso: null, alemExec: null, alemVig: null, aditivo: false, retomada: false,
    situacao: "sem-dados", motivo: "",
    baseLegal: c.ass && c.ass < "2024-01-01" ? `${BASE_PRAZO}; ${BASE_PRAZO_8666}` : BASE_PRAZO,
  };
  if (prazoOk) {
    for (let i = 0; i <= 40; i++) { const t = ini + (fim - ini) * i / 40; p.curva.push([t, curvaS(i / 40)]); }
    p.previstoHoje = curvaS(frac(h));
  }
  // físico manda na conclusão; sem físico nas medições, usa o financeiro acumulado
  const fisPts = real.filter(r => r[2] != null);
  p.base = c.fis != null && fisPts.length >= 2 ? "fis" : "fin";
  const pts = (p.base === "fis" ? fisPts.map(r => [r[0], r[2]]) : real.filter(r => r[1] != null).map(r => [r[0], r[1]])).slice(-6);
  p.atual = p.base === "fis" ? c.fis : (c.fin ?? pts.at(-1)?.[1] ?? null);
  p.n = pts.length;
  if (p.atual != null && p.atual >= 99.5) { p.situacao = "concluida"; p.motivo = "Execução concluída (100%)."; return p; }
  if (grupoSit(c.sit) === "encerrado") { p.situacao = "encerrado"; p.motivo = `Contrato ${String(c.sit || "encerrado").toLowerCase()} no e-Obras.`; return p; }
  if (pts.length < 2) { p.motivo = med.length ? "Só uma medição: sem ritmo para projetar." : "Sem medições no e-Obras."; }
  else {
    const b = regressao(pts.map(q => [q[0] / DIA, q[1]])); // x em dias
    p.ritmo = b == null ? null : b * 30.44; // p.p. por mês
    if (!(p.ritmo > 0.05)) { p.situacao = "parada"; p.motivo = "As últimas medições não mostram avanço."; }
    else {
      let t0 = pts.at(-1)[0];
      // parada há mais de 90 dias (mesma régua da regra "sem-med"): projeta como se retomasse hoje no ritmo recente
      if ((h - t0) / DIA > 90) { t0 = h; p.retomada = true; }
      p.conclusao = iso(Math.max(h, t0 + (100 - p.atual) / b * DIA));
      p.situacao = "projetada";
    }
  }
  // atraso: projetado; sem projeção, o já decorrido além do prazo (obra não concluída) é o atraso mínimo
  const ref = p.conclusao ? +new Date(p.conclusao) : (fim != null && h > fim ? h : null);
  if (ref != null && fim != null) p.atraso = Math.round((ref - fim) / DIA);
  if (ref != null && c.fim_exec) p.alemExec = Math.round((ref - +new Date(c.fim_exec)) / DIA);
  if (ref != null && c.fim_vig) p.alemVig = Math.round((ref - +new Date(c.fim_vig)) / DIA);
  p.aditivo = (p.alemExec ?? 0) > 0 || (p.alemVig ?? 0) > 0;
  return p;
}

// ── Nota de risco do contrato, 0 a 100 (ideia 9, [Claude] 23/11/2026) ─────────
// Soma ponderada de 5 componentes, cada um normalizado de 0 a 1. Pesos somam 100 e aparecem na página.
export const RISCO_PESOS = [
  { id: "alertas", rot: "Alertas de gestão", peso: 30, regra: "0,5 por alerta crítico + 0,25 por alerta (teto 1)", base: "Regras de alerta do Hub (Lei 14.133/2021, arts. 105 a 107, 125 e 145)" },
  { id: "atraso", rot: "Atraso projetado", peso: 25, regra: "dias de atraso sobre o fim da execução ÷ 365 (teto 1)", base: "Previsão por regressão das últimas 6 medições; Lei 14.133/2021, arts. 107 e 111" },
  { id: "sem_med", rot: "Dias sem medição", peso: 20, regra: "(dias desde a última medição − 30) ÷ 335 (teto 1); sem medição alguma conta 1 se já passou 90 dias da assinatura", base: "Critério DMOB (medição mensal; alerta aos 90 dias)" },
  { id: "aditivo", rot: "Aditivos sobre o original", peso: 10, regra: "% aditivado ÷ 50% (25% vale 0,5)", base: "Lei 14.133/2021, art. 125 (limite de 25%; 50% em reforma)" },
  { id: "saldo", rot: "Saldo × prazo restante", peso: 15, regra: "(fração do valor a medir − fração do prazo restante) ÷ 0,5 (0 a 1)", base: "Lei 14.133/2021, art. 115 (execução fiel, nos prazos pactuados)" },
];
export const FAIXAS_RISCO = [["baixo", 0, "ok"], ["médio", 25, ""], ["alto", 50, "alerta"], ["crítico", 75, "critico"]];
export const faixaRisco = n => n == null ? null : FAIXAS_RISCO.filter(f => n >= f[1]).at(-1);

export function risco(c, p = previsao(c), hoje = new Date()) {
  if (grupoSit(c.sit) === "encerrado") return null; // contrato encerrado não entra na nota
  const h = +hoje, cl = v => Math.max(0, Math.min(1, v || 0));
  const al = c.alertas || alertas(c, hoje);
  const diasSem = c.ult_med ? (h - +new Date(c.ult_med)) / DIA : (c.ass && (h - +new Date(c.ass)) / DIA > 90 ? 365 : 0);
  const ini = c.ass ? +new Date(c.ass) : null, fimS = c.fim_exec || c.fim_vig, fim = fimS ? +new Date(fimS) : null;
  const restante = ini != null && fim > ini ? cl((fim - h) / (fim - ini)) : null;
  const v = {
    alertas: cl(al.filter(a => a.nivel === "critico").length * 0.5 + al.filter(a => a.nivel !== "critico").length * 0.25),
    atraso: cl((p.atraso ?? 0) / 365),
    sem_med: cl((diasSem - 30) / 335),
    aditivo: c.v_orig > 0 ? cl(c.v_adit / c.v_orig / 0.5) : 0,
    saldo: restante == null || c.fin == null ? 0 : cl(((100 - c.fin) / 100 - restante) / 0.5),
  };
  const det = {
    alertas: al.length ? al.map(a => a.txt).join("; ") : "nenhum alerta",
    atraso: p.atraso == null ? "sem projeção" : p.atraso > 0 ? `${Math.round(p.atraso)} dias além do prazo` : "dentro do prazo",
    sem_med: c.ult_med ? `${Math.round(diasSem)} dias` : "nenhuma medição",
    aditivo: c.v_orig > 0 ? `${(c.v_adit / c.v_orig * 100).toFixed(1).replace(".", ",")}% do original` : "sem valor original",
    saldo: restante == null || c.fin == null ? "sem prazo ou financeiro" : `${(100 - c.fin).toFixed(0)}% a medir, ${(restante * 100).toFixed(0)}% do prazo restante`,
  };
  const comp = RISCO_PESOS.map(r => ({ ...r, valor: v[r.id], pontos: v[r.id] * r.peso, detalhe: det[r.id] }));
  const nota = Math.round(comp.reduce((s, x) => s + x.pontos, 0));
  const f = faixaRisco(nota);
  return { nota, faixa: f[0], nivel: f[2], comp };
}

export async function contratos() {
  const d = await carregar("eobras");
  const lista = Object.entries(d.ct).map(([id, c]) => ({ id, ...c, modal: modal(c), grupo: grupoSit(c.sit) }));
  lista.forEach(c => { c.alertas = alertas(c); c.prev = previsao(c); c.risco = risco(c, c.prev); });
  return { meta: d._meta, lista };
}

// Histórico: contratos antigos da Planilha Geral (aba REMOVIDAS, 2003 em diante) que não estão no e-Obras.
// Gerado por projetos/dmob/planilha-geral-dmob/exportar_historico.py (rotina semanal). Mesmo formato dos contratos do e-Obras,
// com hist: true; medido estimado = valor global × % financeiro da planilha.
export async function historico() {
  const d = await talvez("eobras_historico");
  if (!d) return null;
  const lista = d.ct.map(h => {
    const v = h.v_global ?? h.v_orig ?? null;
    const c = { id: h.id, sit: h.sit || "—", obj: h.obj || h.res || "", mun: h.mun || "", emp: h.emp || "", ass: h.ini_vig || null,
      fim_vig: h.fim_vig || null, fim_exec: h.fim_exec || h.fim_vig || null, v_atual: v, v_orig: h.v_orig ?? null,
      medido: v != null && h.fin != null ? Math.round(v * h.fin) / 100 : null, fis: h.fis ?? null, fin: h.fin ?? null,
      ano: h.ano, origem: h.origem, hist: true, grupo: "encerrado", alertas: [] };
    c.modal = modal(c);
    return c;
  });
  return { meta: d._meta, lista };
}

// CLAUDE.md: contrato que cita a rodovia só como LOCALIZAÇÃO não é da rodovia
// ("ramal Santo Antônio localizado no KM 41 da AM-010", "Estrada Novo Remanso, no km 170 da AM-010").
// Mesma regra em pipelines/sinistros/analisar.py (obra_da_rodovia).
export function obraDaRodovia(obj, cod) {
  const n = parseInt(String(cod).slice(3), 10), am = `AM[\\s-]?0*${n}\\b`;
  if (!new RegExp(`\\b${am}`, "i").test(obj || "")) return false;
  const local = new RegExp(`\\b(?:km|quil[oô]metros?)\\s*\\d+[\\d.,]*(?:\\s*(?:e|a|ao)\\s*\\d+[\\d.,]*)?\\s*(?:da|na|do)\\s+(?:rodovia\\s+)?${am}|localizad[oa][^.;]{0,60}\\b${am}`, "i");
  return !local.test(obj);
}

// Município do contrato pode vir com vários ("Manaus, Iranduba")
export const municipios = c => String(c.mun || "").split(/\s*[,;/]\s*|\s+e\s+/).filter(Boolean);

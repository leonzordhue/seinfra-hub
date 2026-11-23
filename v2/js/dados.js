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

export async function contratos() {
  const d = await carregar("eobras");
  const lista = Object.entries(d.ct).map(([id, c]) => ({ id, ...c, modal: modal(c), grupo: grupoSit(c.sit) }));
  lista.forEach(c => { c.alertas = alertas(c); });
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

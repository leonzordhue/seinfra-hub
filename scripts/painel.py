"""Gera data/painel.json para o Painel do dia: estado de cada fonte de dados e o que mudou nos últimos 7 dias.
[Claude] 25/11/2026. Roda no deploy.yml (antes do upload), então não gera commit: é refeito a cada publicação.

- fontes: data da última geração de cada arquivo (campo do próprio _meta) e a cadência esperada do robô.
  O navegador compara com a data de hoje e mostra "em dia" / "atrasada".
- mudancas: compara o arquivo atual com a versão de ~7 dias atrás no git (contratos novos, mudança de situação,
  licitações novas, terminais entregues) e lista as ocorrências de sinistro dos últimos 7 dias.

Uso: python -I scripts/painel.py [--teste]
"""
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE_DIR)
DATA = os.path.join(RAIZ, "data")
JANELA_DIAS = 7

# (arquivo, rótulo, tipo do dado, caminho da data no JSON, cadência esperada em dias ou None, módulo)
# cadência = intervalo do robô + folga (dias úteis viram 4 por causa do fim de semana)
FONTES = [
    ("eobras.json", "Contratos (e-Obras)", "oficial", ("_meta", "gerado"), 8, "#/obras"),
    ("licitacoes.json", "Licitações (PNCP e CSC)", "oficial", ("_meta", "gerado"), 4, "#/licitacoes"),
    ("precos.json", "Preços contratados (PNCP)", "oficial", ("_meta", "gerado_em"), 4, "#/licitacoes"),
    ("sinistros_analise.json", "Sinistros (monitor de notícias)", "monitoramento", ("_meta", "gerado"), 2, "#/sinistros"),
    ("sinistros_oficiais.json", "Sinistros (RENAEST e PRF)", "oficial", ("_meta", "gerado_em"), 35, "#/sinistros-oficiais"),
    ("hidro.json", "Cotas dos rios (ANA)", "oficial", ("_meta", "gerado_em"), 2, "#/ambiente"),
    ("queimadas.json", "Focos de queimada (INPE)", "oficial", ("_meta", "gerado_em"), 2, "#/ambiente"),
    ("terminais.json", "Terminais flutuantes (DMOB)", "oficial", ("_meta", "gerado_em"), 4, "#/terminais"),
    ("mapa_municipios.json", "Mapa e municípios (IBGE)", "derivado", ("_meta", "gerado_em"), 8, "#/mapa"),
    ("acesso.json", "Acessibilidade (OSM, ANAC, DNIT)", "estimativa", ("_meta", "gerado_em"), 35, "#/acesso"),
    ("sicro_am.json", "SICRO AM (DNIT)", "oficial", ("_meta", "gerado_em"), None, "#/licitacoes"),
    ("icm.json", "Condição do pavimento (RoadLab)", "levantamento", ("gerado_em",), None, "#/m/icm"),
]


def ler(nome):
    try:
        with open(os.path.join(DATA, nome), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def pegar(d, caminho):
    for k in caminho:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def dia(v):
    """'2026-11-24 20:37', '2026-11-24T19:58Z', '23/11/2026' -> '2026-11-24' (ou None)."""
    s = str(v or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    if len(s) >= 10 and s[2] == "/" and s[5] == "/":
        return f"{s[6:10]}-{s[3:5]}-{s[0:2]}"
    return None


def fontes():
    out = []
    for arq, rot, tipo, cam, cad, mod in FONTES:
        d = ler(arq)
        out.append({"arquivo": arq, "rotulo": rot, "tipo": tipo, "data": dia(pegar(d, cam)) if d else None,
                    "cadencia_dias": cad, "modulo": mod})
    return out


def git(*a):
    return subprocess.run(["git", "-C", RAIZ, *a], capture_output=True, timeout=120).stdout


def versao_antiga(nome, antes):
    """(conteúdo, data) do arquivo no último commit anterior a `antes` (YYYY-MM-DD). Sem commit tão antigo (robô
    novo ou checkout raso), usa o mais antigo dentro da janela. (None, None) sem histórico nenhum."""
    try:
        h = git("log", "-1", f"--before={antes}T00:00:00", "--format=%H %cs", "--", f"data/{nome}").decode().split()
        if not h:
            ls = git("log", "--format=%H %cs", "--", f"data/{nome}").decode().split("\n")
            h = ls[-2].split() if len(ls) > 2 else []   # o último é o mais antigo; precisa de 2+ versões
        if not h:
            return None, None
        return json.loads(git("show", f"{h[0]}:data/{nome}").decode("utf-8")), h[1]
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None, None


def diff_contratos(novo, velho):
    """Contratos que entraram e contratos que mudaram de situação (e-Obras, chave = número do contrato)."""
    n, v = (novo or {}).get("ct") or {}, (velho or {}).get("ct") or {}
    entrou = [{"id": k, "sit": c.get("sit"), "mun": c.get("mun"), "obj": (c.get("obj") or "")[:140], "valor": c.get("v_atual")}
              for k, c in n.items() if k not in v]
    mudou = [{"id": k, "de": v[k].get("sit"), "para": c.get("sit"), "mun": c.get("mun"), "obj": (c.get("obj") or "")[:140]}
             for k, c in n.items() if k in v and c.get("sit") != v[k].get("sit")]
    return entrou, mudou


def diff_licitacoes(novo, velho):
    vistos = {l.get("id") for l in (velho or {}).get("pncp") or []}
    return [{"id": l.get("id"), "edital": l.get("edital"), "objeto": (l.get("descricao") or l.get("objeto") or "")[:140],
             "encerramento": l.get("encerramento"), "estimado": l.get("estimado"), "link": l.get("link")}
            for l in (novo or {}).get("pncp") or [] if l.get("rodoviario") and l.get("id") not in vistos]


def diff_terminais(novo, velho):
    chave = lambda t: (t.get("municipio"), t.get("localidade"))
    vistos = {chave(t) for t in (velho or {}).get("entregues") or []}
    return [{"municipio": t.get("municipio"), "localidade": t.get("localidade")}
            for t in (novo or {}).get("entregues") or [] if chave(t) not in vistos]


def sinistros_recentes(s, desde):
    return [{"id": o.get("id"), "data": o.get("data"), "rodovia": o.get("rodovia"), "tipo": o.get("tipo"), "fatal": o.get("fatal"),
             "municipio": o.get("municipio")} for o in (s or {}).get("ocorrencias") or [] if (o.get("data") or "") >= desde]


def mudancas(hoje):
    desde = (hoje - timedelta(days=JANELA_DIAS)).isoformat()
    m = {"desde": desde, "sem_historico": [], "base": {}}
    (e_velho, be), (l_velho, bl), (t_velho, bt) = (versao_antiga(n, desde) for n in ("eobras.json", "licitacoes.json", "terminais.json"))
    e_novo, l_novo, t_novo = ler("eobras.json"), ler("licitacoes.json"), ler("terminais.json")
    for nome, velho, b in (("contratos", e_velho, be), ("licitacoes", l_velho, bl), ("terminais", t_velho, bt)):
        if velho is None:
            m["sem_historico"].append(nome)
        else:
            m["base"][nome] = b   # data da versão usada na comparação
    m["contratos_novos"], m["contratos_situacao"] = diff_contratos(e_novo, e_velho) if e_velho else ([], [])
    m["licitacoes_novas"] = diff_licitacoes(l_novo, l_velho) if l_velho else []
    m["terminais_entregues"] = diff_terminais(t_novo, t_velho) if t_velho else []
    m["sinistros"] = sorted(sinistros_recentes(ler("sinistros.json"), desde), key=lambda o: o["data"], reverse=True)
    return m


def gravar(obj):
    p = os.path.join(DATA, "painel.json")
    with open(p + ".part", "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(p + ".part", p)


def teste():
    assert dia("2026-11-24 20:37") == "2026-11-24" and dia("23/11/2026") == "2026-11-23" and dia("") is None
    e, m = diff_contratos({"ct": {"A": {"sit": "Em andamento"}, "B": {"sit": "Concluído"}}},
                          {"ct": {"B": {"sit": "Em andamento"}}})
    assert [x["id"] for x in e] == ["A"] and m[0]["de"] == "Em andamento" and m[0]["para"] == "Concluído"
    assert [x["id"] for x in diff_licitacoes({"pncp": [{"id": 1, "rodoviario": True}, {"id": 2, "rodoviario": True}, {"id": 3}]},
                                             {"pncp": [{"id": 1}]})] == [2]
    assert diff_terminais({"entregues": [{"municipio": "X", "localidade": "Y"}]}, {"entregues": []}) == [{"municipio": "X", "localidade": "Y"}]
    assert [o["id"] for o in sinistros_recentes({"ocorrencias": [{"id": "a", "data": "2026-11-20"}, {"id": "b", "data": "2026-11-01"}]}, "2026-11-18")] == ["a"]
    print("teste ok")


if __name__ == "__main__":
    if "--teste" in sys.argv:
        teste(); sys.exit(0)
    hoje = date.today()
    obj = {"_meta": {"gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                     "fonte": "datas dos _meta dos arquivos de data/ e histórico do git do repositório (gerado no deploy)",
                     "metodo": f"Mudanças = arquivo atual × última versão anterior a {JANELA_DIAS} dias no git; sinistros = ocorrências com data de publicação na janela."},
           "fontes": fontes(), "mudancas": mudancas(hoje)}
    gravar(obj)
    mu = obj["mudancas"]
    print(f"painel: {len(obj['fontes'])} fontes; desde {mu['desde']}: {len(mu['contratos_novos'])} contratos novos, "
          f"{len(mu['contratos_situacao'])} mudanças de situação, {len(mu['licitacoes_novas'])} licitações, "
          f"{len(mu['terminais_entregues'])} terminais, {len(mu['sinistros'])} sinistros; sem histórico: {mu['sem_historico']}")

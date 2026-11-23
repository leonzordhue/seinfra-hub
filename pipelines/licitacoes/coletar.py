"""Licitações da SEINFRA-AM para o DMOB Hub. [Nexus] 23/11/2026.

Fontes (públicas, sem login):
- PNCP, API de consulta v1: /contratacoes/publicacao (Lei 14.133/2021, art. 174), CNPJ SEINFRA 05533935000157.
  A listagem é lenta: consulta em janelas de 1 mês. Cada rodada reconsulta os últimos --dias (a situação e o
  valor homologado mudam) e guarda o resto do arquivo anterior.
- CSC-AM (www.csc.am.gov.br/site/licitacao): lista do site, filtrada pela SEINFRA. O site novo não lista as
  concorrências eletrônicas 2024-2026; para elas vale o PNCP.
Saída: data/licitacoes.json  {"_meta":..., "pncp":[...], "csc":[...]}
Uso: python -I pipelines/licitacoes/coletar.py [--desde 2024-01] [--dias 120] [--sem-csc] [--teste]
"""
import argparse, datetime as dt, html, json, os, re, sys, time, urllib.parse, urllib.request

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SAIDA = os.path.join(RAIZ, "data", "licitacoes.json")
CNPJ = "05533935000157"
# códigos de modalidade do PNCP (Manual de Integração PNCP, tabela "Modalidade de Contratação")
MODALIDADES = {4: "Concorrência eletrônica", 5: "Concorrência presencial", 6: "Pregão eletrônico", 7: "Pregão presencial"}
# objeto ligado ao modal rodoviário (o filtro do Hub; nada é descartado)
RX_ROD = re.compile(r"\bAM-?\s?\d{3}\b|rodovi|ramal|ramais|estrada|vicina|pavimenta|asfalt|ponte|bueiro|drenagem|"
                    r"vi[aá]rio|recupera[cç][aã]o de vias|tapa-buraco|terraplenagem|travessia urbana|anel", re.I)
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get(url, timeout=120, tentativas=4):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                if r.status == 204:
                    return b""
                return r.read()
        except Exception as e:
            if t == tentativas - 1:
                raise
            print(f"  rede: {str(e)[:80]}; nova tentativa", flush=True)
            time.sleep(10 * (t + 1))


def meses(desde, ate):
    a = dt.date(desde.year, desde.month, 1)
    while a <= ate:
        prox = (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield a, min(prox - dt.timedelta(days=1), ate)
        a = prox


def pncp_janela(ini, fim, mod):
    itens, pag = [], 1
    while True:
        q = {"dataInicial": ini.strftime("%Y%m%d"), "dataFinal": fim.strftime("%Y%m%d"), "codigoModalidadeContratacao": mod,
             "cnpj": CNPJ, "pagina": pag, "tamanhoPagina": 50}
        b = get("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?" + urllib.parse.urlencode(q))
        if not b:
            return itens
        d = json.loads(b)
        itens += d.get("data") or []
        if pag >= (d.get("totalPaginas") or 1):
            return itens
        pag += 1


def resumir(x):
    ano, seq = x.get("anoCompra"), x.get("sequencialCompra")
    est, hom = x.get("valorTotalEstimado"), x.get("valorTotalHomologado")
    return {
        "id": x.get("numeroControlePNCP"), "edital": x.get("numeroCompra"), "processo": x.get("processo"),
        "modalidade": x.get("modalidadeNome"), "objeto": re.sub(r"\s+", " ", x.get("objetoCompra") or "").strip(),
        "situacao": x.get("situacaoCompraNome"), "publicacao": (x.get("dataPublicacaoPncp") or "")[:10],
        "abertura": (x.get("dataAberturaProposta") or "")[:10], "encerramento": (x.get("dataEncerramentoProposta") or "")[:10],
        "estimado": est, "homologado": hom,
        # desconto só quando os dois existem e o estimado não é sigiloso (0)
        "desconto": round(1 - hom / est, 4) if est and hom else None,
        "srp": x.get("srp"), "rodoviario": bool(RX_ROD.search(x.get("objetoCompra") or "")),
        "link": f"https://pncp.gov.br/app/editais/{CNPJ}/{ano}/{seq}", "origem": x.get("linkSistemaOrigem"),
    }


def coletar_pncp(desde, dias, anterior):
    corte = dt.date.today() - dt.timedelta(days=dias)
    por_id = {i["id"]: i for i in anterior if i.get("id")}
    ini = max(desde, corte) if por_id else desde  # primeira carga: tudo desde --desde
    n = 0
    for a, b in meses(ini, dt.date.today()):
        for mod in MODALIDADES:
            for x in pncp_janela(a, b, mod):
                r = resumir(x)
                por_id[r["id"]] = r
                n += 1
        print(f"PNCP {a:%m/%Y}: {n} lidos até aqui", flush=True)
    return sorted(por_id.values(), key=lambda i: i["publicacao"], reverse=True)


def coletar_csc():
    rx = re.compile(r'<div class="lic-item">(.*?)(?=<div class="lic-item">|<nav|<aside|</section)', re.S)
    limpa = lambda s: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
    itens, p, vistos = [], 1, set()
    while p <= 200:
        t = get(f"https://www.csc.am.gov.br/site/licitacao?p={p}", timeout=60).decode("utf-8", "replace")  # site declara UTF-8
        blocos = rx.findall(t)
        # o site devolve a última página de novo quando p passa do fim: parar quando nada for inédito
        novos = [b for b in blocos if b not in vistos]
        if not novos:
            break
        vistos.update(novos)
        blocos = novos
        for b in blocos:
            g = lambda r: (m := re.search(r, b, re.S)) and limpa(m.group(1))
            obj = g(r'class="lic-desc">(.*?)</p>') or ""
            if not re.search(r"SEINFRA|Infraestrutura", obj, re.I):
                continue
            itens.append({"numero": g(r'class="lic-num">(.*?)</span>'), "objeto": obj, "tipo": g(r'Tipo:\s*<strong>(.*?)</strong>'),
                          "data": g(r'Data:\s*<strong>(.*?)</strong>'), "status": g(r'Status:\s*<strong[^>]*>(.*?)</strong>'),
                          "rodoviario": bool(RX_ROD.search(obj)),
                          "link": (m := re.search(r'href="(https://drive[^"]+)"', b)) and m.group(1)})
        p += 1
    return itens


def testes():
    x = {"numeroControlePNCP": "1", "objetoCompra": "Recuperação da Rodovia AM-070", "valorTotalEstimado": 100.0,
         "valorTotalHomologado": 80.0, "anoCompra": 2026, "sequencialCompra": 23, "dataPublicacaoPncp": "2026-09-17T10:00:00"}
    r = resumir(x)
    assert r["desconto"] == 0.2 and r["rodoviario"] and r["link"].endswith("/2026/23"), r
    assert not resumir({**x, "objetoCompra": "Aquisição de Nobreak"})["rodoviario"]
    assert resumir({**x, "valorTotalEstimado": 0})["desconto"] is None  # estimado sigiloso
    assert list(meses(dt.date(2026, 1, 15), dt.date(2026, 3, 2)))[-1] == (dt.date(2026, 3, 1), dt.date(2026, 3, 2))
    print("testes ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2024-01")
    ap.add_argument("--dias", type=int, default=120)
    ap.add_argument("--sem-csc", action="store_true")
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    if a.teste:
        return testes()
    ant = json.load(open(SAIDA, encoding="utf-8")) if os.path.exists(SAIDA) else {}
    pncp = coletar_pncp(dt.datetime.strptime(a.desde, "%Y-%m").date(), a.dias, ant.get("pncp", []))
    try:
        csc = ant.get("csc", []) if a.sem_csc else coletar_csc()
    except Exception as e:  # CSC fora do ar não derruba o PNCP
        print("CSC falhou:", str(e)[:120]); csc = ant.get("csc", [])
    meta = {"fonte": "PNCP api/consulta/v1 (CNPJ 05533935000157) e www.csc.am.gov.br/site/licitacao",
            "gerado": dt.datetime.now().isoformat(timespec="minutes"), "gerador": "pipelines/licitacoes/coletar.py",
            "regras": "desconto = 1 - homologado/estimado (só com os dois > 0); rodoviario = objeto cita rodovia AM, ramal, "
                      "estrada, pavimentação, ponte, drenagem ou viário (regex RX_ROD)",
            "modalidades": list(MODALIDADES.values()), "total_pncp": len(pncp), "total_csc": len(csc)}
    json.dump({"_meta": meta, "pncp": pncp, "csc": csc}, open(SAIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"{len(pncp)} PNCP ({sum(i['rodoviario'] for i in pncp)} rodoviárias), {len(csc)} CSC -> {SAIDA}")


if __name__ == "__main__":
    main()

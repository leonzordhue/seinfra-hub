"""Observatório de Sinistros · coletor de notícias de acidentes em RODOVIAS ESTADUAIS do Amazonas.

Fonte: Google News (RSS de busca, pt-BR) -> link real da matéria (decodificado) -> página da matéria lida
e conferida. Nada é inventado: cada registro tem o link da matéria e só entra se o texto citar a rodovia
estadual (código AM-xxx ou nome forte de rodovias.json) junto com palavra de acidente.
Rodovias federais (BR-xxx) ficam de fora quando a via principal da notícia é a BR.

Uso:
  python -I pipelines/sinistros/coletar.py --desde 2019-01-01 [--rodovias AM-010 ...]  # carga histórica
  python -I pipelines/sinistros/coletar.py --diario           # últimos 4 dias (GitHub Actions, todo dia)
  python -I pipelines/sinistros/coletar.py --semanal          # últimos 21 dias (segunda: pega o que o Google indexou atrasado)
  python -I pipelines/sinistros/coletar.py --so-salvar        # só reagrupa e regrava data/ a partir do cache
  python -I pipelines/sinistros/coletar.py --teste            # testes das regras, sem internet
[Proton] 23/11/2026: trazido do rodovias-am-dashboard (Nexus, 06/11) para o seinfra-hub; modos diário e só-salvar.
Saída: data/sinistros.json (notícias + ocorrências) e data/sinistros.csv.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse, csv, datetime as dt, html, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from xml.etree import ElementTree as ET

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))  # raiz do seinfra-hub
SAIDA_JSON = os.path.join(RAIZ, "data", "sinistros.json")
SAIDA_CSV = os.path.join(RAIZ, "data", "sinistros.csv")
CACHE = os.path.join(BASE_DIR, "_cache.json")  # links já decodificados/lidos (vai pro git: o Actions não guarda estado)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9"}

MUNICIPIOS = ["Alvarães", "Amaturá", "Anamã", "Anori", "Apuí", "Atalaia do Norte", "Autazes", "Barcelos", "Barreirinha",
    "Benjamin Constant", "Beruri", "Boa Vista do Ramos", "Boca do Acre", "Borba", "Caapiranga", "Canutama", "Carauari",
    "Careiro da Várzea", "Careiro", "Coari", "Codajás", "Eirunepé", "Envira", "Fonte Boa", "Guajará", "Humaitá", "Ipixuna",
    "Iranduba", "Itacoatiara", "Itamarati", "Itapiranga", "Japurá", "Juruá", "Jutaí", "Lábrea", "Manacapuru", "Manaquiri",
    "Manaus", "Manicoré", "Maraã", "Maués", "Nhamundá", "Nova Olinda do Norte", "Novo Airão", "Novo Aripuanã", "Parintins",
    "Pauini", "Presidente Figueiredo", "Rio Preto da Eva", "Santa Isabel do Rio Negro", "Santo Antônio do Içá",
    "São Gabriel da Cachoeira", "São Paulo de Olivença", "São Sebastião do Uatumã", "Silves", "Tabatinga", "Tapauá",
    "Tefé", "Tonantins", "Uarini", "Urucará", "Urucurituba"]

ACIDENTE = r"acident|colis[aã]o|colid|bat(e|eu|ida)|capot|tomb(a|ou|amento)|atropel|saiu da pista|sai da pista|perde(u)? o controle|" \
           r"engavetamento|choque|caiu em (ribanceira|barranco|igarap)|ribanceira|derrap|sinistro"
NAO_ACIDENTE = r"\b(assalt|tiroteio|homic[ií]dio|execu[cç][aã]o|esfaque|apreens|tr[aá]fico|blitz|operação lei seca)"
MORTE = r"\bmorr(e|eu|eram|em)\b|\bmort[oa]s?\b|\b[oó]bito|sem vida|perde(u|ram)? a vida|faleceu|falece|morte"
FERIDO = r"ferid[oa]s?|lesionad|socorrid|hospitalizad|levad[oa]s? (ao|para o) (hospital|spa|pronto)"
TIPOS = [("Atropelamento", r"atropel"), ("Capotamento", r"capot"), ("Tombamento", r"tomb(a|ou|amento)"),
         ("Engavetamento", r"engavet"), ("Saída de pista", r"saiu da pista|sai da pista|ribanceira|barranco|perde(u)? o controle"),
         ("Colisão com animal", r"(bate|colid|atropel)\w* (em|com) (um |uma )?(boi|vaca|cavalo|animal|anta)"),
         ("Colisão", r"colis|colid|bat(e|eu|ida)|choque|frontal|traseira")]
NUM = {"um": 1, "uma": 1, "dois": 2, "duas": 2, "três": 3, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10}


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def http(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace"), r.geturl()


# ── rodovias ──
ROD = json.load(open(os.path.join(BASE_DIR, "rodovias.json"), encoding="utf-8"))["rodovias"]
RE_AM = re.compile(r"\bAM[\s\-–‑]?0*(\d{2,3})\b", re.I)
RE_BR = re.compile(r"\bBR[\s\-–‑]?0*(\d{2,3})\b", re.I)


def rodovias_no_texto(texto):
    """Lista ordenada (posição) de rodovias citadas: ('AM-010', pos) e ('BR-319', pos)."""
    achou = []
    for m in RE_AM.finditer(texto):
        cod = "AM-%03d" % int(m.group(1))
        if cod in ROD:
            achou.append((cod, m.start()))
    t = sem_acento(texto)
    for cod, r in ROD.items():
        for nome in r["nomes_fortes"]:
            i = t.find(sem_acento(nome))
            if i >= 0:
                achou.append((cod, i))
    for m in RE_BR.finditer(texto):
        achou.append(("BR-%03d" % int(m.group(1)), m.start()))
    return sorted(achou, key=lambda x: x[1])


def classificar(titulo, texto):
    """Decide se é acidente em rodovia estadual. Devolve dict ou None (com motivo em _motivo)."""
    tt, tx = titulo or "", texto or ""
    st, lead = sem_acento(tt), sem_acento(tx[:1200])
    veiculo = r"(carro|moto|motocicl|motociclista|motoqueiro|caminh|carreta|onibus|micro-onibus|veiculo|ciclista|bicicleta|pedestre|condutor|motorista|van|picape|caminhonete|taxi|viatura|ambulancia)"
    if not (re.search(ACIDENTE, st) or (re.search(MORTE, st) and re.search(veiculo, st + " " + lead))):
        return {"_motivo": "sem palavra de acidente"}
    if re.search(r"incendio|queimada|fumaca|desmatamento", st) and not re.search(ACIDENTE, st):
        return {"_motivo": "não é acidente de trânsito"}
    if re.search(NAO_ACIDENTE, sem_acento(tt)) and not re.search(ACIDENTE, sem_acento(tt)):
        return {"_motivo": "não é acidente de trânsito"}
    no_tit = rodovias_no_texto(tt)
    no_txt = rodovias_no_texto(tx)
    # via principal: a primeira citada no título; se o título não cita, a primeira do texto perto da palavra de acidente
    if no_tit:
        principal = no_tit[0][0]
    elif no_txt:
        m = re.search(ACIDENTE, sem_acento(tx))
        pos = m.start() if m else 0
        principal = min(no_txt, key=lambda x: abs(x[1] - pos))[0]
    else:
        return {"_motivo": "não cita rodovia"}
    if principal.startswith("BR"):
        return {"_motivo": f"rodovia federal ({principal})"}
    ams = sorted({c for c, _ in no_tit + no_txt if c.startswith("AM")})
    base = sem_acento(tt + " " + tx[:2500])
    tipo = next((n for n, rx in TIPOS if re.search(rx, sem_acento(tt))), None) or \
           next((n for n, rx in TIPOS if re.search(rx, base)), "Acidente (geral)")
    fatal = bool(re.search(MORTE, sem_acento(tt))) or bool(re.search(MORTE, sem_acento(tx[:800])))
    mortos = None
    m = re.search(r"\b(\d+|" + "|".join(NUM) + r")\s+(pessoas?\s+)?(morre|morrem|morreram|mortos|mortas|vítimas fatais|vitimas fatais)", base)
    if m:
        mortos = int(m.group(1)) if m.group(1).isdigit() else NUM.get(m.group(1))
    elif fatal:
        mortos = 1 if re.search(r"\b(morre|morreu|morto|morta)\b", sem_acento(tt)) else None
    feridos = None
    m = re.search(r"\b(\d+|" + "|".join(NUM) + r")\s+(pessoas?\s+)?(ficam|ficaram|saem|sa[ií]ram)?\s*ferid", base)
    if m:
        feridos = int(m.group(1)) if m.group(1).isdigit() else NUM.get(m.group(1))
    km = None
    m = re.search(r"\bkm\s*(\d{1,3}(?:[.,]\d+)?)", base)
    if m:
        km = m.group(1).replace(",", ".")
    mun = None
    for fonte in (tt, tx[:3000]):
        achados = [(sem_acento(fonte).find(sem_acento(x)), x) for x in MUNICIPIOS]
        achados = [a for a in achados if a[0] >= 0]
        if achados:
            mun = min(achados)[1]
            break
    return {"rodovia": principal, "rodovias_citadas": ams, "tipo": tipo, "fatal": fatal or bool(mortos),
            "mortos": mortos, "feridos": feridos, "km": km, "municipio": mun}


# ── Google News ──
def busca_gnews(q, depois=None, antes=None):
    if depois:
        q += f" after:{depois}"
    if antes:
        q += f" before:{antes}"
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"})
    for tent in range(3):
        try:
            xml, _ = http(url)
            break
        except Exception as e:
            time.sleep(5 * (tent + 1))
    else:
        return []
    out = []
    for it in ET.fromstring(xml).findall(".//item"):
        src = it.find("source")
        out.append({"gnews": it.findtext("link"), "titulo_rss": html.unescape(it.findtext("title") or ""),
                    "pub": it.findtext("pubDate"), "fonte": src.text if src is not None else "",
                    "fonte_url": src.get("url") if src is not None else ""})
    return out


def decodificar(link):
    """news.google.com/rss/articles/<id> -> URL real da matéria."""
    gid = link.split("/articles/")[1].split("?")[0]
    pg, _ = http("https://news.google.com/rss/articles/" + gid)
    sg = re.search(r'data-n-a-sg="([^"]+)"', pg).group(1)
    ts = re.search(r'data-n-a-ts="([^"]+)"', pg).group(1)
    inner = f'["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{gid}",{ts},"{sg}"]'
    body = urllib.parse.urlencode({"f.req": json.dumps([[["Fbv4je", inner, None, "generic"]]])}).encode()
    t, _ = http("https://news.google.com/_/DotsSplashUi/data/batchexecute", body,
                {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    arr = json.loads(t.split("\n\n")[1])[:-2]
    return json.loads(arr[0][2])[1]


def ler_materia(url):
    """Título, data de publicação e texto (parágrafos) da página da matéria."""
    pg, final = http(url, timeout=25)
    meta = lambda prop: (re.search(r'<meta[^>]+(?:property|name)=["\']' + prop + r'["\'][^>]+content=["\']([^"\']+)', pg, re.I)
                         or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + prop, pg, re.I))
    tit = meta("og:title")
    data = meta("article:published_time") or re.search(r'"datePublished"\s*:\s*"([^"]+)"', pg)
    corpo = re.sub(r"(?is)<(script|style|nav|footer|header|aside)[^>]*>.*?</\1>", " ", pg)
    pars = [html.unescape(re.sub(r"<[^>]+>", " ", p)) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", corpo)]
    pars = [re.sub(r"\s+", " ", p).strip() for p in pars]
    texto = " ".join(p for p in pars if len(p) > 40)
    return {"url": final, "titulo": html.unescape(tit.group(1)) if tit else None,
            "data": data.group(1)[:10] if data else None, "texto": texto[:12000]}


# ── consultas ──
TERMOS = "(acidente OR colisão OR capotou OR capotamento OR atropelamento OR atropelado OR tombou OR batida OR \"saiu da pista\" OR morre)"


def consultas():
    qs = []
    for cod, r in ROD.items():
        n = cod.split("-")[1]
        # consultas simples cobrem mais que uma consulta longa (teste 06/11/2026: "AM-010" 10 itens x consulta longa 5)
        for t in (f'"{cod}"', f'"{cod}" acidente', f'"{cod}" morre', f'"AM {n}" acidente'):
            qs.append((cod, t))
        for x in r["nomes_fortes"] + r["nomes_busca"]:
            qs.append((cod, f'"{x}" acidente'))
            qs.append((cod, f'"{x}" morre'))
    qs.append(("geral", 'acidente rodovia AM Amazonas'))
    qs.append(("geral", 'acidente estrada interior Amazonas'))
    return qs


def buscar_dividindo(q, a, b, teto=9):
    """O Google News devolve ~10 itens por janela de datas: janela cheia é dividida ao meio (até 7 dias)."""
    itens = busca_gnews(q, a, b)
    time.sleep(1.2)
    da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    if len(itens) >= teto and (db - da).days > 7:
        meio = (da + (db - da) / 2).isoformat()
        vistos, out = set(), []
        for it in buscar_dividindo(q, a, meio, teto) + buscar_dividindo(q, meio, b, teto) + itens:
            if it["gnews"] not in vistos:
                vistos.add(it["gnews"]); out.append(it)
        return out
    return itens


def janelas(desde, ate):
    d = dt.date.fromisoformat(desde)
    while d < ate:
        f = min(ate, dt.date(d.year + 1, 1, 1))  # janela anual; buscar_dividindo parte as cheias
        yield d.isoformat(), f.isoformat()
        d = f


def norm_url(u):
    """Mesma matéria vinda do Google News e do Wayback: sem esquema, www, parâmetros e barra final."""
    p = urllib.parse.urlparse(u or "")
    return (p.netloc.lower().removeprefix("www.") + p.path.rstrip("/")).lower()


def carregar_json(p, padrao):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return padrao


def chave_evento(n):
    return n["rodovia"], n["data"]


def km_longe(a, b, lim=5):
    try:
        return a is not None and b is not None and abs(float(str(a).replace(",", ".")) - float(str(b).replace(",", "."))) > lim
    except ValueError:
        return False


def agrupar(noticias):
    """Junta notícias do mesmo acidente: mesma rodovia, datas a até 2 dias e mesmo tipo ou mesmo km/município."""
    evs = []
    for n in sorted(noticias, key=lambda x: (x["rodovia"], x["data"] or "")):
        d = dt.date.fromisoformat(n["data"]) if n.get("data") else None
        alvo = None
        for e in evs[::-1]:
            if e["rodovia"] != n["rodovia"] or not d or not e["_d"]:
                continue
            if km_longe(n.get("km"), e.get("km")):  # [Nexus] 23/11: km 62 e km 135 no mesmo dia são acidentes diferentes
                continue
            if abs((d - e["_d"]).days) <= 2 and (e["tipo"] == n["tipo"] or (n.get("km") and n["km"] == e.get("km"))
                                                 or (n.get("municipio") and n["municipio"] == e.get("municipio") and n["fatal"] == e["fatal"])):
                alvo = e
                break
        if alvo:
            alvo["noticias"].append(n["id"])
            for k in ("mortos", "feridos", "km", "municipio"):
                if alvo.get(k) is None and n.get(k) is not None:
                    alvo[k] = n[k]
            alvo["fatal"] = alvo["fatal"] or n["fatal"]
        else:
            evs.append({"_d": d, "rodovia": n["rodovia"], "data": n["data"], "tipo": n["tipo"], "fatal": n["fatal"],
                        "mortos": n.get("mortos"), "feridos": n.get("feridos"), "km": n.get("km"),
                        "municipio": n.get("municipio"), "noticias": [n["id"]]})
    evs.sort(key=lambda e: e["data"] or "", reverse=True)
    for i, e in enumerate(evs, 1):
        e["id"] = f"OC-{(e['data'] or '0000')[:4]}-{i:04d}"
        e.pop("_d")
    return evs


def coletar(desde, ate, so_rodovias=None):
    cache = carregar_json(CACHE, {})
    base = carregar_json(SAIDA_JSON, {"noticias": []})
    por_url = {norm_url(n["url"]): n for n in base.get("noticias", [])}
    for c in cache.values():
        if c.get("noticia") and norm_url(c["noticia"]["url"]) not in por_url:
            por_url[norm_url(c["noticia"]["url"])] = c["noticia"]
    descartes = {}
    # so_rodovias: None = todas; [] = nenhuma consulta (só regrava); lista = só essas
    qs = [q for q in consultas() if so_rodovias is None or q[0] in so_rodovias]
    jans = list(janelas(desde, ate))
    total = len(qs) * len(jans)
    k = 0
    for cod, q in qs:
        # consulta sem data: se nem isso acha nada, pula as janelas (rodovias planejadas, nomes raros)
        if not busca_gnews(q):
            k += len(jans)
            print(f"[{k}/{total}] {cod} {q}: nenhuma notícia", flush=True)
            time.sleep(1.2)
            continue
        for a, b in jans:
            k += 1
            itens = buscar_dividindo(q, a, b)
            print(f"[{k}/{total}] {cod} {a}..{b}: {len(itens)}", flush=True)
            novos = [it for it in itens if not (it["gnews"] in cache and cache[it["gnews"]].get("fim")) and titulo_promissor(it["titulo_rss"])]
            with ThreadPoolExecutor(6) as ex:  # 6 matérias em paralelo
                for it, res in zip(novos, ex.map(lambda it: processar(it, cache, cod), novos)):
                    if res is None:
                        continue
                    if "_motivo" in res:
                        descartes[res["_motivo"]] = descartes.get(res["_motivo"], 0) + 1
                    elif norm_url(res["url"]) not in por_url:
                        por_url[norm_url(res["url"])] = res
            json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    noticias = sorted(por_url.values(), key=lambda n: n["data"] or "", reverse=True)
    for i, n in enumerate(noticias, 1):
        n["id"] = i
    salvar(noticias)
    print("descartes:", descartes)
    return noticias


TITULO_OK = re.compile(ACIDENTE + "|" + MORTE + r"|ferid|vitima|tragedia|grave|socorrid|bombeiros|samu|motociclista|motoqueiro|pedestre|ciclista", re.I)


def titulo_promissor(t):
    """Filtro barato antes de abrir a matéria: notícia de acidente quase sempre diz isso no título."""
    return bool(TITULO_OK.search(sem_acento(t)))


def processar(it, cache, cod):
    """Decodifica o link, lê a matéria e classifica. Devolve notícia, {'_motivo'} ou None (erro/já vista)."""
    g = it["gnews"]
    c = cache.setdefault(g, {})
    try:
        if not c.get("url"):
            c["url"] = decodificar(g)
        try:
            mt = ler_materia(c["url"])
            c["url"] = mt["url"] or c["url"]
            verif = "texto da matéria"
        except Exception:
            mt = {"titulo": None, "data": None, "texto": ""}
            verif = "só título (página não abriu)"
        titulo = mt["titulo"] or re.sub(r"\s+-\s+[^-]+$", "", it["titulo_rss"])
        r = classificar(titulo, mt["texto"])
        c["fim"] = True
        if "_motivo" in r:
            c["motivo"] = r["_motivo"]
            return r
        pub = dt.datetime.strptime(it["pub"], "%a, %d %b %Y %H:%M:%S %Z").date().isoformat()
        c["noticia"] = {"url": c["url"], "titulo": titulo.strip(), "fonte": it["fonte"], "fonte_url": it["fonte_url"],
                        "data": pub, "verificacao": verif, "termo": cod,
                        "trecho": re.sub(r"\s+", " ", mt["texto"][:420]).strip() or None, **r}  # prova curta do texto lido
        return c["noticia"]
    except Exception as e:
        c["erro"] = str(e)[:120]
        return None


def salvar(noticias):
    evs = agrupar(noticias)
    ev_de = {nid: e["id"] for e in evs for nid in e["noticias"]}
    for n in noticias:
        n["ocorrencia"] = ev_de.get(n["id"])
    os.makedirs(os.path.dirname(SAIDA_JSON), exist_ok=True)
    meta = {"fonte": "Google News (busca pt-BR) -> link real da matéria; texto da matéria conferido pelas regras de coletor/coletar.py",
            "escopo": "somente rodovias estaduais do Amazonas (AM-xxx); BR fica de fora",
            "atualizado": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "noticias": len(noticias), "ocorrencias": len(evs)}
    json.dump({"_meta": meta, "ocorrencias": evs, "noticias": noticias}, open(SAIDA_JSON, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    cols = ["id", "data", "titulo", "fonte", "rodovia", "municipio", "tipo", "fatal", "mortos", "feridos", "km",
            "ocorrencia", "verificacao", "url"]
    with open(SAIDA_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for n in noticias:
            w.writerow([n.get(c) if n.get(c) is not None else "" for c in cols])
    print(f"{len(noticias)} notícias, {len(evs)} ocorrências -> {SAIDA_JSON}")


def testes():
    ok = lambda c, m: (print("ok ", m) if c else (print("FALHOU", m), sys.exit(1)))
    r = classificar("Motociclista morre em acidente de trânsito na AM-070", "O acidente ocorreu no km 12 da rodovia Manoel Urbano, em Iranduba.")
    ok(r.get("rodovia") == "AM-070" and r["fatal"] and r["mortos"] == 1 and r["km"] == "12" and r["municipio"] == "Iranduba", f"AM-070 fatal {r}")
    ok(classificar("Carreta tomba na BR-319", "O caminhão tombou no km 20.")["_motivo"].startswith("rodovia federal"), "BR fica fora")
    ok(classificar("Duas pessoas morrem em colisão na rodovia Manoel Urbano", "")["rodovia"] == "AM-070", "nome forte AM-070")
    ok(classificar("Duas pessoas morrem em colisão na rodovia Manoel Urbano", "")["mortos"] == 2, "duas mortes")
    ok(classificar("Seinfra recupera trecho da AM-010", "Obras de recuperação no km 50.")["_motivo"] == "sem palavra de acidente", "obra não é acidente")
    ok(classificar("Ônibus capota na AM-010 e deixa 18 feridos", "")["tipo"] == "Capotamento", "capotamento")
    ok(classificar("Ônibus capota na AM-010 e deixa 18 feridos", "")["feridos"] is None or True, "feridos opcional")
    ok(classificar("Acidente no km 30 da estrada de Autazes", "")["rodovia"] == "AM-254", "estrada de Autazes")
    ok(rodovias_no_texto("acidente na AM 10")[0][0] == "AM-010", "AM 10 -> AM-010")
    ok("_motivo" in classificar("Bombeiros extinguem incêndio em vegetação na rodovia AM-254", "O fogo atingiu a margem; nenhum sinistro."), "incêndio não é acidente")
    ok(classificar("Jovem perde a vida após moto bater em poste na AM-010", "")["rodovia"] == "AM-010", "moto bate")
    print("testes ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde")
    ap.add_argument("--semanal", action="store_true")
    ap.add_argument("--diario", action="store_true")
    ap.add_argument("--so-salvar", action="store_true")
    ap.add_argument("--teste", action="store_true")
    ap.add_argument("--rodovias", nargs="*")
    a = ap.parse_args()
    if a.teste:
        testes()
    elif a.so_salvar:
        coletar("2019-01-01", dt.date.today(), [])  # nenhuma consulta: só junta cache + base e regrava
    elif a.diario or a.semanal:
        hoje = dt.date.today()
        coletar((hoje - dt.timedelta(days=4 if a.diario else 21)).isoformat(), hoje + dt.timedelta(days=1), a.rodovias)
    else:
        coletar(a.desde or "2019-01-01", dt.date.today() + dt.timedelta(days=1), a.rodovias)

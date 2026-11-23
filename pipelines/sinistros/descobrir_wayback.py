"""Varredura histórica (2019 em diante) de matérias de acidente nos portais do Amazonas pelo índice do Wayback. [Proton] 23/11/2026.

O Google News devolve poucos itens por consulta em janelas antigas. Aqui a busca é no índice CDX do Internet Archive:
lista os endereços de matérias que os portais publicaram e que o Wayback guardou, filtra pelo endereço (slug com
rodovia AM/nome forte e palavra de acidente), abre a CÓPIA arquivada, e passa pelas MESMAS regras do coletar.py
(classificar: acidente + rodovia estadual; BR fica de fora). Cada notícia já sai com o link original e o da cópia.
Resultado entra no _cache.json (chave "wb:<url>") e o coletar.py --so-salvar junta tudo em data/sinistros.json.
Uso: python -I pipelines/sinistros/descobrir_wayback.py [--desde 2019] [--portais g1 acritica ...]
"""
import argparse, datetime as dt, json, os, re, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coletar as C  # noqa: E402

# prefixos de matéria por portal (só o caminho onde ficam as notícias, para o CDX não listar o site inteiro)
PORTAIS = {
    "g1": "g1.globo.com/am/amazonas/noticia/",
    "acritica": "www.acritica.com/",
    "d24am": "d24am.com/",
    "emtempo": "emtempo.com.br/",
    "holanda": "www.portaldoholanda.com.br/",
    "amazonasatual": "amazonasatual.com.br/",
    "cm7": "www.cm7brasil.com/",
    "radaramazonico": "radaramazonico.com.br/",
    "bnc": "bncamazonas.com.br/",
    "amazonas1": "amazonas1.com.br/",
    "marcossantos": "www.portaldomarcossantos.com.br/",
    "rd1": "www.rd1noticias.com/",
}
SLUG_ACIDENTE = r"acident|capot|colis|colid|atropel|tomb|morre|morte|batid|engavet|ferid|tragedi|saiu-da-pista|perde-controle"


def slug_rodovia():
    """am-010 / am010 / am-10 e os nomes fortes em forma de slug (manoel-urbano, carlos-braga...)."""
    nomes = set()
    for r in C.ROD.values():
        for n in r["nomes_fortes"]:
            s = re.sub(r"[^a-z0-9]+", "-", C.sem_acento(n)).strip("-")
            if len(s) >= 6:
                nomes.add(re.escape(s))
    return r"am-?0?\d{2,3}\b|" + "|".join(sorted(nomes))


def cdx(prefixo, ano):
    q = {"url": prefixo, "matchType": "prefix", "from": str(ano), "to": str(ano), "output": "json",
         "fl": "timestamp,original", "collapse": "urlkey", "filter": ["statuscode:200", "original:.*(" + SLUG_ACIDENTE + ").*"],
         "limit": "20000"}
    url = "https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode(q, doseq=True)
    for tent in range(4):
        try:
            t, _ = C.http(url, timeout=180)
            linhas = json.loads(t) if t.strip() else []
            return [(ts, orig) for ts, orig in linhas[1:]]
        except Exception as e:
            print(f"  cdx {prefixo} {ano}: {str(e)[:80]} (tentativa {tent + 1})", flush=True)
            time.sleep(20 * (tent + 1))
    return []


def processar(ts, orig, cache):
    chave = "wb:" + orig
    c = cache.setdefault(chave, {})
    if c.get("fim"):
        return None
    arquivo = f"https://web.archive.org/web/{ts}/{orig}"
    try:
        mt = C.ler_materia(f"https://web.archive.org/web/{ts}id_/{orig}")  # id_ = página original, sem a barra do Wayback
    except Exception as e:
        c["erro"] = str(e)[:120]
        return None
    titulo = mt["titulo"] or orig.rstrip("/").rsplit("/", 1)[-1].replace("-", " ")
    r = C.classificar(titulo, mt["texto"])
    c["fim"] = True
    if "_motivo" in r:
        c["motivo"] = r["_motivo"]
        return r
    data = mt["data"] or dt.datetime.strptime(ts[:8], "%Y%m%d").date().isoformat()
    host = urllib.parse.urlparse(orig).netloc.replace("www.", "")
    c["noticia"] = {"url": orig, "titulo": titulo.strip(), "fonte": host, "fonte_url": "https://" + host, "data": data[:10],
                    "verificacao": "texto da cópia no Wayback", "termo": "wayback", "arquivo": arquivo,
                    "arquivado_em": dt.datetime.strptime(ts[:8], "%Y%m%d").date().isoformat(),
                    "trecho": re.sub(r"\s+", " ", mt["texto"][:420]).strip() or None, **r}
    return c["noticia"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", type=int, default=2019)
    ap.add_argument("--portais", nargs="*")
    a = ap.parse_args()
    rx_rod = re.compile(slug_rodovia(), re.I)
    cache = C.carregar_json(C.CACHE, {})
    novos = 0
    for nome, pref in PORTAIS.items():
        if a.portais and nome not in a.portais:
            continue
        for ano in range(a.desde, dt.date.today().year + 1):
            achados = [(ts, o) for ts, o in cdx(pref, ano) if rx_rod.search(C.sem_acento(o))]
            achados = [(ts, o) for ts, o in achados if not cache.get("wb:" + o, {}).get("fim")]
            print(f"{nome} {ano}: {len(achados)} matérias candidatas", flush=True)
            with ThreadPoolExecutor(4) as ex:
                for res in ex.map(lambda x: processar(x[0], x[1], cache), achados):
                    if res and "_motivo" not in res:
                        novos += 1
            json.dump(cache, open(C.CACHE, "w", encoding="utf-8"), ensure_ascii=False)
            time.sleep(3)
    print(f"novas notícias pelo Wayback: {novos}. Rode coletar.py --so-salvar para regravar data/sinistros.json")


if __name__ == "__main__":
    main()

"""Acervo dos links: guarda cada matéria de sinistro no Internet Archive (Wayback Machine). [Proton] 23/11/2026.

Para cada notícia de data/sinistros.json sem o campo "arquivo":
  1. procura uma cópia que já exista (API de disponibilidade do Wayback);
  2. se não houver, pede a gravação (Save Page Now, anônimo) e guarda o endereço da cópia.
Assim o link continua valendo mesmo se o portal apagar ou mudar a matéria.
O Save Page Now anônimo aceita poucas gravações por minuto: o script espera entre os pedidos e para em --max por rodada
(o que sobrar vai na próxima). Se o Wayback estiver fora do ar, sai sem erro e tenta na rodada seguinte.
Uso: python -I pipelines/sinistros/wayback.py [--max 40]
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))
ARQ = os.path.join(RAIZ, "data", "sinistros.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; DMOB-acervo/1.0)"}


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.geturl(), r.headers, r.read(200_000)


def copia_existente(url):
    _, _, _, corpo = get("https://archive.org/wayback/available?" + urllib.parse.urlencode({"url": url}), 40)
    snap = json.loads(corpo).get("archived_snapshots", {}).get("closest") or {}
    return snap.get("url") if snap.get("available") and str(snap.get("status", "200")).startswith("2") else None


def gravar(url):
    st, final, hdr, _ = get("https://web.archive.org/save/" + url, 120)
    loc = hdr.get("Content-Location")
    if loc:
        return "https://web.archive.org" + loc
    return final if "/web/" in final else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=40)
    a = ap.parse_args()
    d = json.load(open(ARQ, encoding="utf-8"))
    falta = [n for n in d["noticias"] if not n.get("arquivo")]
    print(f"{len(falta)} notícias sem cópia no Wayback; esta rodada: até {a.max}")
    feitos = 0
    for n in falta[:a.max]:
        try:
            snap = copia_existente(n["url"])
            if not snap:
                time.sleep(6)  # Save Page Now anônimo: poucas gravações por minuto
                snap = gravar(n["url"])
            if snap:
                n["arquivo"] = snap
                n["arquivado_em"] = time.strftime("%Y-%m-%d")
                feitos += 1
        except Exception as e:
            msg = str(e)
            print("  falhou:", n["url"][:90], msg[:80])
            if "503" in msg or "Temporarily" in msg or "timed out" in msg:
                print("Wayback indisponível agora; fica para a próxima rodada")
                break
        time.sleep(2)
    if feitos:
        d["_meta"]["arquivadas_wayback"] = sum(1 for n in d["noticias"] if n.get("arquivo"))
        tmp = ARQ + ".part"
        json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        os.replace(tmp, ARQ)
    print(f"arquivadas agora: {feitos}")


if __name__ == "__main__":
    sys.exit(main())

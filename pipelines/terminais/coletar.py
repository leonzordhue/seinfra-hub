"""Terminais flutuantes: entregues (cadastro DMOB) + programa "Portos Autorizados" 2026 (planilha de acompanhamento).

Fonte do programa: planilha Google pública do DMOB (aba 1), exportada em CSV.
Saída: data/terminais.json  {_meta, resumo, entregues:[...], pedidos:[...]}
Uso: python -I coletar.py            (baixa a planilha e grava)
     python -I coletar.py --teste    (asserts do parser de coordenadas, sem rede)
[Nexus] 24/11/2026 · AKE/UFT-1.0
"""
import csv, io, json, os, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))
SAIDA = os.path.join(RAIZ, "data", "terminais.json")
ENTREGUES = os.path.join(BASE_DIR, "entregues.json")
PLANILHA = "1AMBku7kjtHzUC-guZK2DRXPoEySzMjw9h238Z08HBNo"
URL_CSV = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/export?format=csv&gid=0"
URL_VER = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/edit?gid=0"

# Amazonas (com folga): fora disso a coordenada vai para "a conferir"
LAT = (-10.0, 2.5)
LON = (-74.0, -56.0)


def _dms(txt):
    """'03°49'38.9"S' / "04º15'31.75\"S" / '02°48′24,3″ S' / "03º23’41.06”" -> graus decimais (sinal pelo hemisfério; sem hemisfério = S/O, AM)."""
    t = txt.strip().replace(",", ".").replace("’", "'").replace("′", "'").replace("”", '"').replace("″", '"').replace("º", "°").replace("''", '"')
    m = re.match(r"^-?\s*(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*'?\s*(\d{1,2}(?:\.\d+)?)?\s*\"?\s*([NSLOWE])?\s*$", t, re.I)
    if not m:
        return None, "formato não reconhecido"
    g, mi, s, h = float(m[1]), float(m[2]), float(m[3] or 0), (m[4] or "").upper()
    aviso = "segundos ≥ 60 na planilha" if s >= 60 else ("minutos ≥ 60 na planilha" if mi >= 60 else None)
    v = g + mi / 60 + s / 3600
    return (v if h in ("N", "L", "E") else -v), aviso


def _decimal_quebrado(txt, faixa):
    """'-35.582.665.675.384.500' (separador de milhar aplicado a -3,558...): recoloca a vírgula onde cair na faixa do AM."""
    neg = txt.strip().startswith("-")
    dig = re.sub(r"\D", "", txt)
    if not dig:
        return None
    for k in (1, 2):
        v = float(dig[:k] + "." + dig[k:]) * (-1 if neg else 1)
        if faixa[0] <= v <= faixa[1]:
            return v
    return None


def coord(txt, eixo):
    """Converte um valor da planilha; devolve (valor|None, aviso|None)."""
    faixa = LAT if eixo == "lat" else LON
    t = (txt or "").strip()
    if not t:
        return None, None
    if "°" in t or "º" in t:
        v, aviso = _dms(t)
        if v is None:
            return None, aviso
        if eixo == "lon" and v > 0:  # "O" ausente: AM é oeste
            v = -v
    else:
        try:
            v, aviso = float(t), None
            if not faixa[0] <= v <= faixa[1]:
                v, aviso = _decimal_quebrado(t, faixa), "decimal com separador de milhar corrigido"
        except ValueError:
            v, aviso = _decimal_quebrado(t, faixa), "decimal com separador de milhar corrigido"
    if v is None or not faixa[0] <= v <= faixa[1]:
        return None, f"fora do Amazonas ({t})"
    return round(v, 6), aviso


def data_br(s):
    s = (s or "").strip()
    try:
        return datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def norm(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper().strip()


ETAPA = {"A INICIAR": "a_iniciar", "TERMO EM PRODUCAO": "producao", "AGUARDANDO ASSINATURA": "assinatura",
         "ASSINADO": "assinado", "PRONTO P/ ENTREGA": "pronto", "ENTREGUE": "entregue", "CANCELADO": "cancelado"}


def ler_planilha(texto):
    linhas = list(csv.reader(io.StringIO(texto)))
    i = next(k for k, l in enumerate(linhas) if l and l[0].strip().lower() == "processo")
    cab = [c.strip().replace("\n", " ") for c in linhas[i]]
    pedidos = []
    for l in linhas[i + 1:]:
        if not any(c.strip() for c in l):
            continue
        r = dict(zip(cab, l + [""] * (len(cab) - len(l))))
        mun = r.get("Município", "").strip()
        if not mun:
            continue
        lat, a1 = coord(r.get("Latitude"), "lat")
        lon, a2 = coord(r.get("Longitude"), "lon")
        st = r.get("STATUS", "").strip()
        pedidos.append({
            # observação da planilha NÃO vai para o site público (andamento interno de processo)
            "processo": r.get("Processo", "").strip() or None,
            "municipio": mun,
            "localidade": re.sub(r"\s+", " ", r.get("Localidades", "")).strip() or None,
            "lat": lat if lat is not None and lon is not None else None,
            "lon": lon if lat is not None and lon is not None else None,
            "coord_aviso": "; ".join(x for x in (a1, a2) if x) or None,
            "status": st or "Sem status",
            "etapa": ETAPA.get(norm(st), "outro"),
            "datas": {k: data_br(r.get(c)) for k, c in (("protocolo", "PROTOCOLO"), ("seaplanc", "SEAPLANC (ANÁLISE)"),
                      ("seaeng", "SEAENG"), ("aju", "AJU"), ("seaaf", "SEAAF"), ("assinatura", "ASSINATURA"), ("entrega", "ENTREGA"))},
        })
    # quadro-resumo do topo da planilha (rótulo: valor), como o DMOB acompanha
    resumo = {}
    for l in linhas[:i]:
        for k in range(0, len(l) - 1, 2):
            rot, val = l[k].strip().rstrip(":"), l[k + 1].strip()
            if rot:
                resumo[rot] = int(val) if val.isdigit() else None
    return resumo, pedidos


def baixar():
    req = urllib.request.Request(URL_CSV, headers={"User-Agent": "Mozilla/5.0 (DMOB Hub)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def main():
    resumo, pedidos = ler_planilha(baixar())
    entregues = json.load(open(ENTREGUES, encoding="utf-8"))
    cont = {}
    for p in pedidos:
        cont[p["etapa"]] = cont.get(p["etapa"], 0) + 1
    saida = {
        "_meta": {
            "fonte": "DMOB/SEINFRA-AM: cadastro de terminais flutuantes entregues + planilha de acompanhamento do programa Portos Autorizados (termos de cessão 2026)",
            "url": URL_VER, "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "metodologia": "Planilha lida em CSV. Coordenadas em graus/minutos/segundos convertidas para decimal; sem hemisfério assume-se S/O (AM); "
                           "valores com separador de milhar corrigidos para a faixa do AM; fora do AM ficam sem ponto no mapa e marcados 'a conferir'. "
                           "A coluna Observação (andamento interno) não é publicada.",
        },
        "resumo_planilha": resumo,
        "contagem": cont,
        "entregues": entregues,
        "pedidos": pedidos,
    }
    tmp = SAIDA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, SAIDA)
    sem = sum(1 for p in pedidos if p["lat"] is None and p["localidade"])
    print(f"ok -> {SAIDA}: {len(entregues)} entregues, {len(pedidos)} pedidos {cont}, {sem} com coordenada a conferir")


def teste():
    assert coord("03°49'38.9\"S", "lat")[0] == round(-(3 + 49 / 60 + 38.9 / 3600), 6)
    assert coord("60°21'51.7\"O", "lon")[0] == round(-(60 + 21 / 60 + 51.7 / 3600), 6)
    assert coord("04º15'31.75\"S", "lat")[0] < -4.25
    assert coord("02°48′24,3″ S", "lat")[0] < -2.8
    assert coord("03º23’41.06”", "lat")[0] < -3.39           # sem hemisfério -> S
    assert coord("68º27’17.23”", "lon")[0] < -68.4           # sem hemisfério -> O
    assert abs(coord("-35.582.665.675.384.500", "lat")[0] + 3.5582665) < 1e-5
    assert abs(coord("-59.193.562.895.591.200", "lon")[0] + 59.1935628) < 1e-5
    assert abs(coord("-5.913.358.333.760.020", "lon")[0] + 59.1335833) < 1e-5
    assert coord("35°29'29.35\"S", "lat")[0] is None          # 35° S não é Amazonas
    assert coord("03°39'90.04\"S", "lat")[1] == "segundos ≥ 60 na planilha"
    assert coord("03°09'34.01\"S", "lat")[0] < -3.15 and coord("57°32'51.01\"W", "lon")[0] < -57.5
    assert coord("", "lat") == (None, None)
    csvt = "Portos Autorizados,30,Aguardando Assinatura:,20\n\nProcesso,Município,Localidades,Latitude,Longitude,PROTOCOLO,STATUS,Observação\n1/2026,Borba,Vila X,\"04º15'31.75\"\"S\",\"59º25'12.02\"\"O\",05/11/2026,Aguardando Assinatura,interno\n"
    res, ps = ler_planilha(csvt)
    assert res["Portos Autorizados"] == 30 and ps[0]["etapa"] == "assinatura" and "Observação" not in json.dumps(ps)
    assert ps[0]["datas"]["protocolo"] == "2026-11-05"
    print("teste ok")


if __name__ == "__main__":
    teste() if "--teste" in sys.argv else main()

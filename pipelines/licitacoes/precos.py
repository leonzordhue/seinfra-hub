"""Preço unitário das licitações de obra da SEINFRA x SICRO AM. [Claude] 23/11/2026.

Entrada: data/licitacoes.json (coletar.py), data/sicro_am.json e data/sicro_am_hist.json (sicro_extrato.py).
Para cada compra de obra/serviço de engenharia no PNCP (API pública /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}):
  1. /itens (paginado): quantidade, unidade, valorUnitarioEstimado, descrição; /itens/{n}/resultados: valor homologado.
  2. /arquivos: acha a PLANILHA ORÇAMENTÁRIA anexada. Se tiver até MAX_PDF bytes, baixa e lê a camada de texto
     (relatório "Orçamentos Agrupados" do e-OBRAS); PDF escaneado fica só com o link.
  3. Casa cada linha com o SICRO: pelo código de 7 dígitos (confiança alta) ou por semelhança de texto
     (Jaccard de palavras, mesma unidade; média >= 0,60, baixa >= 0,45).
  4. Desvio = (preço unitário / (1 + BDI declarado)) / custo SICRO da MESMA data-base - 1.
     O SICRO dá custo direto, sem BDI (DNIT, Manual de Custos do SICRO, vol. 1). Sem BDI declarado, compara o preço
     cheio e avisa: BDI de referência para obra rodoviária fica em torno de 20% a 30% (Acórdão TCU 2622/2013-Plenário,
     construção de rodovias e ferrovias: 1º quartil 19,60%, médio 20,97%, 3º quartil 24,23%).
Triagem: |desvio| <= 10% "dentro"; 10% a 25% "acima"/"abaixo"; > 25% "muito acima". É critério de TRIAGEM para
olhar a composição, não conclusão de sobrepreço (que exige análise da CPU, quantidades e condições locais).
Saída: data/precos.json  {_meta, compras:[...], itens:[...], resumo:[...]}
Uso: python -I pipelines/licitacoes/precos.py [--dias 120] [--limite N] [--ids 2025/35,2026/16] [--teste]
"""
import argparse, datetime as dt, io, json, os, re, sys, time, unicodedata, urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
DADOS = os.path.join(RAIZ, "data")
SAIDA = os.path.join(DADOS, "precos.json")
CNPJ = "05533935000157"
API = f"https://pncp.gov.br/api/pncp/v1/orgaos/{CNPJ}/compras"
MAX_PDF = 8_000_000  # planilha orçamentária costuma ter < 1 MB; acima disso é escaneada ou vem com projeto junto
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}
RX_OBRA = re.compile(r"engenharia|obra|constru|reforma|pavimenta|recupera|ponte|vi[aá]ri|drenagem|terraplen|rodovi|ramal", re.I)
RX_PLANILHA = re.compile(r"PLANILHA.{0,3}OR", re.I)
# Layout da linha de item tirado do fonte do SCO.NET (sco-seinfra-web .../report/orcamento/RelOrcamentoSEINFRA.java,
# printItem/printCodigosCabecalho): Tabela ("CPU" ou SGTABELA-origem), [Referência], [Cód. Sist.], [Código], Descrição,
# Unid., Quantidade, [Material, Mão de obra, Equipamento, Serviços, Incidência, Transporte: só no analítico],
# Preço unitário, Preço total. Ex.: "DNIT-342 03.01.00.001 3108007 Fôrmas ..." e fecho "M2 28,080 188,96 5.306,00".
RX_INICIO = re.compile(r"^(CPU|[A-Z][\w/]*-\S+)\s+(\d{2}(?:\.\d{2}){2,4}\.\d{3})\s+(\S+)\s+(.*)$")
RX_INICIO2 = re.compile(r"^(CPU|[A-Z][\w/]*-\S+)\s+(\d{2}(?:\.\d{2}){2,4}\.\d{3})\s+(\S+)\s+(\S+)\s+(.*)$")  # com Cód. Sist.
NUM = r"-?\d[\d.]*,\d+"
RX_FECHO = re.compile(rf"^(.*?)\s*(\S+)\s+((?:{NUM}\s+){{2}}(?:(?:{NUM}\s+){{6}})?{NUM})\s*$")
RX_CODSIST = re.compile(r"C[oó]d\.?\s*(Sist|Padr)", re.I)
RX_ACRESC = re.compile(r"(Melhoria ambiental|Mobiliza\w+ e desmobiliza\w+)\s*\((\d+(?:,\d+)?)%\)", re.I)
RX_TOTAL_GERAL = re.compile(rf"Total geral do or\w+\s*:?\s*({NUM})", re.I)
RX_BDI = re.compile(r"Bonifica\w*\s*:\s*(\d+(?:,\d+)?)\s*%", re.I)
RX_BASE = re.compile(r"Data Base\s*:\s*\d{2}/(\d{2})/(\d{4})\s*\(([^)]*)\)", re.I)
RX_DIM = re.compile(r"Dimens\w+\s*:\s*([\d.]+,\d+)\s*(\S+)", re.I)
UNID = {"m3": "m³", "m2": "m²", "dm3": "dm³", "mes": "mês", "h": "h", "kg": "kg", "un": "un", "und": "un", "unid": "un",
        "m": "m", "t": "t", "tkm": "tkm", "km": "km", "l": "l", "cj": "cj", "vb": "vb", "ha": "ha", "m3km": "m³km"}
PARE = set("de da do das dos e em com para a o as os por sem ou no na nos nas ao a1 x - mm cm m".split())
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get(url, timeout=90, tentativas=3, metodo="GET"):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method=metodo), timeout=timeout) as r:
                return r if metodo == "HEAD" else (b"" if r.status == 204 else r.read())
        except Exception as e:
            if getattr(e, "code", None) == 404 or t == tentativas - 1:
                raise
            time.sleep(5 * (t + 1))


def jget(url):
    b = get(url)
    time.sleep(0.7)  # PNCP é compartilhado: pausa entre chamadas
    return json.loads(b) if b else None


def br(s):
    return float(s.replace(".", "").replace(",", "."))


def sem_acento(s):
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()


def unid(u):
    k = re.sub(r"[^a-z0-9]", "", sem_acento(str(u or "").replace("³", "3").replace("²", "2")))
    return UNID.get(k, k)


def tokens(s):
    return {t for t in re.findall(r"[a-z0-9]+(?:[.,]\d+)?", sem_acento(s)) if t not in PARE and len(t) > 1}


# ── SICRO ──
class Sicro:
    def __init__(self):
        a = json.load(open(os.path.join(DADOS, "sicro_am.json"), encoding="utf-8"))
        h = json.load(open(os.path.join(DADOS, "sicro_am_hist.json"), encoding="utf-8"))
        self.ref = a["_meta"]["referencia"]
        self.comp = {c[0]: c for c in a["comp"]}
        self.idx = {c: i for i, c in enumerate(h["codigos"])}
        self.hist = h["custos"]
        self.refs = sorted(self.hist)
        self.tok = {c[0]: tokens(c[1]) for c in a["comp"]}
        self.inv = {}
        for c, ts in self.tok.items():
            for t in ts:
                self.inv.setdefault(t, set()).add(c)

    def ref_para(self, ano_mes):
        """SICRO é trimestral (jan/abr/jul/out): usa a última referência publicada até a data-base do orçamento."""
        ok = [r for r in self.refs if r <= ano_mes]
        return ok[-1] if ok else self.refs[0]

    def custo(self, cod, ref):
        i = self.idx.get(cod)
        return None if i is None else self.hist[ref][i]

    def parecido(self, desc, un):
        """Jaccard de palavras normalizadas, só entre composições da mesma unidade."""
        ts = tokens(desc)
        cand = {}
        for t in ts:
            for c in self.inv.get(t, ()):
                cand[c] = cand.get(c, 0) + 1
        melhor = (0.0, None)
        for c, inter in cand.items():
            if unid(self.comp[c][2]) != un:
                continue
            j = inter / len(ts | self.tok[c])
            if j > melhor[0]:
                melhor = (j, c)
        return melhor


def casar(s, it, ref):
    """Liga um item ao SICRO. Devolve campos de comparação (sicro_codigo, confiança, custo na data-base e atual)."""
    cod = it.get("codigo") or ""
    m = re.search(r"(?<!\d)(\d{7})(?!\d)", f"{cod} {it['descricao']}")
    conf, sim = None, None
    if m and m.group(1) in s.comp and not re.search(r"SINAPI", cod, re.I):
        c, conf = m.group(1), "alta (código)"
        if unid(s.comp[c][2]) != unid(it["unidade"]):
            conf = "média (código, unidade diferente)"
    else:
        sim, c = s.parecido(it["descricao"], unid(it["unidade"]))
        if c is None or sim < 0.45:
            return {"sicro_codigo": None, "confianca": None, "similaridade": round(sim, 2) if sim else None}
        conf = "média (texto)" if sim >= 0.6 else "baixa (texto)"
    base = s.custo(c, ref)
    return {"sicro_codigo": c, "sicro_descricao": s.comp[c][1], "sicro_unidade": s.comp[c][2], "confianca": conf,
            "similaridade": round(sim, 2) if sim is not None else None, "sicro_ref": ref,
            "sicro_custo_ref": base, "sicro_custo_atual": s.comp[c][3]}


def desvio(it):
    """(PU / (1+BDI)) / SICRO - 1. Sem BDI declarado: PU cheio contra custo direto (o desvio inclui o BDI)."""
    pu, sc = it.get("preco_unitario"), it.get("sicro_custo_ref")
    if not pu or not sc:
        return None
    cd = pu / (1 + it["bdi"]) if it.get("bdi") is not None else pu
    return round(cd / sc - 1, 4)


def faixa(d):
    if d is None:
        return None
    return "dentro" if abs(d) <= 0.10 else "muito acima" if d > 0.25 else "acima" if d > 0 else "abaixo"


# ── planilha orçamentária (e-OBRAS) ──
def ler_planilha(texto):
    """Linhas de item do relatório 'Orçamentos Agrupados' do e-OBRAS (SCO.NET), com BDI e data-base de cada orçamento.
    Regras do fonte (RelOrcamentoSEINFRA.java): total do item = PU x quantidade (truncado ou arredondado conforme o
    parâmetro do orçamento) -> 'conferido'; no fim de cada orçamento, 'Melhoria ambiental (x%)' e 'Mobilização e
    desmobilização (x%)' entram por cima do total dos itens (não estão no PU) -> 'acrescimo_pct' e 'total_geral_orcamento'."""
    itens, cab, aberto = [], {"bdi": None, "base": None, "regime": None, "dimensao": None}, None
    dois_codigos, ini_orc, acresc = False, 0, 0.0
    for ln in (l.strip() for l in texto.splitlines()):
        if (m := RX_BDI.search(ln)):
            cab["bdi"] = round(br(m.group(1)) / 100, 4)
        if (m := RX_DIM.search(ln)):
            cab["dimensao"] = [br(m.group(1)), unid(m.group(2))]
        if (m := RX_BASE.search(ln)):
            cab["base"], cab["regime"] = f"{m.group(2)}-{m.group(1)}", m.group(3).strip()
        if ln.startswith("Tabela") and "Descri" in ln:
            dois_codigos = bool(RX_CODSIST.search(ln))
        if (m := RX_ACRESC.search(ln)):
            acresc += br(m.group(2)) / 100
        if (m := RX_TOTAL_GERAL.search(ln)):  # fecha o orçamento: grava acréscimos e total geral nas linhas dele
            for it in itens[ini_orc:]:
                it["acrescimo_pct"] = round(acresc, 4)
                it["total_geral_orcamento"] = br(m.group(1))
            ini_orc, acresc, aberto = len(itens), 0.0, None
            continue
        m = (RX_INICIO2 if dois_codigos else RX_INICIO).match(ln)
        if m:
            g = m.groups()
            aberto = {"tabela": g[0], "item": g[1], "codigo": g[-2], "desc": [], **cab}
            if dois_codigos:
                aberto["cod_sist"] = g[2]
            ln = g[-1]
        if aberto is None:
            continue
        if (f := RX_FECHO.match(ln)):
            aberto["desc"].append(f.group(1))
            nums = [br(x) for x in f.group(3).split()]
            qt, pu, tot = nums[0], nums[-2], nums[-1]
            it = {"tabela": aberto["tabela"], "item": aberto["item"], "codigo": aberto["codigo"],
                  "descricao": re.sub(r"\s+", " ", " ".join(aberto["desc"])).replace(" ,", ",").strip(),
                  "unidade": f.group(2), "quantidade": qt, "preco_unitario": pu, "preco_total": tot,
                  # PU impresso tem 2 casas e o total usa o PU cheio: folga de meio centavo por unidade
                  "conferido": abs(qt * pu - tot) <= max(0.02, abs(qt) * 0.005 + 0.01),
                  "bdi": aberto["bdi"], "data_base": aberto["base"], "regime": aberto["regime"], "dimensao": aberto["dimensao"]}
            if len(nums) == 9:
                it["composicao"] = dict(zip(("material", "mao_de_obra", "equipamento", "servicos", "incidencia", "transporte"), nums[1:7]))
            if "cod_sist" in aberto:
                it["cod_sist"] = aberto["cod_sist"]
            itens.append(it)
            aberto = None
        elif not re.match(r"^(Total|Tabela Refer|Tabela\s|e-OBRAS|P[aá]gina|Folha|\d{2}(\.\d{2})*\s+-?\s*[A-ZÇÃÕÉ])", ln):
            aberto["desc"].append(ln)
    return itens


def texto_pdf(b):
    from pypdf import PdfReader  # pure-python; instalado no Actions
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(b)).pages)


# ── PNCP ──
def processar(compra, s):
    ano, seq = compra["link"].rsplit("/", 2)[-2:]
    url = f"{API}/{ano}/{seq}"
    r = {"id": compra["id"], "edital": compra["edital"], "ano": int(ano), "seq": int(seq), "link": compra["link"],
         "objeto": compra.get("descricao") or compra.get("objeto"), "situacao": compra.get("situacao"),
         "publicacao": compra.get("publicacao"), "estimado": compra.get("estimado"), "homologado": compra.get("homologado"),
         "rodoviario": compra.get("rodoviario"), "pncp_itens": [], "planilha": None, "achados": []}
    pag = 1
    while True:
        lote = jget(f"{url}/itens?pagina={pag}&tamanhoPagina=50") or []
        for x in lote:
            it = {"n": x["numeroItem"], "descricao": re.sub(r"^\(ID-?\d+\)\s*", "", re.sub(r"\s+", " ", x.get("descricao") or "")).strip(),
                  "quantidade": x.get("quantidade"), "unidade": x.get("unidadeMedida"),
                  "valor_unitario_estimado": x.get("valorUnitarioEstimado"), "valor_total": x.get("valorTotal"),
                  "sigiloso": x.get("orcamentoSigiloso"), "homologado_unitario": None, "fornecedor": None}
            if x.get("temResultado"):
                try:
                    res = jget(f"{url}/itens/{x['numeroItem']}/resultados") or []
                    if res:
                        it["homologado_unitario"] = res[0].get("valorUnitarioHomologado")
                        it["homologado_total"] = res[0].get("valorTotalHomologado")
                        it["fornecedor"] = res[0].get("nomeRazaoSocialFornecedor")
                except Exception as e:
                    print(f"  resultado {ano}/{seq} item {x['numeroItem']}: {str(e)[:60]}")
            r["pncp_itens"].append(it)
        if len(lote) < 50:
            break
        pag += 1
    pi = r["pncp_itens"]
    r["item_global"] = len(pi) == 1 and (pi[0]["quantidade"] or 0) <= 1
    if r["item_global"]:
        r["achados"].append("No PNCP a compra tem 1 item global (quantidade 1, valor = orçamento inteiro): o PNCP não traz "
                            "preço por serviço. A comparação usa a planilha orçamentária anexada ao edital.")
    try:
        arqs = jget(f"{url}/arquivos") or []
    except Exception as e:
        arqs = []
        r["achados"].append(f"Lista de arquivos indisponível: {str(e)[:80]}")
    pl = next((a for a in arqs if RX_PLANILHA.search(a.get("titulo") or "")), None)
    if not pl:
        r["achados"].append("Edital sem planilha orçamentária identificável entre os arquivos do PNCP.")
        return r, []
    r["planilha"] = {"titulo": pl["titulo"], "url": pl["url"]}
    try:
        tam = int(get(pl["url"], metodo="HEAD").headers.get("content-length") or 0)
        r["planilha"]["bytes"] = tam
        if tam > MAX_PDF:
            r["achados"].append(f"Planilha com {tam / 1e6:.1f} MB: não baixada (limite {MAX_PDF / 1e6:.0f} MB). Ver o link.")
            return r, []
        txt = texto_pdf(get(pl["url"], timeout=180))
    except Exception as e:
        r["achados"].append(f"Planilha não lida: {str(e)[:100]}")
        return r, []
    linhas = ler_planilha(txt)
    if not linhas:
        r["achados"].append("Planilha sem camada de texto (PDF escaneado) ou fora do formato e-OBRAS: só o link." if len(txt.strip()) < 200
                            else "Planilha com texto, mas fora do formato e-OBRAS reconhecido: só o link.")
        return r, []
    fator = (compra["homologado"] / compra["estimado"]) if compra.get("homologado") and compra.get("estimado") else None
    itens = []
    for ln in linhas:
        ref = s.ref_para(ln["data_base"] or (compra.get("publicacao") or "")[:7] or s.ref)
        it = {"compra": r["id"], "edital": r["edital"], **ln, **casar(s, ln, ref)}
        it["desvio"] = desvio(it)
        it["faixa"] = faixa(it["desvio"])
        # o contrato não está no PNCP item a item: o homologado proporcional supõe o mesmo desconto em todos os itens
        it["preco_homologado_prop"] = round(ln["preco_unitario"] * fator, 2) if fator else None
        itens.append(it)
    dims = {tuple(ln["dimensao"]) for ln in linhas if ln.get("dimensao") and ln["dimensao"][1] == "km"}
    if dims:
        km = max(d[0] for d in dims)
        r["extensao_km"] = km
        r["valor_por_km"] = round((compra.get("homologado") or compra.get("estimado") or 0) / km, 2) if km else None
    r["planilha"].update(linhas=len(linhas), casadas=sum(1 for i in itens if i["sicro_codigo"]),
                         por_codigo=sum(1 for i in itens if (i["confianca"] or "").startswith("alta")),
                         conferidas=sum(1 for i in itens if i["conferido"]),
                         acrescimo_pct=sorted({i["acrescimo_pct"] for i in itens if i.get("acrescimo_pct")}),
                         totais_gerais=sorted({i["total_geral_orcamento"] for i in itens if i.get("total_geral_orcamento")}),
                         bdi=sorted({i["bdi"] for i in itens if i["bdi"] is not None}),
                         data_base=sorted({i["data_base"] for i in itens if i["data_base"]}))
    return r, itens


def resumir(itens):
    """Por serviço SICRO: quantas linhas, desvio mediano, valor total orçado."""
    g = {}
    for i in itens:
        if i["sicro_codigo"] and i["desvio"] is not None:
            g.setdefault(i["sicro_codigo"], []).append(i)
    out = []
    for c, ls in g.items():
        ds = sorted(i["desvio"] for i in ls)
        out.append({"sicro_codigo": c, "descricao": ls[0]["sicro_descricao"], "unidade": ls[0]["sicro_unidade"],
                    "linhas": len(ls), "compras": len({i["compra"] for i in ls}), "desvio_mediano": ds[len(ds) // 2],
                    "valor_orcado": round(sum(i["preco_total"] for i in ls), 2)})
    return sorted(out, key=lambda x: -x["valor_orcado"])


def testes():
    txt = """Dimensão : 1103,600 M2    Bonificação : 15,00%
Data Base : 01/04/2025 (Sem desoneração)
Tabela Referência Código Descrição Unid. Quantidade Preço unitário Preço total
03.01 FORMAS
DNIT-342 03.01.00.001 3108007 Fôrmas de compensado plastificado 10 mm
- uso geral - utilização de 1 vez - confecção
, instalação e retirada
M2 28,080 188,96 5.306,00
CPU 01.00.00.001 CPU56088 ADMINISTRAÇÃO MES 4,000 56.029,17 224.116,68
Total do Grupo: 7.524,33"""
    ls = ler_planilha(txt)
    assert len(ls) == 2, ls
    a, b = ls
    assert a["codigo"] == "3108007" and a["quantidade"] == 28.08 and a["preco_unitario"] == 188.96 and a["bdi"] == 0.15, a
    assert a["descricao"].startswith("Fôrmas de compensado") and a["descricao"].endswith("instalação e retirada"), a["descricao"]
    assert a["data_base"] == "2025-04" and a["dimensao"] == [1103.6, "m²"], a
    assert b["unidade"] == "MES" and b["preco_total"] == 224116.68, b
    assert a["conferido"] and b["conferido"] and "composicao" not in a
    # analítico (6 colunas de composição), com Cód. Sist. e acréscimos no fim do orçamento (RelOrcamentoSEINFRA.java)
    txt2 = """Bonificação : 20,00%
Data Base : 01/01/2026 (Desonerado)
Tabela Referência Cód. Sist. Código Descrição Unid. Quantidade Material Mão de obra Equipamento Serviços Incidência Transporte Preço unitário Preço total
DNIT-370 02.01.00.001 88123 4011459 Brita graduada simples - areia e brita comerciais
M3 100,000 50,00 10,00 20,00 0,00 1,00 5,00 103,20 10.320,00
Total: 10.320,00
Melhoria ambiental (1,50%): 154,80
Mobilização e desmobilização (2,00%): 209,49
Total geral do orçamento: 10.684,29"""
    c2 = ler_planilha(txt2)
    assert len(c2) == 1, c2
    x = c2[0]
    assert x["codigo"] == "4011459" and x["cod_sist"] == "88123" and x["unidade"] == "M3", x
    assert x["quantidade"] == 100 and x["preco_unitario"] == 103.2 and x["preco_total"] == 10320 and x["conferido"], x
    assert x["composicao"]["transporte"] == 5.0 and x["bdi"] == 0.2 and x["data_base"] == "2026-01", x
    assert x["acrescimo_pct"] == 0.035 and x["total_geral_orcamento"] == 10684.29, x
    assert not ler_planilha("DNIT-1 01.00.00.001 123 X\nM3 10,000 5,00 99,00")[0]["conferido"]  # 10 x 5 != 99
    assert br("1.063,000") == 1063.0 and unid("M3") == "m³" and unid("mês") == "mês"
    # 911,07 = 741,73 (SICRO AM abr/2025, 1107900) x 1,2283: desvio ~0
    assert abs(desvio({"preco_unitario": 911.07, "bdi": 0.2283, "sicro_custo_ref": 741.73})) < 0.001
    assert faixa(0.05) == "dentro" and faixa(0.2) == "acima" and faixa(0.3) == "muito acima" and faixa(-0.2) == "abaixo"
    if os.path.exists(os.path.join(DADOS, "sicro_am_hist.json")):
        s = Sicro()
        assert s.ref_para("2025-05") == "2025-04" and s.custo("1107900", "2025-04") == 741.73
        c = casar(s, a, "2025-04")
        assert c["sicro_codigo"] == "3108007" and c["confianca"] == "alta (código)", c
        j, cod = s.parecido("Concreto fck = 30 MPa - confecção em betoneira e lançamento manual - areia e brita comerciais", "m³")
        assert cod == "1107900" and j > 0.9, (j, cod)
    print("testes ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=120, help="reprocessa compras publicadas nos últimos N dias")
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--ids", default="", help="ano/seq separados por vírgula (teste)")
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    if a.teste:
        return testes()
    s = Sicro()
    lic = json.load(open(os.path.join(DADOS, "licitacoes.json"), encoding="utf-8"))["pncp"]
    alvo = [c for c in lic if c.get("rodoviario") or RX_OBRA.search(f"{c.get('objeto')} {c.get('descricao')}")]
    if a.ids:
        quer = {x.strip() for x in a.ids.split(",")}
        alvo = [c for c in alvo if "/".join(c["link"].rsplit("/", 2)[-2:]) in quer]
    ant = json.load(open(SAIDA, encoding="utf-8")) if os.path.exists(SAIDA) else {"compras": [], "itens": []}
    comp_ant = {c["id"]: c for c in ant["compras"]}
    corte = (dt.date.today() - dt.timedelta(days=a.dias)).isoformat()
    compras, itens, n = [], [], 0
    for c in alvo:
        velho = comp_ant.get(c["id"])
        # já lida e antiga, sem resultado novo: reaproveita (a planilha do edital não muda)
        if velho and (c.get("publicacao") or "") < corte and velho.get("homologado") == c.get("homologado") and not a.ids:
            compras.append(velho)
            itens += [i for i in ant["itens"] if i["compra"] == c["id"]]
            continue
        if a.limite and n >= a.limite:
            if velho:
                compras.append(velho); itens += [i for i in ant["itens"] if i["compra"] == c["id"]]
            continue
        n += 1
        print(f"{c['edital']} ({c['link'].rsplit('/', 2)[-2]}/{c['link'].rsplit('/', 1)[-1]})", flush=True)
        try:
            r, its = processar(c, s)
        except Exception as e:
            print(f"  falhou: {str(e)[:100]}")
            if velho:
                compras.append(velho); itens += [i for i in ant["itens"] if i["compra"] == c["id"]]
            continue
        compras.append(r)
        itens += its
        p = r["planilha"] or {}
        print(f"  {len(r['pncp_itens'])} item(ns) PNCP; planilha: {p.get('linhas', 0)} linhas, {p.get('casadas', 0)} casadas com SICRO")
    lin = sum((c.get("planilha") or {}).get("linhas", 0) for c in compras)
    cas = sum(1 for i in itens if i["sicro_codigo"])
    cod = sum(1 for i in itens if (i["confianca"] or "").startswith("alta"))
    val = sum(i["preco_total"] for i in itens) or 0
    val_cas = sum(i["preco_total"] for i in itens if i["sicro_codigo"])
    meta = {"fonte": f"PNCP api/pncp/v1 (itens, resultados e arquivos das compras do CNPJ {CNPJ}) e DNIT SICRO AM "
                     f"(referências trimestrais 2022 a {s.ref})",
            "url": "https://pncp.gov.br/app/editais?q=05533935000157", "gerado_em": dt.datetime.now().isoformat(timespec="minutes"),
            "gerador": "pipelines/licitacoes/precos.py",
            "metodologia": "Preço unitário da planilha orçamentária do edital (relatório e-OBRAS anexado no PNCP) contra o custo "
                           "unitário SICRO AM da mesma data-base. desvio = (preço / (1 + BDI do orçamento)) / SICRO - 1; o SICRO é "
                           "custo direto, sem BDI. Sem BDI declarado o desvio inclui o BDI (referência: 20% a 30%, Acórdão TCU "
                           "2622/2013-Plenário). Casamento: código SICRO de 7 dígitos (alta) ou semelhança de texto com mesma unidade "
                           "(Jaccard >= 0,60 média, >= 0,45 baixa). Faixas: dentro de +-10%, acima, muito acima (> 25%): critério de "
                           "triagem, não conclusão de sobrepreço. Preço homologado proporcional = preço x homologado/estimado "
                           "(supõe desconto linear; a planilha do contrato não está no PNCP).",
            "compras": len(compras), "com_planilha_lida": sum(1 for c in compras if (c.get("planilha") or {}).get("linhas")),
            "item_global": sum(1 for c in compras if c.get("item_global")), "linhas_planilha": lin,
            "casadas": cas, "casadas_por_codigo": cod, "valor_casado_pct": round(val_cas / val, 4) if val else None}
    json.dump({"_meta": meta, "compras": compras, "itens": itens, "resumo": resumir(itens)}, open(SAIDA, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{len(compras)} compras, {lin} linhas de planilha, {cas} casadas com SICRO ({cod} por código) -> {SAIDA}")


if __name__ == "__main__":
    main()

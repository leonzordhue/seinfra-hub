"""Extrato leve do SICRO AM (DNIT) para o DMOB Hub. [Claude] 23/11/2026.

Roda SÓ no PC (as planilhas oficiais ficam em bases-de-custo/, fora do repo); o resultado vai versionado em data/:
- data/sicro_am.json       referência mais recente: composições (serviços), materiais, equipamentos e mão de obra.
- data/sicro_am_hist.json  custo unitário das composições em cada referência trimestral desde 2022 (usado por
                           precos.py para comparar o preço de um orçamento com o SICRO da MESMA data-base).
Fonte: DNIT, SICRO, Relatórios Sintéticos do Amazonas (gov.br/dnit > custos referenciais > SICRO > Norte > AM).
O sintético de composições do SICRO é publicado num só regime (sem desoneração); mão de obra e equipamentos têm
também a versão "com desoneração" (Lei 12.546/2011, CPRB), que vai no extrato.
Uso: python -X utf8 -I pipelines/licitacoes/sicro_extrato.py [--bases "C:/.../bases-de-custo"] [--desde 2022-01]
"""
import argparse, csv, datetime as dt, glob, json, os, re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
BASES = os.path.abspath(os.path.join(RAIZ, "..", "..", "..", "bases-de-custo"))  # Desktop/Area de Trabalho do Claude/bases-de-custo
URL = "https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro/norte/amazonas"


def ler_csv(caminho):
    with open(caminho, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.reader(f, delimiter=";")][1:]


def f2(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def atual(bases, ref):
    d = os.path.join(bases, "SICRO", f"AM-{ref}", "csv")
    arq = lambda n: os.path.join(d, f"sicro_{n}_AM_{ref}.csv")
    comp = [[r[0], r[1].strip(), r[2], f2(r[3])] for r in ler_csv(arq("composicoes")) if r and r[0]]
    mat = [[r[0], r[1].strip(), r[2], f2(r[3])] for r in ler_csv(arq("materiais")) if r and r[0]]
    eq_d = {r[0]: r for r in ler_csv(arq("equipamentos_desonerado")) if r}
    equip = [[r[0], r[1].strip(), f2(r[9]), f2(r[10]), f2(eq_d.get(r[0], [None] * 11)[9]), f2(eq_d.get(r[0], [None] * 11)[10])]
             for r in ler_csv(arq("equipamentos")) if r and r[0]]
    mo_d = {r[0]: r for r in ler_csv(arq("mao_de_obra_desonerado")) if r}
    mo = [[r[0], r[1].strip(), r[2], f2(r[3]), f2(mo_d.get(r[0], [None] * 4)[3])] for r in ler_csv(arq("mao_de_obra")) if r and r[0]]
    return comp, mat, equip, mo


def historico(bases, desde):
    import openpyxl  # só no PC
    refs = {}
    for pasta in sorted(glob.glob(os.path.join(bases, "SICRO", "AM-20??-??"))):
        ref = os.path.basename(pasta)[3:]
        if ref < desde:
            continue
        xs = sorted(glob.glob(os.path.join(pasta, "**", "*Sint*tico de Composi*.xlsx"), recursive=True), key=len)
        if not xs:
            continue
        wb = openpyxl.load_workbook(xs[0], read_only=True)
        m = {}
        for r in wb[wb.sheetnames[0]].iter_rows(values_only=True):
            if r and isinstance(r[0], str) and re.fullmatch(r"\d{7}", r[0].strip()) and isinstance(r[3], (int, float)):
                m[r[0].strip()] = round(float(r[3]), 2)
        wb.close()
        refs[ref] = m
        print(f"  {ref}: {len(m)} composições", flush=True)
    return refs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bases", default=BASES)
    ap.add_argument("--desde", default="2022-01")
    a = ap.parse_args()
    ref = sorted(os.path.basename(os.path.dirname(p))[3:] for p in glob.glob(os.path.join(a.bases, "SICRO", "AM-20??-??", "csv")))[-1]
    comp, mat, equip, mo = atual(a.bases, ref)
    agora = dt.datetime.now().isoformat(timespec="minutes")
    meta = {"fonte": f"DNIT, SICRO, Relatórios Sintéticos do Amazonas, referência {ref[5:]}/{ref[:4]}", "url": URL,
            "referencia": ref, "gerado_em": agora, "gerador": "pipelines/licitacoes/sicro_extrato.py",
            "metodologia": "Cópia fiel dos relatórios sintéticos (sem cálculo). Custo unitário de composição = custo direto "
                           "(inclui FIC, sem BDI), R$ por unidade, regime sem desoneração (único publicado para composições). "
                           "Equipamentos: custo horário produtivo/improdutivo nos dois regimes; mão de obra: R$/h nos dois regimes.",
            "colunas": {"comp": ["codigo", "descricao", "unidade", "custo_sem_desoneracao"],
                        "mat": ["codigo", "descricao", "unidade", "preco"],
                        "equip": ["codigo", "descricao", "produtivo_h", "improdutivo_h", "produtivo_h_desonerado", "improdutivo_h_desonerado"],
                        "mo": ["codigo", "descricao", "unidade", "custo", "custo_desonerado"]}}
    saida = os.path.join(RAIZ, "data", "sicro_am.json")
    json.dump({"_meta": meta, "comp": comp, "mat": mat, "equip": equip, "mo": mo}, open(saida, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{ref}: {len(comp)} composições, {len(mat)} materiais, {len(equip)} equipamentos, {len(mo)} mão de obra -> "
          f"{os.path.getsize(saida) / 1e6:.2f} MB")
    refs = historico(a.bases, a.desde)
    refs[ref] = {c[0]: c[3] for c in comp}
    cods = sorted({c for m in refs.values() for c in m})
    hist = {"_meta": {**meta, "fonte": "DNIT, SICRO AM, Relatórios Sintéticos de Composições, referências trimestrais",
                      "metodologia": "custos[ref][i] = custo unitário (R$, sem desoneração) da composição codigos[i] na "
                                     "referência ref; null = código inexistente naquela referência."},
            "codigos": cods, "custos": {r: [refs[r].get(c) for c in cods] for r in sorted(refs)}}
    s2 = os.path.join(RAIZ, "data", "sicro_am_hist.json")
    json.dump(hist, open(s2, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"histórico: {len(refs)} referências, {len(cods)} códigos -> {os.path.getsize(s2) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

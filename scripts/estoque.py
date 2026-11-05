#!/usr/bin/env python3
"""Gera estoque.json (aparelhos em estoque) para o Portal do Vendedor Aura.

Uso:
  python3 scripts/estoque.py --agora "AAAA-MM-DDTHH:MM:SS-03:00" \
      --meu arquivo1.json [arquivo2.json ...] --riachi arquivoA.json [arquivoB.json ...]

Cada arquivo é a resposta de list_inventory ({"items": [...]}) de uma página.
Regras:
- Unidade Meu iPhone (Aura): só itens com disponibilidade "Estoque atualizado"
  ("Disponível para venda" são aparelhos já vendidos sem baixa no sistema).
- Unidade Riachi: todos os itens em estoque.
- Só aparelhos (tipo Celular), com quantidade > 0.
Não leva custo, fornecedor nem cliente: só modelo, memória, cor, IMEI 1 e saúde da bateria.
"""
import argparse, json, os, re, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper().strip()


def carregar(arquivos):
    itens = {}
    for f in arquivos or []:
        d = json.load(open(f))
        for i in (d.get("items", d) if isinstance(d, dict) else d):
            itens[i["id"]] = i
    return list(itens.values())


def modelo(i):
    m = (i.get("aparelhoDescricao") or "").strip()
    if not m:
        m = (i.get("descricao") or "").split(" - ")[1] if " - " in (i.get("descricao") or "") else "Aparelho"
    m = m.title()
    m = re.sub(r"(?i)\biphone\b", "iPhone", m)
    m = re.sub(r"(?i)\bse\b", "SE", m)
    m = re.sub(r"(?i)\bxr\b", "XR", m)
    m = re.sub(r"(?i)\bxs\b", "XS", m)
    m = re.sub(r"(\d+)E\b", r"\1e", m)
    return m


def memoria(i):
    g = (i.get("gbDescricao") or "").upper().replace(" ", "")
    if not g:
        mt = re.search(r"(\d+)\s*(GB|TB)", (i.get("descricao") or "").upper())
        g = (mt.group(1) + mt.group(2)) if mt else ""
    return g


def cor(i):
    c = (i.get("corDescricao") or "").strip()
    return c.title() if c else ""


def eh_aparelho(i):
    t = norm(i.get("tipoProdutoDescricao"))
    return "CELULAR" in t or norm(i.get("aparelhoDescricao")).startswith("IPHONE")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agora", required=True)
    ap.add_argument("--meu", nargs="*", default=[])
    ap.add_argument("--riachi", nargs="*", default=[])
    a = ap.parse_args()

    saida = []
    for unidade, arquivos, so_atualizado in (("Meu iPhone", a.meu, True), ("Riachi", a.riachi, False)):
        for i in carregar(arquivos):
            if (i.get("quantidade") or 0) <= 0 or i.get("excluido"):
                continue
            if not eh_aparelho(i):
                continue
            if so_atualizado and norm(i.get("disponibilidade")) != "ESTOQUE ATUALIZADO":
                continue
            saida.append({
                "modelo": modelo(i), "memoria": memoria(i), "cor": cor(i),
                "imei": i.get("imei") or i.get("serialNumber") or "",
                "bateria": i.get("saudeBateria"), "unidade": unidade,
            })

    def chave(x):
        nums = re.findall(r"\d+", x["modelo"])
        geracao = int(nums[0]) if nums else 0
        gb = int(re.sub(r"\D", "", x["memoria"]) or 0) * (1024 if "TB" in x["memoria"] else 1)
        return (-geracao, x["modelo"], gb, x["cor"])
    saida.sort(key=chave)
    out = {"atualizadoEm": a.agora, "total": len(saida),
           "porUnidade": {u: sum(1 for x in saida if x["unidade"] == u) for u in ("Meu iPhone", "Riachi")},
           "itens": saida}
    json.dump(out, open(os.path.join(RAIZ, "estoque.json"), "w"), ensure_ascii=False, indent=1)
    print(f"Estoque: {out['total']} aparelhos (Meu iPhone {out['porUnidade']['Meu iPhone']}, Riachi {out['porUnidade']['Riachi']})")


if __name__ == "__main__":
    main()

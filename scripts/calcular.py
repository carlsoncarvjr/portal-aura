#!/usr/bin/env python3
"""Calcula o dados.json do Portal do Vendedor Aura a partir das vendas do MercadoPhone.

Uso:
  python3 scripts/calcular.py --hoje AAAA-MM-DD --agora "AAAA-MM-DDTHH:MM:SS-03:00" \
      vendas_unidade1.json [vendas_unidade2.json ...]

Cada arquivo de entrada é a resposta de list_sales ({"items": [...]}) ou uma lista de vendas.
Pode passar várias páginas e várias unidades; vendas repetidas (mesmo id) são ignoradas.
Busque SEM filtro de status (o script escolhe "concluido" e "orcamento").

Lê e atualiza prevendas.json (na raiz do repositório): guarda a data original de cada
pré-venda, para que, quando ela virar venda concluída, continue contando no dia em que
foi feita. Escreve dados.json na raiz do repositório.
"""
import argparse, calendar, datetime as dt, json, os, re, sys, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDEDORES = ["Gustavo", "Danilo", "Elisa"]          # quem aparece no ranking
EXCLUIDOS = ["JBL", "IPAD", "MACBOOK", "MAC ", "WATCH", "SERVICO", "SERVIÇO"]
STATUS_CONTA = {"concluido", "orcamento"}            # orcamento = pré-venda lançada pelo vendedor
MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
         "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().upper()


def eh_iphone(nome):
    n = norm(nome)
    return n.startswith("IPHONE") or "PREVENDA" in n or "PRE-VENDA" in n or "PRE VENDA" in n


def eh_excluido(nome):
    n = norm(nome) + " "
    return any(x in n for x in EXCLUIDOS)


def vendedor(nome):
    v = re.split(r"[\s/]+", (nome or "").strip())[0]
    return v.capitalize() if v else "—"


def nome_iphone(nome):
    n = norm(nome)
    if "PREVENDA" in n or "PRE-VENDA" in n or "PRE VENDA" in n:
        return "Pré-venda iPhone"
    partes = [p.strip() for p in nome.split(" - ") if p.strip()]
    partes = [p for p in partes if norm(p) not in ("APPLE",)]
    modelo = partes[0] if partes else nome
    modelo = re.sub(r"(?i)iphone", "iPhone", modelo.title()).replace("Pro Max", "Pro Max")
    resto = []
    for p in partes[1:]:
        resto.append(p.upper() if re.fullmatch(r"\d+\s*(GB|TB)", p.upper()) else p.title())
    return " ".join([modelo] + resto)


def nome_acessorios(nomes):
    rotulos = []
    for nome in nomes:
        n = norm(nome)
        if "PELICULA" in n: r = "Película"
        elif any(k in n for k in ("CAPA", "CAPINHA", "CASE")): r = "Capinha"
        elif any(k in n for k in ("CARREGADOR", "FONTE")): r = "Carregador"
        elif "CABO" in n: r = "Cabo"
        elif "ECHO" in n: r = "Echo Dot"
        else: r = nome.split(" - ")[0].strip().capitalize()[:28]
        if r not in rotulos: rotulos.append(r)
    return " + ".join(rotulos[:3]) if rotulos else "Acessório"


# ---------- Comissão dos vendedores (tabela do mês) ----------
# Novembro/2026: valor por iPhone conforme faixa individual (vale para todos do mês);
# % sobre acessórios (valor líquido) conforme faixa; JBL paga como aparelho na faixa atingida, sem contar para a faixa.
FAIXAS_IPHONE = [(12, 16, 10), (17, 24, 15), (25, 28, 20), (29, 32, 25), (33, 36, 30), (37, 42, 35), (43, 10**6, 40)]
FAIXAS_ACESS = [(3000, 4499.99, 3.0), (4500, 6499.99, 5.0), (6500, 9999.99, 7.5), (10000, 14499.99, 10.0), (14500, 10**12, 12.5)]
PREMIO_META_IPHONE = 100
PREMIO_META_ACESS = 100
PREMIO_MELHOR = 100


def valor_iphone(n):
    for a_, b, v in FAIXAS_IPHONE:
        if a_ <= n <= b:
            return v
    return 0


def pct_acess(v):
    for a_, b, p in FAIXAS_ACESS:
        if a_ <= v <= b:
            return p
    return 0.0


def comissoes(dados, vendas_mes, agora):
    m = dados["mes"]
    loja_i, loja_a = m["iphones"], m["acessorios"]
    ranking = dados["ranking"]["mes"]
    for nome in VENDEDORES:
        vs = [v for v in vendas_mes if v["vendedor"] == nome]
        iph = sum(v["iphones"] for v in vs)
        jbl = sum(v.get("jbl", 0) for v in vs)
        acc = round(sum(v["acessorios"] for v in vs), 2)
        vi = valor_iphone(iph)
        prox_i = next(((a_, v) for a_, b, v in FAIXAS_IPHONE if a_ > iph), None)
        pa = pct_acess(acc)
        prox_a = next(((a_, p) for a_, b, p in FAIXAS_ACESS if a_ > acc), None)
        pos = next((i + 1 for i, r in enumerate(ranking) if r["vendedor"] == nome), None)
        bate_i, bate_a = loja_i >= m["metaIphones"], loja_a >= m["metaAcessorios"]
        com_i = (iph + jbl) * vi
        com_a = round(acc * pa / 100, 2)
        premios = (PREMIO_META_IPHONE if bate_i else 0) + (PREMIO_META_ACESS if bate_a else 0)
        out = {
            "atualizadoEm": agora, "mes": m["rotulo"], "vendedor": nome,
            "iphones": iph, "jbl": jbl, "valorPorIphone": vi,
            "proximaFaixaIphone": {"aPartirDe": prox_i[0], "valor": prox_i[1], "faltam": prox_i[0] - iph} if prox_i else None,
            "comissaoIphones": com_i,
            "acessorios": acc, "pctAcessorios": pa,
            "proximaFaixaAcessorios": {"aPartirDe": prox_a[0], "pct": prox_a[1], "faltam": round(prox_a[0] - acc, 2)} if prox_a else None,
            "comissaoAcessorios": com_a,
            "premios": {"metaIphones": {"valor": PREMIO_META_IPHONE, "loja": loja_i, "meta": m["metaIphones"], "batida": bate_i},
                        "metaAcessorios": {"valor": PREMIO_META_ACESS, "loja": loja_a, "meta": m["metaAcessorios"], "batida": bate_a},
                        "melhorVendedor": {"valor": PREMIO_MELHOR, "posicao": pos}},
            "total": round(com_i + com_a + premios, 2),
            "faixasIphone": [{"de": a_, "ate": (b if b < 10**6 else None), "valor": v} for a_, b, v in FAIXAS_IPHONE],
            "faixasAcessorios": [{"de": a_, "ate": (b if b < 10**12 else None), "pct": p} for a_, b, p in FAIXAS_ACESS],
            "vendas": [{"data": v["data"].isoformat(), "produto": v["produto"] + (" + JBL" if v.get("jbl") and v["produto"] else ("JBL" if v.get("jbl") else "")),
                        "tipo": v["tipo"], "valor": round(v["acessorios"], 2), "iphones": v["iphones"], **({"pre": True} if v["pre"] else {})}
                       for v in sorted(vs, key=lambda v: (v["data"], v["hora"]), reverse=True)],
        }
        os.makedirs(os.path.join(RAIZ, "privado"), exist_ok=True)
        json.dump(out, open(os.path.join(RAIZ, "privado", f"vendedor-{norm(nome).lower()}.json"), "w"), ensure_ascii=False, indent=2)


def carregar(arquivos):
    vendas = {}
    for f in arquivos:
        d = json.load(open(f))
        itens = d.get("items", d) if isinstance(d, dict) else d
        for s in itens:
            vendas[s["id"]] = s
    return list(vendas.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hoje", required=True)
    ap.add_argument("--agora", required=True)
    ap.add_argument("--meta-iphones", type=int)
    ap.add_argument("--meta-acessorios", type=float)
    ap.add_argument("arquivos", nargs="+")
    a = ap.parse_args()

    hoje = dt.date.fromisoformat(a.hoje)
    ontem = hoje - dt.timedelta(days=1)
    seg = hoje - dt.timedelta(days=hoje.weekday())          # segunda-feira desta semana
    ini_mes = hoje.replace(day=1)

    reg_path = os.path.join(RAIZ, "prevendas.json")
    registro = json.load(open(reg_path)) if os.path.exists(reg_path) else {}
    dados_path = os.path.join(RAIZ, "dados.json")
    antigo = json.load(open(dados_path)) if os.path.exists(dados_path) else {}

    vendas = carregar(a.arquivos)

    # 1) Data que conta: pré-venda conta no dia em que foi feita
    linhas = []
    for s in vendas:
        st = (s.get("status") or "").lower()
        if st not in STATUS_CONTA:
            continue
        data_venda = s["dataVenda"][:10]
        sid = str(s["id"])
        if st == "orcamento" and sid not in registro:
            registro[sid] = data_venda
        data_conta = min(data_venda, registro.get(sid, data_venda))
        linhas.append((s, st, dt.date.fromisoformat(data_conta)))

    # 2) Pré-venda que virou outra venda concluída do mesmo cliente: conta só a concluída
    def chave_cli(s):
        c = (s.get("cliente") or {}).get("cpf") or ""
        c = re.sub(r"\D", "", c)
        return c or norm(s.get("clienteNome"))
    concl_iph = {}
    for s, st, d in linhas:
        if st == "concluido" and any(eh_iphone(i["produtoNome"]) for i in s["itens"]):
            concl_iph.setdefault(chave_cli(s), []).append(d)
    filtradas = []
    for s, st, d in linhas:
        if st == "orcamento" and norm(s.get("clienteNome")) != "CLIENTE PASSANTE":
            ds = concl_iph.get(chave_cli(s), [])
            if any(abs((x - d).days) <= 45 for x in ds) and any(eh_iphone(i["produtoNome"]) for i in s["itens"]):
                continue
        filtradas.append((s, st, d))

    # 3) Itens, sem duplicar relançamentos (mesmo cliente + mesmo produto + mesmo dia)
    vistos = set()
    vendas_ok = []
    for s, st, d in sorted(filtradas, key=lambda x: x[0]["dataVenda"]):
        iph, acc, nomes_acc, nomes_iph, jbl = 0, 0.0, [], [], 0
        for i in s["itens"]:
            nome = i["produtoNome"]
            k = (chave_cli(s), norm(nome), d.isoformat())
            if k in vistos and norm(s.get("clienteNome")) != "CLIENTE PASSANTE":
                continue
            vistos.add(k)
            q = i.get("quantidade") or 1
            if eh_iphone(nome):
                iph += q; nomes_iph.append(nome)
            elif "JBL" in norm(nome):
                jbl += q
            elif not eh_excluido(nome):
                acc += (i.get("valorUnitario") or 0) * q; nomes_acc.append(nome)
        if iph == 0 and acc == 0 and jbl == 0:
            continue
        vendas_ok.append({
            "data": d, "hora": s["dataVenda"][11:16] if s["dataVenda"][:10] == d.isoformat() else "—",
            "vendedor": vendedor(s.get("vendedorNome")), "iphones": iph, "acessorios": acc,
            "pre": st == "orcamento", "jbl": jbl,
            "produto": nome_iphone(nomes_iph[0]) + (f" (+{iph-1})" if iph > 1 else "") if nomes_iph else nome_acessorios(nomes_acc),
            "tipo": "iphone" if iph else "acessorio",
        })
    vendas_dia = [v for v in vendas_ok if v["iphones"] or v["acessorios"]]

    def periodo(ini, fim, todas=False):
        return [v for v in (vendas_ok if todas else vendas_dia) if ini <= v["data"] <= fim]

    def dia(d):
        vs = sorted(periodo(d, d), key=lambda v: v["hora"])
        return {"data": d.isoformat(),
                "iphones": sum(v["iphones"] for v in vs),
                "acessorios": round(sum(v["acessorios"] for v in vs), 2),
                "itens": [{"hora": v["hora"], "tipo": v["tipo"], "produto": v["produto"],
                           "vendedor": v["vendedor"], **({"pre": True} if v["pre"] else {})} for v in vs]}

    def ranking(vs):
        r = {}
        for v in vs:
            if v["vendedor"] not in VENDEDORES: continue
            x = r.setdefault(v["vendedor"], {"vendedor": v["vendedor"], "iphones": 0, "acessorios": 0.0, "vendas": 0})
            x["iphones"] += v["iphones"]; x["acessorios"] += v["acessorios"]; x["vendas"] += 1
        out = sorted(r.values(), key=lambda x: (-x["iphones"], -x["acessorios"]))
        for x in out: x["acessorios"] = round(x["acessorios"], 2)
        return out

    mes_vs = periodo(ini_mes, hoje)
    am = antigo.get("mes", {})
    mesmo_mes = am.get("ano") == hoje.year and am.get("mes") == hoje.month
    meta_i = a.meta_iphones or am.get("metaIphones", 110)
    meta_a = a.meta_acessorios or am.get("metaAcessorios", 25000)
    dados = {
        "atualizadoEm": a.agora,
        "mes": {"rotulo": f"{MESES[hoje.month-1]} {hoje.year}", "ano": hoje.year, "mes": hoje.month,
                "diasNoMes": calendar.monthrange(hoje.year, hoje.month)[1],
                "metaIphones": meta_i, "metaAcessorios": meta_a,
                "iphones": sum(v["iphones"] for v in mes_vs),
                "acessorios": round(sum(v["acessorios"] for v in mes_vs), 2)},
        "hoje": dia(hoje),
        "ontem": dia(ontem),
        "ranking": {"mes": ranking(mes_vs), "semana": ranking(periodo(seg, hoje)),
                    "hoje": ranking(periodo(hoje, hoje))},
    }
    json.dump(dados, open(dados_path, "w"), ensure_ascii=False, indent=2)
    comissoes(dados, periodo(ini_mes, hoje, todas=True), a.agora)
    # guarda só pré-vendas dos últimos 120 dias
    corte = (hoje - dt.timedelta(days=120)).isoformat()
    registro = {k: v for k, v in registro.items() if v >= corte}
    json.dump(dict(sorted(registro.items())), open(reg_path, "w"), indent=1)
    m = dados["mes"]
    print(f"Mês: {m['iphones']} iPhones, R$ {m['acessorios']:.2f} | Hoje: {dados['hoje']['iphones']} iPhones, "
          f"R$ {dados['hoje']['acessorios']:.2f} | Pré-vendas no mês: {sum(1 for v in mes_vs if v['pre'])}")
    if dados["ranking"]["mes"]:
        print("1º do mês em iPhones:", dados["ranking"]["mes"][0]["vendedor"])


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Calcula privado/tecnico.json (comissão do técnico) a partir das ordens de serviço.

Uso:
  python3 scripts/calcular_os.py --hoje AAAA-MM-DD --agora "AAAA-MM-DDTHH:MM:SS-03:00" os_normalizadas.json

os_normalizadas.json = lista de OS do mês (todas as situações), cada uma assim:
  {"codigo": 1039, "data": "AAAA-MM-DD",        # data de finalização (ou de criação, se ainda aberta)
   "aparelho": "iPhone 14 Pro Max", "servico": "Troca de bateria",
   "situacao": "Finalizado" | "Em andamento" | "Aprovado" | "Aguardando peça" | "Cancelado",
   "tipo": "ASSISTENCIA" | "MANUTENCAO UPGRADE" | "GARANTIA" | outro,
   "valor": 580.00,        # valor recebido do cliente, já sem a taxa da máquina
   "pecas": 210.00,        # custo das peças
   "terceirizada": 0.00}   # mão de obra terceirizada

Regras (Política de comissão do técnico, vigente a partir de 01/11/2026):
- Conta só OS externa (tipo que não seja MANUTENCAO UPGRADE nem GARANTIA), Finalizada no mês, valor >= R$ 150.
- Lucro = valor − peças − terceirizada.
- Faixas por ordem de fechamento: 1º–6º 25%, 7º–12º 30%, 13º–19º 35%, 20º em diante 40%.
- Nov e dez/2026: recebe o maior entre 30% do lucro de todas e o cálculo pelas faixas.
"""
import argparse, json, os, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIXAS = [(1, 6, 25), (7, 12, 30), (13, 19, 35), (20, 10**6, 40)]
META = 15
MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
         "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
GARANTIA_MESES = {"2026-11", "2026-12"}


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper().strip()


def pct(n):
    for a, b, p in FAIXAS:
        if a <= n <= b:
            return p
    return FAIXAS[-1][2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hoje", required=True)
    ap.add_argument("--agora", required=True)
    ap.add_argument("arquivo")
    a = ap.parse_args()
    mes = a.hoje[:7]
    lista = json.load(open(a.arquivo))
    if isinstance(lista, dict):
        lista = lista.get("items", [])

    oss = []
    for o in lista:
        sit, tipo = norm(o.get("situacao")), norm(o.get("tipo"))
        valor = float(o.get("valor") or 0)
        lucro = round(valor - float(o.get("pecas") or 0) - float(o.get("terceirizada") or 0), 2)
        motivo = None
        if "CANCEL" in sit:
            continue
        if "GARANTIA" in tipo:
            motivo = "Garantia"
        elif "MANUTENCAO" in tipo or "UPGRADE" in tipo or "INTERN" in tipo:
            motivo = "Interna"
        elif "FINALIZ" not in sit:
            motivo = None  # ainda aberta: aparece, mas sem lucro
        elif valor < 150:
            motivo = "Abaixo de R$ 150"
        elif (o.get("data") or "")[:7] != mes:
            continue
        conta = motivo is None and "FINALIZ" in sit
        oss.append({"codigo": o.get("codigo"), "data": o.get("data"), "aparelho": o.get("aparelho") or "",
                    "servico": o.get("servico") or "", "situacao": o.get("situacao") or "",
                    "valor": round(valor, 2), "pecas": round(float(o.get("pecas") or 0) + float(o.get("terceirizada") or 0), 2),
                    "lucro": lucro if conta else None, "conta": conta, "motivo": motivo})

    contam = sorted([o for o in oss if o["conta"]], key=lambda o: (o["data"] or "", str(o["codigo"])))
    com_faixas = 0.0
    for i, o in enumerate(contam, 1):
        o["pct"] = pct(i)
        com_faixas += o["lucro"] * o["pct"] / 100
    n = len(contam)
    lucro_total = round(sum(o["lucro"] for o in contam), 2)
    garantia = round(lucro_total * 0.30, 2) if mes in GARANTIA_MESES else None
    comissao = max(com_faixas, garantia or 0)
    atual = pct(n) if n else 25
    prox = next(((p, a_ - n) for a_, b, p in FAIXAS if a_ > n), None)

    dados = {
        "atualizadoEm": a.agora,
        "mes": f"{MESES[int(mes[5:]) - 1]} {mes[:4]}",
        "meta": META,
        "servicos": n,
        "faixaAtual": atual,
        "proxima": {"pct": prox[0], "faltam": prox[1]} if prox else None,
        "lucro": lucro_total,
        "comissaoFaixas": round(com_faixas, 2),
        "comissaoGarantia": garantia,
        "comissao": round(comissao, 2),
        "garantiaAplicada": bool(garantia and garantia > com_faixas),
        "os": sorted(oss, key=lambda o: (o["data"] or "", str(o["codigo"])), reverse=True),
    }
    os.makedirs(os.path.join(RAIZ, "privado"), exist_ok=True)
    json.dump(dados, open(os.path.join(RAIZ, "privado", "tecnico.json"), "w"), ensure_ascii=False, indent=2)
    print(f"Assistência: {n} serviços que contam, lucro R$ {lucro_total:.2f}, comissão R$ {comissao:.2f}"
          f" (faixa {atual}%{', garantia 30% aplicada' if dados['garantiaAplicada'] else ''})")


if __name__ == "__main__":
    main()

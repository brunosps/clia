import math, re, requests, pandas as pd

URL = "https://openrouter.ai/api/v1/models"
OUTFILE = "openrouter_models.xlsx"
BASE_CTX = 8000
CTX_CAP = 524288  # 512k cap pro score
W_IN, W_OUT = 0.5, 0.5  # pesos custo input/output

def ffloat(x):
    try:
        return float(x) if x not in (None, "", "null") else None
    except: return None

def ctx_of(m):
    return int(m.get("top_provider", {}).get("context_length")
               or m.get("context_length") or 0)

def is_router(mid, name):
    s = (mid or "").lower()+" "+(name or "").lower()
    return s.startswith("openrouter/auto") or " router" in s or s.endswith("/auto")

def detect_free(mid, name, p_in, p_out):
    s = (mid or "").lower()+" "+(name or "").lower()
    return (":free" in s) or (p_in == 0 and p_out == 0)

def family(mid):
    # pega o autor antes da primeira barra (google/, openai/, deepseek/, meta-llama/, qwen/, etc.)
    return (mid or "").split("/", 1)[0]

def score(p_in, p_out, ctx):
    if ctx <= 0: return math.inf
    ctx_eff = min(ctx, CTX_CAP)
    avg = (W_IN * p_in) + (W_OUT * p_out)
    denom = (ctx_eff / BASE_CTX)
    return avg / denom if denom > 0 else math.inf

r = requests.get(URL, timeout=60); r.raise_for_status()
models = r.json().get("data", [])

rows = []
for m in models:
    mid, name = m.get("id"), m.get("name")
    if is_router(mid, name): continue
    ctx = ctx_of(m)
    p_in  = ffloat(m.get("pricing", {}).get("prompt"))
    p_out = ffloat(m.get("pricing", {}).get("completion"))
    if any(v is None or v < 0 for v in (p_in, p_out)) or ctx <= 0:
        continue
    rows.append({
        "id": mid,
        "name": name,
        "family": family(mid),
        "context": ctx,
        "price_in": p_in,
        "price_out": p_out,
        "score": round(score(p_in, p_out, ctx), 12),
        "free": detect_free(mid, name, p_in, p_out),
        "streaming": "SSE (stream=true)"
    })

df = pd.DataFrame(rows)

# Top 10 custo-benefício (global)
top10 = df.sort_values(["score","price_in","price_out","context"],
                       ascending=[True,True,True,False]).head(10).reset_index(drop=True)

# Top 5 FREE (prioriza contexto maior; empates por menor preço, embora seja 0)
free5 = (df[df["free"]]
         .sort_values(["context","price_in","price_out"],
                      ascending=[False,True,True])
         .head(5).reset_index(drop=True))

# Melhor por família
best_per_family = (df.sort_values(["family","score","price_in","price_out","context"],
                                  ascending=[True,True,True,True,False])
                     .groupby("family", as_index=False).first()
                     .sort_values("score").reset_index(drop=True))

# Formatação amigável
for d in (top10, free5, best_per_family):
    d["price_in"]  = d["price_in"].map(lambda v: round(v, 10))
    d["price_out"] = d["price_out"].map(lambda v: round(v, 10))

with pd.ExcelWriter(OUTFILE, engine="openpyxl") as w:
    top10.to_excel(w, "Top10_CustoBeneficio", index=False)
    free5.to_excel(w, "Top5_Free", index=False)
    best_per_family.to_excel(w, "BestPerFamily", index=False)

print(f"OK -> {OUTFILE}")

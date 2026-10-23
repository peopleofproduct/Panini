"""Panini public visuals, batch 2: V2 Before/After and V8 Credit-file stack.

Sits next to generate_visuals.py in the repo and reuses its drawing kit.
Run:  python generate_visuals_extra.py   -> writes light/dark SVGs to docs/assets/
"""
import os
from generate_visuals import S, THEMES  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "assets")


def box_dark(c):
    return "#1E293B" if c["bg"].upper() == "#FFFFFF" else "#010409"


def head(s, title, sub):
    s.text(40, 56, title, 26, weight=700)
    s.text(40, 84, sub, 15, fill=s.c["muted"])


def note(s, x, y, txt, color):
    s.circle(x + 4, y - 5, 4, s.c[color])
    s.text(x + 18, y, txt, 14)


# ---------------------------------------------------------------- V2 before/after
def before_after(c):
    s = S(1280, 680, c, "Before and after Panini",
          "Today: five companies (a lender, a fintech, an expense app, a reconciliation engine and an FIU) each send data to per-report vendor APIs, "
          "paying per report, with data leaving their systems, flags they can't audit, and the same fix bought repeatedly. "
          "With Panini: each company runs Panini in-process on top of a shared community grammar corpus, so fixes propagate to everyone, cost nothing per report, "
          "data never moves, and every flag has evidence rows.")
    head(s, "Before and after Panini",
         "Every fintech needs the same normalization layer. Today it is bought per report or rebuilt in-house.")
    names = ["Lender A", "Fintech B", "Expense app", "Recon engine", "FIU"]

    # ---- left: today
    s.text(50, 136, "TODAY", 12, fill=c["redText"], weight=700, spacing="1.2")
    xs = [50 + i * 115 for i in range(5)]
    for x, n in zip(xs, names):
        s.rect(x, 152, 100, 54, fill=c["card"], stroke=c["border"])
        s.text(x + 50, 184, n, 13, weight=600, anchor="middle")
    bx, bw, by, bh = 220, 220, 296, 84
    for i, x in enumerate(xs):
        tx = bx + 30 + i * (bw - 60) / 4
        s.arrow(x + 50, 208, tx, by - 4, "red", sw=1.4)
    s.rect(bx, by, bw, bh, fill=box_dark(c), stroke=c["border"], shadow=True)
    s.text(bx + bw / 2, by + 36, "Per-report vendor APIs", 15, fill="#FFFFFF", weight=700, anchor="middle")
    s.text(bx + bw / 2, by + 60, "black box", 13, fill="#FFFFFF", anchor="middle", opacity=0.6, mono=True)
    for i, t in enumerate(["₹ per report", "Data leaves your system", "Can't audit the flags", "Same fix re-bought by everyone"]):
        note(s, 50 + (i % 2) * 290, 436 + (i // 2) * 34, t, "red")
    s.rect(50, 518, 560, 40, fill=c["slateSoft"], rx=8, opacity=0.7)
    s.text(330, 543, "…or private regex spaghetti, rebuilt N times", 13, fill=c["muted"], anchor="middle", italic=True)

    # divider
    s.path("M640,120 L640,580", c["border"])

    # ---- right: with Panini
    s.text(670, 136, "WITH PANINI", 12, fill=c["greenText"], weight=700, spacing="1.2")
    xs2 = [670 + i * 115 for i in range(5)]
    for x, n in zip(xs2, names):
        s.rect(x, 152, 100, 104, fill=c["card"], stroke=c["border"])
        s.text(x + 50, 180, n, 13, weight=600, anchor="middle")
        s.rect(x + 10, 196, 80, 46, fill=c["indigoFill"], rx=6)
        s.text(x + 50, 216, "Panini", 13, fill=c["onFill"], weight=700, anchor="middle")
        s.text(x + 50, 233, "in-process", 11, fill=c["onFill"], anchor="middle", opacity=0.8)
        s.arrow(x + 50, 294, x + 50, 262, "green", sw=1.4, dash="4 3")
    s.rect(670, 296, 560, 84, fill=c["greenSoft"], stroke=c["green"], sw=1.5)
    s.text(950, 330, "community grammar corpus", 15, fill=c["greenText"], weight=700, anchor="middle", mono=True)
    s.text(950, 356, "fixes propagate to everyone", 13, fill=c["text"], anchor="middle")
    for i, t in enumerate(["₹0 per report", "Data never moves", "Every flag has evidence rows", "One fix benefits all"]):
        note(s, 670 + (i % 2) * 290, 436 + (i // 2) * 34, t, "green")

    s.caption(630, "Infrastructure everyone needs, differentiated by no one — that's a commons, not a product.")
    return s.render()


# ---------------------------------------------------------------- V8 credit-file stack
def credit_stack(c):
    s = S(1280, 640, c, "The credit-file stack",
          "Four bands from top to bottom: application and UX (not Panini's layer), decisioning and credit policy (the lender's own), "
          "the Panini normalization band (extract, forensics, fraud suite, consolidation, conduct, income docs, report; open source), "
          "and data rails (AA, bank documents, SMS). Vendors sell the normalization band per report; Panini provides open equivalents.")
    head(s, "The credit-file stack", "Where Panini sits between the data rails and a lender's decisioning.")
    X, W = 220, 840

    def gray_band(y, t, tag, fill, txt, tagcol):
        s.rect(X, y, W, 56, fill=fill, stroke=c["border"])
        s.text(X + 24, y + 34, t, 15, weight=600, fill=txt)
        s.text(X + W - 24, y + 34, tag, 13, fill=tagcol, anchor="end", italic=True)

    gray_band(120, "Application & UX", "not our layer", c["slateSoft"], c["muted"], c["muted"])
    gray_band(186, "Decisioning & credit policy", "lender's own", c["slateSoft"], c["muted"], c["muted"])

    # Panini band
    by, bh = 252, 200
    s.rect(X, by, W, bh, fill=c["indigoFill"], rx=10, shadow=True)
    s.text(X + 24, by + 40, "Panini — the normalization layer", 19, fill=c["onFill"], weight=700)
    s.rect(X + W - 140, by + 20, 116, 28, fill="#FFFFFF", rx=14, opacity=0.18)
    s.text(X + W - 82, by + 39, "open source", 13, fill=c["onFill"], weight=600, anchor="middle")
    stages = ["Extract", "Forensics", "Fraud suite", "Consolidation", "Conduct", "Income docs", "Report"]
    cw, gap = 98, 14
    x0 = X + (W - (7 * cw + 6 * gap)) / 2
    for i, t in enumerate(stages):
        x = x0 + i * (cw + gap)
        s.rect(x, by + 80, cw, 56, fill="#FFFFFF", rx=8, opacity=0.14)
        s.text(x + cw / 2, by + 113, t, 12, fill=c["onFill"], weight=600, anchor="middle")
        if i < 6:
            s.text(x + cw + gap / 2, by + 113, "›", 16, fill=c["onFill"], anchor="middle", opacity=0.7)
    s.text(X + W / 2, by + 172, "Apache-2.0  ·  runs in your process  ·  every output carries evidence", 13,
           fill=c["onFill"], anchor="middle", opacity=0.85)

    # data rails
    s.rect(X, 462, W, 56, fill=c["card"], stroke=c["slate"])
    s.text(X + 24, 496, "Data rails", 15, weight=600)
    s.text(X + W - 24, 496, "AA  ·  bank documents  ·  SMS", 13, fill=c["muted"], anchor="end", mono=True)

    # left bracket: open equivalents
    bx = X - 14
    s.path(f"M{bx+8},{by} L{bx},{by} L{bx},{by+bh} L{bx+8},{by+bh}", c["green"], sw=1.8)
    s.text(bx - 12, by + 22, "Panini's open", 13, weight=700, anchor="end", fill=c["greenText"])
    s.text(bx - 12, by + 40, "equivalents", 13, weight=700, anchor="end", fill=c["greenText"])
    for i, t in enumerate(["parsing", "tamper checks", "fraud flags", "multi-account view", "income analysis", "credit-file report"]):
        s.text(bx - 12, by + 72 + i * 21, f"{t}  ✓", 12, anchor="end", fill=c["text"])

    # right bracket: vendor per-report
    rx = X + W + 14
    s.path(f"M{rx-8},{by} L{rx},{by} L{rx},{by+bh} L{rx-8},{by+bh}", c["saffron"], sw=1.8)
    s.text(rx + 12, by + 22, "What vendors sell", 13, weight=700, fill=c["saffronText"])
    s.text(rx + 12, by + 40, "per report", 13, weight=700, fill=c["saffronText"])
    for i, t in enumerate(["statement analysis", "tamper detection", "fraud flags", "account aggregation", "income verification", "analysis reports"]):
        s.text(rx + 12, by + 72 + i * 21, f"₹  {t}", 12, fill=c["text"])

    s.caption(590, "Vendors sell this band per report. We open-sourced it.")
    return s.render()


ASSETS = {"panini-before-after": before_after, "panini-credit-file-stack": credit_stack}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in ASSETS.items():
        for theme, c in THEMES.items():
            with open(os.path.join(OUT, f"{name}-{theme}.svg"), "w") as f:
                f.write(fn(c))
    print("wrote", ", ".join(ASSETS))

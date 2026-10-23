import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "assets")
os.makedirs(OUT, exist_ok=True)

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

THEMES = {
    "light": dict(
        bg="#FFFFFF", text="#0F172A", muted="#64748B", card="#F8FAFC", border="#E2E8F0",
        indigo="#4F46E5", indigoFill="#4F46E5", indigoSoft="#EEF2FF", indigoText="#4338CA",
        saffron="#F59E0B", saffronSoft="#FFFBEB", saffronText="#B45309",
        green="#10B981", greenSoft="#ECFDF5", greenText="#047857",
        red="#EF4444", redSoft="#FEF2F2", redText="#B91C1C",
        slate="#64748B", slateSoft="#F1F5F9", onFill="#FFFFFF", shadow="0.10",
    ),
    "dark": dict(
        bg="#0D1117", text="#E6EDF3", muted="#8B949E", card="#161B22", border="#30363D",
        indigo="#818CF8", indigoFill="#4F46E5", indigoSoft="#1E1B4B", indigoText="#A5B4FC",
        saffron="#FBBF24", saffronSoft="#2A1F05", saffronText="#FBBF24",
        green="#34D399", greenSoft="#052E1F", greenText="#34D399",
        red="#F87171", redSoft="#2D0F0F", redText="#F87171",
        slate="#8B949E", slateSoft="#1C2128", onFill="#FFFFFF", shadow="0.45",
    ),
}


class S:
    def __init__(self, w, h, c, title, desc):
        self.w, self.h, self.c = w, h, c
        self.parts = []
        self.title, self.desc = title, desc

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill="none", stroke=None, sw=1.5, rx=8, dash=None, shadow=False, opacity=None):
        a = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"'
        if stroke:
            a += f' stroke="{stroke}" stroke-width="{sw}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if shadow:
            a += ' filter="url(#shadow)"'
        if opacity is not None:
            a += f' fill-opacity="{opacity}"'
        self.add(a + "/>")

    def text(self, x, y, s, size=14, fill=None, weight=400, anchor="start", mono=False, italic=False, spacing=None, opacity=None):
        fill = fill or self.c["text"]
        fam = MONO if mono else SANS
        a = f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"'
        if italic:
            a += ' font-style="italic"'
        if spacing:
            a += f' letter-spacing="{spacing}"'
        if opacity is not None:
            a += f' fill-opacity="{opacity}"'
        self.add(a + f">{escape(s)}</text>")

    def path(self, d, stroke, sw=1.5, dash=None, marker=None, fill="none"):
        a = f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if marker:
            a += f' marker-end="url(#arr-{marker})"'
        self.add(a + "/>")

    def arrow(self, x1, y1, x2, y2, color="muted", sw=1.5, dash=None):
        self.path(f"M{x1},{y1} L{x2},{y2}", self.c[color], sw, dash, marker=color)

    def circle(self, cx, cy, r, fill, stroke=None, sw=1.5):
        a = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"'
        if stroke:
            a += f' stroke="{stroke}" stroke-width="{sw}"'
        self.add(a + "/>")

    def caption(self, y, s):
        self.text(self.w / 2, y, s, size=15, fill=self.c["muted"], anchor="middle", italic=True)

    def render(self):
        c = self.c
        markers = "".join(
            f'<marker id="arr-{k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{c[k]}"/></marker>'
            for k in ["muted", "indigo", "green", "red", "saffron", "slate"]
        )
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" role="img" aria-labelledby="t d">'
            f'<title id="t">{escape(self.title)}</title><desc id="d">{escape(self.desc)}</desc>'
            f'<defs>{markers}<filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">'
            f'<feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="{c["shadow"]}"/></filter></defs>'
            f'<rect width="100%" height="100%" fill="{c["bg"]}"/>'
        )
        return head + "".join(self.parts) + "</svg>"


# ---------------------------------------------------------------- V1 ecosystem
def ecosystem(c):
    s = S(1280, 730, c, "Where Panini sits in India's open-finance stack",
          "Data sources (bank statements, payslips, ITR-V and Form 26AS, bank SMS, Account Aggregator data) flow as raw inconsistent formats into Panini, "
          "an open-source normalization layer with extraction, integrity forensics, a narration grammar engine, and insights and fraud indicators. "
          "Panini outputs clean typed data with evidence to lenders, expense apps, reconciliation engines, FIUs and audit teams, who contribute grammar back.")
    s.text(60, 58, "Where Panini sits in India's open-finance stack", 26, weight=700)
    s.text(60, 86, "An open-source normalization layer between raw financial documents and the systems that use them.", 15, fill=c["muted"])

    # regulatory frame
    s.rect(40, 120, 1200, 520, stroke=c["saffron"], sw=1.5, rx=14, dash="6 5")
    s.rect(60, 106, 640, 28, fill=c["saffronSoft"], stroke=c["saffron"], sw=1.2, rx=14)
    s.text(78, 125, "OPERATES WITHIN", 11, fill=c["saffronText"], weight=700, spacing="1")
    s.text(222, 125, "RBI  ·  Sahamati (AA framework)  ·  NPCI (UPI)  ·  DPDP Act, 2023", 13, fill=c["saffronText"], weight=500)

    ys = [186, 264, 342, 420, 498]
    s.text(80, 172, "DATA SOURCES", 12, fill=c["muted"], weight=700, spacing="1.2")
    s.text(960, 172, "CONSUMERS", 12, fill=c["muted"], weight=700, spacing="1.2")
    sources = [("Bank statements", "PDF · CSV · XLSX"), ("Payslips", "many employer formats"),
               ("ITR-V & Form 26AS", "income-tax documents"), ("Bank SMS", "transaction alerts"),
               ("Account Aggregator data", "consented FI payloads")]
    consumers = [("Lenders & NBFCs", "underwriting"), ("Expense & PFM apps", "categorisation"),
                 ("Reconciliation engines", "matching & ledgers"), ("FIUs on the AA network", "consented data use"),
                 ("Audit & compliance", "evidence trails")]
    for (t, sub), y in zip(sources, ys):
        s.rect(80, y, 260, 62, fill=c["card"], stroke=c["border"])
        s.rect(80, y, 4, 62, fill=c["slate"], rx=2)
        s.text(100, y + 27, t, 15, weight=600)
        s.text(100, y + 46, sub, 12, fill=c["muted"])
        s.path(f"M340,{y+31} L356,{y+31}", c["slate"])
    for (t, sub), y in zip(consumers, ys):
        s.rect(960, y, 260, 62, fill=c["card"], stroke=c["border"])
        s.rect(1216, y, 4, 62, fill=c["green"], rx=2)
        s.text(980, y + 27, t, 15, weight=600)
        s.text(980, y + 46, sub, 12, fill=c["muted"])
        s.path(f"M944,{y+31} L960,{y+31}", c["green"])
    s.path("M356,217 L356,529", c["slate"])
    s.path("M944,217 L944,529", c["green"])

    s.arrow(356, 373, 474, 373, "slate")
    s.text(415, 345, "raw, inconsistent", 12, fill=c["muted"], anchor="middle")
    s.text(415, 360, "formats", 12, fill=c["muted"], anchor="middle")
    s.arrow(800, 373, 940, 373, "green")
    s.text(872, 345, "clean typed data", 12, fill=c["greenText"], anchor="middle", weight=600)
    s.text(872, 360, "+ evidence", 12, fill=c["greenText"], anchor="middle", weight=600)

    # Panini core
    s.rect(480, 200, 320, 310, fill=c["indigoFill"], rx=12, shadow=True)
    s.text(640, 248, "Panini", 30, fill=c["onFill"], weight=700, anchor="middle")
    s.text(640, 274, "open-source normalization layer", 14, fill=c["onFill"], anchor="middle", opacity=0.85)
    rows = ["Extraction", "Integrity forensics", "Narration grammar engine", "Insights & fraud indicators"]
    for i, r in enumerate(rows):
        y = 296 + i * 50
        s.rect(500, y, 280, 42, fill="#FFFFFF", rx=8, opacity=0.13)
        s.text(518, y + 27, f"0{i+1}", 12, fill=c["onFill"], mono=True, opacity=0.7)
        s.text(548, y + 27, r, 15, fill=c["onFill"], weight=500)
    s.rect(510, 524, 260, 30, fill=c["indigoSoft"], stroke=c["indigo"], sw=1.2, rx=15)
    s.text(640, 544, "Apache-2.0  ·  runs in your process", 13, fill=c["indigoText"], anchor="middle", weight=600)

    # contribution loop
    s.path("M1090,560 L1090,600 L640,600 L640,562", c["green"], dash="5 4", marker="green")
    s.text(865, 592, "community grammar contributions", 12, fill=c["greenText"], anchor="middle", italic=True)

    s.caption(686, "Public infrastructure for the data layer — like UPI, one level down.")
    return s.render()


# ---------------------------------------------------------------- V3 pipeline
def pipeline(c):
    s = S(1280, 640, c, "Document in, auditable credit file out",
          "Six-stage pipeline: extract, forensics, rules-engine, insights, standards-schema, bsa report. Entry points: browser, fiu-client, simulator, and panini-py. "
          "Every claim carries a rule_id and evidence indices.")
    s.text(40, 56, "Document in → auditable credit file out", 26, weight=700)
    s.text(40, 84, "Six packages, one deterministic pipeline. Each stage is usable on its own.", 15, fill=c["muted"])
    stages = [("Extract", "extract", ["Bank statements", "Credit cards · UPI apps", "Payslips · ITR-V · 26AS"]),
              ("Verify", "forensics", ["PDF structure checks", "Signature checks", "Balance-chain maths"]),
              ("Classify", "rules-engine", ["Narration grammar", "→ channel · merchant", "→ VPA · category"]),
              ("Analyse", "insights", ["Income · FOIR", "Fraud indicators", "Multi-account view"]),
              ("Validate", "standards-schema", ["AA · ONDC · OCEN", "schema validators"]),
              ("Report", "bsa", ["JSON + Markdown", "credit-file report", "with evidence"])]
    for i, (t, pkg, lines) in enumerate(stages):
        x = 40 + i * 204
        last = i == len(stages) - 1
        s.rect(x, 120, 180, 200, fill=c["indigoSoft"] if last else c["card"],
               stroke=c["indigo"] if last else c["border"], shadow=last)
        s.circle(x + 26, 150, 13, c["indigoFill"])
        s.text(x + 26, 155, str(i + 1), 13, fill=c["onFill"], weight=700, anchor="middle")
        s.text(x + 48, 156, t, 17, weight=700)
        s.text(x + 18, 192, pkg, 13, fill=c["indigoText"], mono=True, weight=600)
        s.path(f"M{x+18},206 L{x+162},206", c["border"])
        for j, ln in enumerate(lines):
            s.text(x + 18, 232 + j * 22, ln, 13, fill=c["text"])
        if not last:
            s.arrow(x + 182, 220, x + 202, 220, "indigo", sw=2)

    # ways in
    s.arrow(130, 356, 130, 326, "slate")
    s.rect(40, 356, 1200, 96, fill=c["slateSoft"], stroke=c["border"], rx=10)
    s.text(58, 378, "WAYS IN", 11, fill=c["muted"], weight=700, spacing="1.2")
    chips = [("browser", "in-browser, nothing uploaded"), ("fiu-client", "AA consent → fetch → decrypt"),
             ("simulator", "synthetic test statements"), ("panini-py", "Python package, same outputs")]
    for i, (pkg, d) in enumerate(chips):
        x = 56 + i * 297
        s.rect(x, 388, 280, 50, fill=c["card"], stroke=c["border"])
        s.text(x + 16, 409, pkg, 13, fill=c["indigoText"], mono=True, weight=600)
        s.text(x + 16, 428, d, 12, fill=c["muted"])

    # evidence strip
    s.rect(40, 480, 1200, 86, fill=c["indigoSoft"], stroke=c["indigo"], sw=1.2, rx=10)
    s.text(64, 512, "Every claim carries a rule_id and evidence indices", 15, weight=700, fill=c["indigoText"])
    s.text(64, 544, "income_detected: ₹85,000/month  →  rule: PANINI-INC-001  →  evidence: [txn 12, 31, 58]", 14, mono=True)
    s.text(1216, 544, "illustrative values", 12, fill=c["muted"], anchor="end", italic=True)

    s.caption(608, "Deterministic. Offline-capable. Auditable.")
    return s.render()


# ---------------------------------------------------------------- V2+V5 privacy
def privacy(c):
    s = S(1280, 680, c, "Where does your customer's data go?",
          "Left: with a hosted parsing API, the customer statement leaves your perimeter for a third-party service and its storage and subprocessors. "
          "Right: with Panini running in-process, the statement, the Panini library and the typed output all stay inside your perimeter. "
          "Core packages contain no networking code; the optional fiu-client connects only to the Account Aggregator you configure.")
    s.text(40, 56, "Where does your customer's data go?", 26, weight=700)
    s.text(40, 84, "Same statement, two architectures. The difference is the boundary it crosses.", 15, fill=c["muted"])

    s.text(60, 134, "HOSTED PARSING API", 12, fill=c["muted"], weight=700, spacing="1.2")
    s.text(680, 134, "PANINI, IN-PROCESS", 12, fill=c["indigoText"], weight=700, spacing="1.2")

    # left
    s.rect(60, 150, 220, 300, stroke=c["slate"], dash="6 5", rx=12)
    s.text(78, 174, "Your perimeter", 12, fill=c["muted"])
    s.rect(78, 255, 184, 80, fill=c["card"], stroke=c["border"])
    s.text(96, 287, "Your system", 15, weight=600)
    s.text(96, 310, "customer statement", 12, fill=c["muted"], mono=True)
    s.arrow(262, 295, 406, 295, "red", sw=2)
    s.text(345, 262, "statement leaves", 12, fill=c["redText"], anchor="middle", weight=600)
    s.text(345, 277, "your perimeter", 12, fill=c["redText"], anchor="middle", weight=600)
    s.rect(410, 240, 200, 110, fill=c["card"], stroke=c["border"])
    s.text(428, 278, "Third-party", 15, weight=600)
    s.text(428, 298, "parsing service", 15, weight=600)
    s.text(428, 326, "per-report pricing", 12, fill=c["muted"])
    s.arrow(510, 350, 510, 388, "slate")
    s.rect(410, 392, 200, 58, fill=c["card"], stroke=c["border"])
    s.text(428, 416, "Vendor storage &", 13)
    s.text(428, 435, "subprocessors", 13)
    notes_l = [("red", "Data crosses your perimeter"), ("slate", "Processor contracts, audits, breach exposure"),
               ("slate", "Logic is whatever the API exposes")]
    for i, (col, t) in enumerate(notes_l):
        y = 500 + i * 30
        s.circle(70, y - 5, 4, c[col])
        s.text(84, y, t, 14)

    # divider
    s.path("M640,120 L640,580", c["border"])
    s.circle(640, 300, 18, c["bg"], stroke=c["border"])
    s.text(640, 305, "vs", 13, fill=c["muted"], anchor="middle", weight=600)

    # right
    s.rect(680, 150, 540, 300, fill=c["greenSoft"], stroke=c["green"], sw=2, dash="6 5", rx=12)
    s.text(698, 174, "Your perimeter — nothing leaves", 12, fill=c["greenText"], weight=600)
    s.rect(705, 196, 490, 228, fill=c["card"], stroke=c["border"], shadow=True)
    s.text(725, 226, "Your system", 15, weight=600)
    s.rect(725, 270, 120, 76, fill=c["slateSoft"], stroke=c["border"])
    s.text(741, 302, "Statement", 14, weight=600)
    s.text(741, 324, "PDF · CSV · AA", 12, fill=c["muted"])
    s.arrow(847, 308, 876, 308, "indigo", sw=2)
    s.rect(880, 270, 160, 76, fill=c["indigoFill"])
    s.text(960, 302, "Panini", 17, fill=c["onFill"], weight=700, anchor="middle")
    s.text(960, 324, "in-process library", 12, fill=c["onFill"], anchor="middle", opacity=0.85)
    s.arrow(1042, 308, 1071, 308, "green", sw=2)
    s.rect(1075, 270, 110, 76, fill=c["greenSoft"], stroke=c["green"])
    s.text(1130, 302, "Typed data", 13, weight=600, anchor="middle")
    s.text(1130, 324, "+ evidence", 12, fill=c["muted"], anchor="middle")
    s.text(950, 390, "Core packages contain no networking code.", 13, fill=c["muted"], anchor="middle")
    notes_r = ["Data stays inside your perimeter", "No third party receives the statement",
               "Every flag traceable to rows and source"]
    for i, t in enumerate(notes_r):
        y = 500 + i * 30
        s.circle(690, y - 5, 4, c["green"])
        s.text(704, y, t, 14)

    s.text(640, 614, "The optional fiu-client connects only to the Account Aggregator you configure.", 12, fill=c["muted"], anchor="middle")
    s.caption(650, "Same output. Different boundary.")
    return s.render()


# ---------------------------------------------------------------- V6+V9 evidence chain
def evidence(c):
    s = S(1280, 720, c, "A flag you can replay",
          "A risk signal about a same-amount in/out pair marked medium severity traces to rule PANINI-FRD-CIRC-001, which cites two transactions: txn 12, a debit of 40,000 rupees on 3 March, "
          "and txn 31, a credit of 39,500 rupees on 5 March from the same counterparty, located on page 2 of the source statement with the balance chain verified. Illustrative example.")
    s.text(40, 56, "A flag you can replay", 26, weight=700)
    s.text(40, 84, "Every risk signal traces to the rule that fired and the exact statement rows behind it.", 15, fill=c["muted"])
    X, W = 180, 620

    # L1
    s.rect(X, 120, W, 64, fill=c["card"], stroke=c["saffron"], sw=1.5, shadow=True)
    s.text(X + 24, 158, "riskSignals[0] · same-amount in/out pair", 16, mono=True, weight=600)
    s.rect(X + W - 110, 139, 88, 26, fill=c["saffronSoft"], stroke=c["saffron"], sw=1.2, rx=13)
    s.text(X + W - 66, 157, "MEDIUM", 12, fill=c["saffronText"], weight=700, anchor="middle", spacing="0.8")
    s.arrow(X + W / 2, 186, X + W / 2, 220, "muted")
    # L2
    s.rect(X, 224, W, 64, fill=c["card"], stroke=c["border"])
    s.text(X + 24, 262, "ruleId: PANINI-FRD-CIRC-001", 16, mono=True, weight=600, fill=c["indigoText"])
    s.text(X + W - 24, 262, "open rule definition", 12, fill=c["muted"], anchor="end", italic=True)
    s.arrow(X + W / 2, 290, X + W / 2, 324, "muted")
    # L3
    s.rect(X, 328, W, 170, fill=c["card"], stroke=c["border"])
    s.text(X + 24, 358, "evidence: [txn 12, txn 31]", 16, mono=True, weight=600)
    hy = 390
    for lbl, xx, anc in [("#", X + 24, "start"), ("DATE", X + 64, "start"), ("NARRATION", X + 150, "start"), ("AMOUNT", X + W - 24, "end")]:
        s.text(xx, hy, lbl, 11, fill=c["muted"], weight=700, anchor=anc, spacing="1")
    s.path(f"M{X+20},{hy+9} L{X+W-20},{hy+9}", c["border"])
    rows = [("12", "03 Mar", "UPI/DR/A SHARMA/xxxx@upi", "−₹40,000.00", "redText"),
            ("31", "05 Mar", "UPI/CR/A SHARMA/xxxx@upi", "+₹39,500.00", "greenText")]
    for i, (n, d, nar, amt, col) in enumerate(rows):
        y = 408 + i * 44
        s.rect(X + 16, y, W - 32, 36, fill=c["slateSoft"], rx=6)
        s.text(X + 24, y + 23, n, 13, mono=True, weight=600)
        s.text(X + 64, y + 23, d, 13)
        s.text(X + 150, y + 23, nar, 13, mono=True)
        s.text(X + W - 24, y + 23, amt, 13, mono=True, weight=600, fill=c[col], anchor="end")
    s.arrow(X + W / 2, 500, X + W / 2, 534, "muted")
    # L4
    s.rect(X, 538, W, 70, fill=c["greenSoft"], stroke=c["green"])
    s.text(X + 24, 566, "source: statement.pdf · page 2 · rows 12 and 31", 15, mono=True)
    s.text(X + 24, 592, "✓  balance chain verified across both rows", 13, fill=c["greenText"], weight=600)

    # annotations
    ann = [(152, "The flag", "what the report says"), (256, "The rule", "which open rule fired"),
           (413, "The rows", "the exact transactions"), (573, "The source", "where they sit in the document")]
    for i, (y, t, sub) in enumerate(ann):
        s.path(f"M{X+W+4},{y} L{X+W+52},{y}", c["border"], dash="3 4")
        s.circle(X + W + 72, y, 14, c["indigoSoft"], stroke=c["indigo"], sw=1.2)
        s.text(X + W + 72, y + 5, str(i + 1), 13, fill=c["indigoText"], weight=700, anchor="middle")
        s.text(X + W + 98, y - 2, t, 16, weight=700)
        s.text(X + W + 98, y + 18, sub, 13, fill=c["muted"])

    s.caption(668, "Every flag is a receipt, not a verdict.")
    s.text(640, 696, "Illustrative example. Field names and rule IDs shown are representative.", 12, fill=c["muted"], anchor="middle")
    return s.render()


ASSETS = {"panini-ecosystem": ecosystem, "panini-pipeline": pipeline,
          "panini-privacy-boundary": privacy, "panini-evidence-chain": evidence}

if __name__ == "__main__":
    for name, fn in ASSETS.items():
        for theme, c in THEMES.items():
            svg = fn(c)
            p = f"{OUT}/{name}-{theme}.svg"
            open(p, "w").write(svg)
    print("done")

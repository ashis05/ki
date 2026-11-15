"""Generate the README header: an energy orb charging over an open palm.

    npm install                      # Geist fonts come from node_modules/geist
    pip install fonttools
    python docs/readme/make_svg.py

Writes header.svg (1200x500) and header-mobile.svg (600x900) next to this file.
Lettering is converted to outlines (GitHub shows SVGs as <img>, which can't
load web fonts). The orb is animated with CSS and SMIL: it rotates, pulses,
and cycles through the five palettes a pinch switches between.
Fonts: Geist (node_modules/geist) and Noto Sans CJK JP for 気
(override with KI_CJK_FONT).
"""

import math
import os
import random
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTCollection, TTFont

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
GEIST = ROOT / "node_modules/geist/dist/fonts"
CJK = Path(os.environ.get("KI_CJK_FONT", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc"))

BG0, BG1 = "#04060d", "#0c1430"
FG, MUTED, LINE = "#e8eefc", "#8e9ab8", "#24304f"
# palettes in the order a pinch cycles them: (core, mid, deep)
PALETTES = [
    ("#e6f6ff", "#2f9bff", "#0b3c8c"),  # azure
    ("#ffe6e6", "#ff3b4e", "#7a0d1e"),  # crimson
    ("#f1e6ff", "#a35bff", "#3f1287"),  # violet
    ("#fff6dc", "#ffbf2f", "#8a5200"),  # gold
    ("#eaffdf", "#5dff3b", "#1c6e08"),  # toxic green
]
LOOP = 15  # seconds for one trip through all palettes

ICONS = {  # same 24x24 icons as the landing page
    "Open palm": '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    "Fist": '<path d="M5.5 10.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2V15a5.5 5.5 0 0 1-5.5 5.5h-2A5.5 5.5 0 0 1 5.5 15zM9 8.5V12M12 8.5V12M15 8.5V12M5.5 14.5H12"/>',
    "Push": '<circle cx="8" cy="16" r="3.5"/><path d="M12.5 11.5L20 4M14 4h6v6"/>',
    "Pinch": '<circle cx="9.5" cy="12" r="2"/><circle cx="14.5" cy="12" r="2"/><path d="M3 12h2.5M18.5 12H21M12 5v2M12 17v2"/>',
    "Two hands": '<circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/>',
}
SUBS = ["charge", "collapse", "launch", "colour", "merge"]


def ttf(name):
    return TTFont(str(GEIST / name))


def cjk():
    for f in TTCollection(str(CJK)).fonts:
        if "JP" in f["name"].getDebugName(1):
            return f
    raise SystemExit(f"no JP face in {CJK}")


SANS_BOLD = ttf("geist-sans/Geist-Bold.ttf")
SANS_MED = ttf("geist-sans/Geist-Medium.ttf")
MONO = ttf("geist-mono/GeistMono-Regular.ttf")
KANJI = cjk()


def outline(font, text, size, x, y, anchor="start", tracking=0.0):
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    k = size / font["head"].unitsPerEm
    names = [cmap.get(ord(c), ".notdef") for c in text]
    adv = [gs[n].width * k + tracking for n in names]
    total = sum(adv) - (tracking if names else 0)
    if anchor == "middle":
        x -= total / 2
    elif anchor == "end":
        x -= total
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}")
    for n, a in zip(names, adv):
        gs[n].draw(TransformPen(pen, (k, 0, 0, -k, x, y)))
        x += a
    return pen.getCommands(), total


def P(d, fill=FG, extra=""):
    return f'<path d="{d}" fill="{fill}"{extra}/>'


def anim_colors(i):
    vals = ";".join(p[i] for p in PALETTES + PALETTES[:1])
    n = len(PALETTES)
    # hold each palette, then blend quickly to the next
    times = []
    for j in range(n):
        times += [j / n, (j + 0.82) / n]
    times.append(1)
    holds = []
    for j in range(n):
        holds += [PALETTES[j][i], PALETTES[j][i]]
    holds.append(PALETTES[0][i])
    return (f'<animate attributeName="stop-color" dur="{LOOP}s" repeatCount="indefinite" '
            f'values="{";".join(holds)}" keyTimes="{";".join(f"{t:.3f}" for t in times)}"/>')


def defs():
    c, m, d = PALETTES[0]
    return f"""<defs>
<radialGradient id="bg" cx="30%" cy="45%" r="85%"><stop offset="0" stop-color="{BG1}"/><stop offset="1" stop-color="{BG0}"/></radialGradient>
<radialGradient id="core" cx="45%" cy="40%" r="60%">
  <stop offset="0" stop-color="#ffffff"/>
  <stop offset=".28" stop-color="{c}">{anim_colors(0)}</stop>
  <stop offset=".7" stop-color="{m}">{anim_colors(1)}</stop>
  <stop offset="1" stop-color="{d}">{anim_colors(2)}</stop>
</radialGradient>
<radialGradient id="glow" r="50%">
  <stop offset="0" stop-color="{m}" stop-opacity=".75">{anim_colors(1)}</stop>
  <stop offset=".45" stop-color="{m}" stop-opacity=".22">{anim_colors(1)}</stop>
  <stop offset="1" stop-color="{m}" stop-opacity="0">{anim_colors(1)}</stop>
</radialGradient>
<linearGradient id="arm" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
<clipPath id="ball"><circle r="1"/></clipPath>
</defs>"""


def style():
    n = len(SUBS)
    return f"""<style>
.spin{{animation:spin 6s linear infinite;transform-origin:0 0}}
.spin2{{animation:spin 9s linear infinite reverse;transform-origin:0 0}}
.orbit{{animation:spin 14s linear infinite;transform-origin:0 0}}
.orbit2{{animation:spin 22s linear infinite reverse;transform-origin:0 0}}
.pulse{{animation:pulse 2.4s ease-in-out infinite;transform-origin:0 0}}
.tw{{animation:tw 3s ease-in-out infinite}}
.g .box{{animation:hl {n * 1.6}s infinite}} .g .ic{{animation:ic {n * 1.6}s infinite}}
{"".join(f".g{j} .box,.g{j} .ic{{animation-delay:{j * 1.6:.1f}s}}" for j in range(n))}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
@keyframes pulse{{0%,100%{{transform:scale(1)}}50%{{transform:scale(1.06)}}}}
@keyframes tw{{0%,100%{{opacity:.15}}50%{{opacity:.9}}}}
@keyframes hl{{0%,18%{{stroke:{PALETTES[0][1]};fill:rgba(47,155,255,.12)}}22%,100%{{stroke:{LINE};fill:rgba(120,160,255,.03)}}}}
@keyframes ic{{0%,18%{{stroke:#ffffff}}22%,100%{{stroke:{PALETTES[0][1]}}}}}
@media (prefers-reduced-motion:reduce){{.spin,.spin2,.orbit,.orbit2,.pulse,.tw,.g .box,.g .ic{{animation:none}}}}
</style>"""


def stars(W, H, n, seed=3):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        x, y, r = rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(0.5, 1.4)
        delay = rnd.uniform(0, 3)
        out.append(f'<circle class="tw" cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="#cfe0ff" style="animation-delay:{delay:.1f}s"/>')
    return "".join(out)


def spiral_arm(R, turns, phase, width):
    """A tapering spiral arm from the centre to the rim, as a filled path."""
    pts_a, pts_b = [], []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        a = phase + t * turns * math.tau
        r = R * (0.08 + 0.9 * t)
        w = width * math.sin(math.pi * min(1, t * 1.15)) + 0.5
        nx, ny = math.cos(a + math.pi / 2), math.sin(a + math.pi / 2)
        x, y = math.cos(a) * r, math.sin(a) * r
        pts_a.append((x + nx * w, y + ny * w))
        pts_b.append((x - nx * w, y - ny * w))
    pts = pts_a + pts_b[::-1]
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z"


def orb(cx, cy, R, seed=11):
    rnd = random.Random(seed)
    s = [f'<g transform="translate({cx} {cy})">']
    # open palm under the orb, faint
    s.append(f'<g transform="translate({-R * 0.96:.0f} {R * 0.32:.0f}) scale({R * 0.08:.3f})" fill="none" stroke="{PALETTES[0][1]}" '
             f'stroke-opacity=".35" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">{ICONS["Open palm"]}</g>')
    s.append(f'<g class="pulse"><circle r="{R * 2.3:.0f}" fill="url(#glow)"/>')
    s.append(f'<circle r="{R}" fill="url(#core)"/>')
    # swirl arms clipped to the ball
    arms = " ".join(spiral_arm(R, 0.85, k * math.tau / 3, R * 0.16) for k in range(3))
    fine = " ".join(spiral_arm(R, 1.2, k * math.tau / 5 + 0.4, R * 0.05) for k in range(5))
    s.append(f'<g clip-path="url(#ballc)"><g class="spin"><path d="{arms}" fill="#fff" opacity=".55" filter="url(#soft)"/></g>'
             f'<g class="spin2"><path d="{fine}" fill="#fff" opacity=".35"/></g></g>')
    s.append(f'<circle r="{R * 0.32:.0f}" fill="#fff" opacity=".85" filter="url(#blur)"/>')
    s.append(f'<circle r="{R}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/></g>')
    # orbiting particles on two tilted rings
    for cls, rx, ry, rot, n in [("orbit", 1.55, 0.42, -18, 26), ("orbit2", 1.9, 0.55, 24, 34)]:
        dots = []
        for i in range(n):
            a = i / n * math.tau + rnd.uniform(-0.08, 0.08)
            dots.append(f'<circle cx="{math.cos(a) * R * rx:.1f}" cy="{math.sin(a) * R * rx:.1f}" r="{rnd.uniform(0.8, 2.4):.1f}" fill="#fff" opacity="{rnd.uniform(.35, .95):.2f}"/>')
        # rotate inside, then squash to an ellipse and tilt
        s.append(f'<g transform="rotate({rot}) scale(1 {ry / rx:.3f})"><g class="{cls}">{"".join(dots)}</g></g>')
    s.append("</g>")
    clip = f'<clipPath id="ballc"><circle cx="0" cy="0" r="{R}"/></clipPath>'
    return clip, "".join(s)


def gestures(x, y, w, h):
    n = len(ICONS)
    gap = 10
    cw = (w - gap * (n - 1)) / n
    out = []
    for j, (name, icon) in enumerate(ICONS.items()):
        gx = x + j * (cw + gap)
        d, _ = outline(SANS_MED, name, 15, gx + cw / 2, y + h - 34, anchor="middle")
        sd, _ = outline(MONO, SUBS[j], 11.5, gx + cw / 2, y + h - 15, anchor="middle")
        out.append(
            f'<g class="g g{j}"><rect class="box" x="{gx:.1f}" y="{y}" width="{cw:.1f}" height="{h}" rx="14" stroke="{LINE}" stroke-width="1.2" fill="rgba(120,160,255,.03)"/>'
            f'<g class="ic" transform="translate({gx + cw / 2 - 14:.1f} {y + 14}) scale(1.17)" fill="none" stroke="{PALETTES[0][1]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{icon}</g>'
            f'{P(d)}{P(sd, MUTED)}</g>'
        )
    return "".join(out)


def build(mobile):
    W, H = (600, 900) if mobile else (1200, 500)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
         f'aria-label="Ki: an energy orb charging over an open palm, cycling through five colours, above the five gestures: open palm, fist, push, pinch, two hands">']
    if mobile:
        ocx, ocy, R = W / 2, 215, 92
        tx, ty, anchor = W / 2, 560, "middle"
    else:
        ocx, ocy, R = 300, 230, 100
        tx, ty, anchor = 590, 150, "start"
    clip, orb_svg = orb(ocx, ocy, R)
    o.append(defs().replace("</defs>", clip + "</defs>"))
    o.append(style())
    o.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    o.append(stars(W, H, 70 if mobile else 110))
    o.append(orb_svg)

    # wordmark: Ki + 気
    ksz = 120 if mobile else 140
    kd, kw = outline(SANS_BOLD, "Ki", ksz, tx, ty, anchor=anchor, tracking=-4)
    o.append(P(kd))
    kx = (tx + kw / 2 + 14) if mobile else (tx + kw + 18)
    jd, _ = outline(KANJI, "気", ksz * 0.36, kx, ty - ksz * 0.36)
    o.append(P(jd, PALETTES[0][1]))
    lines = ["Hold up your hand and charge an", "orb of energy in your palm."]
    for i, line in enumerate(lines):
        d, _ = outline(SANS_MED, line, 23 if mobile else 25, tx, ty + 52 + i * 33, anchor=anchor)
        o.append(P(d, "#cfd6e6"))
    md, _ = outline(MONO, "on-device hand tracking · MediaPipe · three.js · nothing uploaded",
                    11.5 if mobile else 12.5, tx, ty + 52 + 2 * 33 + 10, anchor=anchor)
    o.append(P(md, MUTED))

    if mobile:
        o.append(gestures(28, H - 148, W - 56, 104))
        fd, _ = outline(MONO, "ki.ashiswadhwani.in", 12.5, W / 2, H - 22, anchor="middle")
    else:
        o.append(gestures(tx, H - 172, W - tx - 48, 104))
        fd, _ = outline(MONO, "ki.ashiswadhwani.in", 12.5, W - 48, 48, anchor="end")
    o.append(P(fd, MUTED))
    o.append("</svg>")
    return "\n".join(o)


if __name__ == "__main__":
    for mobile, name in [(False, "header.svg"), (True, "header-mobile.svg")]:
        (HERE / name).write_text(build(mobile), encoding="utf-8")
        print("wrote", HERE / name, f"{(HERE / name).stat().st_size / 1024:.0f} KB")

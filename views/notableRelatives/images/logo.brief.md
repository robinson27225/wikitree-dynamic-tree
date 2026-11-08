# Notable Relatives logo: brief and provenance

Chosen 2026-11-08 from three concepts (A star in the tree, B shared-ancestor arch, C laurel and tree), compared on
light and dark backgrounds at 200, 48, 32 and 16 px next to the Cemetery Map icon.

Recraft was not connected in the session, so the logo was drawn by hand as SVG (generator below), at the same bar.

```
Subject:     a gold star among the branches of a family tree: one notable among your relatives
Style:       flat vector mark, WikiTree app family (dark-green rounded tile, like Cemetery Map)
Palette:     #234a2b tile/green, #e8f4d6 canopy and trunk, #9fc27a relative dots, #fbb616 star, #d99400 star edge
Background:  dark-green rounded tile (notable-relatives-logo); transparent mark without tile (notable-relatives-mark)
Output:      SVG, viewBox 0 0 512 512; PNG 512/192/32 exported from the tile SVG with qlmanage
Size:        512 x 512
Variants:    tile and no-tile
```

Files: `notable-relatives-logo.svg` (tile, used in the view header), `notable-relatives-mark.svg` (no tile, for
light backgrounds), `notable-relatives-logo-512.png`, `-192.png`, `-32.png`. SVGs cleaned with svgo 3.3.2
(`removeViewBox` and `removeTitle` turned off, so the mark scales and keeps its name).

## Generator (Python 3, writes the uncleaned SVGs)

```python
import math
G="#234a2b"; GOLD="#fbb616"; GOLDD="#d99400"; L1="#e8f4d6"; L2="#c9deaa"; LDOT="#9fc27a"
def star(cx,cy,R,r=None,rot=-90):
    r=r or R*0.45
    return " ".join(f"{cx+(R if i%2==0 else r)*math.cos(math.radians(rot+i*36)):.1f},{cy+(R if i%2==0 else r)*math.sin(math.radians(rot+i*36)):.1f}" for i in range(10))
def svg(body, tile=True):
    bg=f'<rect x="16" y="16" width="480" height="480" rx="104" fill="{G}"/>' if tile else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Notable Relatives"><title>Notable Relatives</title>{bg}{body}</svg>\n'
def STAR(cx,cy,R): return f'<polygon points="{star(cx,cy,R)}" fill="{GOLD}" stroke="{GOLDD}" stroke-width="6" stroke-linejoin="round"/>'

def tree(cx=256, cy=0, s=1.0, canopy=L1, dot=LDOT, trunk=L1, starR=70):
    T=lambda x,y:(cx+(x-256)*s, cy+y*s)
    circles=[(256,206,118),(160,252,84),(352,252,84),(196,146,84),(316,146,84),(256,290,90)]
    c="".join('<circle cx="%.1f" cy="%.1f" r="%.1f"/>'%(*T(x,y),r*s) for x,y,r in circles)
    d="".join('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>'%(*T(x,y),15*s,dot) for x,y in [(150,250),(362,250),(196,150),(318,150),(206,312),(306,312)])
    (tx,ty0)=T(256,330); (_,ty1)=T(256,450); (bx1,by1)=T(198,348); (bx2,by2)=T(314,326); (_,j1)=T(256,392); (_,j2)=T(256,372)
    tr=f'<path d="M{tx:.1f} {ty1:.1f}V{ty0:.1f}M{tx:.1f} {j1:.1f}L{bx1:.1f} {by1:.1f}M{tx:.1f} {j2:.1f}L{bx2:.1f} {by2:.1f}" fill="none" stroke="{trunk}" stroke-width="{34*s:.1f}" stroke-linecap="round" stroke-linejoin="round"/>'
    sx,sy=T(256,214)
    return tr+f'<g fill="{canopy}">{c}</g>{d}'+STAR(sx,sy,starR*s)

# A: tree with a star, on the tile
A=svg(tree(cy=20, s=0.86, starR=74))
A_plain=svg(tree(canopy=G, dot=L2, trunk=G, starR=74), tile=False)

open("notable-relatives-logo.svg", "w").write(A)
open("notable-relatives-mark.svg", "w").write(A_plain)
```

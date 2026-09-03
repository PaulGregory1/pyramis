// Regénère les déclinaisons de marque depuis les deux originaux de public/brand/.
// À relancer si logo-pyr.png ou brand-pyr.png change. Nécessite Python et Pillow —
// c'est un outil d'atelier, pas une dépendance de l'app : rien ici ne tourne au
// démarrage, et les fichiers produits sont versionnés avec le reste.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = `
from PIL import Image
import os
os.chdir(${JSON.stringify(root)})

# Le mot-symbole : rogner la marge, rendre le fond transparent. L'alpha vient de la
# luminance, donc les bords restent lissés au lieu de se découper en escalier.
b = Image.open("public/brand/brand-pyr.png").convert("RGB")
px = b.load(); w, h = b.size
xs = [x for y in range(h) for x in range(w) if sum(px[x, y]) < 400]
ys = [y for y in range(h) for x in range(w) if sum(px[x, y]) < 400]
pad = 6
crop = b.crop((max(0, min(xs) - pad), max(0, min(ys) - pad),
               min(w, max(xs) + pad + 1), min(h, max(ys) + pad + 1)))
ink = Image.new("RGBA", crop.size, (0, 8, 35, 255))
ink.putalpha(crop.convert("L").point(lambda v: 255 - v))
# La hauteur est la mesure, pas la largeur : la feuille de style pose
# .wordmark { height: 12px }, donc c'est elle qui fixe la taille des lettres à
# l'écran. Un mot plus court rendu à largeur constante grossirait d'autant.
th = 85
ink.resize((round(ink.width * th / ink.height), th), Image.LANCZOS).save("public/brand/wordmark.png")

# Le logo du graphe : même travail que le mot-symbole, mais la couleur est le sujet.
# L'original est peint sur du blanc opaque, donc l'alpha se déduit du canal le plus
# sombre (255 - min), puis on démultiplie pour retrouver le violet plein — sans quoi
# le losange sortirait délavé de moitié. Les bords lissés gardent leur dégradé.
g = Image.open("public/brand/graph-pyr.png").convert("RGB")
gp = g.load(); gw, gh = g.size
box = [x for y in range(gh) for x in range(gw) if min(gp[x, y]) < 235], \
      [y for y in range(gh) for x in range(gw) if min(gp[x, y]) < 235]
g = g.crop((min(box[0]), min(box[1]), max(box[0]) + 1, max(box[1]) + 1))
top = max(255 - min(g.getpixel((x, y))) for y in range(g.height) for x in range(g.width))
out = Image.new("RGBA", g.size)
op = out.load(); gp = g.load()
for y in range(g.height):
    for x in range(g.width):
        r, gg, b = gp[x, y]
        a = min(255, round((255 - min(r, gg, b)) * 255 / top))
        if a == 0:
            op[x, y] = (0, 0, 0, 0); continue
        f = a / 255
        op[x, y] = tuple(max(0, min(255, round((c - 255 * (1 - f)) / f))) for c in (r, gg, b)) + (a,)
# Une seule taille, servie à 13 px dans les boutons et 17 px dans l'en-tête de la
# visionneuse : 128 laisse la marge d'un écran Retina et pèse quelques kilo-octets.
out.thumbnail((128, 128), Image.LANCZOS)
sq = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
sq.paste(out, ((128 - out.width) // 2, (128 - out.height) // 2), out)
sq.save("public/brand/graph-128.png")

# La pyramide : rognée au contenu, centrée, en trois tailles.
l = Image.open("public/brand/logo-pyr.png").convert("RGBA")
l = l.crop(l.getbbox())
for size in (256, 128, 64):
    m = l.copy(); m.thumbnail((size, size), Image.LANCZOS)
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c.paste(m, ((size - m.width) // 2, (size - m.height) // 2), m)
    c.save("public/brand/favicon.png" if size == 64 else f"public/brand/mark-{size}.png")
# Les huit pyramides de couleur : une planche 4 x 2 où chaque case porte la pyramide
# et, dessous, le mot-symbole. Seule la pyramide sert d'icône. La découpe se lit sur les
# BANDES VIDES de la planche plutôt que sur des coordonnées écrites ici : une planche
# redessinée d'un pixel les décalerait toutes les huit d'un coup, et le seul symptôme
# serait une icône rognée de travers.
c = Image.open("public/brand/colors-pyr.png").convert("RGB")
cp = c.load(); cw, ch = c.size

# Deux seuils, et ils ne disent pas la même chose. PAPER sépare l'encre du papier ; il
# est haut parce que les faces CLAIRES des pyramides le sont aussi — le sommet de la
# grise est à (229, 230, 232), à six points du blanc, et un seuil déduit de la luminance
# comme celui du losange du graphe le mangerait. DARK ne reconnaît que les faces sombres
# et ne sert qu'à une chose : trouver le bas de la base.
PAPER, DARK = 246, 190
inked = [[min(cp[x, y]) < PAPER for y in range(ch)] for x in range(cw)]
dark = [[min(cp[x, y]) < DARK for y in range(ch)] for x in range(cw)]

def runs(vals):
    out = []; s = None
    for i, v in enumerate(vals):
        if v and s is None: s = i
        if not v and s is not None: out.append((s, i - 1)); s = None
    if s is not None: out.append((s, len(vals) - 1))
    return out

rows = runs([any(inked[x][y] for x in range(cw)) for y in range(ch)])
# Quatre bandes : pyramides, mot-symbole, pyramides, mot-symbole. Les pyramides sont les
# HAUTES — c'est le seul critère qui survive à un mot plus long ou à une rangée de plus.
tall = max(b - a for a, b in rows)
bands = [(a, b) for a, b in rows if (b - a) > tall / 2]

# L'ordre de lecture de la planche, et c'est un contrat : le nom du fichier est le jeton
# qu'un projet garde dans le registre (« pyr:violet »). La même liste, dans le même
# ordre, est dans PYR de public/app.js — les deux, jamais une seule.
names = ["violet", "blue", "teal", "orange", "pink", "amber", "slate", "red"]
cells = [(x0, x1, y0, y1)
         for y0, y1 in bands
         for x0, x1 in runs([any(inked[x][y] for y in range(y0, y1 + 1)) for x in range(cw)])]
assert len(cells) == len(names), f"{len(cells)} pyramides pour {len(names)} noms"

SIZE = 128
for name, (x0, x1, y0, y1) in zip(names, cells):
    # L'ombre portée s'en va, et c'est une décision : les autres images de la marque n'en
    # ont pas, et à 17 px une tache gris pâle ne se lit pas comme une ombre mais comme une
    # jupe sale. Aucun seuil ne la sépare — elle va de 212 à 245, et le sommet de la
    # pyramide grise est à 229 — donc on la sépare par sa PLACE : dans chaque colonne,
    # l'ombre est ce qui tombe SOUS le dernier pixel sombre, c'est-à-dire sous le bas de
    # la base. Mesuré sur la planche : 25 px d'ombre dans chaque colonne des huit cases,
    # et deux colonnes au plus par pyramide — les pointes extrêmes de la base — n'ont
    # aucun pixel sombre du tout ; celles-là tombent, et cela ne se voit pas.
    mask = Image.new("L", (x1 - x0 + 1, y1 - y0 + 1), 0)
    mp = mask.load()
    for x in range(x0, x1 + 1):
        floor = max((y for y in range(y0, y1 + 1) if dark[x][y]), default=None)
        if floor is None: continue
        for y in range(y0, floor + 1):
            if inked[x][y]: mp[x - x0, y - y0] = 255
    tile = c.crop((x0, y0, x1 + 1, y1 + 1))
    # Recadrer sur le masque, l'ombre partie : sinon la case garde ses 25 px de vide en
    # bas, et la pyramide sort étirée et posée trop haut dans son carré.
    fit = mask.getbbox()
    tile = tile.crop(fit); mask = mask.crop(fit)

    # Le masque est franc à 1536 px ; c'est la RÉDUCTION qui lisse le contour, en
    # moyennant les voisins. Elle se fait en PRÉMULTIPLIÉ — le papier mis à zéro d'abord,
    # sans quoi il saignerait dans les bords lissés et les cernerait de blanc — puis on
    # démultiplie pour retrouver la couleur.
    pre = Image.new("RGB", tile.size, (0, 0, 0)); pre.paste(tile, (0, 0), mask)
    k = SIZE / max(tile.size)
    dim = (max(1, round(tile.width * k)), max(1, round(tile.height * k)))
    pre = pre.resize(dim, Image.LANCZOS); al = mask.resize(dim, Image.LANCZOS)
    out = Image.new("RGBA", dim)
    op = out.load(); pp = pre.load(); ap = al.load()
    for y in range(dim[1]):
        for x in range(dim[0]):
            a = ap[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0); continue
            op[x, y] = tuple(min(255, round(v * 255 / a)) for v in pp[x, y]) + (a,)
    sq = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sq.paste(out, ((SIZE - dim[0]) // 2, (SIZE - dim[1]) // 2), out)
    sq.save(f"public/brand/pyr-{name}.png")

print("marque regénérée")
`;
console.log(execFileSync("python3", ["-c", script], { encoding: "utf8" }).trim());

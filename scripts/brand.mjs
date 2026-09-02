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
print("marque regénérée")
`;
console.log(execFileSync("python3", ["-c", script], { encoding: "utf8" }).trim());

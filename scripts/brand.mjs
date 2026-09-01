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

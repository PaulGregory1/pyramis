// Fabrique l'icône macOS (.icns) depuis public/brand/logo-pyr.png. Aucune
// dépendance et aucun outil d'image : un PNG 8 bits RGBA se décode avec le zlib
// de la bibliothèque standard (IHDR/IDAT/IEND, cinq filtres de ligne), et un
// .icns n'est qu'un conteneur — un type sur quatre caractères, une taille en
// gros-boutiste, la charge PNG telle quelle.
//
// C'est délibérément l'inverse de scripts/brand.mjs, qui réclame Pillow : celui-là
// est un outil d'atelier lancé à la main quand le logo change, celui-ci tourne
// dans l'emballage. Un build qui exige Python est un build qui casse un jour.
//
//   node scripts/icon.mjs build/icon.icns
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public", "brand", "logo-pyr.png");

// Part de la boîte de 1024 qu'occupe la marque. 0,82 n'est pas un goût : c'est le
// rapport de la tuile arrondie d'Apple (824/1024). Une icône de forme libre qui
// le dépasse paraît plus grosse que toutes ses voisines dans le Dock.
const COVER = 0.82;

/* ------------------------------------------------------------- décodage PNG */

function readPng(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const [depth, color, , , interlace] = [b[24], b[25], b[26], b[27], b[28]];
  if (depth !== 8 || color !== 6 || interlace !== 0)
    throw new Error(`${path.basename(file)} : attendu RGBA 8 bits non entrelacé, reçu depth=${depth} color=${color} interlace=${interlace}`);

  const parts = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o), type = b.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") parts.push(b.subarray(o + 8, o + 8 + len));
    if (type === "IEND") break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));

  // Défiltrage. Chaque ligne commence par son type ; les prédicteurs travaillent
  // sur l'octet d'il y a `bpp` (à gauche) et sur la ligne du dessus.
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const bb = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      } else if (ft !== 0) throw new Error(`filtre PNG inconnu : ${ft}`);
      cur[i] = v & 255;
    }
  }
  return { w, h, rgba: out };
}

/* ------------------------------------------------------------- encodage PNG */

const crc32 = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filtre : aucun
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- rendu */

// La marge du fichier d'origine n'est pas la nôtre : on repart du contenu.
function bbox({ w, h, rgba }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error("la source est entièrement transparente");
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Rééchantillonnage par moyenne de surface, en couleurs prémultipliées. La
// prémultiplication n'est pas un détail : sans elle, un pixel de bord moyenne la
// couleur de voisins invisibles et la marque se borde d'un halo.
function render(src, box, size) {
  const cover = Math.round(size * COVER);
  const scale = cover / Math.max(box.w, box.h);
  const dw = Math.max(1, Math.round(box.w * scale)), dh = Math.max(1, Math.round(box.h * scale));
  const ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
  const out = Buffer.alloc(size * size * 4);

  for (let dy = 0; dy < dh; dy++) {
    const sy0 = box.y0 + (dy * box.h) / dh, sy1 = box.y0 + ((dy + 1) * box.h) / dh;
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = box.x0 + (dx * box.w) / dw, sx1 = box.x0 + ((dx + 1) * box.w) / dw;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        const fy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        if (fy <= 0) continue;
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const fx = Math.min(x + 1, sx1) - Math.max(x, sx0);
          if (fx <= 0) continue;
          const i = (y * src.w + x) * 4, f = fx * fy, al = src.rgba[i + 3] / 255;
          r += src.rgba[i] * al * f; g += src.rgba[i + 1] * al * f; b += src.rgba[i + 2] * al * f;
          a += src.rgba[i + 3] * f; area += f;
        }
      }
      if (!area) continue;
      const al = a / area / 255;
      const o = ((oy + dy) * size + ox + dx) * 4;
      if (al > 0) { // démultiplication : la teinte d'un bord reste la sienne
        out[o] = Math.min(255, Math.round(r / area / al));
        out[o + 1] = Math.min(255, Math.round(g / area / al));
        out[o + 2] = Math.min(255, Math.round(b / area / al));
      }
      out[o + 3] = Math.round(al * 255);
    }
  }
  return encodePng(size, size, out);
}

/* --------------------------------------------------------- ligne de commande */

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/icon.mjs <icon.icns> [--png fichier]"); process.exit(1); }

const src = readPng(SOURCE);
const box = bbox(src);

// `iconutil` a refusé des iconsets valides sur plusieurs versions de macOS. On
// écrit donc le conteneur nous-mêmes : c'est cinquante lignes de moins à débugger.
//
// Les onze emplacements, et pourquoi les onze. macOS ne redimensionne pas une
// icône : il demande un TYPE précis selon l'endroit et l'écran — `ic13` pour le
// Dock d'un Mac Retina, `ic12` pour la barre de menus, `icp4` pour une liste
// Finder compacte. Un type absent, et le système retombe sur ce qu'il trouve,
// jusqu'à l'icône générique d'application — celle qui a un fond blanc, justement.
// Les variantes @2x ne coûtent rien : elles ont la même taille en pixels que la
// version simple correspondante, donc le même PNG sert deux fois.
const TYPES = [
  [16, "icp4"], [32, "icp5"], [64, "icp6"], [128, "ic07"],
  [256, "ic08"], [512, "ic09"], [1024, "ic10"],
  [32, "ic11"],  // 16 @2x
  [64, "ic12"],  // 32 @2x
  [256, "ic13"], // 128 @2x
  [512, "ic14"], // 256 @2x
];
const images = new Map();
for (const [size] of TYPES) if (!images.has(size)) images.set(size, render(src, box, size));

const chunks = TYPES.map(([size, type]) => {
  const png = images.get(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, "ascii");
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
});
const head = Buffer.alloc(8);
head.write("icns", 0, "ascii");
head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, ...chunks]));

const i = process.argv.indexOf("--png");
if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], images.get(512));

console.log(`icône     : ${TYPES.length} emplacements, ${images.size} rendus → ${path.relative(ROOT, out)}`);

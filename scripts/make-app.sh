#!/bin/bash
# Fabrique build/Pyramis.app — Pyramis en vraie application macOS : sa fenêtre,
# son icône, sa barre de menus, son entrée dans le Dock et dans Spotlight.
#
# Aucun packager. Un bundle Electron EST le runtime de node_modules avec le code
# déposé dans Contents/Resources/app (la disposition qu'Electron cherche) et les
# métadonnées réécrites. Trois détails le font réellement démarrer :
#   · la charge n'emporte que les dépendances de production — `npm ls --omit=dev`
#     sait lesquelles, et ça garde Electron (≈300 Mo, il EST déjà le runtime) dehors ;
#   · Chromium retrouve ses processus d'aide par le CFBundleName de l'app : les
#     assistants sont renommés avec elle, sinon le rendu ne démarre jamais ;
#   · retoucher un bundle annule la signature qu'il portait, et sur Apple Silicon
#     une signature invalide est fatale — d'où la re-signature ad hoc à la fin.
#
#   ./scripts/make-app.sh            → build/Pyramis.app
#   ./scripts/make-app.sh --install  → et le copie dans /Applications
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO/build/Pyramis.app"
DIST="$REPO/node_modules/electron/dist/Electron.app"
NAME="Pyramis"
ID="com.paulgregory.pyramis"
VERSION="$(node -p "require('$REPO/package.json').version")"

case "$(node -p 'process.arch')" in
  arm64) ARCH="arm64"; MACHO="arm64" ;;
  x64)   ARCH="x64";   MACHO="x86_64" ;;
  *) echo "architecture non gérée" >&2; exit 1 ;;
esac

# Le binaire d'Electron n'est pas dans le tarball : un postinstall le télécharge.
# Cette étape saute assez souvent (--ignore-scripts, un node_modules restauré, un
# appel réseau raté que npm rapporte comme un succès) pour que « relance npm
# install » soit un mauvais conseil : il sort en 0 et laisse dist/ manquant. On
# appelle le téléchargeur nous-mêmes ; c'est un non-événement s'il est déjà là.
if [ ! -d "$DIST" ]; then
  [ -f "$REPO/node_modules/electron/install.js" ] \
    || { echo "Electron absent de node_modules — lance d'abord : npm install" >&2; exit 1; }
  echo "runtime   : téléchargement d'Electron ($ARCH)…"
  npm_config_arch="$ARCH" node "$REPO/node_modules/electron/install.js"
  [ -d "$DIST" ] || { echo "le téléchargement d'Electron a échoué" >&2; exit 1; }
fi

plist() { # plist <fichier> <clé> <valeur> — pose la clé, ou l'ajoute si elle est neuve
  /usr/libexec/PlistBuddy -c "Set :$2 $3" "$1" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$2 string $3" "$1" >/dev/null
}

rm -rf "$APP"
mkdir -p "$REPO/build"
cp -R "$DIST" "$APP"
echo "runtime   : Electron $(cat "$REPO/node_modules/electron/dist/version") ($ARCH)"

# ---- identité ---------------------------------------------------------------
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$NAME"
rm -f "$APP/Contents/Resources/electron.icns"
# Notre code vit dans Resources/app ; la fenêtre d'accueil d'Electron ne doit
# jamais servir de repli s'il échouait à charger — et son hash est scellé dans
# le plist, qu'on retire avec elle.
rm -f "$APP/Contents/Resources/default_app.asar"
/usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "$APP/Contents/Info.plist" 2>/dev/null || true

PL="$APP/Contents/Info.plist"
plist "$PL" CFBundleName "$NAME"
plist "$PL" CFBundleDisplayName "$NAME"
plist "$PL" CFBundleExecutable "$NAME"
plist "$PL" CFBundleIdentifier "$ID"
plist "$PL" CFBundleIconFile "icon"
plist "$PL" CFBundleShortVersionString "$VERSION"
plist "$PL" CFBundleVersion "$VERSION"
plist "$PL" LSApplicationCategoryType "public.app-category.developer-tools"
plist "$PL" NSHumanReadableCopyright "Copyright © 2026 Paul Gregory. Tous droits réservés."

# Les autorisations de fichiers, et l'unique raison pour laquelle elles sont ici.
#
# macOS protège Documents, Bureau et Téléchargements par TCC. Une app qui y lit un
# fichier déclenche une demande d'autorisation — MAIS le système ne sait l'afficher
# que si l'Info.plist porte la chaîne d'explication correspondante. Sans elle, l'appel
# `open()` ne revient JAMAIS : pas d'erreur, pas de refus, pas de fenêtre. Et comme
# `MILESTONES.md` est lu de façon synchrone, c'est la boucle d'événements de Node qui
# se fige avec lui — serveur muet, fenêtre blanche, ⌘Q sans effet. Le symptôme ne
# ressemble en rien à sa cause, d'où ce commentaire plutôt qu'une ligne de plus.
#
# Les trois dossiers sont ceux où un dépôt suivi peut vivre ; le registre, lui, borne
# déjà la navigation au dossier personnel (route /api/browse).
plist "$PL" NSDocumentsFolderUsageDescription "Pyramis lit et met à jour le MILESTONES.md des projets que vous suivez."
plist "$PL" NSDesktopFolderUsageDescription "Pyramis lit et met à jour le MILESTONES.md des projets que vous suivez."
plist "$PL" NSDownloadsFolderUsageDescription "Pyramis lit et met à jour le MILESTONES.md des projets que vous suivez."

for SUFFIX in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  SRC="$APP/Contents/Frameworks/Electron Helper$SUFFIX.app"
  [ -d "$SRC" ] || continue
  DST="$APP/Contents/Frameworks/$NAME Helper$SUFFIX.app"
  mv "$SRC" "$DST"
  mv "$DST/Contents/MacOS/Electron Helper$SUFFIX" "$DST/Contents/MacOS/$NAME Helper$SUFFIX"
  plist "$DST/Contents/Info.plist" CFBundleName "$NAME Helper$SUFFIX"
  plist "$DST/Contents/Info.plist" CFBundleExecutable "$NAME Helper$SUFFIX"
  plist "$DST/Contents/Info.plist" CFBundleIdentifier "$ID.helper"
done

# ---- icône ------------------------------------------------------------------
node "$REPO/scripts/icon.mjs" "$APP/Contents/Resources/icon.icns"

# ---- charge -----------------------------------------------------------------
DEST="$APP/Contents/Resources/app"
mkdir -p "$DEST"
# Liste explicite : tout module racine importé par server.mjs doit y figurer,
# sinon l'app packagée démarre… jusqu'au premier import manquant.
cp "$REPO/package.json" "$REPO/server.mjs" "$REPO/milestones.mjs" "$REPO/terminals.mjs" \
   "$REPO/generate.mjs" "$REPO/graph.mjs" "$DEST/"
cp -R "$REPO/electron" "$REPO/public" "$REPO/prompts" "$DEST/"
# Pas de projects.json : le registre vit dans ~/Library/Application Support/Pyramis
# (cf. registryPath dans server.mjs). Un registre embarqué serait écrit à chaque
# ajout de projet — donc dans un bundle signé, donc une app qui ne redémarre plus.

cd "$REPO"
while IFS= read -r PKG; do
  [ "$PKG" = "$REPO" ] && continue
  REL="${PKG#"$REPO"/}"
  mkdir -p "$DEST/$(dirname "$REL")"
  cp -R "$PKG" "$DEST/$REL"
done < <(npm ls --omit=dev --parseable --all 2>/dev/null || true)

for MOD in node-pty ws @xterm/xterm @xterm/addon-fit; do
  [ -d "$DEST/node_modules/$MOD" ] \
    || { echo "$MOD n'a pas été copié — lance : npm install" >&2; exit 1; }
done
# npm extrait les prebuilds de node-pty SANS le bit exécutable sur spawn-helper :
# chaque terminal mourrait sur un « posix_spawnp failed » qui n'explique rien.
# scripts/fix-pty.mjs le répare dans le dépôt ; ici on le répare dans la copie.
find "$DEST/node_modules/node-pty/prebuilds" -name spawn-helper -exec chmod 755 {} +
# node-pty est en N-API (napi_register_module_v1) : le même .node se charge sous
# Node et sous Electron. Si ça cessait d'être vrai, ce test tomberait ici plutôt
# qu'au premier terminal ouvert.
nm -gU "$DEST/node_modules/node-pty/prebuilds/darwin-$ARCH/pty.node" 2>/dev/null | grep -q napi_register_module_v1 \
  || { echo "le node-pty embarqué n'est plus en N-API : il faudrait le recompiler pour Electron" >&2; exit 1; }
file "$DEST/node_modules/node-pty/prebuilds/darwin-$ARCH/pty.node" | grep -q "$MACHO" \
  || { echo "le node-pty embarqué n'est pas en $ARCH" >&2; exit 1; }

# ---- signature --------------------------------------------------------------
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" 2>/dev/null
codesign --verify --deep "$APP" 2>/dev/null || { echo "signature invalide" >&2; exit 1; }

touch "$APP" # le Finder garde les icônes en cache ; un touch le pousse à relire
echo "app       : $APP  ($(du -sh "$APP" | cut -f1), $ARCH)"

if [ "${1:-}" = "--install" ]; then
  rm -rf "/Applications/Pyramis.app"
  cp -R "$APP" "/Applications/Pyramis.app"
  echo "installé  : /Applications/Pyramis.app"
fi

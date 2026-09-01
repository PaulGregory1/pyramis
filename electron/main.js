// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Pyramis en application Mac : sa fenêtre, son icône dans le Dock, sa barre de
// menus, son ⌘Q. Rien d'autre. Le serveur tourne DANS ce process (voir boot) —
// un seul objet à lancer, un seul à quitter, donc pas de serveur orphelin ni de
// `claude` qui survive à la fermeture.
//
// L'interface, elle, ne change pas : c'est toujours la même app web servie sur
// 127.0.0.1. Electron n'est qu'une fenêtre — s'il disparaissait, `npm start` et
// le navigateur suffiraient encore. C'est la condition pour que le « Node pur »
// du CLAUDE.md reste vrai là où il compte : dans le serveur.
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 4331);
const ORIGIN = `http://127.0.0.1:${PORT}`;
// `?app=1` allume `body.in-app` dans la feuille de style : la barre de l'app
// devient la barre de titre de la fenêtre. C'est un paramètre d'URL et non un
// reniflage d'Electron pour que la vérification headless du CLAUDE.md puisse
// ouvrir exactement la même page.
const URL_APP = `${ORIGIN}/?app=1`;

let win = null;
let owned = null; // le module server.mjs, seulement si c'est nous qui l'avons démarré

/* ------------------------------------------------------------------- PATH */

// Une app lancée depuis le Finder n'hérite pas du PATH du shell : `claude`,
// `graphify` et `node` deviennent introuvables. `terminals.mjs` complète déjà le
// PATH des processus qu'il lance, mais `graph.mjs` lit `process.env.PATH` pour
// trouver son binaire — c'est donc CELUI-CI qu'il faut réparer, et avant tout
// import du serveur.
function richPath() {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin"), "/usr/bin", "/bin"];
  const have = (process.env.PATH || "").split(":").filter(Boolean);
  return [...have, ...extra.filter((p) => !have.includes(p) && fs.existsSync(p))].join(":");
}

/* ---------------------------------------------------------------- journal */

// Ouverte par le Finder, l'app n'a pas de sortie standard : chaque console.log
// part dans le vide, y compris la trace de l'erreur qu'on cherche. On recopie
// les deux flux dans ~/Library/Logs/Pyramis. Écriture synchrone, délibérément :
// un journal tamponné perd exactement les lignes qui précèdent un plantage.
function startLogging() {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pyramis.log");
  try { if (fs.statSync(file).size > 2e6) fs.renameSync(file, `${file}.1`); } catch { /* premier lancement */ }
  const fd = fs.openSync(file, "a");
  fs.writeSync(fd, `\n=== ${new Date().toISOString()} — Pyramis ${app.getVersion()} ===\n`);
  for (const name of ["stdout", "stderr"]) {
    const stream = process[name];
    const write = stream.isTTY ? stream.write.bind(stream) : null;
    stream.write = (chunk, ...rest) => {
      try { fs.writeSync(fd, typeof chunk === "string" ? chunk : Buffer.from(chunk)); } catch { /* journal perdu, tant pis */ }
      return write ? write(chunk, ...rest) : true;
    };
  }
  return file;
}

/* --------------------------------------------------------------- démarrage */

// Le port qui écoute est le vrai verrou : un `npm start` déjà lancé dans un
// terminal est REPRIS, jamais concurrencé. Deux serveurs sur le même registre
// se marcheraient dessus, et le second échouerait sur EADDRINUSE.
const listening = () =>
  new Promise((ok) => {
    const s = net.connect(PORT, "127.0.0.1");
    s.on("connect", () => { s.destroy(); ok(true); });
    s.on("error", () => ok(false));
    setTimeout(() => { s.destroy(); ok(false); }, 700);
  });

async function boot() {
  if (await listening()) return; // un serveur tourne déjà : on lui emprunte
  owned = await import("../server.mjs");
  for (let i = 0; i < 60; i++) {           // ~3 s : `listen` est asynchrone
    if (await listening()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`le serveur n'écoute pas sur ${ORIGIN}`);
}

/* ---------------------------------------------------------------- fenêtre */

function createWindow() {
  win = new BrowserWindow({
    width: 1420, height: 900, minWidth: 940, minHeight: 560,
    // La barre de l'app fait 52 px et porte déjà la marque : lui superposer une
    // barre de titre vide ferait deux bandeaux. On garde donc les trois boutons
    // et rien d'autre, posés dans la barre — d'où le décalage à gauche que
    // `body.in-app` réserve dans style.css.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 19, y: 19 },
    backgroundColor: "#fafafb", // --bg
    show: false,                // pas de flash blanc avant la première peinture
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(URL_APP);

  // Un lien externe s'ouvre dans le navigateur, pas dans une fenêtre d'app sans
  // barre d'adresse — et la fenêtre principale ne quitte jamais 127.0.0.1.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.on("closed", () => { win = null; });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open in Browser", accelerator: "CmdOrCtrl+Shift+O", click: () => shell.openExternal(ORIGIN) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    // Sans lui, ⌘C et ⌘V ne feraient rien dans les terminaux : xterm.js les reçoit
    // du menu Édition, pas d'un raccourci qu'il installerait lui-même.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

/* ------------------------------------------------------------------- vie */

// Deux verrous, deux rôles. Le port empêche deux serveurs ; celui d'Electron
// empêche deux fenêtres — la seconde ouverture remet la première au premier plan.
app.setName(app.isPackaged ? "Pyramis" : "Pyramis Dev");
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

// Sur un Mac, fermer la fenêtre ne quitte pas l'app : les terminaux continuent de
// tourner, l'icône reste dans le Dock, un clic dessus rouvre la vue. C'est aussi
// la garantie que le travail en cours ne dépend pas d'une fenêtre restée ouverte.
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!win) createWindow(); });

// ⌘Q, lui, tue vraiment : sans ça, les `claude` des panneaux resteraient
// rattachés à des pty sans lecteur, à consommer le quota en silence. C'est le
// même geste que le SIGINT de server.mjs, appliqué à la fermeture de l'app.
app.on("before-quit", () => { try { owned?.terminals?.closeAll(); } catch { /* déjà partis */ } });

process.env.PATH = richPath();

app.whenReady().then(async () => {
  const log = startLogging();
  buildMenu();
  try {
    await boot();
  } catch (e) {
    dialog.showErrorBox("Pyramis n'a pas démarré", `${e.message}\n\nJournal : ${log}`);
    return app.exit(1);
  }
  createWindow();
});

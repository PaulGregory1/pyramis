// npm extrait les prebuilds de node-pty SANS le bit exécutable sur `spawn-helper`.
// Résultat : chaque spawn échoue avec un « posix_spawnp failed » qui ne dit rien.
// On le remet après chaque installation, sur toutes les plateformes livrées.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "node-pty", "prebuilds");
if (fs.existsSync(root)) {
  for (const dir of fs.readdirSync(root)) {
    const helper = path.join(root, dir, "spawn-helper");
    if (!fs.existsSync(helper)) continue;
    fs.chmodSync(helper, 0o755);
    console.log("pyra: +x", path.relative(process.cwd(), helper));
  }
}

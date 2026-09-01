# Pyra

Le tableau de bord des projets menés en parallèle : où en est chacun, et de quoi
lancer le travail sans changer de fenêtre.

## Ce que ça fait

**Deux niveaux, et un seul visible de loin.** La vue d'ensemble ne montre que les
MILESTONES — les résultats qu'on peut annoncer — et parmi eux ceux qui bougent ou
coincent. Les petites étapes attendent qu'on ouvre le projet : elles dorment dans le
repli de leur milestone, avec leur compte (`2/5`). Faire remonter le détail de huit
projets sur une même page reproduirait le problème qu'on cherche à régler.

**La page d'un projet tient en deux étages.** En haut, ce que le dépôt EST : les
premières lignes de son README, ses langages, sa branche, son dernier commit, ce qui
n'est pas encore enregistré, et quatre mesures — milestones, étapes, sessions vivantes,
taille du graphe. Deux boutons y ouvrent les vues en lecture seule : **le graphe du
code** (quel symbole appelle quoi, communautés en couleur, recherche et voisinage au
survol) et **l'arbre git** (les commits avec leurs branches côte à côte, les fusions
en anneau). En bas, ce qu'il reste à faire : tous les milestones dans l'ordre du
fichier, chacun dépliable sur sa note, ses étapes et son échéance. Ce qui bouge ou
coince s'ouvre tout seul.

**Des étapes qui vivent dans les dépôts.** Un `MILESTONES.md` à la racine de chaque
projet, en markdown ordinaire. Une puce à la marge est un milestone, une puce indentée
sous elle est une étape :

    - [~] Détecter la 3e répétition ATTEIGNABLE @due:2026-09-20
          Le référé annule dès que la position est atteignable, pas atteinte.
      - [x] Écrire le test des positions atteignables
      - [ ] Brancher la détection sur le référé
    - [x] Baseline vs Stockfish niveau 3 @done:2026-09-01

`[ ]` à faire · `[~]` en cours · `[!]` bloquée · `[x]` faite. Éditable à la main, lu
par le Claude qui travaille dans le projet, versionné avec le reste.

**Un bouton ✦ qui écrit la carte.** `Generate milestones` lance un `claude -p` dans
le dossier du projet : il lit le README, le `CLAUDE.md`, les derniers commits, et
propose des milestones découpés en étapes. La proposition est **greffée** sur le
`MILESTONES.md` — ce qui manque est ajouté, rien n'est remplacé, aucun statut n'est
touché. On peut donc rappuyer dessus des semaines plus tard sans rien risquer ; le
bouton s'appelle alors `Complete`. Le prompt est dans `prompts/milestones.md`, à
retoucher sans redémarrer le serveur.

**Un graphe du code, construit sans rien demander.** Un projet qu'on met à suivre
repart avec un graphe de connaissance Graphify dans son `graphify-out/` : quel symbole
appelle quoi, à quelle ligne. Le Claude qui travaille ensuite dans ce dépôt l'interroge
(`graphify query "…"`) au lieu de relire tout le code — de l'ordre de six fois moins de
tokens par question sur un dépôt de cette taille, davantage sur les gros.

La construction est **locale et gratuite** : extraction AST par tree-sitter, aucune clé
d'API, aucun token, quelques secondes. Graphify sait aussi faire lire les docs et les
images par un LLM ; Pyra ne s'en sert pas, précisément pour que le geste puisse être
automatique sans jamais rien coûter. Le graphe est exclu du dépôt par
`.git/info/exclude`, jamais par le `.gitignore` — celui-là t'appartient. Le bouton
`◈ Build graph` sert aux projets déjà suivis et aux graphes que le dépôt a dépassés ;
la ligne sous le titre dit de quel commit le graphe a été tiré.

**Toutes les sessions d'un projet, sous son nom.** La barre latérale liste sous
chaque projet les sessions Claude qui lui appartiennent — celles ouvertes ici, et
celles lancées ailleurs sur la machine, marquées « elsewhere ». Un clic y va :
sur un panneau de Pyra, il le met en avant ; sur une session d'ailleurs, il en
reprend le fil dans une branche, la session d'origine continuant intacte de son
côté. Le bouton **All projects**, en haut, ramène à la vue d'ensemble.

**Autant de terminaux que voulu, en même temps.** Chaque panneau est un vrai
pseudo-terminal : un vrai `claude` interactif, avec ses couleurs, son `/resume` et
ses dialogues de permission. Rien n'est réimplémenté, donc rien ne diverge. Fermer
l'onglet du navigateur ne tue pas les sessions ; elles se retrouvent au rechargement.

**Un bouton ▶ sur chaque ligne.** Il ouvre un terminal Claude dans le bon dossier
et y dépose l'étape, prête à partir — sur un milestone, ses étapes qui restent partent
avec, en contexte. Il n'appuie pas sur Entrée : la dernière décision reste à toi.

## La langue

L'interface et les prompts envoyés au modèle sont en anglais ; la documentation et
les commentaires du code restent en français. Le mot **milestone** est le même des
deux côtés, pour qu'un bouton et un commentaire parlent de la même chose.

Les titres écrits dans un `MILESTONES.md`, eux, suivent la langue du dépôt : le prompt
demande explicitement au modèle d'écrire en français si le README et les commits le
sont. Une carte qui change de langue en cours de route est illisible.

## Lancer

Comme une app du Mac :

    npm install
    ./scripts/make-app.sh --install     # → /Applications/Pyra.app

Elle a sa fenêtre, son icône dans le Dock, sa barre de menus et son ⌘Q ; on l'ouvre
depuis Spotlight ou le Launchpad comme n'importe quelle autre. Le serveur tourne
DANS l'app : il n'y a qu'une chose à lancer, et qu'une chose à quitter — fermer
l'app arrête les `claude` de ses panneaux au lieu de les laisser orphelins.

**Au tout premier lancement, macOS demande l'accès au dossier Documents.** Il faut
accepter : sans cette autorisation, Pyra ne peut pas lire le `MILESTONES.md` des
projets qui y vivent. Si l'écran est verrouillé, la demande ne peut pas s'afficher et
l'app attend — déverrouiller suffit à la débloquer.

Ou dans le navigateur, ce qui reste vrai :

    ./start.sh          # ou : npm start, puis http://127.0.0.1:4331

Les deux façons partagent le même serveur : ouvrir l'app quand `npm start` tourne
déjà REPREND ce serveur au lieu d'en lancer un second. Et le même registre, qui vit
dans `~/Library/Application Support/Pyra/projects.json` — hors du dépôt, pour
qu'il survive à une réinstallation et parce qu'une app signée ne peut pas écrire
chez elle sans casser sa signature.

Au premier démarrage, six projets sont pré-inscrits s'ils existent : ecdsa.fail,
carnet Singapour, Skull King, PDM, chess hackathon, SoAI. `＋ Track a project`
ajoute les autres. Le registre est un `projects.json` éditable à la main.

## Ce que ça ne fait pas

Pas de troisième niveau : un milestone, ses étapes, et c'est tout. Un fichier écrit à
la main qui en compte davantage est relu sans erreur, mais les puces plus profondes
remontent au niveau des étapes.

Les deux visionneuses ne modifient rien : ni le graphe, ni l'histoire git ne
s'éditent depuis Pyra. Le graphe ne se rafraîchit pas non plus tout seul — `◈` le
reconstruit quand la ligne sous l'aperçu dit qu'il a pris du retard. Et au-delà de
450 noeuds, seuls les plus connectés sont dessinés : le dire vaut mieux qu'un nuage.

Pas de suivi de quota : l'app compte les sessions vivantes, pas les jetons. Lancer
cinq sessions Opus en parallèle vide la fenêtre de 5 h beaucoup plus vite qu'on ne
le croit — le compteur en haut à droite est là pour le rappeler.

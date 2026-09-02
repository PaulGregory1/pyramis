<!-- graph-baseline: 5c761cc -->
# Pyra — carte du code

Ce document décrit le dépôt tel qu'il était au commit indiqué en première ligne.
Protocole de mise à jour en bas de page.

## Le pari

Pyra ne stocke rien qui lui soit propre. Il n'a ni base de données, ni état
métier. Deux sources de vérité, toutes deux extérieures à l'app :

1. **Les étapes** vivent dans `MILESTONES.md`, à la racine de chaque dépôt suivi.
2. **Les sessions Claude** viennent de `claude agents --json`, c'est-à-dire de
   Claude Code lui-même.

Conséquence à ne pas perdre de vue : si Pyra disparaît, rien n'est perdu. Un
`MILESTONES.md` reste lisible dans un éditeur, et il est déjà dans le dépôt que Claude
ouvre quand il travaille dessus. C'est la garde contre le vrai risque du projet —
qu'un neuvième pyra vienne s'ajouter aux huit qu'il devait alléger.

Le seul fichier propre à l'app est `projects.json` (le registre : quels dossiers
suivre, dans quel ordre, avec quelle icône). Il est hors git et se répare à la main.

La génération d'étapes ne change pas ce pari : le modèle propose, l'app greffe la
proposition sur le `MILESTONES.md` du dépôt, et c'est tout. Rien n'est gardé ici — ni
la réponse, ni l'historique des générations.

## La langue

L'interface est en anglais, les prompts envoyés au modèle aussi (`prompts/milestones.md`,
`promptFor` dans `app.js`, les messages d'erreur des routes — ils remontent dans une
alerte). La documentation et les commentaires du code sont en français. Le mot
**milestone** ne se traduit pas : il est le même dans un bouton et dans un
commentaire, sans quoi on ne saurait plus si « jalon » et « milestone » désignent la
même chose.

Ce que le modèle ÉCRIT dans un `MILESTONES.md` échappe à la règle : le prompt lui demande
la langue du dépôt. Un fichier à moitié français, à moitié anglais ne se lit pas.

## Deux niveaux, et un seul visible de loin

Une puce à la marge est un **milestone** ; une puce indentée sous elle est une **étape**.
C'est toute la hiérarchie, et le fichier la porte tel quel — deux espaces, lisibles
dans n'importe quel éditeur. La règle d'affichage qui en découle tient l'app :

- la vue d'ensemble et la barre latérale ne comptent QUE les milestones (`mainStats`) ;
- les étapes vivent dans la carte de leur milestone, donc uniquement dans la vue projet.

Faire remonter le détail de huit projets sur une même page redonnerait la liste
illisible que Pyra existe pour éviter. C'est aussi pourquoi il n'y a pas de
troisième niveau : le schéma envoyé au modèle n'en propose pas, et `link()` aplatit
ce qu'un fichier écrit à la main pourrait contenir de plus profond.

## Le graphe de connaissance, et pourquoi il ne coûte rien

Un projet que l'app **crée** repart avec un graphe Graphify dans son `graphify-out/`.
Cet automatisme tient au fait qu'il est **gratuit** : `graphify extract --code-only`
lit le code par AST, en local, sans clé d'API. Graphify sait aussi extraire le sens
des docs, des papiers et des images — en envoyant leur contenu à un LLM. Cette porte
reste fermée dans `graph.mjs`, et c'est la décision qui autorise l'automatisme :
un geste que l'app déclenche seule ne doit jamais coûter un token.

**Il a changé de chemin le 2 septembre 2026.** Il se déclenchait à l'AJOUT d'un projet ;
il se déclenche désormais à la CRÉATION. Un dossier déjà présent sur la machine existait
avant l'app : il a son histoire, son `CLAUDE.md`, peut-être un travail en cours, et un
geste non demandé sur un dépôt qu'on n'a pas fabriqué est une intrusion, fût-il gratuit.
Le bouton « Build graph » de la page du projet reste la voie pour eux — c'est un clic.

Corollaire mesuré, pas deviné : **un projet qu'on vient de créer produit un graphe
vide**, et Graphify le rend comme une erreur (« graph is empty — extraction produced
no nodes »). Il n'a que son README, son `.gitignore` et son `MILESTONES.md` : du
markdown, que `--code-only` ignore par construction. `startForge()` traduit donc ce
cas en une ligne neutre — « no code yet » — plutôt qu'en rouge. Le peindre comme un
échec apprendrait à l'utilisateur que la création rate toujours à moitié, et il
cesserait de lire la liste.

**Deux cartes, et elles ne disent pas la même chose.** Ce `KNOWLEDGE-GRAPH.md` est
écrit à la main : il porte le *pourquoi* et les pièges, c'est-à-dire ce qu'aucune
extraction ne trouvera jamais. Le `graphify-out/` est machine, régénérable, et porte
le *où* : quel symbole appelle quoi, à quelle ligne. L'un ne remplace pas l'autre, et
c'est pourquoi le `CLAUDE.md` renvoie aux deux. Si l'un doit être cru sur parole en
cas de désaccord, c'est le graphe machine pour les faits de code, et celui-ci pour
les intentions.

Le bloc que `pointer()` greffe dans le `CLAUDE.md` d'un dépôt est **en anglais** alors
que la documentation de Pyra est en français : il est généré à l'identique pour
tous les dépôts suivis, quelle que soit leur langue, donc il relève de la règle des
prompts et non de celle de la documentation.

## La direction artistique

Elle est tirée de `public/brand/logo-pyr.png` (une pyramide à trois étages, violet à
gauche, bleu à droite) et de `public/brand/brand-pyr.png` (PYRA en capitales fines
très espacées, encre bleu nuit). Les couleurs de `style.css` ne sont pas choisies à
l'œil : elles ont été prélevées au compte-gouttes dans ces deux fichiers —
`#000823` pour l'encre, `#6c34d6` et `#3c5bf5` pour les deux bouts du dégradé.

Trois règles en découlent, et elles tiennent toute la feuille de style :

1. **Le fond est blanc, l'encre est bleu nuit.** Rien d'autre ne porte de couleur
   sauf ce qui demande une action ou signale un état.
2. **Le dégradé violet → bleu est réservé à l'accent** : l'avancement, le bouton
   principal, le focus. Employé partout, il ne voudrait plus rien dire.
3. **Les intitulés de section reprennent l'espacement du mot-symbole**
   (`--track: .16em`, capitales, graisse 600). C'est ce détail, plus que la
   couleur, qui fait reconnaître la marque à l'intérieur de l'interface.

`scripts/brand.mjs` regénère les déclinaisons depuis les TROIS originaux : le
mot-symbole rogné sur fond transparent (la police du logo n'existe pas sur la
machine — la réapprocher donnerait un faux, donc c'est une image), la pyramide
en 256 / 128 / 64 px, et le logo du graphe en 128 px. Les originaux restent dans
`public/brand/`.

Le logo du graphe (`graph-pyr.png` → `graph-128.png`) est la seule exception mesurée
à la règle 2 : un dégradé violet qui n'est pas l'accent. Il la tient quand même,
parce qu'il ne décore rien — il ne paraît QUE là où le graphe est en jeu (les deux
boutons qui le construisent, celui qui l'ouvre, l'en-tête de la visionneuse), et
c'est `graphIcon()` dans `app.js` qui le pose partout, d'un seul endroit. La ligne
de mesure de `graphNote`, elle, garde son `◈` : elle dit un chiffre, pas un geste,
et n'a droit à aucune couleur tant que rien ne cloche.

L'original est peint sur du blanc OPAQUE, là où `logo-pyr.png` a déjà son alpha.
D'où le détour de `brand.mjs` : l'alpha se déduit du canal le plus sombre
(`255 - min(r,g,b)`, rapporté au pixel le plus plein), puis on démultiplie la
couleur — sans quoi le violet sortirait délavé de moitié, le blanc du fond restant
mélangé dedans.

Le mot-symbole est rendu à HAUTEUR constante (85 px), pas à largeur constante :
`.brand .wordmark` pose `height: 12px`, donc c'est la hauteur qui fixe la taille
des lettres à l'écran. C'est ce qui a permis de raccourcir PYRAMIS en PYRA — la
source est rognée après le Δ — sans que les quatre lettres restantes grossissent
pour remplir la même largeur.

## Les deux chemins d'entrée, et pourquoi ils divergent

C'est la décision structurante du 2 septembre 2026, et tout le panneau des réglages
existe pour la rendre visible.

**Ajouter** (`POST /api/projects`) inscrit au registre un dossier qui était déjà là.
Rien d'autre. Ce dépôt existait avant l'app : il a son histoire, son `CLAUDE.md`,
peut-être un travail à moitié indexé. Un automatisme y serait une intrusion, même
gratuit, même utile — la question n'est pas ce qu'il coûte, c'est qu'on ne l'a pas
demandé.

**Créer** (`POST /api/projects/new`) fabrique le dossier, puis déclenche ce qui est
réglé : `git init`, le premier commit, `gh repo create`, le graphe, la synchro. Là,
l'app ne peut rien abîmer — il n'y avait rien une seconde plus tôt.

Trois conséquences à connaître avant de toucher au code :

1. **Le drapeau vit dans le REGISTRE, pas dans les réglages.** Un projet créé porte
   `created: true` et `auto: { sync: true }`. C'est lui, et non un réglage global, qui
   autorise l'app à commiter chez lui. Un réglage global « synchroniser » se serait
   appliqué le lendemain aux six projets ajoutés à la main, qui ne l'avaient jamais
   demandé. La bascule par projet est dans `PATCH /api/projects/:id` (`b.sync`).
2. **Le formulaire peut contredire les réglages sans les déplacer.** Décocher une case
   dans « New project » vaut pour ce projet-ci ; `settings.json` n'est pas réécrit. Un
   choix ponctuel qui déplacerait le réglage général se paierait au projet suivant.
3. **L'installation est une TÂCHE DE FOND.** `gh repo create` parle au réseau ;
   tenir la requête HTTP ouverte donnerait une interface figée sur un clic. Le
   déroulé vit dans la map `forges` du serveur et ressort dans `/api/state`, comme la
   génération et le graphe. Chaque geste garde sa ligne : un dépôt distant qui rate
   n'efface pas le `git init` et les commits qui ont réussi avant lui.

## Les réglages, et ce qu'ils ne contiennent pas

Trois choses : à QUI l'app parle, ce que Claude demande avant d'agir dans un panneau,
et ce qu'elle déclenche en créant.

Le provider est une **table** (`PROVIDERS` dans `settings.mjs`), pas une suite de
`if`. Claude est seul aujourd'hui ; le jour où un second arrive, il s'ajoute en ligne
et rien d'autre ne bouge. Sans cette table, « claude » serait écrit en dur dans
`generate.mjs`, `terminals.mjs` et l'interface, et le deuxième provider demanderait de
rouvrir les trois. Le panneau montre l'état RÉEL du binaire — chemin résolu et
version — plutôt qu'une promesse : une installation trop vieille se lit là, pas au
premier échec de génération.

**Aucun secret n'est stocké.** La connexion GitHub est celle de `gh`, qui tient déjà
son jeton dans le trousseau du Mac ; `forge.github()` demande seulement s'il y en a
un. Un secret que l'app ne stocke pas est un secret qu'elle ne peut pas laisser fuir.
Corollaire : quand quelque chose manque, le panneau affiche la COMMANDE à taper
(`gh auth login`, `brew install gh`), jamais un simple constat — l'utilisateur ne
peut rien réparer depuis l'app, donc l'app doit lui dire où aller.

Un seul automatisme dépense, la génération par le modèle, et il est le seul décoché
par défaut. `test/settings.test.mjs` le vérifie explicitement : si ce test tombe un
jour, c'est qu'on a coché une dépense à la place de quelqu'un.

## Le mode de permission, et pourquoi il est en bypass

C'est le seul réglage de Pyra qui décide de ce que Claude **fait**, et il est réglé
sur `bypassPermissions` par défaut. Ce n'est pas une négligence, c'est la raison
d'être de l'app : tenir N sessions en parallèle. Un mur de questions par panneau,
huit fois, est exactement ce qu'on fuyait — l'utilisateur ne serait plus qu'un
valideur. Le réglage est donc en toutes lettres dans les réglages, avec son étiquette
« no questions asked », pour que celui qui veut l'inverse le trouve du premier coup.

**Pyra ne réimplémente rien.** Le CLI porte ce réglage lui-même ; un panneau EST un
`claude` complet, on lui passe un drapeau au lancement et c'est lui qui arbitre. C'est
toute la différence avec ApplyStudio, qui intercepte chaque outil par `canUseTool`
parce qu'il tient une `query()` du SDK — d'où ses trois modes maison (bypass / auto /
ask) là où Pyra expose les six du CLI, tels quels.

**`bypassPermissions` a un drapeau à lui, et les deux formes ne s'échangent pas.**
`--permission-mode bypassPermissions` est REFUSÉ au lancement (« Cannot set permission
mode to bypassPermissions because the session was not launched with
`--dangerously-skip-permissions` ») — lu dans le binaire du CLI, pas deviné. Et le mode
manuel ne passe rien du tout : le CLI l'appelle « manual » en ligne de commande alors
que son nom interne est « default », donc ne rien dire est la seule forme sûre.
`test/settings.test.mjs` verrouille les deux.

**Un seul endroit compose la ligne `claude`** : `cliCommand()` dans `settings.mjs`. Le
panneau ordinaire et la reprise d'une session (`--resume --fork-session`) y passent
tous les deux, sinon un panneau sur deux demanderait la permission et personne ne
saurait pourquoi. `claude attach`, lui, se rebranche sur un process DÉJÀ lancé : lui
passer un drapeau de lancement n'aurait aucun sens, et il n'en reçoit pas.

**Le mode est figé à la NAISSANCE du panneau**, gardé dans le terminal (`t.mode`) et
écrit dans son en-tête. Changer le réglage ne retourne pas un `claude` qui tourne ;
l'afficher par panneau est la seule façon honnête de le dire. Un seul mode dépense —
`auto`, où un classifieur répond aux questions — et il est étiqueté comme la
génération l'est.

## La synchro git, et la seule forme qui la rende sûre

`git commit -m … -- MILESTONES.md CLAUDE.md` commite la version DISQUE de ces
chemins-là, quoi qu'il y ait dans l'index. C'est toute la garantie, et elle tient dans
cette forme précise : au milieu d'un travail en cours, une modification à moitié
indexée ailleurs n'est ni prise, ni perdue. Un `git add -A` aurait emporté les trois.
`test/forge.test.mjs` monte exactement ce cas — un fichier non suivi, un modifié, un
indexé — et vérifie que les trois sont intacts après le passage de Pyra.

La liste `OWNED` est courte et doit le rester : chaque nom ajouté est un fichier de
plus que l'app s'autorise à commiter chez quelqu'un d'autre. `graphify-out/` n'y est
pas et n'a pas à y être — il est exclu via `.git/info/exclude`, donc il ne peut pas
entrer dans un commit même par accident.

**Un push qui échoue n'est pas un commit perdu.** Pas de réseau, pas d'amont, une
branche divergée : le commit est fait, il attend. L'interface le dit ainsi, sans quoi
l'utilisateur referait le geste en croyant avoir tout raté.

## La consommation du forfait, et pourquoi elle ne coûte rien

Deux fenêtres, parce qu'il y a deux questions et qu'elles n'ont pas la même réponse :
« est-ce que je viens d'épuiser ma session de 5 h ? » — ça revient dans l'heure, on va
boire un café — et « il me reste combien cette semaine ? » — ça ne revient pas avant des
jours, il faut lever le pied. N'en montrer qu'une laisse sans réponse une fois sur deux.
Pyra tient N sessions Claude de front : c'est exactement l'app où la question se pose.

**La lecture ne coûte pas un token, et c'est ce qui l'autorise à tourner seule.** On
ouvre un `claude` en mode flux et on lui pose une REQUÊTE DE CONTRÔLE (`get_usage`) :
aucun tour de modèle, rien d'envoyé au modèle. Même règle que pour le graphe — ce que
l'app déclenche d'elle-même doit être gratuit. Gratuit en tokens ne veut pas dire
gratuit tout court : c'est un sous-processus de deux secondes, d'où le cache de deux
minutes de `usage.mjs`, l'interdiction de mettre cette lecture dans `/api/state`, et
l'arrêt du rythme côté client quand l'onglet passe à l'arrière-plan.

**Le compte nomme lui-même ses fenêtres** (`rate_limits.limits` : espèce, pourcentage,
remise à zéro, modèle concerné). C'est la source à préférer sur les clés historiques —
une formule nouvelle y apparaît sans qu'on rouvre le fichier. Les clés restent en repli,
pour le jour où le champ disparaîtrait ; `test/usage.test.mjs` tient les deux chemins.

**C'est un CONFORT, et le protocole n'est pas gravé.** Binaire absent, sous-commande
disparue, champ renommé : tout rend `null`, l'écran dit « indisponible », et pas un
geste de l'app n'en dépend. Aucun secret ne passe par là non plus — le jeton OAuth
appartient au CLI, qui interroge le compte avec ; Pyra ne voit que des pourcentages.

**Deux montages, un seul rendu.** La barre latérale porte la version courte (on veut
le chiffre sans rien ouvrir, comme l'avancement d'un projet), le panneau la version
longue avec les dates de remise à zéro. Elle n'a PAS d'onglet à elle : elle est dans
« Model & plan », sous le fournisseur qui dépense ce forfait, parce que le choix et sa
dépense sont deux faces du même réglage — et parce que c'est l'onglet qui s'ouvre tout
seul, donc la version longue se lit sans un clic de plus. Deux rendus finiraient par ne plus dire la même
chose du même chiffre. Et la couleur n'est PAS le dégradé : un forfait qui se remplit
n'est pas un avancement, le peindre en violet le lirait comme une réussite. Encre
jusqu'à 70 %, puis `--warn`, puis `--blocked` — la couleur ne vient qu'avec l'état.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `server.mjs` | Serveur HTTP sur 127.0.0.1 : API JSON, registre des projets, relais WebSocket. |
| `milestones.mjs` | Analyse et réécriture de `MILESTONES.md`. Aucune dépendance au reste. |
| `generate.mjs` | L'appel au modèle : un `claude -p` en lecture seule dans le dépôt. |
| `prompts/milestones.md` | Le prompt de génération. Relu à chaque appel, donc modifiable à chaud. |
| `graph.mjs` | Le graphe de connaissance d'un dépôt : construction Graphify, état, exclusion git, pointeur, lecture pour la visionneuse. |
| `repo.mjs` | Ce que le dépôt dit de lui-même : README, langages, branche, et l'histoire git mise en voies. Git en LECTURE seule. Aucune dépendance au reste. |
| `forge.mjs` | Le miroir en ÉCRITURE de `repo.mjs` : `git init`, premier commit, `gh repo create`, et la synchro. Seul module qui puisse modifier l'histoire d'un dépôt. |
| `settings.mjs` | Les réglages : le provider (table, Claude seul aujourd'hui) et ce qui se déclenche à la création d'un projet. Vit hors du dépôt, à côté du registre. |
| `usage.mjs` | Ce que le forfait a consommé : une requête de CONTRÔLE sur un `claude` jetable, donc zéro token. Cache de deux minutes. |
| `terminals.mjs` | Les pseudo-terminaux. Un `claude` ou un shell réel par panneau. |
| `public/app.js` | Toute l'UI. Pas de framework, pas d'étape de build. |
| `electron/main.js` | La coquille Mac : une fenêtre, un menu, un ⌘Q. Importe `server.mjs`, ne décide rien. |
| `scripts/make-app.sh` | Emballe `build/Pyra.app` à partir du runtime Electron de `node_modules`. Sans packager. |
| `scripts/icon.mjs` | L'`.icns` depuis `logo-pyr.png`. Décode et encode le PNG à la main, aucune dépendance. |
| `scripts/fix-pty.mjs` | Remet `+x` sur le `spawn-helper` de node-pty après chaque `npm install`. |
| `scripts/brand.mjs` | Regénère mot-symbole, pyramide et logo du graphe depuis les originaux. |
| `public/brand/` | Les originaux (`logo-pyr.png`, `brand-pyr.png`, `graph-pyr.png`) et leurs déclinaisons. |

## La page d'un projet : deux étages, et pourquoi

En haut, ce que le dépôt EST. En bas, ce qu'il reste à en faire. La séparation n'est
pas décorative : le premier étage se lit une fois — on l'ouvre pour se remettre en
tête de quoi parle ce projet — et le second se travaille. Les mélanger redonnait la
page où l'on cherche l'information au milieu des commandes.

**L'étage du haut ne coûte rien à la boucle des quatre secondes.** `/api/state` tourne
toutes les 4 s pour six projets : y ajouter un `git log`, un `git status` et une lecture
de README, ce serait vingt-quatre sous-processus par tour pour des faits qui bougent
une fois par heure. D'où trois routes séparées (`/preview`, `/git`, `/graph-data`),
demandées à l'ouverture d'un projet ou au clic, et un cache d'une minute côté client
(`previews` dans `app.js`). La tentative est notée AVANT le départ de la requête :
sans ça, un dossier qui répond en erreur relancerait un appel à chaque rendu.

**Les quatre colonnes ont laissé la place à une liste.** Un tableau rangé par statut
perdait l'ORDRE DU FICHIER, qui est celui que l'utilisateur a écrit et le seul qui
raconte une feuille de route. Le statut n'a pas disparu pour autant : il se lit à la
pastille, se filtre au-dessus, et se change au clic (la pastille fait tourner, le
sélecteur du repli désigne). C'est la seule chose que la vue projet a perdue, et elle
est revenue sous une autre forme.

**Le repli est un état d'interface qui survit au rechargement, et il ne va pas dans le
fichier.** `localStorage` (`pyra.open`), jamais le `MILESTONES.md` : le fichier
appartient au dépôt, l'état d'un pli n'y a rien à faire. Sans choix explicite, ce qui
est en cours ou bloqué s'ouvre — c'est ce qu'on vient voir. Le registre des plis est
borné à 400 entrées, sinon un milestone supprimé y laisserait sa clé pour toujours.

## La grille des terminaux, et le « ＋ »

**Le nombre de colonnes n'est plus un réglage.** « Tous visibles » est une contrainte
géométrique, pas une préférence : `gridShape()` essaie chaque découpe possible et garde
celle dont les cellules ressemblent le plus à un terminal — plus larges que hautes
(`CELL_AR = 1.6`) — en pénalisant celles qui passent sous le lisible et, un peu, celles
qui laissent des trous. Une seule découpe est écrite en dur : à DEUX panneaux, côte à
côte, quelle que soit la fenêtre — un terminal est une colonne de lignes, l'empiler
retire des lignes (ce qu'on vient lire) là où le rétrécir ne fait que replier le texte,
et le score, qui ne juge que la forme d'une cellule, ne sait pas le dire. Au-delà, plus
personne ne choisit : la géométrie tranche. La borne basse (`CELL_MIN_H`) est une
vraie borne, posée en `minmax` : au-delà
d'une quinzaine de panneaux la grille finit par défiler, ce qui vaut mieux que vingt
bandes de trois lignes.

**Le « ＋ » en pointillés ne se montre que s'il RESTE une case.** Trois panneaux dans
une grille 2×2 laissent un trou : il le remplit. Quatre panneaux n'en laissent pas, et
un bouton de plus pousserait tout le monde d'un rang — les panneaux rétréciraient à
cause de lui. Le « ＋ » de la barre du haut couvre ce cas-là et ne coûte aucune case.
Grille vide, c'est la même case qui porte le mot d'accueil : un seul endroit dit
« aucun terminal ».

**Le « ＋ » ne peut pas deviner le projet**, puisque la grille tient les panneaux de
tous. D'où un dialogue qui ne pose que cette question — sauf s'il n'y a qu'un projet
suivi, où la question n'en est pas une. Il a une adresse (`#s=term`) comme les deux
autres panneaux, pour la même raison qu'eux.

**`⤢` a cessé d'être un plein cadre.** Le panneau agrandi est POSÉ sur la grille, il ne
la remplace plus : le plein cadre cachait les autres (`[hidden]`), et une grille où l'on
ne voit plus ce qui tourne n'est plus une grille. Détail complet dans « Agrandir un
panneau », plus bas.

**Et le panneau tout entier est ce bouton.** Un clic n'importe où dans un panneau
l'agrandit — `zoomTarget()`. Chercher un chevron de 12 px dans une grille de huit
panneaux était le geste le plus fréquent de l'app et le plus mal servi ; le bouton reste,
pour qu'on sache que la chose existe, et s'efface une fois le panneau devant. On n'en
SORT pas par le même geste : la croix de l'arrière-plan, ou l'arrière-plan lui-même. Un
second clic refermerait le panneau au premier mouvement un peu large, et Échap appartient
à `claude` — dans un terminal, c'est une touche comme une autre. Deux endroits gardent
leur propre sens du clic : un bouton, et le terminal (on y place un curseur, on y
sélectionne). Troisième garde, invisible mais nécessaire : relâcher une phrase surlignée
n'est pas un clic — sans le test sur la sélection, sélectionner du texte dans un panneau
l'agrandissait sous les doigts.

## Les deux vues, et le chemin entre elles

Les onglets « Milestones » et « Terminals » sont deux vues d'un même écran : la barre
latérale les surplombe et ne disparaît jamais. C'est ce qui fait que **la navigation
doit être câblée dans les DEUX sens**, et le second manquait.

`focusPane()` allait de la page d'un projet à son panneau — il appelle `showView("terms")`
avant de faire défiler. Le retour, lui, n'existait pas : la barre latérale se contentait
d'un `state.selected = p.id; render()`. Depuis la grille des terminaux, `#view-board`
porte `.hidden`, donc ce rendu peignait une page que personne ne voyait. Le seul signe
du clic était la surbrillance qui se déplaçait dans la barre latérale — l'app avait
exactement l'air cassée. D'où `showProject(id)`, le pendant exact de `focusPane(id)` :
il bascule sur la vue avant de rendre. Les trois entrées y passent (un projet de la
barre latérale, « All projects », le bouton « Open » d'une carte de la vue d'ensemble),
et la règle à tenir est simple — **un geste qui change de projet change aussi de vue**.

**L'identité d'un panneau est le chemin vers son projet.** L'émoji et le nom, dans
l'en-tête, sont un bouton (`.goproj`) qui mène à la page du projet, donc à son aperçu.
La grille montre huit dépôts à la fois et rien d'autre : sans lui, relire le README de
celui qu'on regarde demandait de changer d'onglet puis de retrouver son nom dans la
barre latérale. Il n'est pas peint comme « ⤢ » et « ✕ » — il reste à l'encre, et seul
le fond au survol dit qu'il mène quelque part ; en faire un troisième bouton d'action
aurait laissé l'en-tête sans identité. Étant un bouton, il n'agrandit pas le panneau :
c'est la première exception de `zoomTarget()`, et elle joue ici sans qu'on ait rien à
ajouter. Son `min-width: 0` n'est pas décoratif : un item flex ne descend jamais sous la
largeur de son contenu sans lui, et un nom de session un peu long poussait « ⤢ » et
« ✕ » hors du cadre au lieu de se couper aux points de suspension. Mesuré à sept
panneaux dans une fenêtre de 1100 px, pas deviné.

## Déposer une image dans un panneau

Trois choses, et la première rendait le geste impossible : **sans `preventDefault`, le
navigateur QUITTE la page** pour afficher le fichier lâché. L'app disparaît d'un coup —
les terminaux survivent côté serveur, mais personne ne le sait sur le moment. La garde
est posée sur la fenêtre entière, pas seulement sur les panneaux.

Deuxième : **le navigateur ne donne pas le chemin du fichier d'origine**, et Electron ne
le donne plus depuis la 32 (`webUtils.getPathForFile` demanderait un préchargement, donc
de la logique dans `electron/main.js` — exactement ce que la règle « Electron n'est
qu'une fenêtre » interdit). On envoie donc les OCTETS à `POST /api/terminals/:id/drop`,
qui en pose une copie dans `os.tmpdir()/pyra-drops/<terminal>/` et rend le chemin. Un
seul code pour les deux façons de lancer Pyra. Le corps est lu BRUT, pas en JSON : une
capture de 8 Mo en base64 en ferait 11, pour rien.

Trois conséquences voulues : le fichier de l'utilisateur n'est ni déplacé, ni modifié,
ni supprimé ; rien n'entre dans son dépôt ; et le ménage revient à macOS, qui purge
`/var/folders` tout seul — Pyra n'efface rien, ici non plus. Le nom est nettoyé
(`dropName()`) parce qu'il vient du client : `basename`, filtre, points de tête retirés.

Troisième : **le chemin est DÉPOSÉ dans l'invite, jamais envoyé.** Même règle que pour
une étape, et le même chemin de code — `typeInto()` est le seul endroit qui écrit dans
un pty depuis l'interface, pour qu'il n'y ait qu'un seul endroit où l'on pourrait, un
jour, ajouter un `\r` par mégarde. Vérifié à l'écran : Claude Code reconnaît le chemin
et affiche `[Image #1]` dans son invite, sans partir.

## Agrandir un panneau

**Il est posé sur la grille, pas mis à sa place.** `.pane.zoomed` passe en
`position: fixed` : le nœud ne bouge pas d'un pouce dans le DOM, il sort du flux, et
l'arrière-plan floute le reste au lieu de le masquer — les autres sessions continuent, on
les voit du coin de l'œil sans pouvoir les lire par-dessus celle-ci. C'est aussi la seule
façon de garder xterm intact : le déplacer dans le DOM lui ferait perdre sa boîte, et le
pty renaîtrait à la mauvaise largeur, avec les mots coupés en travers que la temporisation
de 150 ms existe déjà pour éviter.

**Le fantôme n'est pas un détail de mise en page.** `.paneslot` prend la case laissée
vide par le panneau sorti du flux. Sans lui, la grille se retasse derrière le flou, puis
se retasse encore à la fermeture : deux redimensionnements de TOUS les pty, donc des mots
coupés dans des sessions que personne n'avait touchées, pour un mouvement que personne
n'avait demandé.

**La croix vit sur l'arrière-plan, pas dans la barre de titre.** Celle du panneau ARRÊTE
la session : deux croix à trois centimètres l'une de l'autre qui ne font pas la même
chose est une faute qu'aucune infobulle ne rattrape. La gouttière du haut de `.pane.zoomed`
est en pixels et non en `vh`, parce que c'est là que la croix se pose — une fenêtre courte
la ferait chevaucher le panneau.

**La vue lisible a été retirée, et c'est l'agrandi qui l'a rendue inutile.** Un panneau
`claude` s'est ouvert un temps sur une seconde surface : les tours de parole relus dans le
tampon de xterm, chaque outil replié en une ligne qu'un clic dépliait (`readBlocks`,
`paintDigest`, `setReading`, `test/digest.test.mjs` — tout est dans `git log`, commit
1f67f38). Ce qu'on venait y chercher, c'était lire une session sans plisser les yeux ;
mettre le panneau devant le donne sans rien INTERPRÉTER. Ce qui reste à l'écran est ce que
`claude` a écrit, à la colonne près, et rien d'autre — plus de repérage à tenir à jour
contre la mise en page du CLI. Gardé ici pour que la question ne se repose pas sans son
histoire.

## Le peintre du terminal

**Par défaut, xterm dessine en DOM**, cellule par cellule : un coup de molette repasse par
la mise en page du navigateur, ligne par ligne, et pour CHAQUE panneau qui reçoit du texte
en même temps. C'est ce qui hachait le défilement là où Terminal.app glisse — lui peint
sur le GPU. `gpu()` charge l'addon WebGL de xterm : même terminal, même thème, même
feuille de style, seul le peintre change.

**Et il sait se relâcher.** Deux façons de le perdre, les deux prévues. Le navigateur ne
tient qu'une poignée de contextes WebGL à la fois — la grille se scindant seule, on peut
ouvrir assez de panneaux pour qu'il retire le plus ancien — et une machine, ou un Chrome
headless de capture, peut n'en donner aucun. Dans les deux cas l'addon est jeté
(`onContextLoss`, ou le `try` autour de sa construction) et xterm revient au rendu DOM de
lui-même. Un panneau qui défile moins bien vaut mieux qu'un panneau noir.

**Le module doit voyager avec l'app.** `server.mjs` le sert sous `/vendor/addon-webgl.js`
comme les deux autres, et `scripts/make-app.sh` VÉRIFIE sa présence dans le bundle : un
module oublié là ne se voit qu'à l'exécution, dans l'app empaquetée, et jamais en
`npm start`.

## Les deux visionneuses

Elles sont en **lecture seule**, toutes les deux, et c'est ce qui les rend sûres :
regarder le graphe ou l'histoire ne peut rien casser dans le dépôt. Elles ont chacune
une adresse (`#p=<projet>&d=graph`, `&d=git`), pour la même raison que les onglets —
une capture headless doit pouvoir les ouvrir sans clic.

**Le graphe se pose AVANT d'être montré.** `simulate()` fait tourner 200 à 320 tours
de force dirigée sans rien afficher, puis peint et cadre une fois. Trois gains, et le
troisième n'était pas prévu : on ne fait pas regarder une pelote qui se démêle pendant
cinq secondes ; le cadrage a des positions définitives à cadrer ; et le résultat ne
dépend plus du rythme des images — c'est ce qui a rendu la vérification headless
possible, `requestAnimationFrame` étant à peine servi sous `--virtual-time-budget`.
L'animation ne repart qu'au geste (traîner un noeud), et se referme d'elle-même.

**Une répulsion en 1/d² doit être bornée.** Deux noeuds qui se superposent donnent une
force gigantesque : le noeud part à des milliers de pixels et ne revient pas, le
cadrage s'ajuste alors sur du vide et le dessin utile occupe un dixième de l'écran.
`MAX_FORCE` et `MAX_STEP` sont là pour ça. Vu à l'écran avant d'être compris.

**Le rappel au centre se desserre quand le graphe grossit** (`GRAVITY = 4 / n`) : à
force égale, quatre cents noeuds s'écrasent en boule là où deux cents restent écartés,
et les communautés cessent de se lire. Au-delà de 450 noeuds, seuls les plus connectés
sont dessinés et l'en-tête le DIT — un nuage de cinq mille points n'est pas un dessin.

**L'arbre git tient dans `lanes()`, et cette fonction est testée.** Un dessin de graphe
git faux reste un dessin : rien à l'écran ne dit qu'une branche part du mauvais
commit. D'où `test/repo.test.mjs`, sur les cas qui trompent les rendus naïfs — la
fusion, la voie libérée puis reprise, et le parent hors fenêtre. Ce dernier est le
piège : une histoire coupée à 250 commits a des parents qu'on n'a pas chargés, et les
croire vivants dessine des traits qui descendent jusqu'au bas de l'écran sans jamais
rencontrer leur commit. Une voie ne se déplace JAMAIS d'un rang à l'autre — c'est ce
qui autorise le trait vertical pour ce qui passe et la courbe pour ce qui bifurque.

**`origin/HEAD` n'est pas une branche.** C'est un alias vers celle par défaut : affiché,
il double chaque étiquette du dépôt distant sans rien apprendre. Filtré à la lecture.

**Un dossier suivi doit porter son PROPRE `.git`.** `repo.mjs` ne remonte pas aux
parents : un sous-dossier inscrit comme projet afficherait sinon l'histoire du dépôt
qui le contient, qui n'est pas la sienne. Même règle que dans `graph.mjs`.

## L'app Mac, et ce qu'elle change (ou pas)

`Pyra.app` n'est pas un second produit : c'est la même app web, dans une fenêtre
qui lui appartient. `electron/main.js` fait trois choses — ouvrir la fenêtre, poser
le menu, importer `server.mjs` dans SON PROCESS — et rien d'autre. Aucune logique
métier n'est passée de l'autre côté, et c'est la règle à tenir : le jour où Electron
disparaît, `npm start` et un navigateur suffisent encore.

**Un seul serveur, un seul registre.** L'app sonde le port avant de démarrer quoi que
ce soit : si un `npm start` tourne déjà, elle lui emprunte son serveur au lieu
d'échouer sur EADDRINUSE. Et le registre a quitté le dépôt pour
`~/Library/Application Support/Pyra/projects.json` (`registryPath`, `server.mjs`) —
obligatoire, parce qu'un bundle signé qui s'écrit dedans invalide sa signature et ne
redémarre plus sur Apple Silicon ; utile, parce que deux registres donneraient deux
listes de projets sans que rien ne le dise. L'ancien fichier du dépôt est repris une
fois, par copie, et n'est plus lu.

**L'emballage n'a pas de packager.** Un bundle Electron EST le runtime de
`node_modules` avec le code déposé dans `Contents/Resources/app`. Trois détails le
font démarrer, tous dans `scripts/make-app.sh` : la charge n'emporte que les
dépendances de production (`npm ls --omit=dev`), les assistants Chromium sont
renommés avec l'app (ils se trouvent par le `CFBundleName`), et le bundle est
re-signé à la fin — le retoucher annule la signature qu'il portait, et sur Apple
Silicon une signature invalide est fatale.

**La liste des modules embarqués est écrite à la main, donc elle prend du retard.**
`make-app.sh` copie les modules racine un par un ; un module ajouté au dépôt et
importé par `server.mjs` n'entre pas tout seul dans la charge. L'app se lance
quand même — l'erreur n'arrive qu'à l'import manquant, chez l'utilisateur, pas au
build (`repo.mjs`, `forge.mjs` et `settings.mjs` sont partis comme ça). Le script
suit maintenant les imports relatifs depuis `electron/main.js` et `server.mjs` dans
la copie, et s'arrête net s'il en manque un.

**`node-pty` n'a pas besoin d'être recompilé.** Son prebuild est en N-API
(`napi_register_module_v1`), donc le même `.node` se charge sous Node et sous
Electron. `make-app.sh` le vérifie plutôt que de l'espérer : le jour où ça cesse
d'être vrai, le build échoue au lieu du premier terminal ouvert.

**La barre de l'app EST la barre de titre.** La fenêtre est en `titleBarStyle:
"hiddenInset"` et la page reçoit `?app=1`, qui allume `body.in-app` : 86 px réservés
à gauche pour les trois boutons, et la barre devient déplaçable. C'est un paramètre
d'URL et non un reniflage d'Electron, pour qu'une capture headless ouvre
exactement la même page.

## Ce qu'il faut savoir avant de toucher au code

**Lire dans `~/Documents` peut figer TOUTE l'app.** macOS protège Documents, Bureau
et Téléchargements par TCC. La demande d'autorisation ne peut s'afficher que si
l'`Info.plist` porte la chaîne `NS*FolderUsageDescription` correspondante — sinon
l'`open()` ne revient jamais : pas d'erreur, pas de refus, pas de fenêtre. Et comme
`MILESTONES.md` est lu de façon SYNCHRONE (`milestones.read`) dans le process qui
tient aussi le serveur, c'est la boucle d'événements de Node qui s'arrête avec lui.
Le symptôme ne ressemble en rien à la cause : fenêtre blanche, serveur qui accepte
les connexions sans jamais répondre, ⌘Q sans effet, 0 % de CPU. Les trois chaînes
sont posées par `scripts/make-app.sh`. Même blocage si l'écran est verrouillé au
premier lancement — la demande ne peut pas s'afficher, l'app attend ; déverrouiller
la débloque. Diagnostic : `sample <pid>`, et chercher `uv_fs_open` → `open` en bas
de la pile du thread principal.

**Et la demande revient à CHAQUE réinstallation.** Le bundle est signé ad hoc
(`Signature=adhoc`, pas d'équipe) : le hash change à chaque `make-app.sh --install`,
macOS y voit une autre application et remet son autorisation à zéro. Donc après
chaque installation, le premier lancement se fige jusqu'à ce qu'on accepte — la même
fenêtre blanche et le même serveur muet qu'une vraie panne. Ce n'en est pas une, il
n'y a qu'à cliquer. Mesuré : `curl /api/settings` sans réponse, `sample` sur
`__open`, puis tout repart d'un coup une fois l'accès donné. C'est aussi le seul prix
de la note « un `.app` notarié » du `MILESTONES.md` : signé pour de bon, le hash
cesserait de bouger et l'autorisation tiendrait.

**`spawn-helper` perd son bit exécutable.** npm extrait les prebuilds de node-pty
sans les permissions. Chaque `pty.spawn()` échoue alors sur un `posix_spawnp failed`
qui ne dit rien de la cause. D'où le `postinstall`. Si les terminaux ne démarrent
plus après une réinstallation, c'est là qu'il faut regarder en premier.

**Les terminaux ne doivent pas hériter de l'environnement d'un Claude parent.**
Si Pyra est lancé depuis une session Claude, l'environnement porte
`CLAUDE_CODE_CHILD_SESSION` et consorts. Un `claude` qui en hérite se croit
sous-session : transcript désactivé, donc plus de `/resume`. `NESTING_VARS` dans
`terminals.mjs` liste ce qu'on retire. Vérifié : sans ce nettoyage, la bannière
« Transcript saving is off » apparaît dans chaque panneau.

**Un terminal n'a pas de processus tant que le navigateur n'a pas annoncé sa
taille.** `create()` fabrique une coquille ; `start()` lance le programme à la
première mesure reçue, avec un filet à 3 s si aucun client ne se connecte. Lancé
avant, `claude` peint son invite à une largeur fausse et le redimensionnement
laisse des mots coupés en travers du panneau — c'était visible à l'écran.
Côté client, la première mesure est en plus temporisée de 150 ms (`resize()` dans
`app.js`) : entre l'ouverture de la WebSocket et la pose de la grille, le panneau
passe par une taille intermédiaire plus large, et c'est elle qui partait. Les
mesures suivantes sont de vrais redimensionnements et partent sans délai.

**`.dhead` était déjà pris.** Les classes de la vue lisible — retirée depuis — s'étaient
appelées `.dsay`, `.dtool`, `.dhead`… et `.dhead` est depuis toujours l'en-tête des
visionneuses. Chaque ligne d'outil héritait donc de son `border-bottom` : un filet gris en
travers de la vue, qu'aucune règle nouvelle n'expliquait. Vu à l'écran, pas deviné. Le
code est parti, la leçon reste : une feuille de style sans portée ni build est un espace
de noms PLAT, et un nom de trois lettres y est presque sûrement déjà pris — `grep` avant
de nommer. Les classes de l'agrandi (`.zback`, `.zclose`, `.zbtn`, `.paneslot`) sont
passées par ce `grep`.

**Un panneau qu'on met devant ne se démonte pas.** Ni `appendChild` ailleurs, ni
`display: none` sur le terminal : les deux lui font perdre ses dimensions, `fit()` le
remesure à zéro, et le pty renaît à la mauvaise largeur — les mots coupés en travers que
la temporisation de 150 ms existe déjà pour éviter. D'où le `position: fixed` et le
fantôme plutôt qu'un déplacement, dans « Agrandir un panneau ».

**Un `<dialog>` fermé ne doit son invisibilité qu'au navigateur.** `#settings` portait
un `display: flex` NON conditionné, et le panneau des réglages restait peint par-dessus
la page en permanence — au chargement, sans qu'on ait cliqué la roue. Le `display` va
sur `#settings[open]`, comme `dialog.big[open]` deux blocs plus bas l'avait déjà compris.
La sélection est la moitié de la règle. Symptôme trompeur : la page a l'air d'ouvrir les
réglages toute seule, et l'attribut `open` n'est pourtant nulle part dans le DOM.

**Une capture headless d'un terminal ne rend jamais la main.** Les WebSockets des
panneaux gardent la page vivante, donc `--virtual-time-budget` n'expire pas et Chrome
ne sort pas. Il faut le lancer en arrière-plan, attendre que le fichier de capture
existe, puis le tuer. Sans ça, chaque capture bloque jusqu'au délai de garde puis
échoue. Et `--user-data-dir` doit être neuf à chaque fois : un profil réutilisé restaure
la session précédente et capture une AUTRE page que celle demandée — vu, en capturant
ApplyStudio en croyant capturer Pyra.

**Le collage d'une étape attend que l'invite soit prête, et n'appuie jamais sur
Entrée.** Claude met une à deux secondes à peindre son invite, et peut afficher
d'abord le dialogue de confiance du dossier — où une frappe vaut réponse. On
attend donc un silence de 900 ms *et* l'absence de formulation bloquante
(`BLOCKING` dans `app.js`). Le motif a été resserré après un test : `❯` y figurait
et bloquait tout, puisque c'est aussi le chevron de l'invite ordinaire. Le mode bypass
ajoute une question au répertoire : au tout premier lancement, Claude fait accepter sa
mise en garde (« WARNING: Claude Code running in Bypass Permissions mode » / « Yes, I
accept »), et coller dedans y vaudrait réponse. Le bouton « ⌥ step » de l'en-tête reste
le filet quand l'automatisme rate.

**Le `claude` appelé est résolu à la main, et `~/.local/bin` passe AVANT
`/opt/homebrew/bin`.** Deux installations cohabitent souvent sur une même machine :
l'installateur natif dans `~/.local/bin`, qui se met à jour tout seul, et un paquet npm
dans `/opt/homebrew/bin`, figé au jour de son installation. Lancée depuis le Finder,
l'app n'hérite pas du PATH du shell : elle reconstruit le sien (`richPath()`), et
l'ordre des dossiers ajoutés décide donc à quel binaire elle parle. Avec homebrew en
tête, Pyra interrogeait un claude de six versions de retard et la barre latérale
affichait `unknown option '--json'` — l'option existe, c'est le binaire qui était vieux.
`claudeBin()` (dans `terminals.mjs`) renvoie maintenant le chemin complet du premier
candidat trouvé dans cet ordre, et `agentsError()` traduit « unknown option » en
« claude trop ancien » plutôt que de laisser croire à un bug de l'app.

**Les panneaux maison ressortent aussi de `claude agents --json`.** Le pty fait
`exec claude`, donc son pid EST celui de claude. `ownPids` dans `buildState()`
rapproche les deux ; sans ça, chaque panneau compterait double dans la barre
latérale — une fois comme terminal, une fois comme session « ailleurs ».

**Rejoindre une session ouverte ailleurs ouvre une BRANCHE.** `claude attach` ne
sait reprendre que les sessions d'arrière-plan. Pour une session interactive qui
vit dans un autre terminal, on lance `claude --resume <id> --fork-session` : le fil
est repris ici, la session d'origine continue intacte. La branche démarre dans le
**cwd de la session**, pas dans celui du projet — une session de `PDM/qcbm-ring`
rouverte à la racine de `PDM` travaillerait à côté de ses fichiers. Le chemin
demandé est validé : il doit être sous le projet.

**On repart toujours du disque à l'enregistrement.** `PUT /steps` relit le fichier,
refusionne la liste reçue, puis réécrit. Le fichier a pu changer entre deux
enregistrements — édité à la main, ou par un Claude qui tourne dans ce projet-là.
La prose hors étapes est conservée telle quelle, en-tête compris : c'est pourquoi
un vieil en-tête « # Milestones » survit à la migration et doit être corrigé à la main.

**Les ids d'étape sont forgés côté serveur.** Ils atterrissent dans un commentaire
HTML (`<!--id:...-->`) que la relecture doit savoir reparser. Un id venu du client
et non conforme laissait le commentaire collé au titre, et l'étape se dédoublait
au tour suivant.

**La génération greffe, elle ne remplace pas.** `graft()` ajoute les milestones et les
étapes absents, et rien d'autre : un titre déjà présent (à la casse et aux accents
près) n'est pas dupliqué, un statut existant n'est jamais réécrit, aucune ligne n'est
retirée. Sans cette garantie, appuyer sur le bouton une seconde fois serait un pari
sur ce qu'on va perdre — et personne n'appuierait. Le seul enrichissement toléré est
la note d'un milestone qui n'en avait aucune.

**Le fichier est relu APRÈS l'appel au modèle, pas seulement avant.** Une génération
dure une à trois minutes ; l'utilisateur peut cocher une étape pendant ce temps, ou
un Claude du projet écrire dans le fichier. La greffe se fait sur la version fraîche.

**Le journal git est injecté dans le prompt, pas laissé au modèle.** Lui donner Bash
pour un `git log`, ce serait ouvrir l'exécution de commandes dans le dépôt de
l'utilisateur pour une ligne de contexte qu'on sait produire soi-même. Les outils
autorisés se limitent à `Read`, `Glob`, `Grep`.

**`--json-schema` plutôt qu'un markdown à redécouper.** La sortie du modèle est une
structure validée ; une réponse bavarde ne peut donc pas se retrouver telle quelle
dans le dépôt. Et `--no-session-persistence` : ces appels sont jetables, sauvegardés
ils encombreraient le `/resume` de l'utilisateur et la liste des sessions vivantes.

**Une génération ne bloque pas sa requête HTTP.** `POST /generate` répond `202` tout
de suite ; l'état vit dans la map `gens` du serveur et ressort dans `/api/state`.
L'interface peint l'état « en cours » sans attendre le rafraîchissement suivant,
sinon le clic aurait l'air de n'avoir rien fait pendant quatre secondes.

**`graphify` n'est pas dans le PATH d'une app lancée depuis le Finder.** `uv tool
install` pose ses binaires dans `~/.local/bin`, que le PATH d'un process GUI ne
contient pas. `bin()` cherche donc le PATH d'abord, puis trois emplacements connus.
Sans cette recherche, chaque construction échouerait sur un `ENOENT` que rien dans
l'interface n'expliquerait.

**`--no-label` est ce qui garde la construction gratuite.** `graphify cluster-only`
appelle un LLM pour NOMMER ses communautés si on ne le lui interdit pas. Les
communautés restent donc « Community N » dans le `GRAPH_REPORT.md` — c'est le prix
assumé de la règle « aucun appel au modèle ». Y toucher, c'est faire payer un geste
que l'app déclenche toute seule. `--no-viz` épargne en plus un `graph.html` de
plusieurs mégaoctets que personne n'ouvre depuis Pyra.

**L'exclusion est posée AVANT la construction, pas après.** `graphify extract` crée
le `graphify-out/` puis peut échouer — un dépôt neuf sans code, par exemple. Le dossier
reste alors sur le disque. Tant que `exclude()` n'était appelée qu'en cas de succès,
l'utilisateur retrouvait un artefact de construction dans son prochain `git add`. Vu
sur le premier projet créé de bout en bout : `?? graphify-out/` dans un dépôt censé
être propre.

**Un README réduit à son titre EXISTE.** `readme()` rend `{ file, title, text: "" }`
quand il n'y a pas un paragraphe de plus de 24 caractères. Le client testait
`pv?.blurb?.text` et annonçait « No README in this repository » — faux pour tout projet
qu'on vient de créer, et de nature à faire croire que la création a oublié un fichier.
Les deux cas se distinguent maintenant.

**`.gnote` est un `display:flex`, et un compte rendu est une COLONNE.** Le déroulé de
l'installation emprunte la taille et la couleur de `.gnote`, mais pas sa direction :
sans `.col`, ses quatre gestes se rangeaient côte à côte sur une seule ligne. Même
famille de piège que les `" · "` mangés par le flex — les blancs de bord d'un item
flex disparaissent, c'est le `gap` qui sépare, jamais une espace dans la chaîne.

**Un dialogue ouvert par `showModal()` donne le focus à son premier bouton.** Ici
« Close », qui s'allumait comme s'il était le geste attendu. `autofocus` sur l'élément
`<dialog>` lui-même garde le focus sur le cadre. Dans le formulaire de création, le
champ « Name » le prend — et c'est le bon endroit.

**Les deux panneaux ont une adresse (`#s=settings`, `#s=new`).** Même raison que les
visionneuses : une vérification visuelle se fait en headless, où personne ne clique. Un
panneau sans adresse est un panneau qu'on ne peut regarder qu'à la main. Fermer un
panneau efface son adresse — l'événement `close` du dialogue couvre les trois façons
de fermer (le bouton, Échap, le clic hors cadre), ce que `showModal` ne fait pas seul.

**`gh` n'est pas dans le PATH d'une app lancée depuis le Finder.** Exactement le même
piège que `graphify`, et le même remède (`ghBin()`). `git`, lui, vit dans `/usr/bin`
et n'a pas ce souci — c'est pourquoi un seul des deux binaires est cherché à la main.

**`git commit` échoue sans identité, et son message fait douze lignes.** C'est la
panne la plus fréquente d'un premier commit sur une machine neuve. `firstCommit()` la
reconnaît et rend la commande à taper plutôt que le pavé de git.

**L'exclusion va dans `.git/info/exclude`, jamais dans le `.gitignore`.** Le
`.gitignore` appartient à l'utilisateur et part avec le dépôt s'il le publie. Une app
de suivi n'a rien à écrire dans un fichier versionné — c'est le même principe que la
règle sur le `MILESTONES.md`, appliquée à un artefact de construction.

**La péremption se lit par PRÉFIXE.** Le `GRAPH_REPORT.md` abrège le commit à huit
caractères, `git rev-parse HEAD` en rend quarante. Et un dossier hors git n'est jamais
déclaré périmé : il n'a pas d'horloge, le prétendre poserait une pastille orange
permanente sur un projet qui va très bien.

**`state()` lit le rapport, pas le graphe.** Elle est appelée pour chaque projet à
chaque `/api/state`, donc toutes les quelques secondes. Le `GRAPH_REPORT.md` fait
quelques kilo-octets là où `graph.json` peut peser plusieurs mégaoctets, et `HEAD` est
lu directement dans `.git` plutôt que par un sous-processus `git`.

**Un item flex mange les blancs de ses bords.** La ligne d'état du graphe est un
`display:flex` : les `" · "` écrits dans le texte perdaient leur espace et donnaient
`8 edges· built from`. Les séparateurs sont donc espacés par le `gap`, jamais par une
espace dans la chaîne. Vu à l'écran, pas deviné.

**Supprimer un milestone emporte ses étapes.** C'est l'UI qui les joint à la liste
supprimée (`save()`), pas le serveur : orphelines, elles remonteraient au premier
niveau et deviendraient des milestones à leur tour.

**Le fichier a porté deux noms, et il est revenu au premier.** `MILESTONES.md`,
puis `ETAPES.md`, puis `MILESTONES.md` de nouveau — le vocabulaire de l'app s'est
fixé sur *milestone*. `read()` relit encore l'ancien nom ; le premier enregistrement
écrit le nouveau et SUPPRIME l'ancien. D'où la règle avant tout futur renommage :
`FILENAME` et `LEGACY_FILENAME` ne doivent jamais s'échanger sans avoir vérifié
qu'aucun dépôt suivi ne porte les deux fichiers à la fois — le plus récent y
passerait. Un `find ~/Documents -name '<ancien nom>'` suffit.

**Les sessions appartiennent au chemin le plus long.** Une session ouverte dans
`PDM/qcbm-ring` revient à `qcbm-ring` s'il est suivi, pas à `PDM`.

**Une capture headless d'un terminal peut sortir vide.** `--virtual-time-budget`
fait défiler le temps du navigateur bien plus vite que le temps réel : la page peut
être capturée avant que le sous-processus ait produit quoi que ce soit. Ce n'est pas
un défaut de l'app — vérifier le tampon côté serveur avant de conclure. Et capturer
un terminal né sous une AUTRE mise en page montre des mots coupés : le dialogue de
Claude ne se repeint pas à la largeur nouvelle. Recréer le terminal avant de juger.

**L'app s'appelait Pyramis.** Le nom a été raccourci en Pyra, et trois traces de
l'ancien restent volontairement dans le code, parce qu'elles pointent vers des
fichiers qui appartiennent à l'utilisateur :
  — `registryPath()` (`server.mjs`) copie une fois le registre depuis
    `~/Library/Application Support/Pyramis/projects.json` ; sans cette reprise, le
    changement de nom viderait la liste de projets sans rien dire ;
  — `MARK_WAS` (`graph.mjs`) reconnaît encore `<!-- pyramis:graphify -->` dans le
    `CLAUDE.md` d'un dépôt suivi de longue date, sinon `pointer()` y greffe un
    second bloc identique ;
  — `scripts/make-app.sh --install` signale `/Applications/Pyramis.app` sans la
    jeter : l'identifiant de bundle a changé (`com.paulgregory.pyra`), les deux
    apps coexistent donc, et c'est à l'utilisateur de supprimer l'ancienne.
Les variables d'environnement ont suivi le nom : `PYRA_REGISTRY`, `PYRA_MODEL`,
`PYRA=1`. Elles, personne ne les hérite d'une installation précédente.

## Ce qui n'est pas fait

- Aucun suivi de quota. N sessions Opus en parallèle vident la fenêtre de 5 h vite ;
  l'app affiche le nombre de sessions vivantes, pas ce qu'il reste à dépenser.
- Pas de réordonnancement des étapes par glisser-déposer ; l'ordre est celui du fichier.
- Une étape ne peut pas changer de milestone depuis l'interface, ni un milestone devenir
  étape. Ça se fait dans le fichier, en déplaçant la ligne.
- La génération ne dit jamais qu'une étape est devenue caduque : elle ajoute, elle ne
  taille pas. L'élagage reste à la main — c'est le prix de la garantie qu'elle
  n'enlève rien.
- L'ordre des projets dans la barre latérale est fixe : ceux qui ont des sessions
  actives ne remontent pas d'eux-mêmes.
- Les panneaux ne se réordonnent pas et ne se déplacent pas à la souris : la grille
  suit l'ordre de création, et le seul geste de mise en page est l'agrandissement.
- Le mode de permission est global, pas par projet. Un dépôt qu'on préférerait tenir
  en `manual` demanderait un réglage par projet — donc un endroit où le garder, et le
  registre n'est pas fait pour ça.
- Rien ne nettoie `os.tmpdir()/pyra-drops`. C'est délibéré : macOS purge `/var/folders`,
  et une app qui efface des fichiers est une app qui peut en effacer un de trop.
- On ne peut pas coller une image depuis le presse-papiers (⌘V) : seul le dépôt est
  câblé. `xterm` traite déjà ⌘V comme du texte, et lui reprendre ce geste demanderait
  de distinguer les deux cas à chaque frappe.
- Aucun rafraîchissement automatique du graphe. Il se périme au fil des commits et
  c'est l'utilisateur qui appuie — `graphify watch` existe, mais un processus par
  projet suivi tournant en permanence n'a pas été jugé payant.
- La synchro se déclenche sur ce que Pyra ÉCRIT (un enregistrement d'étapes, une
  génération, une construction de graphe), pas sur une horloge. Un dépôt qui bouge
  tout seul ne sera pas poussé.
- Elle ne sait que pousser. Pas de `pull`, pas de résolution de conflit : une branche
  divergée rend son échec et attend l'utilisateur. C'est délibéré — un `pull` qui
  rate au milieu laisse un dépôt dans un état que l'app ne saurait pas défaire.
- Un seul provider. La table est faite pour en accueillir d'autres, mais rien n'a été
  écrit pour un second, et le champ « model » n'est validé par personne avant le CLI.
- Le graphe d'un projet créé est vide par construction (rien que du markdown au
  premier jour). Rien ne le reconstruit quand le code arrive : c'est un clic sur
  « Build graph ».
- La création ne sait pas partir d'un modèle de projet : un README, un `.gitignore` de
  deux lignes et trois milestones à remplacer. Deviner la pile d'un projet qui n'a pas
  encore une ligne de code, c'est se tromper.
- Les communautés du graphe ne sont pas nommées (« Community 0, 1, 2 »). Les nommer
  demanderait un appel au modèle, et c'est exactement ce que la construction s'interdit.
- Les deux visionneuses ne modifient rien : on ne renomme pas une branche, on ne
  reconstruit pas le graphe depuis le dessin. Le seul geste qu'elles offrent est la
  copie d'un hash.
- L'arbre git s'arrête à 250 commits et ne sait pas en charger davantage. Il ne montre
  pas non plus les fichiers d'un commit : ce serait un client git, pas un aperçu.
- Le graphe n'a pas de mise en page stable d'une ouverture à l'autre au-delà du départ
  en spirale : deux dessins du même dépôt se ressemblent, ils ne sont pas identiques.
- Retirer un projet du registre ne retire ni son `graphify-out/`, ni le bloc greffé
  dans son `CLAUDE.md`. C'est la règle « ne jamais supprimer un fichier de
  l'utilisateur », et le bloc est délimité précisément pour qu'il l'enlève lui-même.
- Le gain réel est de l'ordre de **5,8×** sur Pyra (mesuré par `graphify benchmark`),
  pas des 71× annoncés par le projet : ce chiffre-là vaut pour un dépôt de plusieurs
  centaines de fichiers. Le graphe paie sur PDM ou soc-ai-trading, pas sur un dépôt de
  dix fichiers.

## Index inverse — quelle tâche touche quoi

| Ce qu'on veut faire | Où aller |
|---|---|
| Changer la grammaire de `MILESTONES.md` | `milestones.mjs` (`parse` / `serialize` / `apply`), puis `test/milestones.test.mjs` |
| Renommer le fichier des dépôts | `milestones.mjs` (`FILENAME` / `LEGACY_FILENAME`), après avoir cherché les deux noms sur le disque |
| Retoucher ce que le modèle propose | `prompts/milestones.md` (aucun redémarrage) |
| Changer les outils ou le modèle de la génération | `generate.mjs` (`READ_ONLY`, `SCHEMA`, `PYRA_MODEL`) |
| Changer la règle de fusion d'une proposition | `milestones.mjs` (`graft`), puis `test/milestones.test.mjs` |
| Ajouter un champ à une étape | `milestones.mjs` (`mergeItem`, `serialize`), `server.mjs` (`buildState`, `PUT /steps`), `public/app.js` (`stepCard`) |
| Toucher au cycle de vie d'un terminal | `terminals.mjs` (`create` / `start` / `resize` / `kill`) |
| Changer ce que Claude demande avant d'agir | `settings.mjs` (`PERMISSION_MODES`, `cliCommand`), puis `test/settings.test.mjs` — jamais `--permission-mode bypassPermissions` |
| Changer la découpe de la grille des terminaux | `public/app.js` (`gridShape`, `layout`, les trois constantes `CELL_*`), jamais sans recapture headless |
| Toucher à l'agrandissement d'un panneau | `public/app.js` (`setZoom`, `zoomBack`, `zoomSlot`, `layout`), `public/style.css` (`.pane.zoomed`, `.zback`, `.zclose`, `.paneslot`) — les noms courts sont un espace PLAT, `grep` avant d'en choisir un |
| Toucher au peintre du terminal | `public/app.js` (`gpu`), `server.mjs` (`/vendor/addon-webgl.js`), `scripts/make-app.sh` (la liste des modules vérifiés) |
| Changer ce qu'un clic fait dans un panneau | `public/app.js` (`zoomTarget`) — la liste des exceptions EST la règle |
| Toucher au « ＋ » ou au choix du projet | `public/app.js` (`addTile`, `askTerminal`, `renderNewTerm`), `public/index.html` (`#newterm`), `public/style.css` (`.addpane`, `.tlist`) |
| Toucher au dépôt d'un fichier dans un panneau | `public/app.js` (`dropTarget`, `dropFiles`, `typeInto`), `server.mjs` (`/drop`, `DROPS`, `readRaw`, `dropName`) |
| Changer la façon de rejoindre une session | `server.mjs` (`POST /api/attach`), `public/app.js` (`joinSession`) |
| Toucher à la hiérarchie milestone/étape | `milestones.mjs` (`link`, `insertionPoint`), `public/app.js` (`mains`, `kids`, `subRow`) |
| Modifier la barre latérale | `public/app.js` (`renderSide`), `public/style.css` (`#side`, `.sessions`) |
| Toucher au passage d'une vue à l'autre | `public/app.js` (`showProject`, `focusPane`, `showView`) — les deux sens, jamais un seul |
| Changer ce que l'aperçu montre | `repo.mjs` (`overview`, `readme`, `languages`), `public/app.js` (`previewPanel`) |
| Toucher au repli d'un milestone | `public/app.js` (`isOpen`, `setOpen`, `msRow`), clé `pyra.open` du `localStorage` |
| Retoucher la force dirigée du graphe | `public/app.js` (`simulate`, bloc des constantes) — le résultat ne se juge qu'à l'écran |
| Changer le dessin des voies git | `repo.mjs` (`lanes`) puis `test/repo.test.mjs`, et `gitRow` pour le tracé |
| Retoucher la direction artistique | `public/style.css` (bloc `:root`), `scripts/brand.mjs` pour les images |
| Changer ce que Graphify extrait (docs, images, LLM) | `graph.mjs` (`build`), en pesant d'abord la règle « aucun appel au modèle » |
| Retoucher le bloc greffé dans les `CLAUDE.md` | `graph.mjs` (`BLOCK`, `MARK_OPEN`), puis `test/graph.test.mjs` |
| Changer ce que l'interface dit du graphe | `public/app.js` (`graphNote`, `graphButton`), `public/style.css` (`.gnote`) |
| Changer le logo du graphe | `public/brand/graph-pyr.png`, puis `node scripts/brand.mjs` — `graphIcon()` et `.gicon` ne bougent pas |
| Changer ce qui se déclenche à la création d'un projet | `settings.mjs` (`DEFAULTS.create`), `server.mjs` (`startForge`), `public/app.js` (`CREATE_OPTS`) — les intitulés viennent d'une SEULE liste |
| Ajouter un provider | `settings.mjs` (`PROVIDERS`), puis `server.mjs` (`/api/connections`, la résolution du binaire) |
| Toucher à ce que l'app commite | `forge.mjs` (`OWNED`, `sync`), puis `test/forge.test.mjs` — chaque nom ajouté est un fichier de plus qu'on s'autorise chez quelqu'un d'autre |
| Créer le dépôt distant autrement | `forge.mjs` (`createRemote`, `ghBin`) |
| Changer le squelette d'un projet neuf | `forge.mjs` (`scaffold`, `starter`, `GITIGNORE`) |
| Retoucher le panneau des réglages | `public/index.html` (`#settings`), `public/app.js` (`renderSettings`, `SET_PANES`), `public/style.css` (`.sset`, `.ssub`, `.frow`, `.opts`) |
| Regarder un panneau sans cliquer | son adresse : `#s=settings`, `#s=settings&sp=perm`, `#s=new` — un `sp` inconnu (`usage`, d'avant la fusion) retombe sur `model` |
| Ajouter une route | `server.mjs`, bloc `http` |
| Toucher à la fenêtre, au menu, au ⌘Q | `electron/main.js` |
| Changer ce que le bundle emporte, ou son identité | `scripts/make-app.sh` |
| Refaire l'icône de l'app | `public/brand/logo-pyr.png`, puis `scripts/icon.mjs` |
| Déplacer le registre | `server.mjs` (`registryPath`) — jamais dans le dépôt |

## Protocole de mise à jour

1. Lire le hash de la première ligne.
2. `git diff --name-only <baseline>..HEAD` et `git status --porcelain`.
3. Ne relire que ce qui a bougé, et ne corriger que les sections concernées.
4. Avancer le hash de la première ligne jusqu'au `HEAD` courant.

Pas de hook git : la réconciliation se fait ici, à la main, la prochaine fois qu'on
travaille dans le dépôt.

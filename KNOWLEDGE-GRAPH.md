<!-- graph-baseline: c3ce2e8 -->
# Pyramis — carte du code

Ce document décrit le dépôt tel qu'il était au commit indiqué en première ligne.
Protocole de mise à jour en bas de page.

## Le pari

Pyramis ne stocke rien qui lui soit propre. Il n'a ni base de données, ni état
métier. Deux sources de vérité, toutes deux extérieures à l'app :

1. **Les étapes** vivent dans `MILESTONES.md`, à la racine de chaque dépôt suivi.
2. **Les sessions Claude** viennent de `claude agents --json`, c'est-à-dire de
   Claude Code lui-même.

Conséquence à ne pas perdre de vue : si Pyramis disparaît, rien n'est perdu. Un
`MILESTONES.md` reste lisible dans un éditeur, et il est déjà dans le dépôt que Claude
ouvre quand il travaille dessus. C'est la garde contre le vrai risque du projet —
qu'un neuvième pyramis vienne s'ajouter aux huit qu'il devait alléger.

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
illisible que Pyramis existe pour éviter. C'est aussi pourquoi il n'y a pas de
troisième niveau : le schéma envoyé au modèle n'en propose pas, et `link()` aplatit
ce qu'un fichier écrit à la main pourrait contenir de plus profond.

## Le graphe de connaissance, et pourquoi il ne coûte rien

Un projet qu'on ajoute au registre repart avec un graphe Graphify dans son
`graphify-out/`. C'est le seul geste automatique de l'app, et il tient au fait qu'il
est **gratuit** : `graphify extract --code-only` lit le code par AST, en local, sans
clé d'API. Graphify sait aussi extraire le sens des docs, des papiers et des images —
en envoyant leur contenu à un LLM. Cette porte reste fermée dans `graph.mjs`, et c'est
la décision qui autorise l'automatisme : ajouter un projet ne doit jamais déclencher
une dépense qu'on n'a pas demandée. Corollaire à connaître avant de s'étonner : un
dépôt qui n'est que du markdown produit un graphe presque vide.

Les projets déjà suivis n'en ont pas reçu. Le bouton `◈ Build graph` est là pour eux,
et pour les graphes que le dépôt a dépassés.

**Deux cartes, et elles ne disent pas la même chose.** Ce `KNOWLEDGE-GRAPH.md` est
écrit à la main : il porte le *pourquoi* et les pièges, c'est-à-dire ce qu'aucune
extraction ne trouvera jamais. Le `graphify-out/` est machine, régénérable, et porte
le *où* : quel symbole appelle quoi, à quelle ligne. L'un ne remplace pas l'autre, et
c'est pourquoi le `CLAUDE.md` renvoie aux deux. Si l'un doit être cru sur parole en
cas de désaccord, c'est le graphe machine pour les faits de code, et celui-ci pour
les intentions.

Le bloc que `pointer()` greffe dans le `CLAUDE.md` d'un dépôt est **en anglais** alors
que la documentation de Pyramis est en français : il est généré à l'identique pour
tous les dépôts suivis, quelle que soit leur langue, donc il relève de la règle des
prompts et non de celle de la documentation.

## La direction artistique

Elle est tirée de `public/brand/logo-pyr.png` (une pyramide à trois étages, violet à
gauche, bleu à droite) et de `public/brand/brand-pyr.png` (PYRAMIS en capitales fines
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

`scripts/brand.mjs` regénère les déclinaisons depuis les deux originaux : le
mot-symbole rogné sur fond transparent (la police du logo n'existe pas sur la
machine — la réapprocher donnerait un faux, donc c'est une image), et la pyramide
en 256 / 128 / 64 px. Les originaux restent dans `public/brand/`.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `server.mjs` | Serveur HTTP sur 127.0.0.1 : API JSON, registre des projets, relais WebSocket. |
| `milestones.mjs` | Analyse et réécriture de `MILESTONES.md`. Aucune dépendance au reste. |
| `generate.mjs` | L'appel au modèle : un `claude -p` en lecture seule dans le dépôt. |
| `prompts/milestones.md` | Le prompt de génération. Relu à chaque appel, donc modifiable à chaud. |
| `graph.mjs` | Le graphe de connaissance d'un dépôt : construction Graphify, état, exclusion git, pointeur. |
| `terminals.mjs` | Les pseudo-terminaux. Un `claude` ou un shell réel par panneau. |
| `public/app.js` | Toute l'UI. Pas de framework, pas d'étape de build. |
| `scripts/fix-pty.mjs` | Remet `+x` sur le `spawn-helper` de node-pty après chaque `npm install`. |
| `scripts/brand.mjs` | Regénère mot-symbole et pyramide depuis les deux originaux. |
| `public/brand/` | Les originaux (`logo-pyr.png`, `brand-pyr.png`) et leurs déclinaisons. |

## Ce qu'il faut savoir avant de toucher au code

**`spawn-helper` perd son bit exécutable.** npm extrait les prebuilds de node-pty
sans les permissions. Chaque `pty.spawn()` échoue alors sur un `posix_spawnp failed`
qui ne dit rien de la cause. D'où le `postinstall`. Si les terminaux ne démarrent
plus après une réinstallation, c'est là qu'il faut regarder en premier.

**Les terminaux ne doivent pas hériter de l'environnement d'un Claude parent.**
Si Pyramis est lancé depuis une session Claude, l'environnement porte
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

**Le collage d'une étape attend que l'invite soit prête, et n'appuie jamais sur
Entrée.** Claude met une à deux secondes à peindre son invite, et peut afficher
d'abord le dialogue de confiance du dossier — où une frappe vaut réponse. On
attend donc un silence de 900 ms *et* l'absence de formulation bloquante
(`BLOCKING` dans `app.js`). Le motif a été resserré après un test : `❯` y figurait
et bloquait tout, puisque c'est aussi le chevron de l'invite ordinaire. Le bouton
« ⌥ step » de l'en-tête reste le filet quand l'automatisme rate.

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
plusieurs mégaoctets que personne n'ouvre depuis Pyramis.

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
- Aucun rafraîchissement automatique du graphe. Il se périme au fil des commits et
  c'est l'utilisateur qui appuie — `graphify watch` existe, mais un processus par
  projet suivi tournant en permanence n'a pas été jugé payant.
- Les communautés du graphe ne sont pas nommées (« Community 0, 1, 2 »). Les nommer
  demanderait un appel au modèle, et c'est exactement ce que la construction s'interdit.
- Retirer un projet du registre ne retire ni son `graphify-out/`, ni le bloc greffé
  dans son `CLAUDE.md`. C'est la règle « ne jamais supprimer un fichier de
  l'utilisateur », et le bloc est délimité précisément pour qu'il l'enlève lui-même.
- Le gain réel est de l'ordre de **5,8×** sur Pyramis (mesuré par `graphify benchmark`),
  pas des 71× annoncés par le projet : ce chiffre-là vaut pour un dépôt de plusieurs
  centaines de fichiers. Le graphe paie sur PDM ou soc-ai-trading, pas sur un dépôt de
  dix fichiers.

## Index inverse — quelle tâche touche quoi

| Ce qu'on veut faire | Où aller |
|---|---|
| Changer la grammaire de `MILESTONES.md` | `milestones.mjs` (`parse` / `serialize` / `apply`), puis `test/milestones.test.mjs` |
| Renommer le fichier des dépôts | `milestones.mjs` (`FILENAME` / `LEGACY_FILENAME`), après avoir cherché les deux noms sur le disque |
| Retoucher ce que le modèle propose | `prompts/milestones.md` (aucun redémarrage) |
| Changer les outils ou le modèle de la génération | `generate.mjs` (`READ_ONLY`, `SCHEMA`, `PYRAMIS_MODEL`) |
| Changer la règle de fusion d'une proposition | `milestones.mjs` (`graft`), puis `test/milestones.test.mjs` |
| Ajouter un champ à une étape | `milestones.mjs` (`mergeItem`, `serialize`), `server.mjs` (`buildState`, `PUT /steps`), `public/app.js` (`stepCard`) |
| Toucher au cycle de vie d'un terminal | `terminals.mjs` (`create` / `start` / `resize` / `kill`) |
| Changer la façon de rejoindre une session | `server.mjs` (`POST /api/attach`), `public/app.js` (`joinSession`) |
| Toucher à la hiérarchie milestone/étape | `milestones.mjs` (`link`, `insertionPoint`), `public/app.js` (`mains`, `kids`, `subRow`) |
| Modifier la barre latérale | `public/app.js` (`renderSide`), `public/style.css` (`#side`, `.sessions`) |
| Retoucher la direction artistique | `public/style.css` (bloc `:root`), `scripts/brand.mjs` pour les images |
| Changer ce que Graphify extrait (docs, images, LLM) | `graph.mjs` (`build`), en pesant d'abord la règle « aucun appel au modèle » |
| Retoucher le bloc greffé dans les `CLAUDE.md` | `graph.mjs` (`BLOCK`, `MARK_OPEN`), puis `test/graph.test.mjs` |
| Changer ce que l'interface dit du graphe | `public/app.js` (`graphNote`, `graphButton`), `public/style.css` (`.gnote`) |
| Cesser de construire un graphe à l'ajout d'un projet | `server.mjs` (`POST /api/projects`, le `b.graph !== false`) |
| Ajouter une route | `server.mjs`, bloc `http` |

## Protocole de mise à jour

1. Lire le hash de la première ligne.
2. `git diff --name-only <baseline>..HEAD` et `git status --porcelain`.
3. Ne relire que ce qui a bougé, et ne corriger que les sections concernées.
4. Avancer le hash de la première ligne jusqu'au `HEAD` courant.

Pas de hook git : la réconciliation se fait ici, à la main, la prochaine fois qu'on
travaille dans le dépôt.

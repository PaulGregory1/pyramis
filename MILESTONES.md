# Pyra

Suivi du développement de Pyra, dans Pyra. Les milestones ci-dessous sont
reconstitués depuis l'historique du dépôt — c'est l'état réel, pas une intention.

- [x] Le socle : suivi de projets parallèles et terminaux Claude <!--id:68352b5a-->
      Serveur Node sans build, registre de projets, panneaux de vrais pseudo-terminaux.
  - [x] Registre de projets et vue d'ensemble <!--id:b0445d43-->
  - [x] Panneaux `claude` interactifs, qui survivent au rechargement de l'onglet <!--id:8331d3cf-->
  - [x] Bouton ▶ qui dépose l'étape dans l'invite sans appuyer sur Entrée <!--id:f9aaea82-->

- [x] Le fichier des étapes : deux niveaux, et rien de plus <!--id:84a90375-->
      `MILESTONES.md` vit dans le dépôt du projet ; l'app reste jetable.
  - [x] Grammaire `- [ ] / [~] / [!] / [x]`, id planqué en commentaire HTML <!--id:4119a602-->
  - [x] Reprise de l'ancien nom `ETAPES.md`, renommé au premier enregistrement <!--id:16b486b8-->
  - [x] Génération greffée : rien n'est réécrit, aucun statut n'est touché <!--id:9d14cc16-->
  - [x] Interface et prompts en anglais, documentation en français <!--id:1cb9241a-->

- [x] Le graphe de connaissance <!--id:b70f0d61-->
      Extraction locale Graphify, sans jamais appeler le modèle.
  - [x] `extract --code-only` + `cluster-only --no-label`, aucun token dépensé <!--id:75eb94a8-->
  - [x] Un projet qu'on ajoute repart avec son graphe, tout seul <!--id:7e002a00-->
  - [x] Bloc greffé dans le `CLAUDE.md` du projet, délimité pour être retirable <!--id:199d2fe5-->
  - [x] Bouton `◈ Build graph` pour les graphes que le dépôt a dépassés <!--id:752ea006-->

- [x] L'app Mac <!--id:1a99bae7-->
      Pyra s'ouvre depuis Spotlight comme n'importe quelle autre application.
  - [x] Coquille Electron : une fenêtre, un menu, un ⌘Q — aucune logique métier <!--id:1d64f430-->
  - [x] `scripts/make-app.sh --install` → `/Applications/Pyra.app` <!--id:0690d0be-->
  - [x] Registre déplacé hors du dépôt, dans Application Support <!--id:6e3642fa-->
  - [x] Le piège TCC documenté : l'accès à Documents demandé au premier lancement <!--id:605de879-->

- [x] Pyra se suit lui-même <!--id:00479de8-->
      Le dépôt est inscrit à son propre registre, avec ce fichier.

- [x] La page d'un projet en deux étages <!--id:7b908078-->
      En haut ce que le dépôt est, en bas ce qu'il reste à en faire.
  - [x] Aperçu : README, langages, branche, dernier commit, quatre mesures <!--id:3151628e-->
  - [x] Visionneuse du graphe de connaissance, force dirigée écrite à la main <!--id:de69952e-->
  - [x] Visionneuse de l'arbre git, voies et fusions dessinées depuis `git log --all` <!--id:e43b8825-->
  - [x] Les milestones en liste dépliable, dans l'ordre du fichier <!--id:d9b19b2d-->
- [x] Créer un projet de zéro, et les réglages qui décident de ce qui s'enclenche @done:2026-09-02 <!--id:08bf9556-->
      Le drapeau vit dans le registre : un dossier simplement ajouté ne subit aucun automatisme.
  - [x] Panneau des réglages : le provider, le binaire résolu, la connexion `gh` @done:2026-09-02 <!--id:e0008917-->
  - [x] `git init`, premier commit, dépôt distant — en tâche de fond, chaque geste sur sa ligne @done:2026-09-02 <!--id:45c7fb1e-->
  - [x] Synchro qui nomme ses fichiers, jamais un `git add -A` @done:2026-09-02 <!--id:843d70e6-->
  - [x] Un seul automatisme qui dépense, et il est décoché par défaut @done:2026-09-02 <!--id:b51c0ac4-->
- [ ] Remanier le tableau sans ouvrir le fichier <!--id:6a2d4b5b-->
      Le fichier reste la vérité : tout geste de l'interface doit se relire dans un éditeur.
  - [ ] Déplacer une étape d'un milestone à un autre <!--id:e62e4eef-->
  - [ ] Réordonner milestones et étapes à la souris, le fichier suivant l'ordre affiché <!--id:0ec539d9-->
  - [ ] Promouvoir une étape en milestone, et redescendre un milestone en étape <!--id:3cb68268-->
  - [ ] Marquer ce que la génération croit caduc, sans jamais le retirer soi-même <!--id:f56f660f-->
- [ ] Un graphe qui ne prend plus de retard sur son dépôt <!--id:5ab546bf-->
      Reconstruire reste `--code-only` et `--no-label` : le jour où ça coûte un token, l'automatisme tombe.
  - [ ] Détecter la péremption à l'ouverture d'un projet et reconstruire sans clic <!--id:dcc6b85c-->
  - [ ] Un projet créé construit son graphe dès qu'il a sa première ligne de code <!--id:fe82c8b4-->
  - [ ] Dire dans la visionneuse de quel commit le dessin est tiré <!--id:07d9ed42-->
- [ ] Savoir ce que la journée a coûté, pas seulement combien de sessions vivent <!--id:65991e25-->
      Aucun relevé qui dépense, sinon le compteur devient la dépense qu'il mesure.
  - [ ] Relever la fenêtre de 5 h auprès du CLI, sans clé d'API <!--id:39678926-->
  - [ ] Barre latérale : ce qu'il reste, à côté du nombre de sessions <!--id:e11d4aeb-->
  - [ ] Prévenir avant d'ouvrir une session de plus quand la fenêtre se referme <!--id:0e283096-->
- [ ] Pyra s'installe sur une machine qui ne l'a pas écrit <!--id:50105b46-->
  - [ ] Un `.app` notarié, qui s'ouvre sans passer par le clic droit <!--id:d0422bb7-->
  - [ ] Premier lancement sans projets pré-inscrits ni chemin codé en dur <!--id:30b77ad1-->
  - [ ] Le piège TCC expliqué au premier écran, pas seulement dans le README <!--id:17f0420d-->
  - [ ] `npm test` vert sur une machine neuve, node-pty compris <!--id:ddafbd0c-->

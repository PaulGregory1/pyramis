# Pyra

Suivi du développement de Pyra, dans Pyra. Les milestones ci-dessous sont
reconstitués depuis l'historique du dépôt — c'est l'état réel, pas une intention.

- [x] Le socle : suivi de projets parallèles et terminaux Claude
      Serveur Node sans build, registre de projets, panneaux de vrais pseudo-terminaux.
  - [x] Registre de projets et vue d'ensemble
  - [x] Panneaux `claude` interactifs, qui survivent au rechargement de l'onglet
  - [x] Bouton ▶ qui dépose l'étape dans l'invite sans appuyer sur Entrée

- [x] Le fichier des étapes : deux niveaux, et rien de plus
      `MILESTONES.md` vit dans le dépôt du projet ; l'app reste jetable.
  - [x] Grammaire `- [ ] / [~] / [!] / [x]`, id planqué en commentaire HTML
  - [x] Reprise de l'ancien nom `ETAPES.md`, renommé au premier enregistrement
  - [x] Génération greffée : rien n'est réécrit, aucun statut n'est touché
  - [x] Interface et prompts en anglais, documentation en français

- [x] Le graphe de connaissance
      Extraction locale Graphify, sans jamais appeler le modèle.
  - [x] `extract --code-only` + `cluster-only --no-label`, aucun token dépensé
  - [x] Un projet qu'on ajoute repart avec son graphe, tout seul
  - [x] Bloc greffé dans le `CLAUDE.md` du projet, délimité pour être retirable
  - [x] Bouton `◈ Build graph` pour les graphes que le dépôt a dépassés

- [x] L'app Mac
      Pyra s'ouvre depuis Spotlight comme n'importe quelle autre application.
  - [x] Coquille Electron : une fenêtre, un menu, un ⌘Q — aucune logique métier
  - [x] `scripts/make-app.sh --install` → `/Applications/Pyra.app`
  - [x] Registre déplacé hors du dépôt, dans Application Support
  - [x] Le piège TCC documenté : l'accès à Documents demandé au premier lancement

- [x] Pyra se suit lui-même
      Le dépôt est inscrit à son propre registre, avec ce fichier.

- [x] La page d'un projet en deux étages
      En haut ce que le dépôt est, en bas ce qu'il reste à en faire.
  - [x] Aperçu : README, langages, branche, dernier commit, quatre mesures
  - [x] Visionneuse du graphe de connaissance, force dirigée écrite à la main
  - [x] Visionneuse de l'arbre git, voies et fusions dessinées depuis `git log --all`
  - [x] Les milestones en liste dépliable, dans l'ordre du fichier

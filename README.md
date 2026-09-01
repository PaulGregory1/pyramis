# Pyramis

Le tableau de bord des projets menés en parallèle : où en est chacun, et de quoi
lancer le travail sans changer de fenêtre.

## Ce que ça fait

**Une vue d'ensemble qui ne montre que ce qui bouge.** Chaque projet affiche ses
étapes en cours et bloquées — pas la liste complète, qui reproduirait le problème
qu'on cherche à régler.

**Des étapes qui vivent dans les dépôts.** Un `ETAPES.md` à la racine de chaque
projet, en markdown ordinaire :

    - [~] Détecter la 3e répétition ATTEIGNABLE @due:2026-09-20
          Le référé annule dès que la position est atteignable, pas atteinte.
    - [x] Baseline vs Stockfish niveau 3 @done:2026-09-01

`[ ]` à faire · `[~]` en cours · `[!]` bloquée · `[x]` faite. Éditable à la main, lu
par le Claude qui travaille dans le projet, versionné avec le reste.

**Toutes les sessions d'un projet, sous son nom.** La barre latérale liste sous
chaque projet les sessions Claude qui lui appartiennent — celles ouvertes ici, et
celles lancées ailleurs sur la machine, marquées « ailleurs ». Un clic y va :
sur un panneau de Pyramis, il le met en avant ; sur une session d'ailleurs, il en
reprend le fil dans une branche, la session d'origine continuant intacte de son
côté. Le bouton **Tous les projets**, en haut, ramène à la vue d'ensemble.

**Autant de terminaux que voulu, en même temps.** Chaque panneau est un vrai
pseudo-terminal : un vrai `claude` interactif, avec ses couleurs, son `/resume` et
ses dialogues de permission. Rien n'est réimplémenté, donc rien ne diverge. Fermer
l'onglet du navigateur ne tue pas les sessions ; elles se retrouvent au rechargement.

**Un bouton ▶ sur chaque étape.** Il ouvre un terminal Claude dans le bon dossier
et y dépose l'étape, prête à partir. Il n'appuie pas sur Entrée : la dernière
décision reste à toi.

## Lancer

    ./start.sh

Au premier démarrage, six projets sont pré-inscrits s'ils existent : ecdsa.fail,
carnet Singapour, Skull King, PDM, chess hackathon, SoAI. `＋ Suivre un projet`
ajoute les autres. Le registre est un `projects.json` éditable à la main.

## Ce que ça ne fait pas

Pas de suivi de quota : l'app compte les sessions vivantes, pas les jetons. Lancer
cinq sessions Opus en parallèle vide la fenêtre de 5 h beaucoup plus vite qu'on ne
le croit — le compteur en haut à droite est là pour le rappeler.

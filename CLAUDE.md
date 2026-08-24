# CLAUDE.md — règles de travail sur WorldPaint

Ce fichier complète `CONTRIBUTING.md`, qui reste la référence sur la structure
du projet, la frontière thème/moteur et les invariants d'architecture. Ce qui
suit est ce qu'un assistant doit savoir **en plus**.

## Vérification visuelle : ce n'est pas à toi de la faire

**Ne juge jamais toi-même du rendu.** WorldPaint produit un paysage : sa qualité
se constate à l'œil, dans la démo ou dans une application consommatrice, et
c'est le rôle de l'auteur du projet — pas le tien.

Concrètement :

- ne lance pas la démo, ne prends pas de capture, n'ouvre pas de navigateur pour
  « aller voir si ça rend bien » ;
- n'affirme jamais qu'un changement « améliore le paysage », « rend mieux » ou
  « est plus crédible » : tu ne l'as pas vu ;
- décris ce que le code **fait**, pas l'effet que tu supposes qu'il produira ;
- à la fin d'un chantier, dis explicitement ce qui reste à vérifier
  visuellement, et où le regarder (quel réglage, quelle case à cocher, quel
  type de lieu).

Ce qui est vérifiable sans les yeux, en revanche, doit l'être et l'être
vraiment : `npm test`, le chargement des modules, le nombre de tests avant et
après. Rapporte ces chiffres tels quels, sans les arrondir dans le bon sens.

## Le vocabulaire du projet

Le code, les commentaires et les tests sont **en français**. Les commentaires
expliquent *pourquoi*, pas *quoi* — un commentaire qui paraphrase la ligne
suivante est du bruit. Les modules portent un en-tête qui dit la raison d'être
du fichier et les décisions qu'on ne doit pas défaire par inadvertance ; quand
tu modifies un module en profondeur, cet en-tête fait partie du diff.

## Portée d'un chantier

- Une étape à la fois, telle qu'elle a été demandée. Pas de refactor préventif,
  pas d'abstraction « pendant qu'on y est », pas de système générique tant qu'il
  n'a pas deux sites d'appel réels.
- Une valeur artistique (couleur, densité, hauteur, palette) ne se change pas au
  passage pour faire tenir un correctif. Si une correction en exige une, dis-le
  et laisse la décision à l'auteur.
- Le déterminisme spatial est un invariant dur : la même donnée doit rendre le
  même paysage. Toute graine dérive d'une position au sol quantifiée, jamais de
  l'ordre de parcours ni de la position de l'observateur.

## Ce qu'on attend en fin de tâche

1. le nombre de tests avant / après, et le résultat réel de `npm test` ;
2. la liste exacte des fichiers modifiés ;
3. ce qui a été délibérément laissé hors périmètre, et pourquoi ;
4. ce qui reste à contrôler à l'œil, et où.

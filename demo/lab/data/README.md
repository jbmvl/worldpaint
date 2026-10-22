# Fond de l’atlas des régions

`countries.json` conserve les géométries et noms des pays de Natural Earth
1:110m dont au moins un sommet se trouve dans la fenêtre 16° O–23° E,
30° N–65° N. Les géométries de ces pays sont conservées entières.

Source : [Natural Earth, pays 1:110m](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson).
Données dans le [domaine public](https://www.naturalearthdata.com/about/terms-of-use/).
Ce fond donne les repères terrestres ; il ne décide pas des régions du moteur.

`cities.json` contient les villes du jeu Natural Earth 1:50m situées entre
12° O–15° E et 34° N–63° N, avec `POP_MAX` supérieur ou égal à 100 000.
Le nom français, la position et `POP_MAX` sont conservés. Cette dernière valeur
sert uniquement à donner priorité aux libellés des grandes agglomérations ;
ce n’est pas un relevé actuel de population. Les libellés trop proches sont
masqués à l’affichage, puis apparaissent avec le zoom.

Source : [Natural Earth, lieux habités 1:50m](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_populated_places.geojson),
également dans le domaine public.

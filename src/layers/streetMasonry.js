/*
 * streetMasonry — joints des dalles de caniveau et des éléments de bordure.
 * Les joints découpent les triangles déjà posés : ils suivent exactement le
 * caniveau incliné, sans recalculer le terrain. Leur phase suit l'abscisse
 * du réseau ; un coin de rue sans abscisse s'ancre à sa position quantifiée.
 */

// Polygone en cours de découpe, quatre nombres par sommet (t, x, y, z) : un
// triangle coupé par deux limites garde au plus cinq sommets. Les réserves
// sont partagées — une section de bordure pose des milliers de joints.
const TRIANGLE = new Float64Array(3 * 4);
const APRES_BAS = new Float64Array(4 * 4);
const APRES_HAUT = new Float64Array(5 * 4);

/** Ajoute les joints au tampon, sans changer les sommets de la section. */
export function ajouterJointsVoirie(tampon, { debut, points, profil, demiLargeur, style, couleur }) {
  const colonnes = profil.length;
  const abscisses = [];
  let distance = Math.round(points[0].x * 10) / 10 + Math.round(points[0].z * 10) / 10;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    abscisses.push(Number.isFinite(points[i].distance) ? points[i].distance : distance);
  }
  const lire = (rang, ligne, colonne, t) => {
    const indice = debut + (ligne * colonnes + colonne) * 3;
    TRIANGLE[rang * 4] = t;
    TRIANGLE[rang * 4 + 1] = tampon.positions[indice];
    TRIANGLE[rang * 4 + 2] = tampon.positions[indice + 1];
    TRIANGLE[rang * 4 + 3] = tampon.positions[indice + 2];
  };
  for (let r = 0; r < points.length - 1; r++) {
    const longueur = abscisses[r + 1] - abscisses[r];
    if (longueur <= 0) continue;
    for (let c = 0; c < colonnes - 1; c++) {
      const a = profil[c], b = profil[c + 1];
      if (a.up !== 0 || b.up !== 0 || a.across === b.across) continue;
      const milieu = Math.abs((a.across + b.across) / 2);
      const pas = milieu < demiLargeur + style.gutterWidth ? style.gutterSlabLength : style.kerbBlockLength;
      const largeur = style.jointWidth;
      if (!(pas > 0 && largeur > 0 && largeur < pas)) continue;
      const premier = Math.ceil((abscisses[r] - largeur / 2) / pas);
      const dernier = Math.floor((abscisses[r + 1] + largeur / 2) / pas);
      for (let joint = premier; joint <= dernier; joint++) {
        const bas = Math.max(0, (joint * pas - largeur / 2 - abscisses[r]) / longueur);
        const haut = Math.min(1, (joint * pas + largeur / 2 - abscisses[r]) / longueur);
        if (haut <= bas) continue;
        for (let moitie = 0; moitie < 2; moitie++) {
          if (moitie === 0) {
            lire(0, r, c, 0); lire(1, r + 1, c, 1); lire(2, r, c + 1, 0);
          } else {
            lire(0, r, c + 1, 0); lire(1, r + 1, c, 1); lire(2, r + 1, c + 1, 1);
          }
          const garde = couper(TRIANGLE, 3, bas, true, APRES_BAS);
          const nombre = couper(APRES_BAS, garde, haut, false, APRES_HAUT);
          if (nombre < 3) continue;
          const origine = tampon.positions.length / 3;
          for (let i = 0; i < nombre; i++) {
            tampon.positions.push(APRES_HAUT[i * 4 + 1], APRES_HAUT[i * 4 + 2] + 0.001, APRES_HAUT[i * 4 + 3]);
            tampon.colors.push(...couleur);
          }
          for (let i = 1; i < nombre - 1; i++) {
            tampon.indices.push(origine, origine + i, origine + i + 1);
          }
        }
      }
    }
  }
}

/** Garde la part du polygone d'un côté de `limite` ; rend son nombre de sommets. */
function couper(source, nombre, limite, garderApres, cible) {
  let n = 0;
  for (let i = 0; i < nombre; i++) {
    const a = i * 4, b = ((i + 1) % nombre) * 4;
    const ta = source[a], tb = source[b];
    const dedansA = garderApres ? ta >= limite : ta <= limite;
    const dedansB = garderApres ? tb >= limite : tb <= limite;
    if (dedansA) {
      for (let k = 0; k < 4; k++) cible[n * 4 + k] = source[a + k];
      n++;
    }
    if (dedansA !== dedansB) {
      const ratio = (limite - ta) / (tb - ta);
      cible[n * 4] = limite;
      for (let k = 1; k < 4; k++) cible[n * 4 + k] = source[a + k] + (source[b + k] - source[a + k]) * ratio;
      n++;
    }
  }
  return n;
}

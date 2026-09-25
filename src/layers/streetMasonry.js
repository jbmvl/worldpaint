/*
 * streetMasonry — joints des dalles de caniveau et des éléments de bordure.
 * Les joints découpent les triangles déjà posés : ils suivent exactement le
 * caniveau incliné, sans recalculer le terrain. Leur phase suit l'abscisse
 * du réseau ; un coin de rue sans abscisse s'ancre à sa position quantifiée.
 */

/** Ajoute les joints au tampon, sans changer les sommets de la section. */
export function ajouterJointsVoirie(tampon, { debut, points, profil, demiLargeur, style, couleur }) {
  const colonnes = profil.length;
  const abscisses = [];
  let distance = Math.round(points[0].x * 10) / 10 + Math.round(points[0].z * 10) / 10;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    abscisses.push(Number.isFinite(points[i].distance) ? points[i].distance : distance);
  }
  const lire = (ligne, colonne, t) => {
    const indice = debut + (ligne * colonnes + colonne) * 3;
    return { t, position: tampon.positions.slice(indice, indice + 3) };
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
      const triangles = [
        [lire(r, c, 0), lire(r + 1, c, 1), lire(r, c + 1, 0)],
        [lire(r, c + 1, 0), lire(r + 1, c, 1), lire(r + 1, c + 1, 1)],
      ];
      const premier = Math.ceil((abscisses[r] - largeur / 2) / pas);
      const dernier = Math.floor((abscisses[r + 1] + largeur / 2) / pas);
      for (let joint = premier; joint <= dernier; joint++) {
        const bas = Math.max(0, (joint * pas - largeur / 2 - abscisses[r]) / longueur);
        const haut = Math.min(1, (joint * pas + largeur / 2 - abscisses[r]) / longueur);
        if (haut <= bas) continue;
        for (const triangle of triangles) {
          const polygone = couper(couper(triangle, bas, true), haut, false);
          if (polygone.length < 3) continue;
          const origine = tampon.positions.length / 3;
          for (const sommet of polygone) {
            const [x, y, z] = sommet.position;
            tampon.positions.push(x, y + 0.001, z);
            tampon.colors.push(...couleur);
          }
          for (let i = 1; i < polygone.length - 1; i++) {
            tampon.indices.push(origine, origine + i, origine + i + 1);
          }
        }
      }
    }
  }
}

function couper(polygone, limite, garderApres) {
  const resultat = [];
  for (let i = 0; i < polygone.length; i++) {
    const a = polygone[i], b = polygone[(i + 1) % polygone.length];
    const dedansA = garderApres ? a.t >= limite : a.t <= limite;
    const dedansB = garderApres ? b.t >= limite : b.t <= limite;
    if (dedansA) resultat.push(a);
    if (dedansA !== dedansB) {
      const ratio = (limite - a.t) / (b.t - a.t);
      resultat.push({ t: limite, position: a.position.map((v, k) => v + (b.position[k] - v) * ratio) });
    }
  }
  return resultat;
}

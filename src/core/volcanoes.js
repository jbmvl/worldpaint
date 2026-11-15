/*
 * volcanoes — les volcans qui crachent du feu dans le décor.
 *
 * Les tuiles disent où est un volcan (`mountain_peak`, `class=volcano`), pas
 * s'il est actif : un puy d'Auvergne et l'Etna y portent la même classe. La
 * liste est donc tenue ici, à la main, par coordonnées du sommet. Le cratère
 * exact se retrouve dans le relief (`volcanoFire.craterSite`) : quelques
 * centaines de mètres d'écart ne comptent pas.
 *
 * `activity` (0 à 1) dose tout : gerbes, coulées, panache. Le Vésuve dort
 * depuis 1944 ; il est réveillé ici, pour le spectacle.
 */

export const ACTIVE_VOLCANOES = Object.freeze([
  { id: 'vesuvio', name: 'Vésuve', lng: 14.4260, lat: 40.8216, activity: 1 },
  { id: 'etna', name: 'Etna', lng: 14.9934, lat: 37.7510, activity: 1 },
  { id: 'stromboli', name: 'Stromboli', lng: 15.2130, lat: 38.7890, activity: 0.9 },
  { id: 'vulcano', name: 'Vulcano', lng: 14.9620, lat: 38.4040, activity: 0.5 },
  { id: 'teide', name: 'Teide', lng: -16.6420, lat: 28.2723, activity: 0.6 },
  { id: 'tajogaite', name: 'Tajogaite', lng: -17.8660, lat: 28.6130, activity: 0.8 },
  { id: 'hekla', name: 'Hekla', lng: -19.6660, lat: 63.9920, activity: 0.8 },
  { id: 'sundhnukur', name: 'Sundhnúkur', lng: -22.4300, lat: 63.8800, activity: 0.8 },
  { id: 'nea_kameni', name: 'Néa Kaméni', lng: 25.3960, lat: 36.4040, activity: 0.4 },
  { id: 'piton_fournaise', name: 'Piton de la Fournaise', lng: 55.7140, lat: -21.2440, activity: 1 },
  { id: 'pelee', name: 'Montagne Pelée', lng: -61.1650, lat: 14.8090, activity: 0.5 },
  { id: 'soufriere', name: 'Soufrière', lng: -61.6630, lat: 16.0440, activity: 0.5 },
].map(Object.freeze));

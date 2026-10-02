import { argon2id, hash } from 'argon2';

/**
 * Le minimum recommandé par l'OWASP : 19 Mio, 2 passes, 1 voie.
 * Écrits ici plutôt que laissés aux défauts de la bibliothèque (64 Mio, 4 voies) :
 * chaque hachage réserve memoryCost de RAM, et l'inscription comme le login
 * sont des routes publiques. 20 hachages simultanés aux défauts = 1,25 Gio.
 */
const ARGON2_OPTIONS = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

/**
 * Renvoie une chaîne PHC : $argon2id$v=19$m=19456,p=1,t=2$<sel>$<hash>.
 * Le sel est tiré au hasard par la bibliothèque, à chaque appel.
 */

export function hashPassword(palin) {
  return hash(palin, ARGON2_OPTIONS);
}

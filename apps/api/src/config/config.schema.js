import { z } from 'zod';

const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'];

/**
 * Une URL PostgreSQL, pas seulement une URL bien formée.
 * Coller par erreur l'URL de Redis dans DATABASE_URL doit échouer AU DÉMARRAGE,
 * pas au premier connect() — c'est toute la raison d'être de cette branche.
 */
const postgresUrl = z.string().refine(
  (value) => {
    try {
      return POSTGRES_PROTOCOLS.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { error: 'doit être une URL PostgreSQL (postgres:// ou postgresql://)' },
);

/**
 * Décrit ce QU'EST une configuration valide. Ne lit rien, ne lance rien.
 *
 * Volontairement NON strict : ce schéma sera appliqué à process.env en entier,
 * qui contient PATH, HOME, SHELL. z.object() ignore les clés inconnues ;
 * un .strict() exploserait sur la première variable système.
 */
export const configSchema = z.object({
  // Pas de .default() : un conteneur de prod dont la variable a sauté
  // démarrerait en mode développement SANS un mot. 'test' est nécessaire
  // car Jest positionne NODE_ENV=test tout seul.
  NODE_ENV: z.enum(['development', 'test', 'production']),

  // .min(1) : la chaîne vide est coercée en 0, et Node interprète le port 0
  // comme « attribue-moi un port libre au hasard ». L'app démarrerait
  // parfaitement, sur un port que personne ne connaît.
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  DATABASE_URL: postgresUrl,

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

import { configSchema } from './config.schema.js';

/**
 * Levée au démarrage uniquement. N'hérite PAS de DomainError (branche 4) :
 * une erreur de configuration ne devient jamais une réponse HTTP, puisqu'à ce
 * moment-là il n'y a pas encore de serveur HTTP.
 */
export class ConfigValidationError extends Error {
  constructor(issues) {
    super(
      `Configuration invalide — l'application ne démarrera pas :\n` +
        issues.map((issue) => `  • ${issue}`).join('\n'),
    );
    this.issues = issues;
    this.name = 'ConfigValidationError';
  }
}

/**
 * Fonction PURE : elle reçoit l'environnement en paramètre et ne lit jamais
 * process.env. C'est ce qui la rend testable sans toucher au processus.
 *
 * Ne fait PAS process.exit() : elle établit ce qui ne va pas, main.ts décide
 * ce que le processus en fait.
 */
export function loadConfig(env) {
  const result = configSchema.safeParse(env);

  if (result.success) {
    // Gel superficiel : rend la configuration réellement immuable à l'exécution.
    return Object.freeze(result.data);
  }

  // Message construit à la main, à partir du chemin et du message uniquement.
  // JAMAIS la valeur reçue : DATABASE_URL contient un mot de passe, et ce
  // message finit dans les logs de démarrage du conteneur.
  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
  );

  throw new ConfigValidationError(issues);
}

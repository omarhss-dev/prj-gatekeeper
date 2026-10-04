import { RequestValidationError } from '../errors/request-validation-error.js';

/**
 * Valide une valeur entrante (le corps, en pratique) contre un schéma Zod.
 * Renvoie la donnée PARSÉE, jamais la donnée reçue : les clés inconnues sont
 * retirées et les transformations du schéma appliquées.
 */

export class ZodValidationPipe {
  constructor(schema) {
    this.schema = schema;
  }

  transform(value) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new RequestValidationError(result.error.issues);
    }
    return result.data;
  }
}

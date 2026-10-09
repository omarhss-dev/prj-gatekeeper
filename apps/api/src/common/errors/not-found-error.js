export class NotFoundError extends Error {
  name = 'NotFoundError';

  constructor() {
    super('Ressource introuvable');
  }
}

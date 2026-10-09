export class ForbiddenError extends Error {
  name = 'ForbiddenError';

  constructor() {
    super('Acces refuse a cette ressource');
  }
}

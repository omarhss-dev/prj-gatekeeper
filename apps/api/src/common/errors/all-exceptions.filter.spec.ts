import { DomainError } from './domain-error.js';
import { toProblem } from './all-exceptions.filter.js';

describe('toProblem', () => {
  it('traduit une DomainError via la table, avec son code et son detail', () => {
    const problem = toProblem(
      new DomainError('SEAT_UNAVAILABLE', '2 des 3 sièges sont pris.'),
    );
    expect(problem).toEqual({
      type: 'https://gatekeeper.dev/errors/seat-unavailable',
      title: 'Seat unavailable',
      status: 409,
      detail: '2 des 3 sièges sont pris.',
      code: 'SEAT_UNAVAILABLE',
    });
  });

  it('prend le status de la table, pas une valeur par défaut', () => {
    expect(toProblem(new DomainError('MAX_SEATS_EXCEEDED', 'x')).status).toBe(
      422,
    );
  });

  it("ne laisse rien sortir d'une exception inconnue", () => {
    const problem = toProblem(new Error('relation "tickets" does not exist'));
    expect(problem.status).toBe(500);
    expect(problem).not.toHaveProperty('code');
    expect(JSON.stringify(problem)).not.toContain('tickets');
  });

  it("traite une valeur qui n'est pas une Error comme inconnue", () => {
    expect(toProblem('boom').status).toBe(500);
  });
});

import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DomainError } from './domain-error.js';
import { toProblem } from './all-exceptions.filter.js';

describe('toProblem', () => {
  it("garde le status d'une HttpException sans recopier son message", () => {
    const problem = toProblem(
      new NotFoundException('Cannot POST /secret-path'),
    );
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: "La requête n'a pas pu être traitée.",
    });
  });

  it('ne renvoie pas le message de JSON.parse pour un 400 de parsing', () => {
    const problem = toProblem(
      new BadRequestException(
        "Expected property name or '}' in JSON at position 1",
      ),
    );
    expect(problem.status).toBe(400);
    expect(problem.detail).not.toContain('position');
  });

  it('traite un 503 comme une erreur serveur, sans son message', () => {
    const problem = toProblem(new ServiceUnavailableException('not ready'));
    expect(problem.status).toBe(503);
    expect(problem.title).toBe('Service Unavailable');
    expect(problem.detail).not.toContain('not ready');
  });

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

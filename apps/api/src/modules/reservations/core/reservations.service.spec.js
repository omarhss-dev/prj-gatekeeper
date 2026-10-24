import { DomainError } from '../../../common/errors/domain-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import {
  ReservationsService,
  reservationRefusal,
  cancellationRefusal,
} from './reservations.service.js';

const NOW = new Date('2099-06-01T12:00:00Z');
const HOUR = 3_600_000;

/** Événement publié, en vente, à venir, 4 sièges au plus : tout est permis. */
const openEvent = (overrides = {}) => ({
  status: 'published',
  startsAt: new Date(NOW.getTime() + 24 * HOUR),
  salesOpenAt: new Date(NOW.getTime() - HOUR),
  maxSeatsPerReservation: 4,
  ...overrides,
});

describe('reservationRefusal', () => {
  it('null pour un événement publié, en vente, à venir', () => {
    expect(reservationRefusal(openEvent(), 4, NOW)).toBeNull();
  });

  it.each([
    ['inexistant', null],
    [
      'en brouillon : il n’existe pas pour le public',
      openEvent({ status: 'draft' }),
    ],
  ])('404 pour un événement %s', (_, event) => {
    expect(reservationRefusal(event, 1, NOW)).toBeInstanceOf(NotFoundError);
  });

  it.each([
    ['annulé', openEvent({ status: 'cancelled' })],
    ['déjà commencé', openEvent({ startsAt: NOW })],
  ])('EVENT_NOT_AVAILABLE pour un événement %s', (_, event) => {
    expect(reservationRefusal(event, 1, NOW).code).toBe('EVENT_NOT_AVAILABLE');
  });

  it("SALES_NOT_OPEN avec la date d'ouverture en extension", () => {
    const salesOpenAt = new Date(NOW.getTime() + HOUR);
    const refusal = reservationRefusal(openEvent({ salesOpenAt }), 1, NOW);
    expect(refusal.code).toBe('SALES_NOT_OPEN');
    expect(refusal.extensions).toEqual({ salesOpenAt });
  });

  it('accepte une vente qui ouvre à cet instant précis', () => {
    expect(
      reservationRefusal(openEvent({ salesOpenAt: NOW }), 1, NOW),
    ).toBeNull();
  });

  it('MAX_SEATS_EXCEEDED au-delà de la limite de l’événement', () => {
    expect(reservationRefusal(openEvent(), 5, NOW).code).toBe(
      'MAX_SEATS_EXCEEDED',
    );
  });

  it("ne parle pas de la vente d'un événement annulé", () => {
    const event = openEvent({
      status: 'cancelled',
      salesOpenAt: new Date(NOW.getTime() + HOUR),
    });
    expect(reservationRefusal(event, 1, NOW).code).toBe('EVENT_NOT_AVAILABLE');
  });
});

describe('ReservationsService.reserve', () => {
  const input = { eventId: 'e1', seatIds: ['s1', 's2'] };
  // Le service compare à l'heure réelle (new Date()), pas à NOW : la vente
  // doit donc être ouverte depuis toujours pour ces tests.
  const onSaleNow = () => openEvent({ salesOpenAt: new Date(0) });

  it("ne touche pas à l'écriture quand l'événement refuse", async () => {
    const repository = {
      findEventForReservation: async () => null,
      reserve: async () => {
        throw new Error('reserve ne doit pas être appelé');
      },
    };
    await expect(
      new ReservationsService(repository).reserve('u1', input),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('traduit les sièges indisponibles en SEAT_UNAVAILABLE avec leur liste', async () => {
    const repository = {
      findEventForReservation: async () => onSaleNow(),
      reserve: async () => ({ unavailableSeatIds: ['s2'] }),
    };
    const error = await new ReservationsService(repository)
      .reserve('u1', input)
      .catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('SEAT_UNAVAILABLE');
    expect(error.extensions).toEqual({ seatIds: ['s2'] });
  });

  it('renvoie la réservation et transmet acheteur, événement et sièges', async () => {
    const reservation = { id: 'r1', tickets: [] };
    const calls = [];
    const repository = {
      findEventForReservation: async () => onSaleNow(),
      reserve: async (...args) => {
        calls.push(args);
        return { reservation };
      },
    };
    await expect(
      new ReservationsService(repository).reserve('u1', input),
    ).resolves.toBe(reservation);
    expect(calls).toEqual([['u1', 'e1', ['s1', 's2']]]);
  });
});

describe('cancellationRefusal', () => {
  const BUYER = 'buyer-id';
  const reservation = (status, userId = BUYER) => ({ userId, status });

  it('404 pour une réservation inexistante', () => {
    expect(cancellationRefusal(null, BUYER)).toBeInstanceOf(NotFoundError);
  });

  it("404 pour la réservation d'un autre : son existence ne doit pas fuir", () => {
    expect(
      cancellationRefusal(reservation('confirmed', 'autre'), BUYER),
    ).toBeInstanceOf(NotFoundError);
  });

  it("404 pour la réservation déjà annulée d'un autre", () => {
    expect(
      cancellationRefusal(reservation('cancelled', 'autre'), BUYER),
    ).toBeInstanceOf(NotFoundError);
  });

  it('null pour sa propre réservation déjà annulée : DELETE est idempotent', () => {
    expect(cancellationRefusal(reservation('cancelled'), BUYER)).toBeNull();
  });

  it('RESERVATION_NOT_CANCELLABLE pour sa réservation confirmée', () => {
    expect(cancellationRefusal(reservation('confirmed'), BUYER).code).toBe(
      'RESERVATION_NOT_CANCELLABLE',
    );
  });
});

describe('ReservationsService.cancel', () => {
  it("ne relit pas la base quand l'annulation a réussi", async () => {
    const repository = {
      cancel: async () => true,
      findForCancellation: async () => {
        throw new Error('findForCancellation ne doit pas être appelé');
      },
    };
    await expect(
      new ReservationsService(repository).cancel('r1', 'u1'),
    ).resolves.toBeUndefined();
  });

  it('réussit aussi quand la réservation était déjà annulée', async () => {
    const repository = {
      cancel: async () => false,
      findForCancellation: async () => ({ userId: 'u1', status: 'cancelled' }),
    };
    await expect(
      new ReservationsService(repository).cancel('r1', 'u1'),
    ).resolves.toBeUndefined();
  });

  it('lève le refus calculé à partir de la relecture', async () => {
    const repository = {
      cancel: async () => false,
      findForCancellation: async () => ({ userId: 'u1', status: 'confirmed' }),
    };
    await expect(
      new ReservationsService(repository).cancel('r1', 'u1'),
    ).rejects.toMatchObject({ code: 'RESERVATION_NOT_CANCELLABLE' });
  });
});

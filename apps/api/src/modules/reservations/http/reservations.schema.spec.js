import { randomUUID } from 'node:crypto';
import { createReservationSchema } from './reservations.schemas.js';

const seats = (n) => Array.from({ length: n }, () => randomUUID());
const body = (overrides = {}) => ({
  eventId: randomUUID(),
  seatIds: seats(2),
  ...overrides,
});

describe('createReservationSchema', () => {
  it('accepte un événement et des sièges distincts', () => {
    expect(createReservationSchema.safeParse(body()).success).toBe(true);
  });

  it("retire un userId envoyé dans le corps : l'acheteur vient du token", () => {
    const result = createReservationSchema.safeParse(
      body({ userId: randomUUID() }),
    );
    expect(result.data).not.toHaveProperty('userId');
  });

  it.each([
    ['aucun siège', { seatIds: [] }],
    ['plus de 10 sièges', { seatIds: seats(11) }],
    ['un eventId qui n’est pas un uuid', { eventId: 'abc' }],
    ['un siège qui n’est pas un uuid', { seatIds: ['abc'] }],
  ])('refuse %s', (_, overrides) => {
    expect(createReservationSchema.safeParse(body(overrides)).success).toBe(
      false,
    );
  });

  it('refuse un siège demandé deux fois, sur le champ seatIds', () => {
    const seat = randomUUID();
    const result = createReservationSchema.safeParse(
      body({ seatIds: [seat, seat] }),
    );
    expect(result.success).toBe(false);
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0].path).toEqual(['seatIds']);
  });
});

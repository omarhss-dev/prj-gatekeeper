import { z } from 'zod';

export const createReservationSchema = z.object({
  eventId: z.uuid(),
  seatIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((seatIds) => new Set(seatIds).size === seatIds.length),
});

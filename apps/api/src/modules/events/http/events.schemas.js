import { z } from 'zod';
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceCents: z.int().min(0).max(2_147_483_647),
  rowsCount: z.int().min(1).max(26),
  seatsPerRow: z.int().min(1).max(60),
});

export const createEventSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).optional(),
    city: z.string().trim().min(1).max(100),
    venue: z.string().trim().min(1).max(200),
    startsAt: instant.refine((date) => date.getTime() > Date.now()),
    salesOpenAt: instant,
    maxSeatsPerReservation: z.int().min(1).max(10).default(4),
    sections: z
      .array(sectionSchema)
      .min(1)
      .max(20)
      .refine(
        (sections) =>
          new Set(sections.map((section) => section.name)).size ===
          sections.length,
      ),
  })
  .refine(
    ({ salesOpenAt, startsAt }) =>
      !(salesOpenAt instanceof Date && startsAt instanceof Date) ||
      salesOpenAt <= startsAt,
    { path: ['salesOpenAt'] },
  );

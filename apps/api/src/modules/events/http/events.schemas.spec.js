import {
  catalogueQuerySchema,
  createEventSchema,
  updateEventSchema,
} from './events.schemas.js';

// Dates lointaines : le refine « dans le futur » dépend de l'heure courante.
const valid = {
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: '2099-06-01T20:00:00+01:00',
  salesOpenAt: '2099-05-01T10:00:00Z',
  sections: [
    { name: 'Orchestre', priceCents: 5000, rowsCount: 10, seatsPerRow: 20 },
  ],
};

const section = valid.sections[0];

/** Les issues sous la forme exacte que le filtre renverra : path + code. */
function issues(body) {
  const result = createEventSchema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map(({ path, code }) => ({ path, code }));
}

describe('createEventSchema', () => {
  it('accepte un corps minimal et applique le défaut de maxSeatsPerReservation', () => {
    expect(createEventSchema.parse(valid).maxSeatsPerReservation).toBe(4);
  });

  it('convertit les dates en Date', () => {
    expect(createEventSchema.parse(valid).startsAt).toBeInstanceOf(Date);
  });

  it('refuse une date sans fuseau, sans erreur fausse sur salesOpenAt', () => {
    // Une seule issue : le refine d'objet ne doit pas comparer la chaîne brute.
    expect(issues({ ...valid, startsAt: '2099-06-01T20:00:00' })).toEqual([
      { path: ['startsAt'], code: 'invalid_format' },
    ]);
  });

  it('refuse un événement qui commence dans le passé', () => {
    expect(
      issues({
        ...valid,
        startsAt: '2000-06-01T20:00:00Z',
        salesOpenAt: '2000-05-01T10:00:00Z',
      }),
    ).toEqual([{ path: ['startsAt'], code: 'custom' }]);
  });

  it('refuse une ouverture des ventes après le début', () => {
    expect(issues({ ...valid, salesOpenAt: '2099-06-02T10:00:00Z' })).toEqual([
      { path: ['salesOpenAt'], code: 'custom' },
    ]);
  });

  it('compare des instants, pas des chaînes', () => {
    // 19:30Z = 20:30+01:00 : les ventes ouvrent 30 min APRÈS le début.
    // En comparaison de chaînes, '…19:30:00Z' < '…20:00:00+01:00' passerait.
    expect(
      issues({
        ...valid,
        startsAt: '2099-06-01T20:00:00+01:00',
        salesOpenAt: '2099-06-01T19:30:00Z',
      }),
    ).toEqual([{ path: ['salesOpenAt'], code: 'custom' }]);
  });

  it('exige au moins une section', () => {
    expect(issues({ ...valid, sections: [] })).toEqual([
      { path: ['sections'], code: 'too_small' },
    ]);
  });

  it('refuse deux sections du même nom', () => {
    expect(issues({ ...valid, sections: [section, section] })).toEqual([
      { path: ['sections'], code: 'custom' },
    ]);
  });

  it('aligne les bornes des sections sur les CHECK de la base', () => {
    expect(
      issues({ ...valid, sections: [{ ...section, rowsCount: 27 }] }),
    ).toEqual([{ path: ['sections', 0, 'rowsCount'], code: 'too_big' }]);
    expect(
      issues({ ...valid, sections: [{ ...section, seatsPerRow: 61 }] }),
    ).toEqual([{ path: ['sections', 0, 'seatsPerRow'], code: 'too_big' }]);
    expect(
      issues({ ...valid, sections: [{ ...section, priceCents: -1 }] }),
    ).toEqual([{ path: ['sections', 0, 'priceCents'], code: 'too_small' }]);
  });

  it('refuse un prix hors du type integer', () => {
    expect(
      issues({ ...valid, sections: [{ ...section, priceCents: 3e9 }] }),
    ).toEqual([{ path: ['sections', 0, 'priceCents'], code: 'too_big' }]);
  });

  it("refuse un nom fait uniquement d'espaces", () => {
    expect(issues({ ...valid, name: '   ' })).toEqual([
      { path: ['name'], code: 'too_small' },
    ]);
  });

  it('retire les clés que le client ne choisit pas : organizerId, status', () => {
    const parsed = createEventSchema.parse({
      ...valid,
      organizerId: '00000000-0000-0000-0000-000000000000',
      status: 'published',
    });
    expect(parsed).not.toHaveProperty('organizerId');
    expect(parsed).not.toHaveProperty('status');
  });
});

describe('catalogueQuerySchema', () => {
  it('applique les défauts du contrat : page 1, 20 par page', () => {
    expect(catalogueQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("convertit les nombres de l'URL", () => {
    expect(catalogueQuerySchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it.each([
    ['limit', '101', 'too_big'],
    ['limit', '0', 'too_small'],
    ['page', '1001', 'too_big'],
    ['page', '1.5', 'invalid_type'],
  ])('refuse %s=%s', (key, value, code) => {
    const result = catalogueQuerySchema.safeParse({ [key]: value });
    expect(
      result.error.issues.map(({ path, code }) => ({ path, code })),
    ).toEqual([{ path: [key], code }]);
  });

  it('refuse un intervalle vide ou inversé', () => {
    const result = catalogueQuerySchema.safeParse({
      from: '2099-06-01T00:00:00Z',
      to: '2099-06-01T00:00:00Z',
    });
    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ['to'], code: 'custom' }),
    ]);
  });

  it("refuse un « + » devenu espace dans l'URL", () => {
    // Ce que reçoit le serveur pour ?from=2099-06-01T20:00:00+01:00 non encodé.
    expect(
      catalogueQuerySchema.safeParse({ from: '2099-06-01T20:00:00 01:00' })
        .success,
    ).toBe(false);
  });
});

describe('updateEventSchema', () => {
  const issuesOf = (body) => {
    const result = updateEventSchema.safeParse(body);
    return result.success
      ? []
      : result.error.issues.map(({ path, code }) => ({ path, code }));
  };

  it('accepte un seul champ, sans ajouter de défaut', () => {
    expect(updateEventSchema.parse({ name: 'Nouveau nom' })).toEqual({
      name: 'Nouveau nom',
    });
  });

  it('refuse un corps vide', () => {
    expect(issuesOf({})).toEqual([{ path: [], code: 'custom' }]);
  });

  it('refuse un corps dont toutes les clés sont retirées (status)', () => {
    expect(issuesOf({ status: 'published' })).toEqual([
      { path: [], code: 'custom' },
    ]);
  });

  it('refuse une date modifiée sans l’autre, en nommant celle qui manque', () => {
    expect(issuesOf({ startsAt: '2099-06-01T20:00:00Z' })).toEqual([
      { path: ['salesOpenAt'], code: 'custom' },
    ]);
  });

  it('compare les deux dates quand elles sont fournies', () => {
    expect(
      issuesOf({
        startsAt: '2099-06-01T20:00:00Z',
        salesOpenAt: '2099-06-02T20:00:00Z',
      }),
    ).toEqual([{ path: ['salesOpenAt'], code: 'custom' }]);
  });
});

import { DomainError } from '../../../common/errors/domain-error.js';
import { ForbiddenError } from '../../../common/errors/forbidden-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import { EventsService, draftRefusal } from './events.service.js';

const OWNER = 'owner-id';
const OTHER = 'other-id';
const event = (status) => ({ id: 'e1', organizerId: OWNER, status });

describe('draftRefusal', () => {
  it('404 pour un événement inexistant', () => {
    expect(draftRefusal(null, OWNER)).toBeInstanceOf(NotFoundError);
  });

  it("404 pour le brouillon d'un autre : son existence ne doit pas fuir", () => {
    expect(draftRefusal(event('draft'), OTHER)).toBeInstanceOf(NotFoundError);
  });

  it("403 pour l'événement publié d'un autre", () => {
    expect(draftRefusal(event('published'), OTHER)).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('EVENT_ALREADY_PUBLISHED pour son propre événement déjà publié', () => {
    const refusal = draftRefusal(event('published'), OWNER);
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal.code).toBe('EVENT_ALREADY_PUBLISHED');
  });

  it('EVENT_NOT_AVAILABLE pour son propre événement annulé', () => {
    expect(draftRefusal(event('cancelled'), OWNER).code).toBe(
      'EVENT_NOT_AVAILABLE',
    );
  });
});

describe('EventsService.publish', () => {
  it("renvoie l'événement publié sans relire la base", async () => {
    const published = { ...event('published'), seatCount: 22 };
    const repository = {
      publishDraft: async () => published,
      findById: async () => {
        throw new Error('findById ne doit pas être appelé');
      },
    };
    await expect(
      new EventsService(repository).publish('e1', OWNER),
    ).resolves.toBe(published);
  });

  it('lève le refus calculé à partir de la relecture', async () => {
    const repository = {
      publishDraft: async () => null,
      findById: async () => event('published'),
    };
    await expect(
      new EventsService(repository).publish('e1', OWNER),
    ).rejects.toMatchObject({ code: 'EVENT_ALREADY_PUBLISHED' });
  });
});

describe('EventsService.getPublished', () => {
  it('lève une NotFoundError quand le repository ne trouve rien', async () => {
    const repository = { findPublishedById: async () => null };
    await expect(
      new EventsService(repository).getPublished('e1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('EventsService.getSeatMap', () => {
  it('lève une NotFoundError quand le repository ne trouve rien', async () => {
    const repository = { findSeatMap: async () => null };
    await expect(
      new EventsService(repository).getSeatMap('e1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renvoie le plan de salle tel que le repository le construit', async () => {
    const seatMap = { eventId: 'e1', sections: [] };
    const repository = { findSeatMap: async () => seatMap };
    await expect(new EventsService(repository).getSeatMap('e1')).resolves.toBe(
      seatMap,
    );
  });
});

describe('EventsService.listCatalogue', () => {
  /** Faux repository qui renvoie n lignes et retient ce qu'on lui a demandé. */
  function repositoryReturning(n) {
    const calls = [];
    return {
      calls,
      findCatalogue: async (query) => {
        calls.push(query);
        return Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));
      },
    };
  }

  it('demande limit + 1 lignes et calcule l’offset de la page', async () => {
    const repository = repositoryReturning(0);
    await new EventsService(repository).listCatalogue({ page: 3, limit: 20 });
    expect(repository.calls[0]).toMatchObject({ limit: 21, offset: 40 });
  });

  it('hasNext vrai et ligne en trop retirée quand limit + 1 lignes reviennent', async () => {
    const page = await new EventsService(repositoryReturning(21)).listCatalogue(
      { page: 1, limit: 20 },
    );
    expect(page.items).toHaveLength(20);
    expect(page.hasNext).toBe(true);
  });

  it('hasNext faux sur la dernière page', async () => {
    const page = await new EventsService(repositoryReturning(20)).listCatalogue(
      { page: 1, limit: 20 },
    );
    expect(page).toMatchObject({ page: 1, limit: 20, hasNext: false });
    expect(page.items).toHaveLength(20);
  });
});

describe('EventsService.update', () => {
  it("renvoie l'événement modifié sans relire la base", async () => {
    const updated = { ...event('draft'), name: 'Nouveau' };
    const repository = {
      updateDraft: async () => updated,
      findById: async () => {
        throw new Error('findById ne doit pas être appelé');
      },
    };
    await expect(
      new EventsService(repository).update('e1', { name: 'Nouveau' }, OWNER),
    ).resolves.toBe(updated);
  });

  it('lève les mêmes refus que la publication', async () => {
    const repository = {
      updateDraft: async () => null,
      findById: async () => event('published'),
    };
    await expect(
      new EventsService(repository).update('e1', { name: 'x' }, OWNER),
    ).rejects.toMatchObject({ code: 'EVENT_ALREADY_PUBLISHED' });
  });
});

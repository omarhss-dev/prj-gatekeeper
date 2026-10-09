import { DomainError } from '../../../common/errors/domain-error.js';
import { ForbiddenError } from '../../../common/errors/forbidden-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import { EventsService, publishRefusal } from './events.service.js';

const OWNER = 'owner-id';
const OTHER = 'other-id';
const event = (status) => ({ id: 'e1', organizerId: OWNER, status });

describe('publishRefusal', () => {
  it('404 pour un événement inexistant', () => {
    expect(publishRefusal(null, OWNER)).toBeInstanceOf(NotFoundError);
  });

  it("404 pour le brouillon d'un autre : son existence ne doit pas fuir", () => {
    expect(publishRefusal(event('draft'), OTHER)).toBeInstanceOf(NotFoundError);
  });

  it("403 pour l'événement publié d'un autre", () => {
    expect(publishRefusal(event('published'), OTHER)).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('EVENT_ALREADY_PUBLISHED pour son propre événement déjà publié', () => {
    const refusal = publishRefusal(event('published'), OWNER);
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal.code).toBe('EVENT_ALREADY_PUBLISHED');
  });

  it('EVENT_NOT_AVAILABLE pour son propre événement annulé', () => {
    expect(publishRefusal(event('cancelled'), OWNER).code).toBe(
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

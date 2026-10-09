import { withTransaction } from './transaction.js';

/**
 * Faux pool : une seule connexion, qui note chaque requête et l'argument de
 * release(). failOn fait échouer une requête précise (ex. 'ROLLBACK').
 */
function fakePool({ failOn } = {}) {
  const client = {
    queries: [],
    released: [],
    async query(sql) {
      this.queries.push(sql);
      if (sql === failOn) throw new Error(`${sql} impossible`);
    },
    release(destroy) {
      this.released.push(destroy);
    },
  };
  return { client, pool: { connect: async () => client } };
}

describe('withTransaction', () => {
  it('valide la transaction et rend la connexion au pool', async () => {
    const { client, pool } = fakePool();
    const result = await withTransaction(pool, async (tx) => {
      await tx.query('INSERT 1');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(client.queries).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(client.released).toEqual([undefined]);
  });

  it("annule, rend la connexion, et relance l'erreur d'origine", async () => {
    const { client, pool } = fakePool();
    const boom = new Error('boom');
    await expect(
      withTransaction(pool, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(client.queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.released).toEqual([undefined]);
  });

  it('annule aussi quand le COMMIT échoue', async () => {
    const { client, pool } = fakePool({ failOn: 'COMMIT' });
    await expect(withTransaction(pool, async () => {})).rejects.toThrow(
      'COMMIT impossible',
    );
    expect(client.queries).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(client.released).toEqual([undefined]);
  });

  it("détruit la connexion si le ROLLBACK échoue, et relance l'erreur d'origine", async () => {
    const { client, pool } = fakePool({ failOn: 'ROLLBACK' });
    const boom = new Error('boom');
    await expect(
      withTransaction(pool, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(client.released).toEqual([true]);
  });
});

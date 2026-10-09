/**
 * Exécute work(client) dans une transaction, sur UNE connexion du pool.
 *
 * Appelée uniquement depuis les repositories : la transaction est une affaire
 * de SQL, le service n'en voit rien (choix 3a de la branche 8).
 *
 * Règle d'usage : dans work, toutes les requêtes passent par `client`.
 * Un pool.query() glissé dans work partirait sur une AUTRE connexion, hors de
 * la transaction : il ne serait ni annulé par le ROLLBACK, ni visible des
 * requêtes de la transaction avant le COMMIT.
 */
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch {
      // ROLLBACK impossible : connexion coupée, ou session dans un état
      // inconnu. Rendue au pool, elle servirait la requête suivante avec une
      // transaction encore ouverte. release(true) la détruit à la place.
      client.release(true);
    }
    // On relance l'erreur d'ORIGINE : c'est elle qui explique la panne,
    // pas celle du ROLLBACK qui en découle.
    throw error;
  }
}

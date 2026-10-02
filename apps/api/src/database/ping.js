// Le log vit ici, et pas dans le service, pour deux raisons :
// — c'est database/ qui connaît le vocabulaire de l'infrastructure
//   (ECONNREFUSED n'est pas un terme métier) ;
// — appelé hors du contexte de requête, pino n'y attache pas l'objet
//   req entier, que la sonde n'a aucune raison d'emporter.
export async function pingDatabase(pool, logger) {
  try {
    // La requête la moins coûteuse qui prouve à la fois qu'une connexion
    // s'ouvre ET que le serveur répond. Un connect() seul prouverait
    // le TCP, pas que PostgreSQL sait répondre.
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    const code = error?.code;
    const message = error instanceof Error ? error.message : '';
    logger.warn(`Readiness KO : ${code ?? (message || 'cause inconnue')}`);
    return false;
  }
}

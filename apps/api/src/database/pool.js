import { Pool } from 'pg';
// logger : seul warn() est appelé, un test peut fournir un faux minimal.
// Ce n'est pas un port (ADR-010).
export function createPool(config, logger) {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    // Par INSTANCE. 4 réplicas × 10 = 40 < ~50 connexions du B1ms.
    // Ce chiffre et le max_replicas de Terraform ne vont pas l'un sans l'autre.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Défaut pg : 0 = attente INFINIE d'un slot libre. Un pool saturé
    // bloquerait les requêtes sans jamais échouer.
    connectionTimeoutMillis: 5_000,
    // Appliqué côté serveur : une requête lente libère son slot.
    statement_timeout: 10_000,
  });

  // Une connexion INACTIVE coupée par le serveur n'a aucune promesse
  // à rejeter : le pool émet 'error'. Sans listener, Node lève une
  // exception non capturée et le processus meurt. Le pool a déjà
  // écarté le client mort : il n'y a rien à faire d'autre que le dire.

  pool.on('error', (err) => {
    logger.warn(`Connexion inactive du pool perdue : ${err.message}`);
  });
  //test temporaire negative bien verifiee

  return pool;
}

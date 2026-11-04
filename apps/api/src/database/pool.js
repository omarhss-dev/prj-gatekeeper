import { Pool } from 'pg';
// logger : seul warn() est appelé, un test peut fournir un faux minimal.
// Ce n'est pas un port (ADR-010).
export function createPool(config, logger) {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    // Par INSTANCE (réplica). Budget du B1ms : 35 connexions pour les rôles
    // ordinaires (50 moins 15 réservées). Invariant : max_replicas (2, infra/app.tf)
    // × max + 1 (job de migration) ≤ 30, soit 21. Ce chiffre et max_replicas
    // ne vont pas l'un sans l'autre (addendum d'ADR-007).
    // Bascule de révision mesurée (E3) : pic de 13 sous 20 requêtes parallèles.
    // Pire cas théorique : 2 révisions × 2 × 10 + 1 = 41, non atteint, non réfuté.
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

  return pool;
}

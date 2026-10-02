import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../../database/database.tokens.js';

/** Seul endroit du module où la table users est lue ou écrite (ADR-002). */
@Injectable()
export class UsersRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Insère un utilisateur. Renvoie null si l'email est déjà pris.
   * ON CONFLICT ON CONSTRAINT : seule la violation de uq_users_email devient
   * null. Toute autre erreur (un CHECK violé par un bug) remonte telle quelle.
   */
  async create({ email, passwordHash, displayName }) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT uq_users_email DO NOTHING
       RETURNING id, email, display_name, role, created_at`,
      [email, passwordHash, displayName],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }
}

/** Ligne SQL (snake_case) → objet de l'app (camelCase). Jamais password_hash. */
function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

// Sans décorateur de paramètre (ADR-025) : le jeton du paramètre 0 du
// constructeur est déclaré à la main, comme dans HealthService.
Inject(PG_POOL)(UsersRepository, undefined, 0);

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

  /**
   * Seule méthode qui lit password_hash : réservée à la vérification du login.
   * Renvoie null si aucun compte n'a cet email.
   */
  async findCredentialsByEmail(email) {
    const { rows } = await this.pool.query(
      `SELECT id, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    if (!rows[0]) return null;
    const { id, role, password_hash: passwordHash } = rows[0];
    return { id, role, passwordHash };
  }
  /** Profil public d'un utilisateur, sans password_hash. null s'il n'existe pas. */
  async findById(id) {
    const { rows } = await this.pool.query(
      `SELECT id, email, display_name, role, created_at FROM users WHERE id = $1`,
      [id],
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

Inject(PG_POOL)(UsersRepository, undefined, 0);

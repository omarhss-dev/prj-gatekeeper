import { Inject, Logger, Module } from '@nestjs/common';
import { PG_POOL } from './database.tokens.js';
import { createPool } from './pool.js';

@Module({})
export class DatabaseModule {
  logger = new Logger(DatabaseModule.name);

  constructor(pool) {
    this.pool = pool;
  }

  static forRoot(config) {
    return {
      module: DatabaseModule,
      // Seul module global du projet : le pool est lu par tous les modules
      // métier. Importer la classe nue donnerait un module sans PG_POOL.
      global: true,
      providers: [
        {
          provide: PG_POOL,
          useFactory: () => createPool(config, new Logger(DatabaseModule.name)),
        },
      ],
      exports: [PG_POOL],
    };
  }

  // onApplicationShutdown est le DERNIER hook, appelé après la fermeture
  // du serveur HTTP : plus aucune requête ne peut emprunter une connexion.
  async onApplicationShutdown() {
    await this.pool.end();
    this.logger.log('Pool PostgreSQL fermé');
  }
}

// Sans emitDecoratorMetadata ni décorateur de paramètre, Nest ne peut plus
// deviner la dépendance : le jeton du paramètre 0 est déclaré à la main,
// comme le faisait @Inject(PG_POOL).
Inject(PG_POOL)(DatabaseModule, undefined, 0);

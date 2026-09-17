import {
  DynamicModule,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/config.schema';
import { PG_POOL } from './database.tokens';
import { createPool } from './pool';

@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  static forRoot(config: AppConfig): DynamicModule {
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
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.logger.log('Pool PostgreSQL fermé');
  }
}

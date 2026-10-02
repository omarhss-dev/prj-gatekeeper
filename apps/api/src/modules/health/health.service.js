import { Inject, Injectable, Logger } from '@nestjs/common';
import { PG_POOL } from '../../database/database.tokens.js';
import { pingDatabase } from '../../database/ping.js';

@Injectable()
export class HealthService {
  logger = new Logger('Database');

  constructor(pool) {
    this.pool = pool;
  }

  async isDatabaseReachable() {
    return pingDatabase(this.pool, this.logger);
  }
}

// Sans emitDecoratorMetadata ni décorateur de paramètre, Nest ne peut plus
// deviner la dépendance : le jeton du paramètre 0 est déclaré à la main,
// comme le faisait @Inject(PG_POOL).
Inject(PG_POOL)(HealthService, undefined, 0);

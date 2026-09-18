import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.tokens.js';
import { pingDatabase } from '../../database/ping.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger('Database');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async isDatabaseReachable(): Promise<boolean> {
    return pingDatabase(this.pool, this.logger);
  }
}

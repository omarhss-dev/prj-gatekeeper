import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Retry-After', '5')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<{ status: 'ok'; postgres: 'up' }> {
    const reachable = await this.health.isDatabaseReachable();

    if (!reachable) {
      // Aucun détail : la route est publique et non authentifiée.
      // Hôte, port et nom de base ne franchissent pas la frontière HTTP.
      throw new ServiceUnavailableException('not ready');
    }

    return { status: 'ok', postgres: 'up' };
  }
}

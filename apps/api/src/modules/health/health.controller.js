import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(health) {
    this.health = health;
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Retry-After', '5')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const reachable = await this.health.isDatabaseReachable();

    if (!reachable) {
      // Aucun détail : la route est publique et non authentifiée.
      // Hôte, port et nom de base ne franchissent pas la frontière HTTP.
      throw new ServiceUnavailableException('not ready');
    }

    return { status: 'ok', postgres: 'up' };
  }
}

// Sans emitDecoratorMetadata ni décorateur de paramètre, Nest ne lit plus
// le type du paramètre : le jeton du paramètre 0 est déclaré à la main,
// là où TypeScript émettait son type.
Inject(HealthService)(HealthController, undefined, 0);

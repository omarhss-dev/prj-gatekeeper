import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  // Ne teste AUCUNE dépendance : un liveness qui échoue redémarre
  // l'instance. Tester la base ici transformerait une panne de base
  // en boucle de redémarrage de tout le parc.
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

// Charge le .env AVANT toute autre évaluation de module : loadConfig lit
// process.env, qui doit donc être complet à ce moment-là.
// Le fichier vit à la racine du monorepo, partagé avec docker-compose ;
// dotenv le cherche depuis process.cwd(), d'où le chemin explicite.
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '../../.env' });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig, ConfigValidationError } from './config/load-config';

async function bootstrap(): Promise<void> {
  // Validation AVANT tout démarrage de Nest, dans ma portée de capture.
  // Un appel de fonction ordinaire, pas un effet de bord de décorateur.
  const config = loadConfig(process.env);

  const app = await NestFactory.create(AppModule);
  await app.listen(config.PORT);
}

function reportStartupError(error: unknown): void {
  /* eslint-disable no-console */
  if (error instanceof ConfigValidationError) {
    console.error(`Configuration invalide : ${error.message}`);
  } else {
    console.error("Échec du démarrage de l'application", error);
  }
  /* eslint-enable no-console */
}

bootstrap().catch((error: unknown) => {
  reportStartupError(error);
  process.exitCode = 1;
});

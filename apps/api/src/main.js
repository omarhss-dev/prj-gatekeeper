// Charge le .env AVANT toute autre évaluation de module : loadConfig lit
// process.env, qui doit donc être complet à ce moment-là.
// Le fichier vit à la racine du monorepo, partagé avec docker-compose ;
// dotenv le cherche depuis process.cwd(), d'où le chemin explicite.
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '../../.env' });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig, ConfigValidationError } from './config/load-config.js';
import { Logger } from 'nestjs-pino';
async function bootstrap() {
  // Validation AVANT tout démarrage de Nest, dans ma portée de capture.
  // Un appel de fonction ordinaire, pas un effet de bord de décorateur.
  const config = loadConfig(process.env);

  const app = await NestFactory.create(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger)); // Logger importé depuis 'nestjs-pino'

  // Sans cet appel, SIGTERM tue le processus sans passer par les hooks :
  // onApplicationShutdown (fermeture du pool) ne s'exécuterait jamais.
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

function reportStartupError(error) {
  /* eslint-disable no-console */
  if (error instanceof ConfigValidationError) {
    console.error(`Configuration invalide : ${error.message}`);
  } else {
    console.error("Échec du démarrage de l'application", error);
  }
  /* eslint-enable no-console */
}

bootstrap().catch((error) => {
  reportStartupError(error);
  process.exitCode = 1;
});

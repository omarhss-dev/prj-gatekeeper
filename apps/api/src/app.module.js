import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG } from './config/config.tokens.js';
import { isValidCorrelationId } from './common/logging/correlation-id.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';

@Module({})
export class AppModule {
  static forRoot(config) {
    return {
      module: AppModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [APP_CONFIG],
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: {
              ignore: (req) => req.url?.startsWith('/health') ?? false,
            },
            genReqId: (req, res) => {
              const incoming = req.headers['x-correlation-id'];
              const id = isValidCorrelationId(incoming)
                ? incoming
                : randomUUID();
              // Posé ici, donc avant guards et pipes : un 401 levé par un
              // futur JwtAuthGuard portera l'en-tête. Un interceptor ne
              // serait pas atteint sur ce chemin.
              res.setHeader('X-Correlation-Id', id);
              return id;
            },
            customAttributeKeys: { reqId: 'correlationId' },
            transport:
              config.NODE_ENV === 'development'
                ? { target: 'pino-pretty' }
                : undefined,
            quietReqLogger: true,
          },
        }),
        DatabaseModule.forRoot(config),
        HealthModule,
      ],
    };
  }
}

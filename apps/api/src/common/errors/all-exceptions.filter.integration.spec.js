import { jest } from '@jest/globals';
import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { DomainError } from './domain-error.js';
import { NotFoundError } from './not-found-error.js';
import { z } from 'zod';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';

@Controller('boom')
class ThrowingController {
  @Get('unknown')
  unknown() {
    throw new Error('relation "tickets" does not exist');
  }

  @Get('domain')
  domain() {
    throw new DomainError('SEAT_UNAVAILABLE', 'Le siège A12 est déjà pris.');
  }

  @Post('body')
  body(payload) {
    return payload;
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundError();
  }
}
// Équivalent de @Body(pipe) sur le paramètre 0 : Babel ne lit pas les
// décorateurs de paramètre, l'appel est donc écrit à la main (ADR-025).
Body(new ZodValidationPipe(z.object({ password: z.string().min(10) })))(
  ThrowingController.prototype,
  'body',
  0,
);

describe('AllExceptionsFilter (intégration HTTP)', () => {
  let app;
  let server;
  const errorSpy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const logSpy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  beforeEach(() => {
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  it("répond un 500 générique sans stack ni message interne, et loggue l'Error entière", async () => {
    const res = await request(server).get('/boom/unknown');

    expect(res.status).toBe(500);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Une erreur interne est survenue.',
      correlationId: res.get('X-Correlation-Id'),
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it('traduit une DomainError via la table, loggée en info et jamais en error', async () => {
    const res = await request(server).get('/boom/domain');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      type: 'https://gatekeeper.dev/errors/seat-unavailable',
      title: 'Seat unavailable',
      status: 409,
      code: 'SEAT_UNAVAILABLE',
      detail: 'Le siège A12 est déjà pris.',
      correlationId: res.get('X-Correlation-Id'),
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      { code: 'SEAT_UNAVAILABLE' },
      'Refus métier',
    );
  });

  it("répond 422 avec path et code, sans logger d'erreur", async () => {
    const res = await request(server)
      .post('/boom/body')
      .send({ password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { path: ['password'], code: 'too_small' },
    ]);
    expect(res.body.correlationId).toBe(res.get('X-Correlation-Id'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("répond 404 à une NotFoundError, sans logger d'erreur", async () => {
    const res = await request(server).get('/boom/not-found');

    expect(res.status).toBe(404);
    expect(res.body.type).toBe('about:blank');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

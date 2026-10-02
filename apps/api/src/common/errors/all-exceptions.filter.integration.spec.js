import { jest } from '@jest/globals';
import { Controller, Get, Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { DomainError } from './domain-error.js';

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
}

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
});

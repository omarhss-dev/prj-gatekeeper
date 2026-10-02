import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { Catch, HttpException, Logger } from '@nestjs/common';
import { DomainError } from './domain-error.js';

/**
 * Seul point où un code métier rencontre HTTP.
 * Un refus métier n'est jamais un 5xx : 409 ou 422 uniquement.
 */
const DOMAIN_ERROR_HTTP = {
  SEAT_UNAVAILABLE: { status: 409, title: 'Seat unavailable' },
  SALES_NOT_OPEN: { status: 409, title: 'Sales not open' },
  EVENT_NOT_AVAILABLE: { status: 409, title: 'Event not available' },
  EVENT_ALREADY_PUBLISHED: { status: 409, title: 'Event already published' },
  MAX_SEATS_EXCEEDED: { status: 422, title: 'Max seats exceeded' },
  RESERVATION_NOT_CANCELLABLE: {
    status: 409,
    title: 'Reservation not cancellable',
  },
};

const INTERNAL_DETAIL = 'Une erreur interne est survenue.';
const CLIENT_DETAIL = "La requête n'a pas pu être traitée.";

/** Erreur hors métier : about:blank, libellé HTTP standard, jamais de texte de l'exception. */
function httpProblem(status) {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Unknown Error',
    status,
    detail: status >= 500 ? INTERNAL_DETAIL : CLIENT_DETAIL,
  };
}

export function toProblem(exception) {
  if (exception instanceof DomainError) {
    const { status, title } = DOMAIN_ERROR_HTTP[exception.code];
    return {
      type: `https://gatekeeper.dev/errors/${exception.code.toLowerCase().replaceAll('_', '-')}`,
      title,
      status,
      detail: exception.message,
      code: exception.code,
    };
  }

  if (exception instanceof HttpException) {
    return httpProblem(exception.getStatus());
  }

  // Tout le reste est un bug : le client n'en apprend rien.
  return httpProblem(500);
}

@Catch()
export class AllExceptionsFilter {
  logger = new Logger(AllExceptionsFilter.name);

  catch(exception, host) {
    const http = host.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const problem = toProblem(exception);

    this.log(exception);

    // La réponse a déjà commencé à partir : plus rien ne peut être écrit.
    if (res.headersSent) return;

    // Posé par genReqId. Absent quand l'erreur précède le middleware pino-http
    // (body-parser : JSON malformé, corps trop gros), prouvé par curl.
    // Le type de pino-http le déclare toujours présent : on ne le croit pas.
    const reqId = req.id;
    const correlationId = typeof reqId === 'string' ? reqId : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);

    res
      .status(problem.status)
      .type('application/problem+json')
      .json({ ...problem, correlationId });
  }

  log(exception) {
    if (exception instanceof DomainError) {
      this.logger.log({ code: exception.code }, 'Refus métier');
      return;
    }
    // HttpException : déjà tracée par la ligne pino-http ou à la source (readiness).
    if (exception instanceof HttpException) return;
    this.logger.error(exception);
  }
}

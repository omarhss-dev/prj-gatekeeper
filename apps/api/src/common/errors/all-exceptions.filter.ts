import { DomainError, type DomainErrorCode } from './domain-error.js';
import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
/** Corps RFC 7807, sans le correlationId (ajouté par le filtre). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code?: DomainErrorCode;
}

/**
 * Seul point où un code métier rencontre HTTP.
 * Record exige les 6 codes : un code sans entrée ne compile pas.
 * status restreint à 409 | 422 : un refus métier n'est jamais un 5xx.
 */
const DOMAIN_ERROR_HTTP: Record<
  DomainErrorCode,
  { status: 409 | 422; title: string }
> = {
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
function httpProblem(status: number): Problem {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Unknown Error',
    status,
    detail: status >= 500 ? INTERNAL_DETAIL : CLIENT_DETAIL,
  };
}

export function toProblem(exception: unknown): Problem {
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

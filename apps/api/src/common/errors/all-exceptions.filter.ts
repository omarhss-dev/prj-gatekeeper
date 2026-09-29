import { DomainError, type DomainErrorCode } from './domain-error.js';

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

  // Tout le reste est un bug : le client n'en apprend rien.
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: 'Une erreur interne est survenue.',
  };
}

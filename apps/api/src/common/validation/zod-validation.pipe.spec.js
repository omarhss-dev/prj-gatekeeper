import { z } from 'zod';
import { RequestValidationError } from '../errors/request-validation-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(
  z.object({ email: z.email(), password: z.string().min(10) }),
);

describe('ZodValidationPipe', () => {
  it('renvoie la donnée parsée, sans les clés inconnues', () => {
    expect(
      pipe.transform({
        email: 'a@b.co',
        password: '0123456789',
        role: 'organizer',
      }),
    ).toEqual({ email: 'a@b.co', password: '0123456789' });
  });

  it('lève une RequestValidationError avec le chemin et le code de chaque champ fautif', () => {
    expect.assertions(2);
    try {
      pipe.transform({ email: 'nope', password: 'short' });
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect(error.issues).toEqual([
        { path: ['email'], code: 'invalid_format' },
        { path: ['password'], code: 'too_small' },
      ]);
    }
  });
});

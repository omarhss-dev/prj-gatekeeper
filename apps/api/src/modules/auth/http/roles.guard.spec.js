import { Reflector } from '@nestjs/core';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

/** Routes factices : le vrai décorateur, lu par le vrai Reflector. */
class FakeController {
  @Roles(['organizer'])
  organizerOnly() {}

  undecorated() {}
}

/** Faux ExecutionContext : la méthode visée et un req avec ou sans user. */
function context(handler, user) {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const { organizerOnly, undecorated } = FakeController.prototype;

  it('laisse passer un rôle autorisé', () => {
    expect(
      guard.canActivate(
        context(organizerOnly, { userId: 'u1', role: 'organizer' }),
      ),
    ).toBe(true);
  });

  it('refuse un rôle non autorisé (false → 403 par Nest)', () => {
    expect(
      guard.canActivate(
        context(organizerOnly, { userId: 'u1', role: 'customer' }),
      ),
    ).toBe(false);
  });

  it('lève une Error sur une route sans @Roles, au lieu de la laisser ouverte', () => {
    expect(() =>
      guard.canActivate(
        context(undecorated, { userId: 'u1', role: 'organizer' }),
      ),
    ).toThrow('sans @Roles');
  });

  it('lève une Error sans req.user, au lieu de répondre 403 à un anonyme', () => {
    expect(() => guard.canActivate(context(organizerOnly, undefined))).toThrow(
      'avant JwtAuthGuard',
    );
  });
});

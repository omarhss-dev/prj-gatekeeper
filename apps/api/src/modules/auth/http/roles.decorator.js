import { Reflector } from '@nestjs/core';

/**
 * @Roles(['organizer']) : rôles autorisés sur une route, lus par RolesGuard.
 *
 * createDecorator plutôt que SetMetadata('roles', …) : la clé de métadonnée
 * est générée par Nest, pas écrite à la main. Aucune collision possible avec
 * une autre bibliothèque qui utiliserait aussi la chaîne 'roles' (même
 * raisonnement que Symbol('APP_CONFIG')).
 *
 * Attend UN argument, le tableau des rôles : @Roles(['organizer']).
 */
export const Roles = Reflector.createDecorator();

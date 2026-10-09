import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from './roles.decorator.js';

/**
 * Première moitié de l'autorisation : le TYPE d'action (« un organisateur
 * peut créer un événement »). La seconde moitié, la propriété de CET objet,
 * relève du service : seul lui connaît la ressource.
 *
 * Toujours placé APRÈS JwtAuthGuard : @UseGuards(JwtAuthGuard, RolesGuard).
 * Le rôle lu est celui du token, figé jusqu'à son expiration (ADR-004).
 */
@Injectable()
export class RolesGuard {
  constructor(reflector) {
    this.reflector = reflector;
  }

  canActivate(context) {
    // Rôles de la MÉTHODE uniquement : un @Roles posé sur la classe n'est pas
    // lu, et tombe donc dans le cas « sans @Roles » ci-dessous.
    const allowed = this.reflector.get(Roles, context.getHandler());

    // Les deux cas suivants sont des erreurs de câblage, pas des refus :
    // on lève une Error (500, loggée en entier par le filtre) plutôt que de
    // laisser passer ou de répondre un 403 qui masquerait le bug.
    if (!allowed) {
      // Laisser passer ouvrirait la route en silence.
      throw new Error('RolesGuard utilisé sur une route sans @Roles');
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      // JwtAuthGuard absent ou placé après : un anonyme recevrait un 403
      // au lieu d'un 401.
      throw new Error('RolesGuard exécuté avant JwtAuthGuard');
    }

    // false → Nest lève ForbiddenException → 403 about:blank. Contrairement
    // à JwtAuthGuard, le comportement par défaut est ici le bon.
    return allowed.includes(user.role);
  }
}

Inject(Reflector)(RolesGuard, undefined, 0);

import { z } from 'zod';

/**
 * L'app normalise, la base vérifie (ck_users_email_normalized) : trim et
 * minuscules AVANT la validation du format, pour que ' Omar@X.com ' et
 * 'omar@x.com' désignent le même compte.
 * max(254) : la même borne que ck_users_email_length. Sans elle, un email trop
 * long passerait Zod et finirait en 500 sur la contrainte.
 */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const registerSchema = z.object({
  email: emailSchema,
  // Ni trim ni minuscules : un mot de passe ne se modifie jamais.
  // Pas de max : Argon2 ne tronque pas (bcrypt, lui, coupe à 72 octets),
  // et la limite de corps d'Express (100 Ko) borne déjà la taille.
  password: z.string().min(10),
  // trim().min(1) : même règle que ck_users_display_name_not_blank.
  // max(100) : règle de l'app seule, la base ne borne pas ce champ.
  displayName: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

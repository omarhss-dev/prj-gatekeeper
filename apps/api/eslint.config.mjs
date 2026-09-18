// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // jest.config.ts vit hors de include: ["src/**/*"], et l'y
          // ajouter casserait la compilation (TS6059, cf. INC-003 :
          // rootDir vaut ./src). Il est donc linté sans typage.
          allowDefaultProject: ['jest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
    },
  },
);
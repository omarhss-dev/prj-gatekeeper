import eslint from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  {
    languageOptions: {
      // Le parser par défaut d'ESLint refuse les décorateurs de Nest :
      // @babel/eslint-parser lit le code avec la configuration de build.
      parser: babelParser,
      parserOptions: {
        babelOptions: { configFile: `${import.meta.dirname}/babel.config.cjs` },
      },
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'error',
    },
  },
];

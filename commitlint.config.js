module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['booking', 'seats', 'auth', 'config', 'payment', 'cache', 'db', 'infra', 'ci', 'obs', 'api']],
  },
};

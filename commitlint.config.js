module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['booking', 'seats', 'auth', 'payment', 'cache', 'db', 'infra', 'ci', 'obs', 'api']],
  },
};

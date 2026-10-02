const config = {
  moduleFileExtensions: ['js', 'json'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.js$',
  // Les décorateurs de Nest ne sont pas encore du JavaScript standard :
  // babel-jest les compile, en gardant l'ESM (apps/api/package.json a
  // "type": "module").
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;

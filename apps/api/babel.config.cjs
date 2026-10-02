// CommonJS : seul format de configuration que babel-jest charge sans
// détour quand le package est "type": "module".
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
  ],
  // Décorateurs « legacy » : la sémantique d'experimentalDecorators,
  // celle qu'attend Nest.
  plugins: [['@babel/plugin-proposal-decorators', { version: 'legacy' }]],
};

const security = require('eslint-plugin-security');

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'models/**', 'tests/**'],
    plugins: { security },
    rules: {
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-object-injection': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-pseudoRandomBytes': 'warn',
    },
  },
];

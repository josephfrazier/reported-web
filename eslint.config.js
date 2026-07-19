/**
 * ESLint flat config (eslint.config.js)
 *
 * This replaces .eslintrc.js using FlatCompat from @eslint/eslintrc to
 * bridge legacy configs (eslint-config-airbnb, eslint-plugin-css-modules)
 * until they can be migrated to native flat config.
 */

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({ baseDirectory: __dirname });

const legacyConfig = require('./.eslintrc.js');

// Flat config requires global ignores to be in a standalone object
// (no other keys like "rules" alongside "ignores")
const { ignorePatterns, ...rulesConfig } = legacyConfig;

module.exports = [
  { ignores: ignorePatterns },
  ...compat.config(rulesConfig),

  // Build scripts: allowed to reference build output and use dynamic requires
  {
    files: ['tools/**/*.js'],
    rules: {
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
      'global-require': 'off',
      'import/no-dynamic-require': 'off',
    },
  },

  {
    files: ['**/*.test.js', '**/__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        it: 'readonly',
        xdescribe: 'readonly',
        xit: 'readonly',
        fit: 'readonly',
      },
    },
  },
];

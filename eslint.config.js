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

  // Server-side code: Node.js 24 globals
  {
    files: ['src/server.js', 'src/alpr.js'],
    languageOptions: {
      globals: {
        globalThis: 'readonly',
      },
    },
  },

  // Build scripts: allowed to reference build output and use dynamic requires
  // and reference Node.js globals
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      globals: {
        globalThis: 'readonly',
      },
    },
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

  // src/getSubmissions.test.js requires parse-server, which is installed on
  // demand by jest.globalSetup.js instead of being a project dependency, so
  // the import rules can't check it (it's often absent from node_modules when
  // linting runs).
  {
    files: ['src/getSubmissions.test.js'],
    rules: {
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  },

  // Same for src/createSubmission.test.js, which requires parse-server
  // directly to start the test server.
  {
    files: ['src/createSubmission.test.js'],
    rules: {
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  },
];

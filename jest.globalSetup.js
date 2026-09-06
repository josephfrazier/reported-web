/**
 * Jest global setup
 *
 * parse-server (the version prod runs) lives outside package.json and
 * yarn.lock on purpose: it's a test-only dependency, used briefly by
 * src/getSubmissions.test.js, and keeping it in the manifest would make
 * Dependabot file security alerts against its 100+ known advisories (plus
 * everything in its transitive tree, which `ignore` rules can't cover).
 *
 * Instead, `yarn add` it on demand. Yarn v1's add command has no `--no-save`
 * flag — it always writes the new dependency into package.json (while
 * `--no-lockfile` keeps yarn.lock untouched) — so the manifest is restored
 * right after the install. The install is skipped while parse-server is
 * present in node_modules; any `yarn install` that prunes it away just causes
 * a re-install on the next test run.
 */
const { execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const PACKAGE_JSON = join(__dirname, 'package.json');

module.exports = () => {
  if (existsSync(join(__dirname, 'node_modules/parse-server'))) {
    return;
  }
  const manifest = readFileSync(PACKAGE_JSON, 'utf8');
  try {
    execSync('yarn add --no-lockfile parse-server@2.8.4', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } finally {
    writeFileSync(PACKAGE_JSON, manifest);
  }
};

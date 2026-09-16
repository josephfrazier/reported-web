/**
 * Boot the `yarn start` dev server and assert that it actually serves
 * pages.
 *
 * The previous `start.yml` check only grepped the startup log for
 * `Finished 'start' after` — browser-sync prints that line even when
 * its middleware stack is broken and every request 404s (see the
 * revert of #936/#942, where a forced `immutable@4` resolution made
 * browser-sync drop the user middleware). This script makes real
 * HTTP requests instead.
 *
 * The probes are network-independent: they only assert status codes
 * and content on our own routes, so they're safe to run in CI.
 */

import { spawn } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:3000';
const STARTUP_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;

function request(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runChecks(checks) {
  let failures = 0;
  for (const { name, ok, detail } of checks) {
    console.info(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok && detail) {
      console.error(detail);
    }
    if (!ok) failures += 1;
  }
  return failures;
}

const run = async () => {
  // Same command as the `start` npm script, minus `--inspect` and plus
  // `--silent` so browser-sync doesn't try to open a browser.
  const child = spawn(
    'node',
    [
      '-r',
      'dotenv/config',
      'node_modules/.bin/babel-node',
      'tools/run',
      'start',
      '--silent',
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  let failures = 0;
  try {
    // Wait for the server to answer anything (even a 404 counts as
    // "up" — the checks below assert what the responses must be).
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    async function waitForServer() {
      if (exited || Date.now() > deadline) return false;
      try {
        await request(BASE_URL);
        return true;
      } catch {
        await sleep(POLL_INTERVAL_MS);
        return waitForServer();
      }
    }

    const responding = await waitForServer();

    if (!responding) {
      console.error(
        `Dev server did not answer within ${
          STARTUP_TIMEOUT_MS / 1000
        }s or exited during startup. Last output:\n${output.slice(-2000)}`,
      );
      return failures + 1;
    }

    const home = await request(`${BASE_URL}/`);
    const favicon = await request(`${BASE_URL}/favicon.ico`);
    const submissionsMap = await request(`${BASE_URL}/submissions-map`);
    const installHookMap = await request(`${BASE_URL}/installHook.js.map`);
    const unknownPath = await request(`${BASE_URL}/this-page-does-not-exist`);

    // The SSR HTML references the client bundle compiled by
    // webpack-dev-middleware; request it to prove that middleware is
    // in the chain.
    const assetsMatch = home.body.match(/src="(\/assets\/[^"]+\.js)"/);
    const asset = assetsMatch
      ? await request(`${BASE_URL}${assetsMatch[1]}`)
      : { status: null };

    failures += runChecks([
      {
        name: 'dev server responds (any status)',
        ok: responding,
      },
      {
        name: 'GET / serves the SSR home page',
        ok:
          home.status === 200 && home.body.includes('<title>Reported</title>'),
        detail: `status ${home.status}, body starts: ${home.body.slice(0, 80)}`,
      },
      {
        // Served only by the user `express.static` middleware from
        // `tools/start.js` — browser-sync's own static server serves
        // from the vestigial `src/server.js` baseDir, so this 404s
        // whenever the user middleware stack is dropped.
        name: 'GET /favicon.ico is served by the user middleware',
        ok: favicon.status === 200,
        detail: `status ${favicon.status}`,
      },
      {
        name: 'GET /submissions-map serves the map page',
        ok:
          submissionsMap.status === 200 &&
          submissionsMap.body.includes('id="tab-paste"'),
        detail: `status ${submissionsMap.status}, body starts: ${submissionsMap.body.slice(0, 80)}`,
      },
      {
        // Firefox fetches this after the React DevTools extension injects
        // `installHook.js` into the page; a 404 here spams the console with
        // "Source map error: request failed with status 404".
        // https://github.com/facebook/react/issues/32339
        name: 'GET /installHook.js.map serves a stub source map',
        ok:
          installHookMap.status === 200 &&
          (() => {
            try {
              return JSON.parse(installHookMap.body).version === 3;
            } catch {
              return false;
            }
          })(),
        detail: `status ${installHookMap.status}, body starts: ${installHookMap.body.slice(0, 80)}`,
      },
      {
        // Unknown paths must still 404 via the SSR catch-all, rather than
        // being served the stub above.
        name: 'unknown paths still 404 via the SSR catch-all',
        ok: unknownPath.status === 404,
        detail: `status ${unknownPath.status}`,
      },
      {
        name: 'GET of the client bundle in /assets/ is served by webpack-dev-middleware',
        ok: asset.status === 200,
        detail: `asset ${assetsMatch ? assetsMatch[1] : '<none found>'} status ${asset.status}`,
      },
    ]);

    if (failures) {
      console.error(`Last dev server output:\n${output.slice(-2000)}`);
    }
    return failures;
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
};

run()
  .then(failures => {
    if (failures) {
      console.error(`${failures} dev server smoke checks failed`);
      process.exitCode = 1;
    }
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });

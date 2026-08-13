/**
 * Load the built app in a real headless browser and assert the client
 * bundle actually runs.
 *
 * The SSR CSS test inspects the server-rendered HTML, so client-bundle
 * failures are invisible to it — e.g. the stream-browserify regression
 * (#873) threw `class heritage stream_1.Transform is not an object or
 * null` when the browser evaluated a chunk, while the server kept
 * returning a healthy 200 page.
 *
 * Run after `yarn build`; see `tools/test-ssr-css.js` for the server
 * lifecycle pattern this mirrors.
 */

import { chromium } from 'playwright';
import runServer from './runServer.js';

const PORT = process.env.TEST_PORT || '3100';
const BASE_URL = `http://localhost:${PORT}`;

process.env.PORT = PORT;

const run = async () => {
  const server = await runServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(`console.error: ${message.text()}`);
      }
    });

    const response = await page.goto(BASE_URL, { waitUntil: 'load' });

    const heading = await page
      .locator('main h1')
      .first()
      .textContent()
      .catch(() => null);

    const checks = [
      {
        name: 'page responds',
        ok: response !== null && response.ok(),
      },
      {
        name: 'no page or console errors while the client bundle loads',
        ok: errors.length === 0,
        detail: errors.join('\n'),
      },
      {
        name: 'the page rendered the home heading',
        ok: typeof heading === 'string' && heading.length > 0,
        detail: heading,
      },
    ];

    let failures = 0;
    for (const { name, ok, detail } of checks) {
      console.info(`${ok ? '✓' : '✗'} ${name}`);
      if (!ok && detail) {
        console.error(detail);
      }
      if (!ok) failures += 1;
    }

    if (failures) {
      console.error(`${failures}/${checks.length} client smoke checks failed`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

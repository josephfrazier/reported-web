/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

/**
 * Render the built app server-side and assert on the CSS pipeline output.
 *
 * The regular jest suite mocks CSS imports (identity-obj-proxy), so it cannot
 * see the regressions that have historically shipped through the webpack CSS
 * pipeline, e.g.:
 *
 * - css-loader 4+ emitting ES modules by default, which made
 *   isomorphic-style-loader's `'' + css` stringify an ESM namespace object
 *   into the literal text `[object Module]` in the critical `<style>` tag,
 *   dropping every third-party stylesheet (marx, normalize, toastify)
 * - css-loader 4+ camelCasing exported locals, breaking dashed lookups like
 *   `homeStyles['plate-overlay']`
 * - `composes:` chains silently breaking when module exports change shape
 *
 * Each check below catches one of those failure modes by rendering the
 * homepage and inspecting the HTML. Run after `yarn build` (the built
 * `build/server.js` is what gets exercised).
 */

import runServer from './runServer.js';

const PORT = process.env.TEST_PORT || '3100';
const BASE_URL = `http://localhost:${PORT}`;

// runServer spawns the built server with this process's env, so PORT reaches
// it through here.
process.env.PORT = PORT;

const criticalCss = html => {
  const match = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return match ? match[1] : '';
};

const CHECKS = [
  {
    name: 'critical CSS contains no "[object Module]"',
    fn: html => !html.includes('[object Module]'),
  },
  {
    name: "marx.css element rule ('button, input, optgroup' selector) is present",
    fn: html => /button,\s*input,\s*optgroup/.test(criticalCss(html)),
  },
  {
    name: "normalize.css element rule ('html' with line-height 1.15) is present",
    fn: html => /line-height:\s*1\.15/.test(criticalCss(html)),
  },
  {
    name: 'react-toastify styles are present',
    fn: html => /\.Toastify__/.test(criticalCss(html)),
  },
  {
    name: 'dashed CSS-module locals resolve to scoped class names',
    fn: html => /class="Home-[a-z-]+-[A-Za-z0-9]{5}"/.test(html),
  },
  {
    name: 'CSS-module composes: chains are intact',
    fn: html =>
      /class="Home-[a-z-]+-[A-Za-z0-9]{5} Home-[a-z-]+-[A-Za-z0-9]{5}"/.test(
        html,
      ),
  },
];

const run = async () => {
  const server = await runServer();
  try {
    const response = await globalThis.fetch(BASE_URL);
    const html = await response.text();
    if (!response.ok) {
      console.error(`GET / returned ${response.status}`);
      process.exitCode = 1;
      return;
    }

    let failures = 0;
    for (const { name, fn } of CHECKS) {
      const ok = fn(html);
      console.info(`${ok ? '✓' : '✗'} ${name}`);
      if (!ok) failures += 1;
    }

    if (failures) {
      console.error(`${failures}/${CHECKS.length} SSR CSS checks failed`);
      process.exitCode = 1;
    }
  } finally {
    // The server child process keeps this process's event loop alive, so it
    // must be killed explicitly for the script to exit.
    server.kill('SIGTERM');
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

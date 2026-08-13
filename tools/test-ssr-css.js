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
 * `build/server.js` is what gets exercised). The checks are mode-agnostic:
 * they pass against both debug builds (`[name]-[local]-[hash]` class names)
 * and release builds (bare base64 hashes, minified CSS), so CI runs the
 * same script after both `yarn build` and `yarn build --release`.
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

// A CSS-module scoped class, in either naming scheme: debug builds emit
// `Home-<local>-<hash>`, release builds bare `<hash>` (5-6 chars of the
// base64url alphabet).
const looksScoped = token =>
  /^(?:Home-[a-zA-Z][a-zA-Z0-9_-]*-)?[A-Za-z0-9_-]{4,8}$/.test(token);

// The single-class guard additionally requires a digit and an uppercase
// letter, so stable non-module classes (`no-js`, `Toastify`) and utility
// words (`w-100`) can never satisfy it — scoped hashes virtually always
// contain both. The doubled-class guard skips those requirements: a
// two-token attribute whose tokens are both real CSS selectors is already a
// strong signal, and requiring digits there would reject legitimate hash
// pairs (e.g. `_19lsC HVlXE`).
const isScopedClass = token =>
  looksScoped(token) && /[0-9]/.test(token) && /[A-Z]/.test(token);

// Class selectors found in the critical CSS (`.foo` in `.foo:hover { ... }`,
// minus a leading dot; decimal values like `.15em` cannot satisfy
// `isScopedClass`, so they never count).
const cssClassSelectors = html =>
  new Set(
    (criticalCss(html).match(/\.([A-Za-z0-9_-]+)/g) || []).map(s => s.slice(1)),
  );

// Every class token used by the markup.
const markupClassTokens = html =>
  [...html.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(' '));

// A scoped class that is actually *wired up*: emitted as a selector in the
// critical CSS and used by the markup. This is what the camelCased-exports
// regression breaks (the class attributes vanish), so shape alone is not
// enough of a guard.
const linkedClasses = html =>
  markupClassTokens(html).filter(
    token => isScopedClass(token) && cssClassSelectors(html).has(token),
  );

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
    name: 'CSS-module locals resolve (a scoped class appears in CSS and markup)',
    fn: html => linkedClasses(html).length > 0,
  },
  {
    name: 'CSS-module composes: chains are intact',
    fn: html => {
      const selectors = cssClassSelectors(html);
      return [...html.matchAll(/class="([^"]+)"/g)].some(
        match =>
          match[1]
            .split(' ')
            .filter(token => looksScoped(token) && selectors.has(token))
            .length >= 2,
      );
    },
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

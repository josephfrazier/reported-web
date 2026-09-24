# AGENTS.md

## Project overview

- `reported-web` is a server-rendered React Starter Kit app for submitting and reviewing Reported reports.
- The app has both an Express server/API layer and a React client. Most feature work touches `src/server.js`, `src/routes/home/Home.js`, or shared components in `src/components/`.

## Repository map

- `src/server.js` — Express server, SSR entrypoint, and most API endpoints.
- `src/client.js` — client hydration, router updates, and scroll/hash restoration after navigation.
- `src/routes/index.js` — top-level route table.
- `src/routes/home/Home.js` — main reporting UI; this is one of the largest and most central files.
- `src/routes/{about,privacy}/*.md` — markdown-backed content pages.
- `src/components/` — reusable UI pieces.
- `src/{geoclient,srlookup,getVehicleType,alpr}.js` — integrations with external services.
- `tools/` — build/start pipeline used by `yarn build` and `yarn start`.
- `.github/workflows/` — CI definitions; useful for seeing the canonical commands and workarounds.

## Toolchain and setup

- Expected toolchain is Node `24.20.0` and Yarn `1.22.22` (`package.json` pins both).
- Use `nvm` with the checked-in `.nvmrc` to get the exact Node version:
  - `nvm install`
  - `nvm use`
- Install dependencies with `yarn install` after switching to Node `24.20.0`.
- Copy `.env.example` to `.env` before running app flows that need external services.

## Common commands

- Lint: `yarn lint`
- Build: `yarn build`
- Full test suite: `yarn test`
- Non-ALPR tests (matches the main CI test workflow): `yarn test:no-flaky`
- Single test file: `yarn test src/path/to/file.test.js`
- Dev app:
  1. `yarn mongo-start`
  2. `yarn parse`
  3. in another shell: `yarn start`

## Environment and external dependencies

- Parse/local app flows need `PARSE_APP_ID`, `PARSE_JAVASCRIPT_KEY`, `PARSE_MASTER_KEY`, and `PARSE_SERVER_URL`.
- Reverse geocoding/location validation uses `GEO_APP_KEY` and `GOOGLE_API_KEY`.
- ALPR flows/tests use `PLATERECOGNIZER_TOKEN` and optionally `PLATERECOGNIZER_TOKEN_TWO`.
- `HEROKU_APP_NAME`, `API_SERVER_URL`, `API_CLIENT_URL`, and `TRUST_PROXY` affect deployed/server behavior.

## Change guidance

- Prefer small, surgical edits; this repo has several large legacy files and old dependencies.
- **Never amend commits** unless explicitly asked as a one-off. Always create new commits on top instead.
- **Auto-commit after changes**: after making a requested change, run `yarn fix`, verify tests pass, then commit immediately. Do not ask "commit?" or "want me to commit?" — just do it.
- Add or change page routes in `src/routes/` and register them in `src/routes/index.js`.
- If you change API or submission behavior, inspect both `src/server.js` and `src/routes/home/Home.js`; client and server responsibilities are split between them.
- Keep tests near the affected module when possible; this repo uses a mix of colocated tests and snapshots under `src/**/__snapshots__/`.
- Do not "clean up" existing warnings unless your task is specifically about them.
- Before committing changes, run `yarn fix` to auto-fix lint issues.
- When asked to update AGENTS.md in the middle of other work: find an unmerged branch that only touches AGENTS.md (or create one if it doesn't exist), switch to it, make the changes there, commit, run `git show` so the diff is visible, then switch back to the previous branch.

## Refactoring `server.js`

Extract a route's logic into its own module as **three commits**, in this order:

1. **Characterization test first** — a real-HTTP test through the actual express app against a real Parse Server + in-memory MongoDB (the `src/server.test.js` harness: env vars set before `require('./server.js')`, `app.listen` replacement, `jest.mock` on chunk-manifest.json, `X-Forwarded-Proto: https`, explicit `emailVerified: true` seeding).
2. **Extract the implementation** — move the logic verbatim into its own module so routes become thin adapters; the characterization test must stay green.
3. **Simplify the test** — replace the HTTP-level test with a direct module test against the real Parse server; the fetch/FormData/forceSsl/env-var/app.listen workarounds go away.

Never squash the trio together: each step is independently reviewable, and the history is checked for this shape. The `/submit` → `createSubmission.js` extraction is the precedent.

## Browser targets

- `browserslist` is `[">1%", "last 4 versions", "Firefox ESR", "not dead"]`. IE and the other dead browsers were dropped deliberately — don't cite IE (or bb/baidu) as a reason to add a polyfill, avoid a native API, or keep a dependency.
- The two consumers of that target differ fundamentally, so judge an edit by comparing the *whole* build:
  - `@babel/preset-env` reads `@babel/compat-data`, which has **no data** for `op_mini`, `kaios`, `bb`, `baidu`, `and_qq` (only `ie`), so it ignores them and they never hold JS transforms back.
  - `autoprefixer` reads caniuse-lite, which **does** cover `bb` and `baidu`, so removing them changes prefixed CSS.

## Verifying UI changes

- `playwright` is a devDependency and its browsers are installed, so real-browser verification needs no extra setup; `tools/test-client-smoke.js` and `tools/test-dev-server-smoke.js` show the harness pattern. Boot `yarn start --silent` (browser-sync on `http://localhost:3000`), then drive headless chromium — `toast.screenshot({ path })` captures a single element rather than the whole page. Screenshots from an actual browser are the only way to settle CSS/rendering questions.
- Write these scratch scripts outside the repo, and require playwright by **absolute path** (`require('<repo>/node_modules/playwright')`): node resolves a bare `require` from the script's own directory, so a script outside the repo fails with `MODULE_NOT_FOUND`.
- `yarn start`'s HMR does **not** re-render an edited component. `src/client.js` accepts `./router` and calls `deepForceUpdate(appInstance)` plus `onLocationChange`, which re-runs the module that is already loaded instead of re-mounting the component, so a toast fired from `componentDidMount` doesn't re-fire and keeps its old text. For throwaway previews, register `module.hot.dispose(() => window.location.reload())` in the module being edited, guarded by `typeof window !== 'undefined' && module.hot` so SSR, jest and release builds are unaffected.

## Git push

- **Do not try to `git push` to GitHub from the sandbox** — authentication is not configured and attempts will fail with "Invalid username or token." Instead, commit changes here and ask the user to push from their host.

## Validation and CI gotchas

- CI runs Node `24.20.0`; local sandboxes may not. Yarn refuses to run unless the local Node exactly matches the `engines.node` pin. Workaround: use `nvm install` and `nvm use` (the checked-in `.nvmrc` points to `24.20.0`) before running Yarn commands.
- `yarn lint` currently passes with an existing warning in `src/routes/home/Home.js` for `react/no-danger`.
- `yarn build` succeeds locally, but emits existing webpack deprecation warnings and one existing `exifr` “Critical dependency” warning.
- `yarn test` is not a hermetic unit suite. Several tests call live external services:
  - `src/alpr.test.js` calls Plate Recognizer
  - `src/getVehicleType.test.js` calls `api.lookupaplate.com`
  - `src/srlookup.test.js` calls `portal.311.nyc.gov`
  - `src/geoclient.test.js` depends on Google Geocoding and NYC Geoclient
- In a restricted sandbox with no outbound access, those tests fail with DNS/network errors or timeouts. Work around this by running the narrowest relevant tests, or at least `yarn test:no-flaky` when you want parity with the main CI workflow.
- Run tests as `yarn test [path]`, never `npx jest`: the `test` script is `node -r dotenv/config node_modules/.bin/jest`, and that `-r dotenv/config` is the only thing loading `.env`. Under `npx jest` the API-backed suites go out with undefined credentials and fail in a misleading way — it reads like the environment has no credentials rather than like jest was invoked without dotenv.

## Commit message style

- Use markdown backtick code snippets for identifiers in commit message titles and bodies: `handleLogIn`, `type="submit"`, `<form>`, `src/routes/home/Home.js`.
- Write detailed commit bodies that explain **why** the change matters, how the problem manifests, and how the fix works — not just what changed.
- Include before/after code blocks (fenced with `\`\`\`js`) when the mechanism isn't obvious from the diff alone.
- Link to relevant docs (MDN, Node.js, library docs) using markdown reference-style links at the bottom of the message, e.g. `[AbortController]: https://...`.
- For memory, timeout, or leak fixes: describe the closure/retention chain, what held what, and how the fix breaks the chain.
- Record the dead ends: after stating the fix, list the approaches that were tried and rejected, with the reason each failed, so future developers don't repeat them. This applies to PR bodies too.
- Hard-wrap commit and PR bodies at ~72 columns. Keep the markdown when wrapping — never leave long unbroken paragraphs, and don't let the wrapping strip backticks or list structure.

### Dependency bumps

Every added or updated dependency must be linked so the change can be reviewed for dangerous or buggy code:

- **Advisory**: `[GHSA-xxxx-xxxx-xxxx]: https://github.com/advisories/GHSA-...`, found via `https://github.com/advisories?query=<pkg>` when npm's advisory page returns 403.
- **Updated package**: `https://my.diffend.io/npm/<pkg>/<from>/<to>`.
- **Newly added package**: `https://unpkg.com/<pkg>@<version>/`, since diffend has no single-version syntax.
- **npm page**: `https://www.npmjs.com/package/<pkg>?activeTab=versions` for every added or updated package, but not removed ones.
- **Removed packages**: listed plainly in the body, with no links.

In the commit body keep the dependency-changes bullet list, with each package name linking to its diff/unpkg URL and the link definitions collected at the bottom.

## Git Identity

Git config is not set in this environment. Use env vars when committing:
```bash
GIT_COMMITTER_NAME="Joseph Frazier" GIT_COMMITTER_EMAIL="1212jtraceur@gmail.com" git commit --author="Joseph Frazier <1212jtraceur@gmail.com>" -m "message"
```

Instead of Claude Code's default git commit trailer of `Co-Authored-By: Claude <noreply@anthropic.com>`, use `Co-Authored-By: Claude Code with DeepSeek` — with no email address, and not on commits the user authored themselves.

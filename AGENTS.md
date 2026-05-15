# AGENTS.md

## Project overview

- `reported-web` is a server-rendered React Starter Kit app for submitting and reviewing Reported reports.
- The app has both an Express server/API layer and a React client. Most feature work touches `src/server.js`, `src/routes/home/Home.js`, or shared components in `src/components/`.

## Repository map

- `/home/runner/work/reported-web/reported-web/src/server.js` — Express server, SSR entrypoint, and most API endpoints.
- `/home/runner/work/reported-web/reported-web/src/client.js` — client hydration, router updates, and scroll/hash restoration after navigation.
- `/home/runner/work/reported-web/reported-web/src/routes/index.js` — top-level route table.
- `/home/runner/work/reported-web/reported-web/src/routes/home/Home.js` — main reporting UI; this is one of the largest and most central files.
- `/home/runner/work/reported-web/reported-web/src/routes/{about,privacy}/*.md` — markdown-backed content pages.
- `/home/runner/work/reported-web/reported-web/src/components/` — reusable UI pieces.
- `/home/runner/work/reported-web/reported-web/src/{geoclient,srlookup,getVehicleType,alpr}.js` — integrations with external services.
- `/home/runner/work/reported-web/reported-web/tools/` — build/start pipeline used by `yarn build` and `yarn start`.
- `/home/runner/work/reported-web/reported-web/.github/workflows/` — CI definitions; useful for seeing the canonical commands and workarounds.

## Toolchain and setup

- Expected toolchain is Node `24.12.0` and Yarn `1.22.22` (`package.json` pins both).
- Install dependencies with:
  - `yarn install` if you are on Node `24.12.0`
  - `YARN_IGNORE_ENGINES=1 yarn install --ignore-engines` if the sandbox has a nearby Node version but not exactly `24.12.0`
- Copy `/home/runner/work/reported-web/reported-web/.env.example` to `.env` before running app flows that need external services.

## Common commands

- Lint: `YARN_IGNORE_ENGINES=1 yarn lint`
- Build: `YARN_IGNORE_ENGINES=1 yarn build`
- Full test suite: `YARN_IGNORE_ENGINES=1 yarn test`
- Non-ALPR tests (matches the main CI test workflow): `YARN_IGNORE_ENGINES=1 yarn test:no-alpr`
- Single test file: `YARN_IGNORE_ENGINES=1 yarn test src/path/to/file.test.js`
- Dev app:
  1. `YARN_IGNORE_ENGINES=1 yarn mongo-start`
  2. `YARN_IGNORE_ENGINES=1 yarn parse`
  3. in another shell: `YARN_IGNORE_ENGINES=1 yarn start`

## Environment and external dependencies

- Parse/local app flows need `PARSE_APP_ID`, `PARSE_JAVASCRIPT_KEY`, `PARSE_MASTER_KEY`, and `PARSE_SERVER_URL`.
- Reverse geocoding/location validation uses `GEO_APP_KEY` and `GOOGLE_API_KEY`.
- ALPR flows/tests use `PLATERECOGNIZER_TOKEN` and optionally `PLATERECOGNIZER_TOKEN_TWO`.
- `HEROKU_APP_NAME`, `API_SERVER_URL`, `API_CLIENT_URL`, and `TRUST_PROXY` affect deployed/server behavior.

## Change guidance

- Prefer small, surgical edits; this repo has several large legacy files and old dependencies.
- Add or change page routes in `/home/runner/work/reported-web/reported-web/src/routes/` and register them in `src/routes/index.js`.
- If you change API or submission behavior, inspect both `src/server.js` and `src/routes/home/Home.js`; client and server responsibilities are split between them.
- Keep tests near the affected module when possible; this repo uses a mix of colocated tests and snapshots under `src/**/__snapshots__/`.
- Do not “clean up” existing warnings unless your task is specifically about them.

## Validation and CI gotchas

- CI runs Node `24.12.0`; local sandboxes may not. In this sandbox, Yarn refused to run because the repo expects exactly `24.12.0` and the installed version was `24.14.1`. Workaround: prefix Yarn commands with `YARN_IGNORE_ENGINES=1` and use `--ignore-engines` for install steps.
- `yarn lint` currently passes with an existing warning in `src/routes/home/Home.js` for `react/no-danger`.
- `yarn build` succeeds locally, but emits existing webpack deprecation warnings and one existing `exifr` “Critical dependency” warning.
- `yarn test` is not a hermetic unit suite. Several tests call live external services:
  - `src/alpr.test.js` calls Plate Recognizer
  - `src/getVehicleType.test.js` calls `api.lookupaplate.com`
  - `src/srlookup.test.js` calls `portal.311.nyc.gov`
  - `src/geoclient.test.js` depends on Google Geocoding and NYC Geoclient
- In a restricted sandbox with no outbound access, those tests fail with DNS/network errors or timeouts. Work around this by running the narrowest relevant tests, or at least `yarn test:no-alpr` when you want parity with the main CI workflow.
- CI test workflows also run `yarn add sharp --ignore-engines` before tests. If ALPR-related tests fail because `sharp` is missing or misbuilt, repeat that step locally.

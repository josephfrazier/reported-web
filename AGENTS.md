# AGENTS.md

## Project overview

- `reported-web` is a server-rendered React Starter Kit app for submitting and reviewing Reported reports.
- The app has both an Express server/API layer and a React client. Most feature work touches `src/server.js`, `src/routes/home/Home.js`, or shared components in `src/components/`.
- Production is https://web.reported.nyc (not reportedweb.com). The domain appears nowhere else in the repo. The sandbox proxy allows this domain, so `curl https://web.reported.nyc/<path>` shows what a route serves in production. This check settles questions that the code alone leaves ambiguous.
- Deployment is Heroku: the `git remote -v` list carries a `heroku` remote. A merge to `main` on GitHub deploys the app automatically through the Heroku GitHub integration, a few minutes after the merge. A manual `git push heroku main` also deploys, and `docs/getting-started.md` describes that flow. Heroku runs `yarn run build --release` through `heroku-postbuild`. `src/config.js` falls back to `https://${HEROKU_APP_NAME}.herokuapp.com` when `API_SERVER_URL` is unset.

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

- Expected toolchain is Node `26.13.0` and Yarn `1.22.22` (`package.json` pins both).
- Use `nvm` with the checked-in `.nvmrc` to get the exact Node version:
  - `nvm install`
  - `nvm use`
- Install dependencies with `yarn install` after switching to Node `26.13.0`.
- Copy `.env.example` to `.env` before running app flows that need external services.

## Common commands

- Lint: `yarn lint`
- `yarn lint` runs eslint and stylelint. It does not run prettier, and prettier is not the standard for CSS here: a `prettier --write` run can move a `stylelint-disable-line` comment off its selector line, where it disables nothing. After you touch a `.css` file, run `yarn lint`, not just eslint and prettier. `yarn fix` is `eslint --fix` plus `stylelint --fix`.
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
- ALPR flows/tests use `PLATERECOGNIZER_TOKEN_LIST`, a comma-separated list of tokens. A read tries the token used longest ago first, puts tokens the service rate limited behind the free ones until their wait passes, and drops a token that answers 403 (depleted) for the life of the process.
- The plate-read disk cache is in `src/alprCache.js`, keyed by the uploaded bytes. `ALPR_CACHE_DIR` selects the directory. It landed on main as PR #1095, and `add-semi-automatic-mode-plan` carries the same commits, so the ALPR files are byte-identical on both branches. Do not extract it again. The live `src/alpr.test.js` snapshots pass only under `yarn test` (dotenv loads the token); a bare `yarn jest src/alpr.test.js` gets 403 `Invalid token`, which looks like a broken cache. Tests get no cache unless they set `ALPR_CACHE_DIR`.
- `HEROKU_APP_NAME`, `API_SERVER_URL`, `API_CLIENT_URL`, and `TRUST_PROXY` affect deployed/server behavior.

## Parse

- `Parse.initialize(appId, jsKey, masterKey)` stores the master key but sets `USE_MASTER_KEY` to false. `RESTController` sends `_MasterKey` only when the call's options carry `useMasterKey: true`. A script that only calls `Parse.initialize` sends no master key, even though a comment in the 311 tasks script says it does.
- Pass `{ useMasterKey: true }` on every `find`, `count`, or `save` call that needs it, or use raw fetch with an `X-Parse-Master-Key` header. A script that reads `submission` needs one of these: the class has a per-owner ACL. The 311 tasks script works without the key only because `tasks` has no ACL.
- The master key is sent only from `getSubmissions`, `deleteSubmission`, and `/api/submissions-in-polygon`. A comment above `Parse.initialize` in `src/server.js` records that policy. PR #1047 has the full rationale: the ACL owner is not always the requester, and the public map shows other users' submissions by design. Public-read ACLs were rejected because consent does not cover name and phone. Open follow-up: move those three reads to Cloud Code, so the web app needs no master key. No Cloud Code deployment exists in this repo.

## Sessions and submissions

- The app sets the HttpOnly Parse session cookie `reportedWebSession` in `src/session.js`. That work replaced stored passwords and is live.
- **Back4App sessions expire a year out.** The value is in `_Session.expiresAt` (confirmed 2026-10-02), and Parse Server 2.8.4 never extends it on use. A browser therefore needs a real login about once a year. The client's 401 handler covers it. `expireInactiveSessions: false` in Back4App's Server Settings → Custom Parse Options would make sessions never expire.
- **`/submissions` costs about 0.37 ms per returned row.** The whole history is the cost: the heaviest known account (4,966 submissions) takes about 1.9 s. Pagination, not query narrowing, is the lever if this matters.

## Heroku deployment

- **Keep the `runtime-dyno-metadata` lab.** `version_number` on each Parse submission is `Number(HEROKU_RELEASE_VERSION.slice(1))` (`src/server.js`). The Back4App column is typed Number, so a commit hash cannot replace it. The user looks up the commit for a release with `heroku releases`. Do not propose removing the lab.
- **Do not unset `HEROKU_RELEASE_VERSION` anywhere.** On review apps it comes from a frozen 2021 snapshot in the pipeline's review-app config vars (`v326`, next to `HEROKU_APP_NAME=reported-web`). Without the variable, `undefined.slice` throws in the multer callback and the process exits on every submission. Clean the snapshot only after `versionNumber` gets a fallback.
- **Review apps copy config vars only at creation.** A new parent variable is absent until you set it on the review app or recreate the app. On 2026-10-22 the review app for PR #1103 failed every ALPR read because it predated `PLATERECOGNIZER_TOKEN_LIST`. Copy a variable without a rebuild:

  ```bash
  heroku config:set -a <review-app> \
    PLATERECOGNIZER_TOKEN_LIST="$(heroku config:get PLATERECOGNIZER_TOKEN_LIST -a reported-web)"
  ```

  Review app names look like `reported-web-<branch-fragment>-<hash>`. Their `window.App.sentryDsn` is undefined, so their server errors do not reach Sentry. Use `heroku logs -a <review-app>`.

## Sentry

Sentry is the observability home: US region, org `reported`, project `reported-web`, project id `4512188817014784`.

- **Errors and logs.** Both SDKs report uncaught exceptions, unhandled rejections, and console output. The browser sends its envelopes through the app's `/monitoring` tunnel, so content blockers do not drop them.
- **Logs are the log home.** The server and browser console output lands in Sentry Logs, with 30-day retention on the free plan. This includes the countable lines such as `[home] legacy localStorage state migrated`. The Axiom drain was removed on 2026-10-05. `heroku logs` is the only place the Heroku router lines appear.
- **Read the logs through the API.** `SENTRY_AUTH_TOKEN` is in `.env`, created read-only on purpose (`event:read`, `org:read`, `project:read`). Query `GET https://us.sentry.io/api/0/organizations/reported/events/?dataset=logs&query=…`. Use `statsPeriod=30d` or `start`/`end` (ISO-8601; a `Z` is accepted here). Use `field=count()` for a count. The issues endpoint takes only `24h` or `14d`, never `30d`.
- **Link one in the UI.** The page is `/explore/logs/?end=…&logsFields=timestamp&logsFields=message&logsSortBys=-timestamp&project=4512188817014784&query=…&start=…`. Its timestamps are naive UTC: a `Z` or an offset is rejected, and the page falls back to `statsPeriod=30d`. A range older than the retention floor is refused the same way. The page renders the UTC bounds in the viewer's timezone.
- **App-level errors are logs, not issues.** Nothing calls `captureException` for them, so there is no issue permalink. Cite a logs URL, and put the counts in the commit message: retention removes the link long before the commit.
- **Source maps.** Release builds upload them with `@sentry/webpack-plugin` (`SENTRY_AUTH_TOKEN` in the Heroku config), and the client bundle uses `hidden-source-map`. One release string goes into both bundles. The build takes it from `SOURCE_VERSION`; `HEROKU_BUILD_COMMIT` names the running release inside a build, which once filed artifacts one commit behind.
- The DSN lives in the Heroku config and the local `.env`, never the repo. Allowed Domains no longer gates browser traffic because the tunnel carries it.
- OAuth grants live at `https://<org>.sentry.io/settings/account/authorizations/`, headed "Approved Applications". The user revoked the Sentry MCP app there on 2026-10-05. That page is separate from `SENTRY_AUTH_TOKEN`, which the source map upload needs.
- **Tracing.** Built on branch `add-sentry-tracing` (browser page loads, trace headers, server spans, one in ten in production). It was not landed as of 2026-10-05.

## Change guidance

- Prefer small, surgical edits; this repo has several large legacy files and old dependencies.
- **Split a fix that applies to `main` off the feature branch.** Make a new branch from `main`, write the failing test first, then the fix. Land it before the feature. The order matters: a server-side acceptance change is a safe no-op until a client sends the new shape. Do not assume the change is a bug on `main`; ask whether the split is wanted. Create the branch with `git switch -c <name> --no-track origin/main`, and tell the user the landing order.
- **Never amend commits** unless explicitly asked as a one-off. Always create new commits on top instead.
- **Auto-commit after changes**: after making a requested change, run `yarn fix`, verify tests pass, then commit immediately. Do not ask "commit?" or "want me to commit?" — just do it.
- Add or change page routes in `src/routes/` and register them in `src/routes/index.js`.
- If you change API or submission behavior, inspect both `src/server.js` and `src/routes/home/Home.js`; client and server responsibilities are split between them.
- Keep tests near the affected module when possible; this repo uses a mix of colocated tests and snapshots under `src/**/__snapshots__/`.
- Do not "clean up" existing warnings unless your task is specifically about them.
- Write each code comment for a reader who never saw the previous version. Do not explain what changed or what was removed ("no longer", "used to"). Delete the comment with the code it described, unless the remaining code needs one.
- `src/session.js` still accepts legacy email+password auth. The transition away from client-stored passwords needs it. Each use logs `[session] legacy credential auth used`. Delete the fallback and the `viaCredentials` plumbing after that log line stays quiet for about 90 days.
- Before committing changes, run `yarn fix` to auto-fix lint issues.
- When asked to update AGENTS.md in the middle of other work: find an unmerged branch that only touches AGENTS.md (or create one if it doesn't exist), switch to it, make the changes there, commit, run `git show` so the diff is visible, then switch back to the previous branch.

### Commit messages

- **Do not include CI results.** No test or suite counts, and no "`yarn lint` exits 0" line. A message says what changed and why; it does not report the run that checked it. Run the suite and the linter all the same — just keep them out of the message.
- **Name in-flight work by its pull request**, rather than only by branch name, so a reader can follow it. If you're not sure whether there's a PR, ask the user, or if that's not acceptable (e.g. in non-interactive work), generate a github link to the branch name, for example https://github.com/josephfrazier/reported-web/tree/add-semi-automatic-mode-plan
- **Say when a change came out of other in-flight work.** If a fix turned up while building something that has a pull request open, name that PR and say what it was doing that surfaced the problem. The change still has to stand on its own — a reader should not need the other work to follow it — but knowing where it came from is the context for why it was made.

## Refactoring `server.js`

Extract a route's logic into its own module as **three commits**, in this order:

1. **Characterization test first** — a real-HTTP test through the actual express app against a real Parse Server + in-memory MongoDB, in the new module's own test file. Step 3 rewrites that file, so no example stays in the tree; the most recent one is `git show f91bb664:src/getAttachmentData.test.js`. Its shape: env vars set before `require('./server.js')`, `app.listen` replacement, `jest.mock` on chunk-manifest.json, `X-Forwarded-Proto: https`, explicit `emailVerified: true` seeding.
2. **Extract the implementation** — move the logic verbatim into its own module so routes become thin adapters; the characterization test must stay green.
3. **Simplify the test** — replace the HTTP-level test with a direct module test against the real Parse server; the fetch/FormData/forceSsl/env-var/app.listen workarounds go away.

Never squash the trio together: each step is independently reviewable, and the history is checked for this shape. The `/submit` → `createSubmission.js` extraction is the precedent.

## Browser targets

- `browserslist` is `[">1%", "last 4 versions", "Firefox ESR", "not dead"]`. IE and the other dead browsers were dropped deliberately — don't cite IE (or bb/baidu) as a reason to add a polyfill, avoid a native API, or keep a dependency.
- The two consumers of that target differ fundamentally, so judge an edit by comparing the *whole* build:
  - `@babel/preset-env` reads `@babel/compat-data`, which has **no data** for `op_mini`, `kaios`, `bb`, `baidu`, `and_qq` (only `ie`), so it ignores them and they never hold JS transforms back.
  - `autoprefixer` reads caniuse-lite, which **does** cover `bb` and `baidu`, so removing them changes prefixed CSS.

## Verifying UI changes

- `playwright` is a devDependency and its browsers are installed, so real-browser verification needs no extra setup; `tools/test-client-smoke.js` and `tools/test-dev-server-smoke.js` show the harness pattern. Boot `yarn start --silent` (the Express dev server on `http://localhost:3000`), then drive headless chromium — `toast.screenshot({ path })` captures a single element rather than the whole page. Screenshots from an actual browser are the only way to settle CSS/rendering questions.
- Write these scratch scripts outside the repo, and require playwright by **absolute path** (`require('<repo>/node_modules/playwright')`): node resolves a bare `require` from the script's own directory, so a script outside the repo fails with `MODULE_NOT_FOUND`.
- `yarn start`'s HMR does **not** re-render an edited component. `src/client.js` accepts `./router` and calls `deepForceUpdate(appInstance)` plus `onLocationChange`, which re-runs the module that is already loaded instead of re-mounting the component, so a toast fired from `componentDidMount` doesn't re-fire and keeps its old text. For throwaway previews, register `module.hot.dispose(() => window.location.reload())` in the module being edited, guarded by `typeof window !== 'undefined' && module.hot` so SSR, jest and release builds are unaffected.
- Start the dev server and other long-running processes with the Bash tool's `run_in_background`, not a shell `&`. The user works from the session task list: a detached process shows no row, no status, and no live output, so the work looks absent. Say what the task ID is and where its output goes. Put screenshots and walkthroughs where the user can open them, not in the job's temporary directory.
- **Drive the logged-in report form without an account.** The dev server holds production Back4App credentials, so use the state cookie instead of a sign-in. The report form and the `Where` button that opens the map modal render only when `loginSuccessful` is true. `src/routes/home/index.js` parses the state cookie into `initialState`, and `Home` spreads `props.initialState` last, so a fresh Playwright context with cookie `reportedWebHomeState={"loginSuccessful":true}` gets the logged-in UI. Nothing re-verifies the session on load.
- `handleSessionExpired` clears the login on any 401, so intercept each authenticated call the flow makes (`POST /api/uploadAttachment`, `POST /platerecognizer`) and fulfil both locally. Without that the form vanishes mid-run.
- The attachment fields live inside the `attachmentData.length > 0` fragment, so upload a picture first. A JPEG with EXIF taken-date and GPS keeps `extractDate`/`extractLocation` quiet; a PNG makes both throw.
- Google's `.pac-container` still holds the previous keystroke's list while the next request is in flight. Read predictions only after two reads a half-second apart agree; an early read reports results for a prefix of the query.
- The Maps API key is hardcoded in `src/routes/home/Home.js` and works from `localhost:3000`, so `yarn start` alone is enough (no mongo or Parse).

## Git push

- **Do not try to `git push` to GitHub from the sandbox** — authentication is not configured and attempts will fail with "Invalid username or token." Instead, commit changes here and ask the user to push from their host.
- **Do not rewrite commits that exist on origin.** A rebase of a pushed branch needs a force-push, and the user does not want that. When a local branch has commits that are not on origin's head, reset to `origin/<branch>` and cherry-pick the local commits on top of it. Resolve the conflicts there. Check `git merge-base --is-ancestor origin/<branch> HEAD` before the hand-off. A local commit that is not pushed yet can still be amended or rebased.
- **Create working branches with `--no-track`, and push them with an explicit destination:**

  ```bash
  git checkout -b my-branch --no-track origin/main
  git push -u origin my-branch:refs/heads/my-branch
  ```

  `git checkout -b my-branch origin/main` records `branch.my-branch.merge = refs/heads/main`, so the new branch tracks `main` rather than a same-named branch. With `push.default = upstream` (or `tracking`) in the user's global config, which is not visible from the sandbox, `git push origin my-branch` then resolves its destination from that upstream and **tries to push onto `main`** — rejected here with `GH006: Protected branch update failed` because `main` is protected, but it would land on an unprotected branch. `--no-track` leaves the branch with no upstream, so a push defaults to the same name, and the explicit `:refs/heads/<name>` destination overrides `push.default` and records the correct tracking ref. To repair a branch created the old way, point its upstream at itself with `git config branch.<name>.merge refs/heads/<name>` (or `git branch --unset-upstream <name>`).

## Shared checkout and worktrees

- **Other sessions share this checkout.** The tree is a direct-mode mount of the host's working copy. Another session can switch HEAD while you work. Run `git rev-parse --abbrev-ref HEAD` in the same command as `git commit`, not in an earlier call. If a commit lands on the wrong branch, move it with `git branch -f <branch> <commit>` and restore the other branch from its remote ref.
- **Do not use the stash.** The stash list is shared too. One bare `git stash pop` applied another session's work. Park a file with `cp <file> $CLAUDE_JOB_DIR/tmp/`, then copy it back. If you must pop, read `git stash list` first and name the entry (`stash@{n}`).
- **Prefer a throwaway worktree.** Run the branch, the edits, the tests, and the commit in a worktree outside the shared checkout:

  ```bash
  git worktree add --no-track -b <branch> /home/agent/<name> origin/main
  ln -s <repo>/node_modules <worktree>/node_modules   # and .env
  # edit, test, commit there
  git worktree remove --force <worktree>              # branch ref stays in the repo
  ```

  The shared HEAD does not move, and the other session's dirty files stay untouched. Remove the worktree before the hand-off, so the user can `git checkout <branch>`. Do not borrow a `.claude/worktrees/<name>` checkout that belongs to another task; it blocks that task and the user's own checkout.

## Validation and CI gotchas

- CI runs Node `26.13.0`; local sandboxes may not. Use `nvm install` and `nvm use` (the checked-in `.nvmrc` points to `26.13.0`) to match it.
- `.yarnrc` sets `ignore-engines`, so Yarn no longer enforces any `engines.node` field. The reason is `parse-server` 9.4.0: it declares a Node range that stops below 26, and its first release that names Node 26 (9.11.0) changes how a master-key signup and a pointer `$in` query behave. Keep local Node at the `.nvmrc` pin by hand; Yarn will not catch a mismatch.
- `yarn lint` currently passes with an existing warning in `src/routes/home/Home.js` for `react/no-danger`.
- `yarn build` succeeds locally, but emits existing webpack deprecation warnings and one existing `exifr` “Critical dependency” warning.
- `yarn test` is not a hermetic unit suite. Several tests call live external services:
  - `src/alpr.test.js` calls Plate Recognizer
  - `src/getVehicleType.test.js` calls `api.lookupaplate.com`
  - `src/srlookup.test.js` calls `portal.311.nyc.gov`
  - `src/geoclient.test.js` depends on Google Geocoding and NYC Geoclient
- In a restricted sandbox with no outbound access, those tests fail with DNS/network errors or timeouts. Work around this by running the narrowest relevant tests, or at least `yarn test:no-flaky` when you want parity with the main CI workflow.
- Run tests as `yarn test [path]`, never `npx jest`: the `test` script is `node -r dotenv/config node_modules/.bin/jest`, and that `-r dotenv/config` is the only thing loading `.env`. Under `npx jest` the API-backed suites go out with undefined credentials and fail in a misleading way — it reads like the environment has no credentials rather than like jest was invoked without dotenv.
- The real-Parse suites (`src/testUtils/realParseServer.js`, `mongodb-memory-server`) run offline in this sandbox: the mongod binary is cached at `~/.cache/mongodb-binaries/mongod-arm64-ubuntu-4.4.14`, so nothing downloads. `parse-server` and `mongodb-memory-server` are devDependencies.
- A scratch test can drive the real Express app end to end. Set `PARSE_*`, `HEROKU_RELEASE_VERSION`, and `PLATERECOGNIZER_TOKEN` (`_TWO`) before `require('./server.js')`. Replace `app.listen` with one that binds port 0. Then POST with `globalThis.fetch` and `FormData`, with a `cookie: reportedWebSession=<session token>` header and `X-Forwarded-Proto: https`. `jest.mock('./chunk-manifest.json', () => ({}), { virtual: true })` is still needed.
- jest 30's node environment does provide `fetch`, `FormData`, and `Blob`. The "jest's environment has no fetch of its own" comment in `src/alprCache.test.js` is stale. Stub `globalThis.fetch` and keep the real one in a local to call the app under test.
- `video-extensions@2.0.0` is pure ESM. Under a bare `npx jest` it throws `Must use import to load ES Module`. The `yarn test` script runs `node --experimental-vm-modules node_modules/.bin/jest` (since `cf6b573e`), so it loads the package fine. Node 24 supports `require(esm)`, but jest's sync-ESM path needs `vm.SourceTextModule.prototype.hasAsyncGraph`, which only exists with the flag. Run jest through `yarn test` before you blame an ESM-only dependency.
- `express@5` ships `send@1.x`, whose `dotfiles: 'ignore'` check runs on the resolved filesystem path, not on the request URL as `send@0.19` under Express 4 did. A dot-prefixed directory anywhere in the path makes `res.sendFile()` answer 404 with a `NotFoundError` from `send`. Symptom: `yarn test:dev-server-smoke` fails only at `✗ GET /submissions-map serves the map page`, with status 404 and the SSR page, when the tree lives under `~/.claude/jobs/<id>/tmp/...` or `<repo>/.claude/worktrees/<name>`. A plain `express.static` mount is unaffected, and Node 24 and Node 26 fail the same way. Run server smoke tests from a path with no dot segment, such as `/home/agent/expr-scratch`. To test a worktree branch, add a throwaway detached worktree outside dot paths (`git worktree add --detach /home/agent/nodot <branch>`), symlink `node_modules`, and run there. CI (`/home/runner/work`) and Heroku (`/app`) have no dot segment. Raised in PR #851.

## Logging and countable events

- Count things with one-line `console.info('[topic] message')` calls, like `[session] legacy credential auth used` and `[home] legacy localStorage state migrated`. A search in the log service finds every event of one kind, so a count needs no new metrics code.
- The default `heroku logs` window is short. Pull a longer tail with `heroku logs -n 9999`, and check it periodically. A line that stays absent across the checks is the signal that ends a transitional block.

## Writing style

Write all prose in Simplified Technical English (ASD-STE100). The user asked for this style as the default for all prose, including commit messages and pull request descriptions.

- Keep each sentence at or below 20 words. Put one idea in each sentence.
- Use active voice.
- Use simple tenses only. Do not use `-ing` verbs or the present perfect.
- Use simple words. Do not use idioms, metaphors, slang, or contractions.
- Write the articles (a, an, the). Keep noun groups at or below three words.
- Put one instruction in each sentence.
- Use a vertical list for two or more items or parallel facts. Do not use dashes to join clauses.
- Keep each paragraph at or below 6 sentences.
- Keep code identifiers, file paths, command names, and the git trailer unchanged. STE permits technical names.

## Commit message style

- Use markdown backtick code snippets for identifiers in commit message titles and bodies: `handleLogIn`, `type="submit"`, `<form>`, `src/routes/home/Home.js`.
- Write detailed commit bodies that explain **why** the change matters, how the problem manifests, and how the fix works — not just what changed.
- Include before/after code blocks (fenced with `\`\`\`js`) when the mechanism isn't obvious from the diff alone.
- Link to relevant docs (MDN, Node.js, library docs) using markdown reference-style links at the bottom of the message, e.g. `[AbortController]: https://...`.
- Write every in-text mention that a definition serves as a reference-style link, PR numbers included: `[#928][pr-928]`, with `[pr-928]: https://github.com/josephfrazier/reported-web/pull/928` at the bottom. Never write a bare `#NNN`: GitHub autolinks it to the issue or PR with that number, which is the wrong artifact for a Dependabot alert and a duplicate of a PR link.
- Bracket a `GHSA-...` or alert number as well: `[GHSA-q2hr-2g5m-vwhr][ghsa-q2hr-2g5m-vwhr]` or `[Dependabot alert #515][alert-515]`. A plain-text mention leaves its definition unused, so no link renders. Check that every label has a definition and every definition is used.
- For memory, timeout, or leak fixes: describe the closure/retention chain, what held what, and how the fix breaks the chain.
- Record the dead ends: after stating the fix, list the approaches that were tried and rejected, with the reason each failed, so future developers don't repeat them. This applies to PR bodies too.
- Hard-wrap commit and PR bodies at ~72 columns. Keep the markdown when wrapping — never leave long unbroken paragraphs, and don't let the wrapping strip backticks or list structure.

### Dependency bumps

Every added or updated dependency must be linked so the change can be reviewed for dangerous or buggy code:

- **Advisory**: `[GHSA-xxxx-xxxx-xxxx]: https://github.com/advisories/GHSA-...`, found via `https://github.com/advisories?query=<pkg>` when npm's advisory page returns 403.
- **Updated package**: `https://my.diffend.io/npm/<pkg>/<from>/<to>`.
- **Newly added package**: `https://unpkg.com/<pkg>@<version>/`, since diffend has no single-version syntax. Check that the link resolves: a `yarn.lock` key can be an npm alias (`@jest/react-is-18@npm:react-is@^18.3.1`), so it has no registry entry and its unpkg URL 404s. Link the real package (`https://unpkg.com/react-is@18.3.1/`) and say it is an alias. `npmjs.com` returns 403 to curl, so check the unpkg URL instead.
- **npm page**: `https://www.npmjs.com/package/<pkg>?activeTab=versions` for every added or updated package, but not removed ones.
- **Removed packages**: listed plainly in the body, with no links.

In the commit body keep the dependency-changes bullet list, with each package name linking to its diff/unpkg URL and the link definitions collected at the bottom.

## Git identity

Git config is set in this environment to `Joseph Frazier <1212jtraceur@gmail.com>`, so a commit needs no environment variables. Verify it with `git config user.email` before you rely on it. If the identity is missing, set it for that commit only:
```bash
GIT_COMMITTER_NAME="Joseph Frazier" GIT_COMMITTER_EMAIL="1212jtraceur@gmail.com" git commit --author="Joseph Frazier <1212jtraceur@gmail.com>" -m "message"
```

Instead of Claude Code's default git commit trailer of `Co-Authored-By: Claude <noreply@anthropic.com>`, use `Co-Authored-By: Claude Code with DeepSeek` — with no email address, and not on commits the user authored themselves.

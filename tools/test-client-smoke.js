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
 * Also exercises `/submissions-map`: both the logged-in "My Submissions"
 * flow (with the `/submissions` POST mocked via route interception) and
 * the logged-out login-prompt flow.
 *
 * Run after `yarn build`; see `tools/test-ssr-css.js` for the server
 * lifecycle pattern this mirrors.
 */

import { chromium } from 'playwright';
import runServer from './runServer.js';

const PORT = process.env.TEST_PORT || '3100';
const BASE_URL = `http://localhost:${PORT}`;

process.env.PORT = PORT;

// The map page loads Leaflet (CDN) and OSM tiles immediately; failed
// image/tile fetches surface as "Failed to load resource" console errors
// without breaking the page, so skip those when checking for real errors.
function attachErrorListeners(page, errors) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource/.test(message.text())
    ) {
      errors.push(`console.error: ${message.text()}`);
    }
  });
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
  const server = await runServer();
  const browser = await chromium.launch();
  let failures = 0;
  try {
    // ── Home page ──
    const page = await browser.newPage();

    const errors = [];
    attachErrorListeners(page, errors);

    const response = await page.goto(BASE_URL, { waitUntil: 'load' });

    const heading = await page
      .locator('main h1')
      .first()
      .textContent()
      .catch(() => null);

    failures += runChecks([
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
    ]);

    // ── Submissions map: logged in ──
    const homeState = {
      email: 'test@example.com',
      password: 'password123',
      FirstName: 'Test',
      LastName: 'User',
      Phone: '555-555-5555',
      testify: false,
      loginSuccessful: true,
    };
    const loggedInContext = await browser.newContext();
    await loggedInContext.addCookies([
      {
        name: 'reportedWebHomeState',
        // Home.js serializes the cookie value with `cookie.serialize`,
        // which URI-encodes the JSON
        value: encodeURIComponent(JSON.stringify(homeState)),
        url: BASE_URL,
        sameSite: 'Lax',
      },
    ]);

    let submissionsPostCount = 0;
    let submissionsPostBody = null;
    await loggedInContext.route('**/submissions', route => {
      if (route.request().method() !== 'POST') {
        route.continue();
        return;
      }
      submissionsPostCount += 1;
      submissionsPostBody = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [
            {
              objectId: 'sub_1',
              location: {
                __type: 'GeoPoint',
                latitude: 40.686,
                longitude: -73.979,
              },
              typeofcomplaint: 'Blocked the crosswalk',
              license: 'T794438C',
              state: 'NY',
              loc1_address: '64 Flatbush Ave, Brooklyn',
              timeofreport: { __type: 'Date', iso: '2023-04-28T17:04:00.000Z' },
              reqnumber: 'REQ-1',
              photoData0: {
                __type: 'File',
                url: 'https://example.com/photo.jpg',
                name: 'photo.jpg',
              },
              photoData1: null,
              photoData2: null,
            },
            {
              objectId: 'sub_2',
              location: {
                __type: 'GeoPoint',
                latitude: 40.7,
                longitude: -73.99,
              },
              typeofcomplaint: 'Ran red light',
              license: 'ABC1234',
              state: 'NY',
              loc1_address: '2nd Ave & St Marks Pl, Manhattan',
              timeofreport: { __type: 'Date', iso: '2023-05-01T10:00:00.000Z' },
              photoData0: null,
              photoData1: null,
              photoData2: null,
            },
            { objectId: 'sub_3' }, // no location → skipped by renderMap
          ],
        }),
      });
    });

    const mapPage = await loggedInContext.newPage();
    const mapErrors = [];
    attachErrorListeners(mapPage, mapErrors);

    await mapPage.goto(`${BASE_URL}/submissions-map`, { waitUntil: 'load' });
    await mapPage.click('#tab-my-submissions');
    await mapPage.click('#load-my-submissions-btn');
    await mapPage.waitForFunction(
      () => document.querySelectorAll('.leaflet-marker-icon').length === 2,
    );

    // The first marker belongs to `sub_1`; its popup should link that
    // objectId to the Back4App browser view.
    await mapPage.locator('#map .leaflet-marker-icon').first().hover();
    await mapPage.waitForSelector('#popup.visible');
    const objectIdHref = await mapPage
      .locator('#popup-meta a')
      .first()
      .getAttribute('href');
    const objectIdText = await mapPage
      .locator('#popup-meta a')
      .first()
      .textContent();
    const countBadge = await mapPage.locator('#count-badge').textContent();
    const modeLabel = await mapPage.locator('#mode-label').textContent();
    const loggedInPromptVisible = await mapPage
      .locator('#my-submissions-login-prompt')
      .isVisible()
      .catch(() => false);

    failures += runChecks([
      {
        name: 'submissions map: no page or console errors (logged in)',
        ok: mapErrors.length === 0,
        detail: mapErrors.join('\n'),
      },
      {
        name: 'submissions map: POSTs cookie credentials to /submissions',
        ok:
          submissionsPostCount === 1 &&
          submissionsPostBody?.email === homeState.email &&
          submissionsPostBody?.password === homeState.password &&
          submissionsPostBody?.FirstName === homeState.FirstName &&
          submissionsPostBody?.LastName === homeState.LastName &&
          submissionsPostBody?.Phone === homeState.Phone,
        detail: JSON.stringify({ submissionsPostCount, submissionsPostBody }),
      },
      {
        name: 'submissions map: renders markers and count badge',
        // Counts all submissions; geoless ones are skipped only for markers
        ok: countBadge === '3 reports',
        detail: `count-badge: ${countBadge}`,
      },
      {
        name: 'submissions map: popup links objectId to the Back4App browser',
        ok:
          objectIdHref?.startsWith(
            'https://backend.back4app.com/apps/932de73d-5214-4a3e-aec5-5c9be0055dac/browser/submission?filters=',
          ) &&
          objectIdHref.includes('compareTo%22%3A%22sub_1%22') &&
          objectIdText === 'sub_1',
        detail: JSON.stringify({ objectIdHref, objectIdText }),
      },
      {
        name: 'submissions map: shows My submissions mode label',
        ok: modeLabel === 'My submissions',
        detail: `mode-label: ${modeLabel}`,
      },
      {
        name: 'submissions map: URL persists mySubmissions=1',
        ok: new URL(mapPage.url()).searchParams.get('mySubmissions') === '1',
        detail: mapPage.url(),
      },
      {
        name: 'submissions map: login prompt stays hidden when logged in',
        ok: !loggedInPromptVisible,
      },
    ]);

    // ── Submissions map: logged out ──
    const loggedOutContext = await browser.newContext();
    const loggedOutPage = await loggedOutContext.newPage();
    const loggedOutErrors = [];
    attachErrorListeners(loggedOutPage, loggedOutErrors);

    let submissionsRequests = 0;
    loggedOutPage.on('request', request => {
      if (request.url().endsWith('/submissions')) submissionsRequests += 1;
    });

    await loggedOutPage.goto(`${BASE_URL}/submissions-map`, {
      waitUntil: 'load',
    });
    await loggedOutPage.click('#tab-my-submissions');
    await loggedOutPage.click('#load-my-submissions-btn');

    const loggedOutPromptVisible = await loggedOutPage
      .locator('#my-submissions-login-prompt')
      .isVisible()
      .catch(() => false);

    failures += runChecks([
      {
        name: 'submissions map: no page or console errors (logged out)',
        ok: loggedOutErrors.length === 0,
        detail: loggedOutErrors.join('\n'),
      },
      {
        name: 'submissions map: logged out shows login prompt',
        ok: loggedOutPromptVisible,
      },
      {
        name: 'submissions map: logged out makes no /submissions request',
        ok: submissionsRequests === 0,
        detail: `requests: ${submissionsRequests}`,
      },
    ]);

    if (failures) {
      console.error(`${failures} client smoke checks failed`);
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

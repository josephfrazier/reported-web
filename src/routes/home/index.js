/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import sortBy from 'lodash.sortby';
import Home from './Home.js';
import Layout from '../../components/Layout/Layout.js';
import boroughBoundariesFeatureCollection from '../../boroughBoundaries.js';
import categoriesData from './categories.json';

async function action({
  commitHash,
  cookies,
  parseServerUrl,
  showParseServerBanner,
  reviewAppUrl,
  reviewAppLabel,
  sessionPresent,
}) {
  // The complaint categories haven't changed in Parse for years, so a
  // snapshot of them is bundled instead of fetched at render time.
  const typeofcomplaintValues = sortBy(
    categoriesData.categories,
    'createdAt',
  ).map(({ text }) => text);

  // Parse persistent state from cookie set by the client
  let initialState = null;
  const cookieValue = cookies && cookies.reportedWebHomeState;
  if (cookieValue) {
    try {
      initialState = JSON.parse(cookieValue);
    } catch {
      // ignore corrupted cookie
    }
  }

  // Being logged in is the session cookie's call, not the state cookie's.
  // Only true is forced: on a client-side navigation after an in-page login,
  // this action re-runs in the browser with a stale `sessionPresent`, and
  // the state cookie it just wrote is the newer truth.
  if (sessionPresent) {
    initialState = { ...(initialState || {}), loginSuccessful: true };
  }

  // Submissions are loaded client-side when the user expands the
  // "Previous Submissions" section or has opted into auto-loading.
  // We don't pre-fetch them during SSR because it can be slow for
  // users with thousands of submissions.

  return {
    title: 'Reported',
    chunks: ['home'],
    component: (
      <Layout>
        <Home
          typeofcomplaintValues={typeofcomplaintValues}
          boroughBoundariesFeatureCollection={
            boroughBoundariesFeatureCollection
          }
          commitHash={commitHash}
          parseServerUrl={parseServerUrl}
          showParseServerBanner={showParseServerBanner}
          reviewAppUrl={reviewAppUrl}
          reviewAppLabel={reviewAppLabel}
          initialState={initialState}
        />
      </Layout>
    ),
  };
}

export default action;

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
import boroughBoundariesFeatureCollection from '../../../public/borough-boundaries-clipped-to-shoreline.geo.json';

async function action({ fetch, commitHash, cookies }) {
  // get complaint categories from server. The form can render without
  // them, so a Parse/API failure must not take down SSR — the action
  // fetches them again on client-side navigation.
  let typeofcomplaintValues = [];
  try {
    const resp = await fetch('/api/categories');
    const { categories } = await resp.json();
    typeofcomplaintValues = sortBy(categories, 'createdAt').map(
      ({ text }) => text,
    );
  } catch {
    // fall back to the empty list above
  }

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
          initialState={initialState}
        />
      </Layout>
    ),
  };
}

export default action;

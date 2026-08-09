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
  // get complaint categories from server
  const resp = await fetch('/api/categories');
  const { categories } = await resp.json();
  const typeofcomplaintValues = sortBy(categories, 'createdAt').map(
    ({ text }) => text,
  );

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

  // If the user has opted in to loading previous submissions, fetch them server-side
  // so they are available on the very first render (no flash / extra round-trip).
  let initialSubmissions = null;
  if (
    initialState &&
    initialState.isLoadPreviousSubmissionsEnabled &&
    initialState.loginSuccessful &&
    initialState.email &&
    initialState.password
  ) {
    try {
      const submissionsResp = await fetch('/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: initialState.email,
          password: initialState.password,
        }),
      });
      if (submissionsResp.ok) {
        const { submissions } = await submissionsResp.json();
        initialSubmissions = submissions;
      }
    } catch {
      // fall back to client-side loading
    }
  }

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
          initialSubmissions={initialSubmissions}
        />
      </Layout>
    ),
  };
}

export default action;

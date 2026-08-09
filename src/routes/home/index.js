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
  let typeofcomplaintValues = [];
  try {
    const resp = await fetch('/api/categories');
    const { categories } = await resp.json();
    typeofcomplaintValues = sortBy(categories, 'createdAt').map(
      ({ text }) => text,
    );
  } catch {
    // fall back to empty list (e.g. when Parse is not configured)
  }

  // Parse persistent state from cookie set by the client
  let initialState = null;
  const cookieValue = cookies && cookies.reportedWebHomeState;
  console.info('[SSR] reportedWebHomeState cookie present:', !!cookieValue);
  if (cookieValue) {
    try {
      initialState = JSON.parse(cookieValue);
      console.info(
        '[SSR] parsed initialState keys:',
        Object.keys(initialState),
      );
      console.info(
        '[SSR] isLoadPreviousSubmissionsEnabled:',
        initialState.isLoadPreviousSubmissionsEnabled,
      );
      console.info('[SSR] loginSuccessful:', initialState.loginSuccessful);
      console.info('[SSR] has email:', !!initialState.email);
      console.info('[SSR] has password:', !!initialState.password);
    } catch (err) {
      console.error('[SSR] failed to parse cookie:', err.message);
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
    console.info('[SSR] conditions met, fetching submissions...');
    try {
      const submissionsResp = await fetch('/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: initialState.email,
          password: initialState.password,
        }),
      });
      console.info(
        '[SSR] submissions response status:',
        submissionsResp.status,
      );
      if (submissionsResp.ok) {
        const { submissions } = await submissionsResp.json();
        console.info('[SSR] submissions count:', submissions.length);
        initialSubmissions = submissions;
      } else {
        console.error(
          '[SSR] submissions fetch not ok:',
          submissionsResp.status,
        );
      }
    } catch (err) {
      console.error('[SSR] submissions fetch error:', err.message);
    }
  } else {
    console.info('[SSR] conditions not met for preloading submissions');
  }

  console.info('[SSR] initialSubmissions present:', !!initialSubmissions);

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

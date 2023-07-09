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
import Home from './Home';
import Layout from '../../components/Layout';
import boroughBoundariesFeatureCollection from '../../../public/borough-boundaries-clipped-to-shoreline.geo.json';

async function action({ fetch }) {
  // get complaint categories from server
  const resp = await fetch('/api/categories');
  const { categories } = await resp.json();
  const typeofcomplaintValues = sortBy(categories, 'createdAt').map(
    ({ text }) => text,
  );

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
        />
      </Layout>
    ),
  };
}

export default action;

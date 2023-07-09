/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

/* eslint-env jest */
/* eslint-disable padded-blocks, no-unused-expressions */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import App from '../../components/App';
import Home from './Home';
import boroughBoundariesFeatureCollection from '../../../public/borough-boundaries-clipped-to-shoreline.geo.json';

require('timezone-mock').register('US/Eastern');
require('jest-mock-now')();

describe('Home', () => {
  test('renders children correctly', () => {
    const typeofcomplaintValues = [
      'Blocked the bike lane',
      'Blocked the crosswalk',
      'Honked horn (no emergency)',
      'Failed to yield to pedestrian',
      'Drove aggressively',
      'Was on a cell phone while driving',
      'Refused to pick me up',
      'Was courteous, kind or polite',
      'Went above and beyond to help',
    ];

    const wrapper = renderer
      .create(
        <App context={{ insertCss: () => {}, fetch: () => {}, pathname: '' }}>
          <Home
            typeofcomplaintValues={typeofcomplaintValues}
            boroughBoundariesFeatureCollection={
              boroughBoundariesFeatureCollection
            }
          />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

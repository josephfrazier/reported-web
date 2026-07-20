/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import App from '../../components/App.js';
import Home from './Home.js';
import boroughBoundariesFeatureCollection from '../../../public/borough-boundaries-clipped-to-shoreline.geo.json';

require('timezone-mock').register('US/Eastern');
require('jest-mock-now')();

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

const insertCss = () => {};

function renderHome() {
  return renderer.create(
    <StyleContext.Provider value={{ insertCss }}>
      <App context={{ fetch: () => {}, pathname: '' }}>
        <Home
          typeofcomplaintValues={typeofcomplaintValues}
          boroughBoundariesFeatureCollection={
            boroughBoundariesFeatureCollection
          }
        />
      </App>
    </StyleContext.Provider>,
  );
}

describe('Home', () => {
  test('renders submission form and Previous Submissions when logged in', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    let tree;
    renderer.act(() => {
      tree = renderer.create(
        <StyleContext.Provider value={{ insertCss }}>
          <App context={{ fetch: () => {}, pathname: '' }}>
            <Home
              localStorageKey={storageKey}
              typeofcomplaintValues={typeofcomplaintValues}
              boroughBoundariesFeatureCollection={
                boroughBoundariesFeatureCollection
              }
            />
          </App>
        </StyleContext.Provider>,
      );
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    localStorage.removeItem(storageKey);
  });

  test('renders auth prompt and hides form when logged out', () => {
    const tree = renderHome();

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });
});

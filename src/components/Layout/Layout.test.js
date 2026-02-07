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

import React from 'react';
import renderer from 'react-test-renderer';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import App from '../App.js';
import Layout from './Layout.js';

describe('Layout', () => {
  test('renders children correctly', () => {
    const insertCss = () => {};
    const wrapper = renderer
      .create(
        <StyleContext.Provider value={{ insertCss }}>
          <App context={{ fetch: () => {}, pathname: '' }}>
            <Layout>
              <div className="child" />
            </Layout>
          </App>
        </StyleContext.Provider>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

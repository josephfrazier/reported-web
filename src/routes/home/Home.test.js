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

require('jest-mock-now')();

describe('Home', () => {
  test('renders children correctly', () => {
    const wrapper = renderer
      .create(
        <App context={{ insertCss: () => {}, fetch: () => {}, pathname: '' }}>
          <Home />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

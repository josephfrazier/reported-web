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
import SubmissionDetails from '../../components/SubmissionDetails';

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
          <Home typeofcomplaintValues={typeofcomplaintValues} />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

describe('SubmissionDetails', () => {
  test('renders children correctly', () => {
    const submission = {
      reqnumber: 'reqnumber',
      medallionNo: 'medallionNo',
      typeofcomplaint: 'typeofcomplaint',
      timeofreport: new Date(Date.now()).toISOString(),

      photoData0: { url: 'photoData0.url' },
      photoData1: { url: 'photoData1.url' },
      photoData2: { url: 'photoData2.url' },

      videoData0: 'videoData0',
      videoData1: 'videoData1',
      videoData2: 'videoData2',
    };

    const wrapper = renderer
      .create(
        <App context={{ insertCss: () => {}, fetch: () => {}, pathname: '' }}>
          <SubmissionDetails isDetailsOpen submission={submission} />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

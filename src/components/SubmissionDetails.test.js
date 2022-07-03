/* eslint-env jest */
/* eslint-disable padded-blocks, no-unused-expressions */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import App from './App';
import SubmissionDetails from './SubmissionDetails';

require('timezone-mock').register('US/Eastern');
require('jest-mock-now')();

describe('SubmissionDetails', () => {
  test('renders children correctly', () => {
    const submission = {
      reqnumber: 'reqnumber',
      medallionNo: 'medallionNo',
      typeofcomplaint: 'typeofcomplaint',
      loc1_address: '82 Reade St, New York, NY 10007, USA',
      timeofreport: new Date(Date.now()).toISOString(),
      reportDescription: 'reportDescription',
      status: 1,

      photoData: { url: 'photoData.url' },
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
          <SubmissionDetails
            isDetailsOpen
            submission={submission}
            onDeleteSubmission={() => {}}
          />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });

  test('renders children correctly when medallionNo is missing but license is present', () => {
    const submission = {
      reqnumber: 'reqnumber',
      license: 'license',
      typeofcomplaint: 'typeofcomplaint',
      loc1_address: '82 Reade St, New York, NY 10007, USA',
      timeofreport: new Date(Date.now()).toISOString(),
      reportDescription: 'reportDescription',
      status: 1,

      photoData: { url: 'photoData.url' },
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
          <SubmissionDetails
            isDetailsOpen
            submission={submission}
            onDeleteSubmission={() => {}}
          />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });

  test('renders delete button correctly', () => {
    const submission = {
      reqnumber: 'reqnumber',
      medallionNo: 'medallionNo',
      typeofcomplaint: 'typeofcomplaint',
      loc1_address: '82 Reade St, New York, NY 10007, USA',
      timeofreport: new Date(Date.now()).toISOString(),
      reportDescription: 'reportDescription',
      status: 0,

      photoData: { url: 'photoData.url' },
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
          <SubmissionDetails
            isDetailsOpen
            submission={submission}
            onDeleteSubmission={() => {}}
          />
        </App>,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});

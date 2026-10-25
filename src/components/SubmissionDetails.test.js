import React from 'react';
import renderer from 'react-test-renderer';
import App from './App.js';
import SubmissionDetails from './SubmissionDetails.js';

require('timezone-mock').register('US/Eastern');
require('jest-mock-now')();

// The rendered tree keeps every JSX child as its own entry, so the summary --
// which interpolates the plate, the state, the complaint and the address -- is
// not one string in there. Join the text back up before asserting on it.
function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(renderedText).join('');
  return renderedText(node.children);
}

describe('SubmissionDetails', () => {
  test('renders children correctly', () => {
    const submission = {
      reqnumber: 'reqnumber',
      medallionNo: 'medallionNo',
      state: 'licenseState',
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
      state: 'licenseState',
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
      reqnumber: 'N/A until submitted to 311',
      medallionNo: 'medallionNo',
      state: 'licenseState',
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

  test('renders TLC and NYPD SR numbers when submission has matching tasks', () => {
    const submission = {
      medallionNo: 'medallionNo',
      state: 'licenseState',
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

      tasks: [
        {
          objectId: 'taskId1',
          action: 'submit 311 complaint',
          case_id: 'TLC-12345',
        },
        {
          objectId: 'taskId2',
          action: 'submit 311 illegal parking complaint',
          case_id: 'NYPD-12345',
        },
      ],
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

  // The state is optional in the form, so a saved submission can have none.
  // The summary used to print "()" for it.
  test('leaves the state out of the summary when there is none', () => {
    const submission = {
      reqnumber: 'reqnumber',
      medallionNo: 'medallionNo',
      state: '',
      typeofcomplaint: 'typeofcomplaint',
      loc1_address: '82 Reade St, New York, NY 10007, USA',
      timeofreport: new Date(Date.now()).toISOString(),
      reportDescription: 'reportDescription',
      status: 1,
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

    const rendered = renderedText(wrapper);
    expect(rendered).toContain('medallionNo typeofcomplaint near');
    expect(rendered).not.toContain('()');
  });
});

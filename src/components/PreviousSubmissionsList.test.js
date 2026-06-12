/* eslint-env jest */

import React from 'react';
import renderer from 'react-test-renderer';
import PreviousSubmissionsList from './PreviousSubmissionsList.js';

const createSubmission = overrides => ({
  license: 'T123456C',
  state: 'NY',
  typeofcomplaint: 'Blocked the bike lane',
  loc1_address: '82 Reade St, New York, NY 10007, USA',
  timeofreport: new Date(Date.now()).toISOString(),
  reportDescription: 'reportDescription',
  status: 0,
  ...overrides,
});

describe('PreviousSubmissionsList', () => {
  test('keeps the same recent submission open when a newer objectId-less submission is prepended', () => {
    const olderSubmission = createSubmission({
      timeofreport: '2026-06-11T12:00:00.000Z',
      reportDescription: 'older submission',
    });
    const oldestSubmission = createSubmission({
      timeofreport: '2026-06-10T12:00:00.000Z',
      reportDescription: 'oldest submission',
    });

    const tree = renderer.create(
      <PreviousSubmissionsList
        submissions={[olderSubmission, oldestSubmission]}
        onDeleteSubmission={() => {}}
        isLoading={false}
        hasLoadedPreviousSubmissions
      />,
    );

    tree.root.findAllByType('details')[0].props.onToggle({
      target: { open: true },
    });
    expect(tree.root.findByType('p').children).toEqual(['older submission']);

    tree.update(
      <PreviousSubmissionsList
        submissions={[
          createSubmission({
            timeofreport: '2026-06-12T12:00:00.000Z',
            reportDescription: 'newest submission',
          }),
          olderSubmission,
          oldestSubmission,
        ]}
        onDeleteSubmission={() => {}}
        isLoading={false}
        hasLoadedPreviousSubmissions
      />,
    );

    expect(tree.root.findByType('p').children).toEqual(['older submission']);
  });
});

import React from 'react';
import renderer from 'react-test-renderer';
import ReactDOMServer from 'react-dom/server';
import { CSVLink } from 'react-csv';
import App from './App.js';
import PreviousSubmissionsList from './PreviousSubmissionsList.js';

describe('PreviousSubmissionsList', () => {
  const props = {
    isLoading: false,
    hasLoadedPreviousSubmissions: true,
    submissions: [
      {
        objectId: 'objectId',
        reqnumber: 'reqnumber',
        timeofreport: new Date(Date.now()).toISOString(),
      },
    ],
    onDeleteSubmission: () => {},
  };

  const wrap = children => (
    <App context={{ insertCss: () => {}, fetch: () => {}, pathname: '' }}>
      {children}
    </App>
  );

  test('does not render the CSV link on the server', () => {
    // react-csv computes its href (a blob URL) only on the client, so it must
    // not render during SSR or React warns about an href mismatch during
    // hydration.
    const html = ReactDOMServer.renderToString(
      wrap(<PreviousSubmissionsList {...props} />),
    );
    expect(html).not.toContain('Download as CSV');
  });

  test('renders the CSV link after mounting on the client', () => {
    const tree = renderer.create(wrap(<PreviousSubmissionsList {...props} />));
    expect(tree.root.findAllByType(CSVLink)).toHaveLength(1);
  });

  test('opens the submission a toast click names, and opens it again on a new click', () => {
    const submissions = [
      {
        objectId: 'first-submission',
        status: 0,
        timeofreport: new Date(Date.now()).toISOString(),
        tasks: [{ action: 'submit 311 complaint', case_id: '311-12345678' }],
      },
      {
        objectId: 'prior-submission',
        status: 0,
        timeofreport: new Date(Date.now()).toISOString(),
        tasks: [{ action: 'submit 311 complaint', case_id: '311-87654321' }],
      },
    ];
    const listWithFocus = focus =>
      wrap(
        <PreviousSubmissionsList
          {...props}
          submissions={submissions}
          focus={focus}
        />,
      );

    const tree = renderer.create(listWithFocus(undefined));

    renderer.act(() => {
      tree.update(listWithFocus({ objectId: 'prior-submission', request: 1 }));
    });

    let details = tree.root.findAllByType('details');
    expect(details[0].props.open).toBe(false);
    expect(details[1].props.open).toBe(true);

    // The reader closes it; a second click on the same prior opens it again.
    renderer.act(() => {
      details[1].props.onToggle({ target: { open: false } });
    });
    details = tree.root.findAllByType('details');
    expect(details[1].props.open).toBe(false);

    renderer.act(() => {
      tree.update(listWithFocus({ objectId: 'prior-submission', request: 2 }));
    });
    details = tree.root.findAllByType('details');
    expect(details[1].props.open).toBe(true);
  });
});

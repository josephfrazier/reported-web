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
});

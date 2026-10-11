import React from 'react';
import PropTypes from 'prop-types';
import { CSVLink } from 'react-csv';
import SubmissionDetails from './SubmissionDetails.js';

const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

class PreviousSubmissionsList extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      // react-csv's CSVLink computes its href (a blob URL) during render on
      // the client, so rendering it during SSR/hydration produces an href=""
      // on the server and a blob: URL on the client, causing a hydration
      // mismatch warning. Render it only after the component mounts.
      isMounted: false,
    };
  }

  componentDidMount() {
    this.setState({ isMounted: true });
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.props.submissions !== nextProps.submissions ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission ||
      this.props.isLoading !== nextProps.isLoading ||
      this.props.hasLoadedPreviousSubmissions !==
        nextProps.hasLoadedPreviousSubmissions ||
      this.state.isMounted !== nextState.isMounted
    );
  }

  render() {
    const {
      submissions,
      onDeleteSubmission,
      isLoading,
      hasLoadedPreviousSubmissions,
    } = this.props;

    // Keep already-rendered (possibly cached) submissions visible while a
    // background refresh is in flight.
    if (isLoading && submissions.length === 0) {
      return 'Loading submissions...';
    }

    if (hasLoadedPreviousSubmissions && submissions.length === 0) {
      return 'No previous submissions found.';
    }

    return (
      <>
        {this.state.isMounted && (
          <CSVLink
            separator="	"
            data={submissions.map(submission =>
              objectMap(submission, value =>
                typeof value === 'object' ? JSON.stringify(value) : value,
              ),
            )}
          >
            Download as CSV
          </CSVLink>
        )}
        <ul>
          {submissions.map(submission => (
            <li key={submission.objectId}>
              <SubmissionDetails
                submission={submission}
                onDeleteSubmission={onDeleteSubmission}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }
}

PreviousSubmissionsList.propTypes = {
  hasLoadedPreviousSubmissions: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  submissions: PropTypes.arrayOf(
    PropTypes.shape({
      objectId: PropTypes.string,
    }),
  ).isRequired,
  onDeleteSubmission: PropTypes.func.isRequired,
};

export default PreviousSubmissionsList;

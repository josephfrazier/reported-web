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
    this.targetElement = null;
    this.scrolledToTargetKey = null;
  }

  componentDidMount() {
    this.setState({ isMounted: true });
    this.scrollToTarget();
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.props.submissions !== nextProps.submissions ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission ||
      this.props.isLoading !== nextProps.isLoading ||
      this.props.hasLoadedPreviousSubmissions !==
        nextProps.hasLoadedPreviousSubmissions ||
      this.props.focus !== nextProps.focus ||
      this.state.isMounted !== nextState.isMounted
    );
  }

  componentDidUpdate() {
    this.scrollToTarget();
  }

  // The prior submission a toast click named, if any. Each request has its
  // own key, so a second click on the same submission scrolls again.
  getTargetKey() {
    const { focus } = this.props;
    return focus ? `submission:${focus.objectId}:${focus.request}` : null;
  }

  setTargetElement = element => {
    this.targetElement = element;
  };

  scrollToTarget = () => {
    const targetKey = this.getTargetKey();
    if (!targetKey || targetKey === this.scrolledToTargetKey) {
      return;
    }

    const element = this.targetElement;
    if (!element) {
      return;
    }

    this.scrolledToTargetKey = targetKey;
    // The optional call keeps this a no-op in the test renderer, where refs
    // point at non-DOM instances without scrollIntoView.
    element.scrollIntoView?.({ block: 'start' });
  };

  render() {
    const {
      submissions,
      onDeleteSubmission,
      isLoading,
      hasLoadedPreviousSubmissions,
      focus,
    } = this.props;
    const targetKey = this.getTargetKey();
    const isTarget = submission =>
      !!focus && submission.objectId === focus.objectId;

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
          {submissions.map(submission => {
            const isFocused = isTarget(submission);
            // A new target key remounts the details, which opens them: the
            // component reads `isDetailsOpen` only when it mounts. A second
            // click on the same prior is a new key, so it opens again after
            // the reader has closed it.
            return (
              <li
                key={submission.objectId}
                ref={isFocused ? this.setTargetElement : undefined}
              >
                <SubmissionDetails
                  key={isFocused ? targetKey : undefined}
                  submission={submission}
                  onDeleteSubmission={onDeleteSubmission}
                  isDetailsOpen={isFocused}
                />
              </li>
            );
          })}
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
  focus: PropTypes.shape({
    objectId: PropTypes.string,
    request: PropTypes.number,
  }),
};

PreviousSubmissionsList.defaultProps = {
  focus: undefined,
};

export default PreviousSubmissionsList;

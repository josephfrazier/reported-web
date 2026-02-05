/**
 * Error handling middleware
 */

import stringify from 'json-stringify-safe';

/**
 * Creates a promise rejection handler that sends errors as JSON responses
 * @param {object} res - Express response object
 * @returns {function} Error handler function
 */
const handlePromiseRejection = res => error => {
  console.error({ error });
  res.status(500).json(JSON.parse(stringify({ error })));
};

export default handlePromiseRejection;

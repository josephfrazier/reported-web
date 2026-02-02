/**
 * Error handling utilities for Express routes
 */

import stringify from 'json-stringify-safe';

/**
 * Create a promise rejection handler for Express responses
 * @param {Response} res - Express response object
 * @returns {Function} Error handler function
 */
export const handlePromiseRejection = res => error => {
  console.error({ error });
  res.status(500).json(JSON.parse(stringify({ error })));
};

export default handlePromiseRejection;

/**
 * Parse backend initialization
 */

import Parse from 'parse/node';

/**
 * Initialize Parse with application credentials
 * @param {object} config - Configuration object
 * @param {string} config.appId - Parse application ID
 * @param {string} config.javascriptKey - Parse JavaScript key
 * @param {string} config.masterKey - Parse master key
 * @param {string} config.serverURL - Parse server URL
 */
export function initializeParse({
  appId,
  javascriptKey,
  masterKey,
  serverURL,
}) {
  Parse.initialize(appId, javascriptKey, masterKey);
  Parse.Cloud.useMasterKey();
  Parse.serverURL = serverURL;
}

export default Parse;

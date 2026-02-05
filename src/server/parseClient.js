/**
 * Parse Platform client initialization
 * Factory function enables dependency injection for testing
 */

/**
 * Initialize and configure Parse client
 * @param {Object} options - Configuration options
 * @param {Object} options.Parse - Parse SDK instance
 * @param {string} options.appId - Parse application ID
 * @param {string} options.javascriptKey - Parse JavaScript key
 * @param {string} options.masterKey - Parse master key
 * @param {string} options.serverUrl - Parse server URL
 * @returns {Object} Configured Parse instance
 */
export function createParseClient({
  Parse,
  appId,
  javascriptKey,
  masterKey,
  serverUrl,
}) {
  Parse.initialize(appId, javascriptKey, masterKey);
  Parse.Cloud.useMasterKey();
  Parse.serverURL = serverUrl; // eslint-disable-line no-param-reassign
  return Parse;
}

export default createParseClient;

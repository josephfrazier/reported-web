/**
 * @jest-environment node
 */

import express from 'express';

import config from './config.js';

// `req.ip` decides the rate limiter's key on /api/uploadAttachment, so what
// `trust proxy` trusts decides whether each user gets their own 30-uploads-per
// -15-minutes bucket or shares one with every other user, which is how a
// submission ends up re-sending its files through /submit (see the
// "Unexpected end of form" section of the README).
describe('config.trustProxy', () => {
  const trust = address => {
    const app = express();
    app.set('trust proxy', config.trustProxy);
    // Express stores the function it compiled from the setting under this
    // name, which is the only way to ask it how it would treat a peer.
    return app.get('trust proxy fn')(address, 0);
  };

  test('trusts the private address a platform router connects from', () => {
    expect(trust('10.1.2.3')).toBe(true);
    expect(trust('172.16.0.1')).toBe(true);
    expect(trust('192.168.0.1')).toBe(true);
  });

  test('trusts loopback, for requests the server makes to itself', () => {
    expect(trust('127.0.0.1')).toBe(true);
    expect(trust('::1')).toBe(true);
  });

  test('does not trust the public address of a client', () => {
    expect(trust('203.0.113.7')).toBe(false);
  });
});

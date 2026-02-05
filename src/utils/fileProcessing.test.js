/**
 * @jest-environment jsdom
 */
/* eslint-env jest */

import { getBlobUrl } from './fileProcessing.js';

// Mock URL.createObjectURL
let counter = 0;
global.URL.createObjectURL = jest.fn(() => {
  const url = `blob:mock-url-${counter}`;
  counter += 1;
  return url;
});

describe('fileProcessing', () => {
  describe('getBlobUrl', () => {
    test('creates a URL for a blob', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const url = getBlobUrl(blob);
      expect(typeof url).toBe('string');
      expect(url.startsWith('blob:')).toBe(true);
    });

    test('returns the same URL for the same blob', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const url1 = getBlobUrl(blob);
      const url2 = getBlobUrl(blob);
      expect(url1).toBe(url2);
    });

    test('returns different URLs for different blobs', () => {
      const blob1 = new Blob(['test1'], { type: 'text/plain' });
      const blob2 = new Blob(['test2'], { type: 'text/plain' });
      const url1 = getBlobUrl(blob1);
      const url2 = getBlobUrl(blob2);
      expect(url1).not.toBe(url2);
    });
  });
});

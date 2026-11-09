/**
 * @jest-environment node
 */

import getReviewAppSource from './getReviewAppSource.js';

describe('getReviewAppSource', () => {
  test('links to the pull request, naming its branch, when Heroku provides both', () => {
    expect(
      getReviewAppSource({
        HEROKU_PR_NUMBER: '1046',
        HEROKU_BRANCH: 'review-app-source-link',
      }),
    ).toEqual({
      url: 'https://github.com/josephfrazier/reported-web/pull/1046',
      label: 'PR #1046 (review-app-source-link)',
    });
  });

  test('leaves the branch out of the label when Heroku provides no branch', () => {
    expect(getReviewAppSource({ HEROKU_PR_NUMBER: '1046' })).toEqual({
      url: 'https://github.com/josephfrazier/reported-web/pull/1046',
      label: 'PR #1046',
    });
  });

  test('falls back to the branch when there is no PR number', () => {
    expect(
      getReviewAppSource({
        HEROKU_BRANCH: 'dependabot/npm_and_yarn/foo-1.2.3',
      }),
    ).toEqual({
      url: 'https://github.com/josephfrazier/reported-web/tree/dependabot/npm_and_yarn/foo-1.2.3',
      label: 'dependabot/npm_and_yarn/foo-1.2.3',
    });
  });

  test('encodes characters that would break the branch URL', () => {
    expect(getReviewAppSource({ HEROKU_BRANCH: 'fix/#42 a b' })).toEqual({
      url: 'https://github.com/josephfrazier/reported-web/tree/fix/%2342%20a%20b',
      label: 'fix/#42 a b',
    });
  });

  test('returns nothing outside a Heroku review app', () => {
    expect(getReviewAppSource({})).toBeNull();
  });
});

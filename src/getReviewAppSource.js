// Heroku injects these config vars into review apps only, so a review app can
// point back at the pull request or branch it was deployed from:
// https://devcenter.heroku.com/articles/github-integration-review-apps#injected-environment-variables
//
// HEROKU_PR_NUMBER is set only when Heroku created the review app
// automatically, so fall back to the branch it tracks when it's missing.
const GITHUB_REPO_URL = 'https://github.com/josephfrazier/reported-web';

export default function getReviewAppSource(
  { HEROKU_PR_NUMBER, HEROKU_BRANCH } = process.env,
) {
  if (HEROKU_PR_NUMBER) {
    return {
      url: `${GITHUB_REPO_URL}/pull/${HEROKU_PR_NUMBER}`,
      // Name the branch too: the PR number alone doesn't say which branch a
      // review app is tracking, and Heroku provides both.
      label: HEROKU_BRANCH
        ? `PR #${HEROKU_PR_NUMBER} (${HEROKU_BRANCH})`
        : `PR #${HEROKU_PR_NUMBER}`,
    };
  }

  if (HEROKU_BRANCH) {
    // Branch names can contain slashes (`dependabot/npm_and_yarn/foo`), which
    // GitHub reads as path separators in a tree URL, so keep those and encode
    // the rest (`#`, `?`, spaces, ...).
    const branch = HEROKU_BRANCH.split('/').map(encodeURIComponent).join('/');

    return {
      url: `${GITHUB_REPO_URL}/tree/${branch}`,
      label: HEROKU_BRANCH,
    };
  }

  return null;
}

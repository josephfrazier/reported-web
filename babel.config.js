/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

// Babel configuration
// https://babeljs.io/docs/usage/api/
module.exports = api => {
  // babel-jest is the only consumer that has to compile dependency code: the
  // transformIgnorePatterns allow-list in jest.config.js lets through the
  // ESM-only packages that jsdom 30 depends on, and Babel has to turn them
  // into CommonJS because Jest's runtime has no `require(esm)` (Node's own
  // does, which is why this only ever breaks under Jest). Every other
  // consumer — babel-node via @babel/register — keeps ignoring node_modules,
  // so this changes nothing outside of tests.
  const isBabelJest = api.caller(
    caller => Boolean(caller) && caller.name === 'babel-jest',
  );

  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: {
            node: 'current',
          },
          // Node 24 runs the ES2022 class features natively, so preset-env
          // leaves them alone and never enables their parser plugins. babel-jest
          // still has to *parse* them to strip the ESM syntax out of
          // dependencies such as @exodus/bytes and @asamuzakjp/dom-selector.
          ...(isBabelJest
            ? {
                include: [
                  '@babel/plugin-transform-class-static-block',
                  '@babel/plugin-transform-private-methods',
                  '@babel/plugin-transform-private-property-in-object',
                ],
              }
            : {}),
        },
      ],
      '@babel/preset-flow',
      '@babel/preset-react',
    ],
    plugins: ['@babel/plugin-transform-class-properties'],
    ignore: isBabelJest ? ['build'] : ['node_modules', 'build'],
  };
};

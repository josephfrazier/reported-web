/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function format(time) {
  return time.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
}

function run(fn, options) {
  const task = typeof fn.default === 'undefined' ? fn : fn.default;
  const start = new Date();
  console.info(
    `[${format(start)}] Starting '${task.name}${
      options ? ` (${options})` : ''
    }'...`,
  );
  return task(options).then(resolution => {
    const end = new Date();
    const time = end.getTime() - start.getTime();
    console.info(
      `[${format(end)}] Finished '${task.name}${
        options ? ` (${options})` : ''
      }' after ${time} ms`,
    );
    return resolution;
  });
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.length > 2) {
  // eslint-disable-next-line import/no-dynamic-require
  const modulePath = `./${process.argv[2]}.js`;
  import(modulePath).then(module => {
    run(module).catch(err => {
      console.error(err.stack);
      process.exit(1);
    });
  });
}

export default run;

#!/usr/bin/env node
/*
 * Add the SR numbers from the Reported Parse DB to the vendored collage
 * report files.
 *
 * Each report has a source photograph URL. Match that URL to a submission
 * through `photoData0`, `photoData1`, or `photoData2`. Then read every task
 * on that submission. A submission can have several tasks, and each task
 * has its own `case_id`. Write `311-...` case IDs to `sr` and older
 * `1-1-...` case IDs to `legacy`. Store the task action in `srActions`.
 *
 * The script writes the files with two-space indentation, so a data refresh
 * keeps the reviewable diffs. It is safe to run again: existing values are
 * kept, and duplicate case IDs are not added.
 *
 * Run it from the repository:
 *   node tools/enrich-collage-sr-numbers.js
 *
 * It needs PARSE_SERVER_URL, PARSE_APP_ID, and PARSE_MASTER_KEY in `.env`.
 */

/* eslint-disable no-await-in-loop -- requests run in order to respect the API rate limit */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const REQUIRED_ENV = ['PARSE_SERVER_URL', 'PARSE_APP_ID', 'PARSE_MASTER_KEY'];
const missing = REQUIRED_ENV.filter(name => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment values: ${missing.join(', ')}`);
  process.exit(1);
}

const base = process.env.PARSE_SERVER_URL.replace(/\/$/, '');
const headers = {
  'X-Parse-Application-Id': process.env.PARSE_APP_ID,
  'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY,
};

const FILES = [
  'public/powerbroker-assets/nyc/power-broker/reports.json',
  'public/powerbroker-assets/nyc/flatiron/reports.json',
  'public/powerbroker-assets/nyc/harlem/reports.json',
  'public/powerbroker-assets/nyc/brooklyn/reports.json',
  'public/powerbroker-assets/portrait-collages/moses/reports-v3.json',
].map(file => path.join(ROOT, file));

const LIMIT = 1000;
const NYPD_ACTION = 'submit 311 illegal parking complaint';
const TLC_ACTION = 'submit 311 complaint';

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function get(pathname, attempt = 1) {
  const response = await fetch(base + pathname, { headers });
  const text = await response.text();
  if (response.ok) return JSON.parse(text);
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const wait = 500 * attempt;
    console.info(`  ${response.status}; retry in ${wait}ms`);
    await sleep(wait);
    return get(pathname, attempt + 1);
  }
  throw new Error(`${response.status} ${text.slice(0, 400)}`);
}

async function fetchPhotoOwners() {
  const photoToSubmissions = new Map();
  let cursor = '';
  let page = 0;
  let total = 0;
  let done = false;
  while (!done) {
    const where = cursor
      ? encodeURIComponent(JSON.stringify({ objectId: { $gt: cursor } }))
      : '';
    const keys = 'objectId,photoData0,photoData1,photoData2';
    const data = await get(
      `/classes/submission?limit=${LIMIT}&order=objectId&keys=${keys}${
        where ? `&where=${where}` : ''
      }`,
    );
    for (const submission of data.results) {
      for (const field of ['photoData0', 'photoData1', 'photoData2']) {
        const file = submission[field];
        if (file && file.url) {
          if (!photoToSubmissions.has(file.url)) {
            photoToSubmissions.set(file.url, new Set());
          }
          photoToSubmissions.get(file.url).add(submission.objectId);
        }
      }
    }
    total += data.results.length;
    page += 1;
    if (page % 25 === 0) console.info(`  submissions: ${total}`);
    done = data.results.length < LIMIT;
    if (!done) cursor = data.results[data.results.length - 1].objectId;
  }
  console.info(
    `submissions fetched: ${total}, photo URLs: ${photoToSubmissions.size}`,
  );
  return photoToSubmissions;
}

async function fetchTaskCases() {
  const submissionToCases = new Map();
  let cursor = '';
  let page = 0;
  let total = 0;
  let done = false;
  while (!done) {
    const whereObject = { case_id: { $exists: true } };
    if (cursor) whereObject.objectId = { $gt: cursor };
    const where = encodeURIComponent(JSON.stringify(whereObject));
    const data = await get(
      `/classes/tasks?limit=${LIMIT}&order=objectId&keys=submission,case_id,action&where=${where}`,
    );
    for (const task of data.results) {
      const submissionId = task.submission && task.submission.objectId;
      if (submissionId && task.case_id) {
        if (!submissionToCases.has(submissionId)) {
          submissionToCases.set(submissionId, new Map());
        }
        submissionToCases
          .get(submissionId)
          .set(task.case_id, task.action || '');
      }
    }
    total += data.results.length;
    page += 1;
    if (page % 25 === 0) console.info(`  tasks: ${total}`);
    done = data.results.length < LIMIT;
    if (!done) cursor = data.results[data.results.length - 1].objectId;
  }
  console.info(
    `tasks fetched: ${total}, submissions with case_id: ${submissionToCases.size}`,
  );
  return submissionToCases;
}

/* eslint-disable no-param-reassign -- the report record is updated in place */
function mergeCases(report, caseActions) {
  const sr = new Set(report.sr || []);
  const legacy = new Set(report.legacy || []);
  let added = 0;
  for (const [caseId, action] of caseActions) {
    if (caseId.startsWith('311-')) {
      if (!sr.has(caseId)) {
        sr.add(caseId);
        added += 1;
      }
    } else if (!legacy.has(caseId)) {
      legacy.add(caseId);
      added += 1;
    }
    if (action) {
      if (!report.srActions) report.srActions = {};
      if (!report.srActions[caseId]) report.srActions[caseId] = action;
    }
  }
  if (sr.size > 0) report.sr = [...sr].sort();
  if (legacy.size > 0) report.legacy = [...legacy].sort();
  if (added > 0 && report.unchecked) delete report.unchecked;
  return added;
}
/* eslint-enable no-param-reassign */

async function main() {
  console.info('Fetching submissions and tasks from Parse...');
  const photoToSubmissions = await fetchPhotoOwners();
  const submissionToCases = await fetchTaskCases();

  for (const file of FILES) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let withCases = 0;
    let addedCases = 0;
    let noSubmission = 0;
    let noTask = 0;
    let nypd = 0;
    let tlc = 0;
    let both = 0;
    for (const report of data.reports) {
      const submissionIds = photoToSubmissions.get(report.photo) || new Set();
      if (submissionIds.size === 0) noSubmission += 1;
      const caseActions = new Map();
      for (const submissionId of submissionIds) {
        for (const [caseId, action] of submissionToCases.get(submissionId) ||
          []) {
          if (!caseActions.get(caseId)) caseActions.set(caseId, action);
        }
      }
      if (caseActions.size === 0 && submissionIds.size > 0) noTask += 1;
      if (caseActions.size > 0) withCases += 1;
      addedCases += mergeCases(report, caseActions);
      const actions = new Set(Object.values(report.srActions || {}));
      if (actions.has(NYPD_ACTION)) nypd += 1;
      if (actions.has(TLC_ACTION)) tlc += 1;
      if (actions.has(NYPD_ACTION) && actions.has(TLC_ACTION)) both += 1;
    }
    const name = path.relative(ROOT, file);
    console.info(
      `${name}: reports=${data.reports.length} withCaseId=${withCases} added=${addedCases} noSubmission=${noSubmission} noTask=${noTask} nypd=${nypd} tlc=${tlc} both=${both}`,
    );
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

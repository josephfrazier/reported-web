#!/usr/bin/env node
/*
 * Add the NYC 311 outcomes to the vendored collage report files.
 *
 * The SR numbers are portal case IDs. They are not fields in NYC Open Data.
 * Match each case to its Open Data record by the complaint type, the address,
 * and the date. Batch the lookups:
 *
 * - A 311- case whose task time is close to the report date uses the task
 *   month. Fetch that month's Illegal Parking and TLC records once.
 * - A legacy 1-1- case, or a 311- case whose task time is a bulk import date,
 *   uses the report date. Fetch the 2018-2019 records once and match locally.
 *
 * The script writes the files with two-space indentation. It keeps existing
 * records and only adds records that are not present.
 *
 * Run it from the repository:
 *   node tools/add-collage-311-outcomes.js
 *
 * It needs PARSE_SERVER_URL, PARSE_APP_ID, and PARSE_MASTER_KEY in `.env`.
 */

/* eslint-disable no-await-in-loop -- requests run in order to respect the API rate limit */
/* eslint-disable no-continue -- the loops skip records that do not match */

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

const parseBase = process.env.PARSE_SERVER_URL.replace(/\/$/, '');
const parseHeaders = {
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
const OPEN_DATA_FIELDS =
  'unique_key,created_date,closed_date,agency,complaint_type,descriptor,incident_address,latitude,longitude,status,resolution_description';
const DIRS = { W: 'WEST', E: 'EAST', N: 'NORTH', S: 'SOUTH' };
const SUFFIXES = {
  ST: 'STREET',
  AVE: 'AVENUE',
  AV: 'AVENUE',
  BLVD: 'BOULEVARD',
  RD: 'ROAD',
  PL: 'PLACE',
  DR: 'DRIVE',
  LN: 'LANE',
  PKWY: 'PARKWAY',
  CT: 'COURT',
  TER: 'TERRACE',
  SQ: 'SQUARE',
  EXPY: 'EXPRESSWAY',
};

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function getJson(url, options = {}, attempt = 1) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (response.ok) return JSON.parse(text);
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const wait = 500 * attempt;
    console.info(`  ${response.status}; retry in ${wait}ms`);
    await sleep(wait);
    return getJson(url, options, attempt + 1);
  }
  throw new Error(`${response.status} ${text.slice(0, 400)}`);
}

function normalizeAddress(value) {
  let text = String(value || '').toUpperCase();
  text = text.split(',')[0];
  text = text.replace(/[.#]/g, ' ');
  text = text.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
  text = text.replace(/\b[A-Z]\b/g, match => DIRS[match] || match);
  text = text.replace(/\b[A-Z]+\b/g, match => SUFFIXES[match] || match);
  text = text.replace(/^(\d+)[A-Z]\b/, '$1');
  text = text.replace(/[^A-Z0-9 -]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function splitAddress(value) {
  const text = normalizeAddress(value);
  const match = text.match(/^(\d+)(?:-(\d+))?\s+(.*)$/);
  if (!match) return { numbers: [], street: text };
  return {
    numbers: [Number(match[1]), Number(match[2] || match[1])],
    street: match[3].trim(),
  };
}

function haversine(aLat, aLng, bLat, bLng) {
  const radius = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function typeCategory(action) {
  if (action === 'submit 311 illegal parking complaint') return 'nypd';
  if (action === 'submit 311 complaint') return 'tlc';
  return null;
}

function recordCategory(complaintType) {
  if (complaintType === 'Illegal Parking') return 'nypd';
  if (
    complaintType === 'For Hire Vehicle Complaint' ||
    complaintType === 'Taxi Complaint'
  ) {
    return 'tlc';
  }
  return null;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
}

async function fetchTaskTimes() {
  const caseTimes = {};
  let cursor = '';
  let done = false;
  let total = 0;
  while (!done) {
    const where = { case_id: { $exists: true } };
    if (cursor) where.objectId = { $gt: cursor };
    const data = await getJson(
      `${parseBase}/classes/tasks?limit=${LIMIT}&order=objectId&keys=case_id,action,createdAt&where=${encodeURIComponent(
        JSON.stringify(where),
      )}`,
      { headers: parseHeaders },
    );
    for (const task of data.results) {
      if (!task.case_id) continue;
      const previous = caseTimes[task.case_id];
      if (!previous || task.createdAt < previous.createdAt) {
        caseTimes[task.case_id] = {
          action: task.action || '',
          createdAt: task.createdAt || '',
        };
      }
    }
    total += data.results.length;
    done = data.results.length < LIMIT;
    if (!done) cursor = data.results[data.results.length - 1].objectId;
  }
  console.info(
    `tasks fetched: ${total}, case IDs: ${Object.keys(caseTimes).length}`,
  );
  return caseTimes;
}

function buildJobs(caseTimes) {
  const jobs = new Map();
  for (const file of FILES) {
    const { reports } = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const report of reports) {
      const caseIds = new Set([
        ...(report.sr || []),
        ...(report.legacy || []),
        ...Object.keys(report.srActions || {}),
      ]);
      for (const caseId of caseIds) {
        if (jobs.has(caseId)) continue;
        const task = caseTimes[caseId];
        if (!task || !task.createdAt) continue;
        const type = typeCategory(task.action);
        if (!type) continue;
        const reportTime = new Date(`${report.date}T12:00:00Z`);
        const taskTime = new Date(task.createdAt);
        const taskDeltaDays = Math.abs(taskTime - reportTime) / 86400000;
        const legacy = !caseId.startsWith('311-') || taskDeltaDays > 30;
        const time = legacy ? `${report.date}T12:00:00Z` : task.createdAt;
        jobs.set(caseId, {
          caseId,
          type,
          time,
          windowHours: legacy ? 45 * 24 : 72,
          month: time.slice(0, 7),
          legacy,
          lat: report.lat,
          lng: report.lng,
          address: report.address,
        });
      }
    }
  }
  return jobs;
}

async function fetchOpenData(ds, start, end) {
  const records = [];
  for (const complaintType of [
    "complaint_type='Illegal Parking'",
    "complaint_type IN ('For Hire Vehicle Complaint','Taxi Complaint')",
  ]) {
    let offset = 0;
    for (;;) {
      const url = `https://data.cityofnewyork.us/resource/${ds}.json?$select=${OPEN_DATA_FIELDS}&$where=created_date >= '${start}T00:00:00' AND created_date < '${end}T00:00:00' AND ${complaintType}&$limit=50000&$offset=${offset}`;
      const rows = await getJson(url);
      records.push(...rows);
      if (rows.length < 50000) break;
      offset += rows.length;
    }
  }
  return records;
}

function toRecord(row, dataset) {
  return {
    id: row.unique_key,
    ds: dataset,
    filed: (row.created_date || '').slice(0, 16),
    closed: row.closed_date ? row.closed_date.slice(0, 16) : '',
    agency: row.agency,
    type: row.complaint_type,
    status: row.status,
    outcome: row.resolution_description || '',
  };
}

function pickRecord(job, records, used) {
  const reportAddress = splitAddress(job.address);
  const time = new Date(job.time);
  const candidates = [];
  for (const record of records) {
    if (used.has(record.unique_key)) continue;
    if (recordCategory(record.complaint_type) !== job.type) continue;
    const hours = Math.abs(new Date(record.created_date) - time) / 3600000;
    if (hours > job.windowHours) continue;
    const distance =
      record.latitude && record.longitude
        ? haversine(
            job.lat,
            job.lng,
            Number(record.latitude),
            Number(record.longitude),
          )
        : 150;
    if (distance > 300) continue;
    const recordAddress = splitAddress(record.incident_address);
    const streetMatch = reportAddress.street === recordAddress.street;
    const houseDelta =
      reportAddress.numbers.length && recordAddress.numbers.length
        ? Math.min(
            ...reportAddress.numbers.map(number =>
              Math.min(
                ...recordAddress.numbers.map(other => Math.abs(number - other)),
              ),
            ),
          )
        : 999;
    if (!streetMatch && houseDelta > 20) continue;
    const score =
      hours +
      distance / 10 +
      Math.min(houseDelta, 40) * 2 +
      (streetMatch ? 0 : 100) +
      (record.descriptor === 'Blocked Bike Lane' ? 0 : 5);
    candidates.push({ record, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ? candidates[0].record : null;
}

async function main() {
  const caseTimes = await fetchTaskTimes();
  const jobs = buildJobs(caseTimes);
  const newJobs = [...jobs.values()].filter(job => !job.legacy);
  const legacyJobs = [...jobs.values()].filter(job => job.legacy);
  console.info(
    `jobs: ${jobs.size} (new: ${newJobs.length}, legacy: ${legacyJobs.length})`,
  );

  const results = {};
  const jobsByMonth = new Map();
  for (const job of newJobs) {
    if (!jobsByMonth.has(job.month)) jobsByMonth.set(job.month, []);
    jobsByMonth.get(job.month).push(job);
  }

  for (const [month, monthJobs] of [...jobsByMonth.entries()].sort()) {
    const start = addDays(`${month}-01`, -3);
    const end = addDays(`${nextMonth(month)}-01`, 3);
    const dataset = month < '2020-01' ? '76ig-c548' : 'erm2-nwe9';
    const records = await fetchOpenData(dataset, start, end);
    const used = new Set();
    let matched = 0;
    for (const job of monthJobs) {
      const record = pickRecord(job, records, used);
      results[job.caseId] = record ? toRecord(record, dataset) : null;
      if (record) {
        used.add(record.unique_key);
        matched += 1;
      }
    }
    console.info(
      `${month}: records=${records.length} jobs=${monthJobs.length} matched=${matched}`,
    );
  }

  if (legacyJobs.length > 0) {
    const dates = legacyJobs.map(job => job.time.slice(0, 10)).sort();
    const startMonth = addDays(dates[0], -45).slice(0, 7);
    const endMonth = addDays(dates[dates.length - 1], 45).slice(0, 7);
    const records = [];
    let month = startMonth;
    while (month <= endMonth) {
      const dataset = month < '2020-01' ? '76ig-c548' : 'erm2-nwe9';
      records.push(
        ...(await fetchOpenData(
          dataset,
          `${month}-01`,
          `${nextMonth(month)}-01`,
        )),
      );
      month = nextMonth(month);
    }
    console.info(`legacy records: ${records.length}`);
    const used = new Set();
    let matched = 0;
    for (const job of legacyJobs) {
      const record = pickRecord(job, records, used);
      results[job.caseId] = record
        ? toRecord(
            record,
            record.created_date < '2020-01-01' ? '76ig-c548' : 'erm2-nwe9',
          )
        : null;
      if (record) {
        used.add(record.unique_key);
        matched += 1;
      }
    }
    console.info(`legacy jobs=${legacyJobs.length} matched=${matched}`);
  }

  let added = 0;
  for (const file of FILES) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const report of data.reports) {
      const caseIds = new Set([
        ...(report.sr || []),
        ...(report.legacy || []),
        ...Object.keys(report.srActions || {}),
      ]);
      const existing = new Map(
        (report.records || []).map(record => [record.id, record]),
      );
      for (const caseId of caseIds) {
        const record = results[caseId];
        if (record && !existing.has(record.id)) {
          existing.set(record.id, record);
          added += 1;
        }
      }
      if (existing.size > 0) {
        report.records = [...existing.values()];
        if (!report.matched) report.matched = 'address';
        delete report.unchecked;
      }
    }
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.info(`wrote ${path.relative(ROOT, file)}`);
  }
  console.info(`records added: ${added}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

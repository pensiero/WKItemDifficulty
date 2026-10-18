#!/usr/bin/env node
// Rebuilds the community difficulty data embedded in main.js.
//
// Source: saraqael's 2022-09-24 snapshot of ~89k public WaniKani profiles
// (https://community.wanikani.com/t/new-combined-user-statistics/58741).
// Each profile showed the user's single worst kanji and worst vocab, with how
// often the user had answered its meaning and reading correctly. An item's
// "votes" are the number of users for whom it was the worst one.
//
// Inputs (data/raw/ is git-ignored and filled on demand):
//   data/raw/rawuserdata.csv   the sheet's "rawuserdata" tab (downloaded from the read-only backup)
//   data/raw/subjects.json     current WK subjects [{id, object, level, characters}]
//                              (fetched with WK_TOKEN; WK content is not redistributed)
//   data/wk-2022-items.json    the items WK had in 2022 and their 2022 levels
//
// Usage:
//   node tools/build-data.mjs            write the data block into main.js
//   node tools/build-data.mjs --report   also write docs/data-report.md
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const RAW = new URL('data/raw/', ROOT);
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1uq8f1N4rfsQS26N1RRKusnwWOfJZhfwsSHs1VI9aElo/export?format=csv&gid=1637531450';
const SNAPSHOT = '2022-09-24';
const READ_SHARE_MIN_VOTES = 5; // below this the reading/meaning split is mostly noise
const BEGIN = '// <difficulty-data>';
const END = '// </difficulty-data>';

const exists = (url) => access(url).then(() => true, () => false);

// Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += c, i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

// 2022 spellings differ slightly from today's (〜 vs ～, stray spaces).
export const normalizeCharacters = (s) => s.trim().replace(/[〜～]/g, '〜');

async function loadUsers() {
  const file = new URL('rawuserdata.csv', RAW);
  if (!(await exists(file))) {
    process.stderr.write('Downloading rawuserdata from the read-only sheet…\n');
    const res = await fetch(SHEET_CSV);
    if (!res.ok) throw new Error(`sheet download failed: HTTP ${res.status}`);
    await mkdir(RAW, { recursive: true });
    await writeFile(file, await res.text());
  }
  const int = (s) => parseInt(s, 10) || 0;
  // Header rows: group labels, then column names. Usernames (column 0) are never kept.
  return parseCsv(await readFile(file, 'utf8'))
    .slice(2)
    .filter((r) => r.length >= 15 && int(r[2]) >= 1)
    .map((r) => ({
      level: int(r[2]),
      kanji: { characters: normalizeCharacters(r[5]), meaningWrong: int(r[7]) - int(r[6]), readingWrong: int(r[9]) - int(r[8]) },
      vocabulary: { characters: normalizeCharacters(r[10]), meaningWrong: int(r[12]) - int(r[11]), readingWrong: int(r[14]) - int(r[13]) },
    }));
}

async function loadSubjects() {
  const file = new URL('subjects.json', RAW);
  if (!(await exists(file))) {
    const token = process.env.WK_TOKEN;
    if (!token) throw new Error('data/raw/subjects.json is missing: set WK_TOKEN (read-only personal access token) to fetch it');
    const headers = { Authorization: `Bearer ${token}`, 'Wanikani-Revision': '20170710' };
    const out = [];
    let url = 'https://api.wanikani.com/v2/subjects?types=kanji,vocabulary';
    while (url) {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      if (!res.ok) throw new Error(`WK API: HTTP ${res.status}`);
      const page = await res.json();
      for (const s of page.data) {
        if (!s.data.hidden_at) out.push({ id: s.id, object: s.object, level: s.data.level, characters: s.data.characters });
      }
      url = page.pages.next_url;
    }
    await mkdir(RAW, { recursive: true });
    await writeFile(file, JSON.stringify(out));
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

// Joins the 2022 items with today's subjects and the users' votes.
// Returns one row per item that still exists on WK.
export function buildItems(users, subjects, items2022) {
  const current = new Map(subjects.map((s) => [`${s.object}:${normalizeCharacters(s.characters || '')}`, s]));
  const tally = new Map();
  for (const u of users) {
    for (const type of ['kanji', 'vocabulary']) {
      const w = u[type];
      const key = `${type}:${w.characters}`;
      const t = tally.get(key) || { votes: 0, meaningWrong: 0, readingWrong: 0, voterLevels: [] };
      t.votes++;
      t.meaningWrong += Math.max(0, w.meaningWrong);
      t.readingWrong += Math.max(0, w.readingWrong);
      t.voterLevels.push(u.level);
      tally.set(key, t);
    }
  }
  const rows = [];
  const gone = [];
  const seen = new Set();
  // The 2022 lists contain blank entries and a few duplicates with a leading space
  // (" 九日" next to "九日"); keep the clean spelling.
  const clean = items2022
    .filter((item) => item.characters.trim())
    .sort((a, b) => (a.characters !== a.characters.trim()) - (b.characters !== b.characters.trim()));
  for (const item of clean) {
    const key = `${item.type}:${normalizeCharacters(item.characters)}`;
    if (seen.has(key)) continue;
    const subject = current.get(key);
    if (!subject) {
      gone.push(item);
      continue;
    }
    seen.add(key);
    const t = tally.get(key) || { votes: 0, meaningWrong: 0, readingWrong: 0 };
    const misses = t.meaningWrong + t.readingWrong;
    rows.push({
      id: subject.id,
      type: item.type,
      characters: subject.characters,
      level2022: item.level ?? subject.level, // zero-vote items had no recorded 2022 level
      level: subject.level,
      votes: t.votes,
      readingShare: t.votes >= READ_SHARE_MIN_VOTES && misses > 0 ? Math.round((t.readingWrong / misses) * 100) : null,
    });
  }
  const unmatchedVotes = [...tally].filter(([key]) => !seen.has(key)).reduce((n, [, t]) => n + t.votes, 0);
  return { rows, gone, unmatchedVotes };
}

// Users who had reached each level (index 1..60), i.e. could have the item as their worst.
export function learnersPerLevel(users) {
  const atLevel = new Array(62).fill(0);
  for (const u of users) atLevel[u.level]++;
  const reached = new Array(61).fill(0);
  for (let l = 60, sum = 0; l >= 1; l--) reached[l] = sum += atLevel[l];
  return reached;
}

// Mid-ranks (ties share the average rank), 0-based.
export function midRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return ranks;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Split-half reliability of the within-level ranking: split users in two random
// halves, rank each level's items by votes in each half, correlate the ranks,
// and step the correlation up to the full sample (Spearman-Brown).
function reliability(users, rows, splits = 20) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const cohorts = groupCohorts(rows);
  const sums = new Map();
  for (let s = 0; s < splits; s++) {
    const halves = [new Map(), new Map()];
    for (const u of users) {
      const h = halves[rand() < 0.5 ? 0 : 1];
      for (const type of ['kanji', 'vocabulary']) {
        const key = `${type}:${u[type].characters}`;
        h.set(key, (h.get(key) || 0) + 1);
      }
    }
    for (const [cohort, items] of cohorts) {
      if (items.length < 5) continue;
      const rk = (h) => midRanks(items.map((r) => h.get(`${r.type}:${normalizeCharacters(r.characters)}`) || 0));
      const rho = pearson(rk(halves[0]), rk(halves[1]));
      sums.set(cohort, (sums.get(cohort) || 0) + rho / splits);
    }
  }
  return new Map([...sums].map(([c, rho]) => [c, rho > 0 ? (2 * rho) / (1 + rho) : 0]));
}

function groupCohorts(rows) {
  const cohorts = new Map();
  for (const r of rows) {
    const key = `${r.type}:${r.level2022}`;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(r);
  }
  return cohorts;
}

// Compact encoding, one string per cohort (type + 2022 level): items sorted by id,
// "<id delta>.<votes>[.<reading share>]" in base 36, comma-separated.
// reliability: Map "type:level" -> split-half reliability, stored per type as a 60-slot array (x100).
export function encode(rows, learners, reliability) {
  const rel = (type) => Array.from({ length: 60 }, (_, i) => Math.round((reliability.get(`${type}:${i + 1}`) ?? 0) * 100));
  const out = { snapshot: SNAPSHOT, learners: learners.slice(1), reliability: { kanji: rel('kanji'), vocabulary: rel('vocabulary') }, kanji: {}, vocabulary: {} };
  for (const [key, items] of groupCohorts(rows)) {
    const [type, level] = key.split(':');
    let prev = 0;
    out[type][level] = items
      .sort((a, b) => a.id - b.id)
      .map((r) => {
        const parts = [(r.id - prev).toString(36), r.votes.toString(36)];
        if (r.readingShare != null) parts.push(r.readingShare.toString(36));
        prev = r.id;
        return parts.join('.');
      })
      .join(',');
  }
  return out;
}

async function main() {
  const users = await loadUsers();
  const subjects = await loadSubjects();
  const items2022 = JSON.parse(await readFile(new URL('data/wk-2022-items.json', ROOT), 'utf8')).items;
  const { rows, gone, unmatchedVotes } = buildItems(users, subjects, items2022);
  const learners = learnersPerLevel(users);
  const rel = reliability(users, rows);

  const scriptUrl = new URL('main.js', ROOT);
  const script = await readFile(scriptUrl, 'utf8');
  const start = script.indexOf(BEGIN);
  const end = script.indexOf(END);
  if (start < 0 || end < start) throw new Error(`main.js has no ${BEGIN} … ${END} block`);
  const block = `${BEGIN} generated by tools/build-data.mjs from the ${SNAPSHOT} snapshot; do not edit by hand\n  const DIFFICULTY_DATA = ${JSON.stringify(encode(rows, learners, rel))};\n  `;
  await writeFile(scriptUrl, script.slice(0, start) + block + script.slice(end));

  const moved = rows.filter((r) => r.level !== r.level2022).length;
  console.log(`users ${users.length} · items ${rows.length} (moved level since 2022: ${moved}) · no longer on WK: ${gone.length} · votes for items outside the 2022 list: ${unmatchedVotes}`);

  if (process.argv.includes('--report')) {
    const lines = [
      '# Community data report',
      '',
      `Generated by \`tools/build-data.mjs --report\` from the ${SNAPSHOT} snapshot.`,
      '',
      `- Users with a level: ${users.length}`,
      `- 2022 items still on WaniKani: ${rows.length} (kanji ${rows.filter((r) => r.type === 'kanji').length}, vocabulary ${rows.filter((r) => r.type === 'vocabulary').length})`,
      `- Items that have moved level since 2022: ${moved}. They are ranked against their 2022 level-mates, the users who saw them then.`,
      `- 2022 items no longer on WaniKani: ${gone.length}`,
      `- Votes for items outside the 2022 list: ${unmatchedVotes}`,
      '',
      '## How reliable is the ranking inside a level?',
      '',
      'Split-half reliability: the users are split into two random halves, each half ranks the level\'s items by votes, and the two rankings are correlated (Spearman, 20 splits, stepped up to the full sample with Spearman-Brown). 1 means both halves agree perfectly; 0 means the ranking is noise.',
      '',
      '| Levels | Type | Learners who reached the level | Median votes per item | Items with 0 votes | Reliability |',
      '|---|---|---|---|---|---|',
    ];
    const cohorts = groupCohorts(rows);
    for (const type of ['kanji', 'vocabulary']) {
      for (let from = 1; from <= 60; from += 5) {
        const levels = [from, from + 1, from + 2, from + 3, from + 4];
        const items = levels.flatMap((l) => cohorts.get(`${type}:${l}`) || []);
        const rels = levels.map((l) => rel.get(`${type}:${l}`)).filter((x) => x != null);
        const votes = items.map((r) => r.votes).sort((a, b) => a - b);
        lines.push(
          `| ${from}–${from + 4} | ${type} | ${learners[from + 4].toLocaleString('en')}–${learners[from].toLocaleString('en')} | ${votes[Math.floor(votes.length / 2)]} | ${Math.round((votes.filter((v) => v === 0).length / votes.length) * 100)}% | ${(rels.reduce((s, x) => s + x, 0) / rels.length).toFixed(2)} |`,
        );
      }
    }
    lines.push('', '## Per-level reliability', '', '```json', JSON.stringify(Object.fromEntries([...rel].map(([k, v]) => [k, +v.toFixed(2)]))), '```', '');
    await mkdir(new URL('docs/', ROOT), { recursive: true });
    await writeFile(new URL('docs/data-report.md', ROOT), lines.join('\n'));
    console.log('wrote docs/data-report.md');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

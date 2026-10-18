#!/usr/bin/env node
// Rebuilds the community difficulty data embedded in main.js.
//
// Source: saraqael's 2022-09-24 snapshot of ~89k public WaniKani profiles
// (https://community.wanikani.com/t/new-combined-user-statistics/58741).
// Each profile showed the user's single worst kanji and worst vocab, with how
// often the user had answered its meaning and reading correctly. An item's
// "votes" are the number of users for whom it was the worst one.
//
// Votes can't be compared across levels as they are: early items are seen by far
// more users, and people overwhelmingly name something they learned recently.
// fitModel() therefore fits a choice model over all users at once: a user at level L
// picks their worst item among everything up to L with probability proportional to
// w_item × recency(L − item level). w is a difficulty that is comparable across
// levels. What ships is each item's votes plus the "exposure" of its 2022 level
// (the votes an item with w = 1 would get), from which the userscript derives w and
// its uncertainty (posterior Gamma(votes + 1, exposure + 1)).
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
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url);
const RAW = new URL('data/raw/', ROOT);
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1uq8f1N4rfsQS26N1RRKusnwWOfJZhfwsSHs1VI9aElo/export?format=csv&gid=1637531450';
const SNAPSHOT = '2022-09-24';
const READ_SHARE_MIN_VOTES = 5; // below this the reading/meaning split is mostly noise
const RECENCY_LEVELS = 10; // items learned this many levels ago or more count as old
const PRIOR = 1; // Gamma(1, 1) prior on w: one pseudo-vote toward an average item
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
// Returns one row per item that still exists on WK. A vote only counts when the
// voter had reached the item's 2022 level (others had reset or moved levels).
export function buildItems(users, subjects, items2022) {
  const current = new Map(subjects.map((s) => [`${s.object}:${normalizeCharacters(s.characters || '')}`, s]));
  const tally = new Map();
  for (const u of users) {
    for (const type of ['kanji', 'vocabulary']) {
      const w = u[type];
      const key = `${type}:${w.characters}`;
      const t = tally.get(key) || { meaningWrong: 0, readingWrong: 0, voterLevels: [] };
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
    const level2022 = item.level ?? subject.level; // zero-vote items had no recorded 2022 level
    const t = tally.get(key) || { meaningWrong: 0, readingWrong: 0, voterLevels: [] };
    const votes = t.voterLevels.filter((l) => l >= level2022).length;
    const misses = t.meaningWrong + t.readingWrong;
    rows.push({
      id: subject.id,
      type: item.type,
      characters: subject.characters,
      key,
      level2022,
      level: subject.level,
      votes,
      readingShare: votes >= READ_SHARE_MIN_VOTES && misses > 0 ? Math.round((t.readingWrong / misses) * 100) : null,
    });
  }
  const unmatchedVotes = [...tally].filter(([key]) => !seen.has(key)).reduce((n, [, t]) => n + t.voterLevels.length, 0);
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

// The choice model (see the header), fitted by minorization-maximization.
// Returns w per row (same order as `rows`), exposure per 2022 level (1..60) and the
// recency weights (relative to items learned RECENCY_LEVELS or more levels ago).
export function fitModel(rows, users, type, iterations = 300) {
  const items = rows.filter((r) => r.type === type);
  const index = new Map(items.map((r, i) => [r.key, i]));
  const lvl = items.map((r) => r.level2022);
  const votes = new Float64Array(items.length);
  const usersAt = new Float64Array(61); // users per level whose vote is usable
  const gapVotes = new Float64Array(RECENCY_LEVELS + 1);
  for (const u of users) {
    const i = index.get(`${type}:${u[type].characters}`);
    if (i == null || lvl[i] > u.level) continue;
    votes[i]++;
    usersAt[u.level]++;
    gapVotes[Math.min(u.level - lvl[i], RECENCY_LEVELS)]++;
  }
  const gap = (L, l) => Math.min(L - l, RECENCY_LEVELS);
  const w = new Float64Array(items.length).fill(1);
  const recency = new Float64Array(RECENCY_LEVELS + 1).fill(1);
  const normalizers = () => {
    const Z = new Float64Array(61);
    for (let i = 0; i < items.length; i++) for (let L = lvl[i]; L <= 60; L++) Z[L] += w[i] * recency[gap(L, lvl[i])];
    return Z;
  };
  const exposureAt = (Z) => {
    const E = new Float64Array(61);
    for (let l = 1; l <= 60; l++) for (let L = l; L <= 60; L++) if (usersAt[L]) E[l] += (usersAt[L] * recency[gap(L, l)]) / Z[L];
    return E;
  };
  for (let it = 0; it < iterations; it++) {
    const E = exposureAt(normalizers());
    for (let i = 0; i < items.length; i++) w[i] = (votes[i] + PRIOR) / (E[lvl[i]] + PRIOR);
    const Z = normalizers();
    const G = new Float64Array(RECENCY_LEVELS + 1);
    for (let i = 0; i < items.length; i++) for (let L = lvl[i]; L <= 60; L++) if (usersAt[L]) G[gap(L, lvl[i])] += (usersAt[L] * w[i]) / Z[L];
    for (let k = 0; k <= RECENCY_LEVELS; k++) if (G[k]) recency[k] = gapVotes[k] / G[k];
    const base = recency[RECENCY_LEVELS];
    for (let k = 0; k <= RECENCY_LEVELS; k++) recency[k] /= base;
  }
  const exposure = exposureAt(normalizers());
  return { items, w, exposure, recency };
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

// Split-half reliability of the model's ranking: fit on two random halves of the
// users, correlate the rankings (Spearman), step up to the full sample (Spearman-Brown).
// Returned per type for all items and per block of 10 levels.
function reliability(users, rows) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const halves = [[], []];
  for (const u of users) halves[rand() < 0.5 ? 0 : 1].push(u);
  const stepUp = (r) => (r > 0 ? (2 * r) / (1 + r) : 0);
  const out = {};
  for (const type of ['kanji', 'vocabulary']) {
    const [a, b] = halves.map((h) => fitModel(rows, h, type, 150));
    const all = stepUp(pearson(midRanks([...a.w]), midRanks([...b.w])));
    const blocks = [];
    for (let from = 1; from <= 60; from += 10) {
      const idx = a.items.map((_, i) => i).filter((i) => a.items[i].level2022 >= from && a.items[i].level2022 < from + 10);
      blocks.push([from, stepUp(pearson(midRanks(idx.map((i) => a.w[i])), midRanks(idx.map((i) => b.w[i]))))]);
    }
    out[type] = { all, blocks };
  }
  return out;
}

const round3 = (x) => Number(x.toPrecision(3));

// Compact encoding, one string per type and current level: items sorted by id,
// "<id delta>.<votes>[.<reading share>][~<2022 level, if different>]" in base 36,
// comma-separated. exposure[type][l - 1] belongs to 2022 level l.
export function encode(rows, learners, exposure) {
  const out = { snapshot: SNAPSHOT, learners: learners.slice(1), exposure, kanji: {}, vocabulary: {} };
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.type}:${r.level}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [key, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    const [type, level] = key.split(':');
    let prev = 0;
    out[type][level] = items
      .sort((a, b) => a.id - b.id)
      .map((r) => {
        let entry = [(r.id - prev).toString(36), r.votes.toString(36)].concat(r.readingShare != null ? [r.readingShare.toString(36)] : []).join('.');
        if (r.level2022 !== r.level) entry += `~${r.level2022.toString(36)}`;
        prev = r.id;
        return entry;
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
  const models = Object.fromEntries(['kanji', 'vocabulary'].map((type) => [type, fitModel(rows, users, type)]));
  const exposure = Object.fromEntries(Object.entries(models).map(([type, m]) => [type, [...m.exposure].slice(1).map(round3)]));

  const scriptUrl = new URL('main.js', ROOT);
  const script = await readFile(scriptUrl, 'utf8');
  const start = script.indexOf(BEGIN);
  const end = script.indexOf(END);
  if (start < 0 || end < start) throw new Error(`main.js has no ${BEGIN} … ${END} block`);
  const block = `${BEGIN} generated by tools/build-data.mjs from the ${SNAPSHOT} snapshot; do not edit by hand\n  const DIFFICULTY_DATA = ${JSON.stringify(encode(rows, learners, exposure))};\n  `;
  await writeFile(scriptUrl, script.slice(0, start) + block + script.slice(end));

  const moved = rows.filter((r) => r.level !== r.level2022).length;
  console.log(`users ${users.length} · items ${rows.length} (moved level since 2022: ${moved}) · no longer on WK: ${gone.length} · votes for items outside the 2022 list: ${unmatchedVotes}`);

  if (process.argv.includes('--report')) {
    // The userscript's own ranking code, on the data block just written.
    const core = createRequire(import.meta.url)('../main.js');
    const index = core.buildCommunityIndex(core.DIFFICULTY_DATA);
    const rank = core.createRanker(index);
    const rel = reliability(users, rows);
    const pct = (n, d) => `${Math.round((n / d) * 100)}%`;
    const lines = [
      '# Community data report',
      '',
      `Generated by \`tools/build-data.mjs --report\` from the ${SNAPSHOT} snapshot.`,
      '',
      `- Users with a level: ${users.length}`,
      `- 2022 items still on WaniKani: ${rows.length} (kanji ${rows.filter((r) => r.type === 'kanji').length}, vocabulary ${rows.filter((r) => r.type === 'vocabulary').length})`,
      `- Items that have moved level since 2022: ${moved}`,
      `- 2022 items no longer on WaniKani: ${gone.length}`,
      `- Votes for items outside the 2022 list: ${unmatchedVotes}`,
      '',
      '## Recency',
      '',
      `How much more likely an item is to be named "worst" when it was learned 0, 1, 2… levels before the user's level, compared with an item learned ${RECENCY_LEVELS} or more levels before:`,
      '',
      '| Type | ' + Array.from({ length: RECENCY_LEVELS + 1 }, (_, k) => (k === RECENCY_LEVELS ? `${k}+` : k)).join(' | ') + ' |',
      '|---|' + '---|'.repeat(RECENCY_LEVELS + 1),
      ...Object.entries(models).map(([type, m]) => `| ${type} | ${[...m.recency].map((x) => x.toFixed(1)).join(' | ')} |`),
      '',
      '## Average difficulty by level',
      '',
      'Mean log w of the items of each block of levels (0 = an item with w = 1). After the recency correction there is no clear upward trend for kanji; late vocabulary is somewhat harder.',
      '',
      '| Levels | kanji | vocabulary |',
      '|---|---|---|',
    ];
    for (let from = 1; from <= 60; from += 10) {
      const mean = (m) => {
        const v = m.items.map((r, i) => [r.level2022, Math.log(m.w[i])]).filter(([l]) => l >= from && l < from + 10).map(([, x]) => x);
        return (v.reduce((s, x) => s + x, 0) / v.length).toFixed(2);
      };
      lines.push(`| ${from}–${from + 9} | ${mean(models.kanji)} | ${mean(models.vocabulary)} |`);
    }
    lines.push(
      '',
      '## Reliability',
      '',
      'Split-half reliability: the model is fitted on two random halves of the users and the two rankings are correlated (Spearman, stepped up to the full sample with Spearman-Brown). 1 means both halves agree perfectly; 0 means the ranking is noise.',
      '',
      '| | All items | ' + rel.kanji.blocks.map(([from]) => `${from}–${from + 9}`).join(' | ') + ' |',
      '|---|---|' + '---|'.repeat(rel.kanji.blocks.length),
      ...Object.entries(rel).map(([type, r]) => `| ${type} | ${r.all.toFixed(2)} | ${r.blocks.map(([, x]) => x.toFixed(2)).join(' | ')} |`),
      '',
      '## Uncertainty',
      '',
      'Each item\'s likely range (90%) compared with everything up to its own level. The userscript shows a band when the range covers one or two bands, and "not enough data" when it covers three or four.',
      '',
      '| Type | 1 band | 2 bands | 3–4 bands (not enough data) |',
      '|---|---|---|---|',
    );
    for (const type of ['kanji', 'vocabulary']) {
      const spans = [0, 0, 0];
      const items = [...index.values()].filter((c) => c.type === type);
      for (const c of items) {
        const r = rank(c.id, c.level);
        spans[Math.min(2, r.bandHi - r.bandLo)]++;
      }
      lines.push(`| ${type} | ${pct(spans[0], items.length)} | ${pct(spans[1], items.length)} | ${pct(spans[2], items.length)} |`);
    }
    lines.push('');
    await mkdir(new URL('docs/', ROOT), { recursive: true });
    await writeFile(new URL('docs/data-report.md', ROOT), lines.join('\n'));
    console.log('wrote docs/data-report.md');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

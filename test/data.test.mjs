// Checks the embedded community data: well-formed, unique ids, sensible rankings,
// and a few items the community is known to struggle with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../main.js');
const data = core.DIFFICULTY_DATA;
const index = core.buildCommunityIndex(data);
const rank = core.createRanker(index);

test('data block has learners and exposure for every level', () => {
  assert.equal(data.learners.length, 60);
  assert.ok(data.learners.every((n, i) => i === 0 || n <= data.learners[i - 1]), 'learners who reached a level only go down');
  for (const type of ['kanji', 'vocabulary']) {
    assert.equal(data.exposure[type].length, 60);
    assert.ok(data.exposure[type].every((e) => e > 0));
    for (let level = 1; level <= 60; level++) assert.ok(data[type][level], `${type} level ${level}`);
  }
});

test('ids are unique across levels', () => {
  let total = 0;
  for (const type of ['kanji', 'vocabulary']) for (const str of Object.values(data[type])) total += core.decodeLevel(str).length;
  assert.equal(index.size, total);
  assert.ok(index.size > 8000);
});

test('bands follow the percentile split among items that can be ranked', () => {
  for (const type of ['kanji', 'vocabulary']) {
    const ranked = [...index.values()].filter((c) => c.type === type).map((c) => rank(c.id, 60)).filter((r) => r.band != null);
    const share = (b) => ranked.filter((r) => r.band === b).length / ranked.length;
    assert.ok(share(3) > 0.05 && share(3) < 0.2, `${type}: ${Math.round(share(3) * 100)}% very hard`);
    assert.ok(share(0) > 0.3, `${type}: ${Math.round(share(0) * 100)}% easy`);
  }
});

test('known leeches are very hard, early ones even against all 60 levels', () => {
  // 午 (noon), 了 (finish): the most common worst kanji in the snapshot
  for (const id of [503, 465]) assert.equal(rank(id, 60).band, 3, `kanji ${id}`);
  assert.ok(index.get(503).readingShare != null);
});

test('items with no votes are never ranked hard', () => {
  for (const c of index.values()) {
    if (c.votes > 0) continue;
    const r = rank(c.id, c.level);
    assert.ok(r.band == null || r.band <= 1, `${c.id}: band ${r.band}`);
  }
});

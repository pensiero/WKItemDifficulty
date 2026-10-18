// Checks the embedded community data: well-formed, unique ids, sensible bands,
// and a few items the community is known to struggle with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../main.js');
const data = core.DIFFICULTY_DATA;
const index = core.buildCommunityIndex(data);

test('data block has every level and the reliability arrays', () => {
  assert.equal(data.learners.length, 60);
  assert.ok(data.learners.every((n, i) => i === 0 || n <= data.learners[i - 1]), 'learners who reached a level only go down');
  for (const type of ['kanji', 'vocabulary']) {
    assert.equal(data.reliability[type].length, 60);
    for (let level = 1; level <= 60; level++) assert.ok(data[type][level], `${type} level ${level}`);
  }
});

test('ids are unique across cohorts', () => {
  let total = 0;
  for (const type of ['kanji', 'vocabulary']) for (const str of Object.values(data[type])) total += core.decodeCohort(str).length;
  assert.equal(index.size, total);
  assert.ok(index.size > 8000);
});

test('bands follow the percentile split in every big cohort', () => {
  const byCohort = new Map();
  for (const item of index.values()) {
    const key = `${item.type}:${item.level2022}`;
    if (!byCohort.has(key)) byCohort.set(key, []);
    byCohort.get(key).push(item);
  }
  for (const [key, items] of byCohort) {
    const hardest = items.filter((i) => i.band === 3).length / items.length;
    assert.ok(hardest <= 0.2, `${key}: ${Math.round(hardest * 100)}% very hard`);
    if (items.every((i) => i.votes === 0)) continue;
    assert.ok(items.some((i) => i.band === 3), `${key} has a very hard item`);
  }
});

test('known leeches are very hard', () => {
  // 午 (noon), 了 (finish) and 生 (life) are the most common worst items in the snapshot.
  for (const id of [503, 465]) assert.equal(index.get(id).band, 3, `kanji ${id}`);
  assert.ok(index.get(503).readingShare != null);
});

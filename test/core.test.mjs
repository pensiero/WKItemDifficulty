import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../main.js');

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('bandIndex: easiest half, next 25%, next 15%, hardest 10%', () => {
  assert.equal(core.bandIndex(0), 0);
  assert.equal(core.bandIndex(49.9), 0);
  assert.equal(core.bandIndex(50), 1);
  assert.equal(core.bandIndex(75), 2);
  assert.equal(core.bandIndex(89.9), 2);
  assert.equal(core.bandIndex(90), 3);
  assert.equal(core.bandIndex(100), 3);
});

test('gamma functions match closed forms', () => {
  close(core.logGamma(5), Math.log(24), 1e-9);
  close(core.logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-9);
  // Gamma(1, rate) is exponential: P(x) = 1 - e^(-x), quantile = -ln(1 - p) / rate
  close(core.gammaP(1, 2), 1 - Math.exp(-2), 1e-9);
  close(core.gammaQuantile(0.05, 1, 1), -Math.log(0.95));
  close(core.gammaQuantile(0.95, 1, 4), -Math.log(0.05) / 4);
  // Gamma(2, 1): P(x) = 1 - (1 + x) e^(-x)
  close(core.gammaP(2, 3), 1 - 4 * Math.exp(-3), 1e-9);
  // large shapes stay accurate (normal approximation: mean 1000, sd ~31.6)
  close(core.gammaQuantile(0.5, 1000, 1), 999.67, 0.05);
});

test('decodeLevel reads id deltas, votes, reading share and the 2022 level (base 36)', () => {
  // ids 440, 441, 450; votes 36, 0, 5; reading share 50 on the first; the last was level 2 in 2022
  assert.deepEqual(core.decodeLevel('c8.10.1e,1.0,9.5~2'), [
    { id: 440, votes: 36, readingShare: 50, level2022: null },
    { id: 441, votes: 0, readingShare: null, level2022: null },
    { id: 450, votes: 5, readingShare: null, level2022: 2 },
  ]);
  assert.deepEqual(core.decodeLevel(''), []);
});

// Two levels of kanji. Level 1: ids 1-10 with lots of evidence (exposure 100), votes 10..100.
// Level 2: ids 11-20 with little evidence (exposure 2); id 20 moved there from level 1.
const tiny = {
  snapshot: '2022-09-24',
  learners: Array.from({ length: 60 }, (_, i) => 1000 - i * 10),
  exposure: { kanji: [100, 2, ...Array(58).fill(1)], vocabulary: Array(60).fill(1) },
  kanji: {
    1: Array.from({ length: 10 }, (_, i) => `1.${((i + 1) * 10).toString(36)}`).join(','),
    2: [...Array.from({ length: 9 }, (_, i) => `${i === 0 ? 'b' : '1'}.${i.toString(36)}`), '1.a~1'].join(','),
  },
  vocabulary: {},
};

test('buildCommunityIndex: w is the posterior mean, exposure follows the 2022 level', () => {
  const index = core.buildCommunityIndex(tiny);
  assert.equal(index.size, 20);
  const top = index.get(10);
  assert.equal(top.votes, 100);
  close(top.w, 101 / 101);
  assert.equal(top.learners, 1000);
  const moved = index.get(20);
  assert.equal(moved.level, 2);
  assert.equal(moved.level2022, 1);
  close(moved.w, 11 / 101, 1e-9); // level 1 exposure, not level 2's
  close(index.get(11).w, 1 / 3); // 0 votes, exposure 2
});

test('createRanker: pools everything up to the pool level and widens with little evidence', () => {
  const index = core.buildCommunityIndex(tiny);
  const rank = core.createRanker(index);
  const top = rank(10, 1);
  assert.equal(top.poolLevel, 1);
  assert.equal(top.band, 3);
  assert.equal(top.harderThan, 95);
  // well-measured items get a narrow range
  assert.ok(top.bandHi - top.bandLo <= 1);
  // the pool is never below the item's own level
  assert.equal(rank(15, 1).poolLevel, 2);
  // pool level 2 adds level 2's items to the comparison
  assert.notEqual(rank(5, 2).percentile, rank(5, 1).percentile);
  // a weakly measured item (exposure 2) has a wide range: not enough data
  const weak = rank(13, 2);
  assert.equal(weak.band, null);
  assert.ok(weak.bandHi - weak.bandLo >= 2);
  assert.equal(rank(999, 2), null);
});

test('personalStats: null without enough answers; weak side and leech', () => {
  assert.equal(core.personalStats(null), null);
  assert.equal(core.personalStats({ meaning_correct: 1, meaning_incorrect: 0, reading_correct: 1, reading_incorrect: 0 }), null);
  // 知識-like: 84% overall, meaning 13/18, reading 13/13, last meaning answer wrong (streak 1)
  const p = core.personalStats({
    meaning_correct: 13, meaning_incorrect: 5, meaning_current_streak: 1,
    reading_correct: 13, reading_incorrect: 0, reading_current_streak: 13,
  });
  assert.equal(p.accuracy, 84);
  assert.equal(p.meaning, 72);
  assert.equal(p.reading, 100);
  assert.equal(p.weakSide, 'meaning');
  assert.equal(p.leech, true, 'a separate tag, not a band');
  const radical = core.personalStats({ meaning_correct: 7, meaning_incorrect: 2, meaning_current_streak: 3, reading_correct: 0, reading_incorrect: 0 });
  assert.equal(radical.reading, null);
  assert.equal(radical.leech, false);
});

test('buildPersonalIndex ranks against your own items of the same type', () => {
  const stats = (correct, incorrect) => ({ meaning_correct: correct, meaning_incorrect: incorrect, meaning_current_streak: 5, reading_correct: correct, reading_incorrect: incorrect, reading_current_streak: 5 });
  // ten vocab: 0..9 wrong answers out of 20 per side; one radical that is always right
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, type: 'vocabulary', stats: stats(20 - i, i) }));
  items.push({ id: 100, type: 'radical', stats: { meaning_correct: 10, meaning_incorrect: 0, meaning_current_streak: 10 } });
  items.push({ id: 101, type: 'vocabulary', stats: stats(1, 0) }); // too few answers: skipped
  const index = core.buildPersonalIndex(items);
  assert.equal(index.size, 11);
  assert.equal(index.has(101), false);
  assert.deepEqual([...Array(10)].map((_, i) => index.get(i + 1).band), [0, 0, 0, 0, 0, 1, 1, 2, 2, 3]);
  assert.equal(index.get(10).of, 10);
  assert.equal(index.get(100).of, 1, 'radicals are ranked among radicals');
  // pseudo-answers keep tiny samples from outranking long histories
  const few = core.buildPersonalIndex([
    { id: 1, type: 'kanji', stats: { meaning_correct: 2, meaning_incorrect: 1, meaning_current_streak: 1, reading_correct: 1, reading_incorrect: 0, reading_current_streak: 1 } },
    { id: 2, type: 'kanji', stats: stats(65, 35) },
    { id: 3, type: 'kanji', stats: stats(95, 5) },
  ]);
  assert.ok(few.get(2).percentile > few.get(1).percentile);
});

test('quizRevealed follows the setting', () => {
  const fresh = { answered: false, failed: false };
  const wrong = { answered: true, failed: true };
  const right = { answered: true, failed: false };
  assert.equal(core.quizRevealed('answered', fresh), false);
  assert.equal(core.quizRevealed('answered', right), true);
  assert.equal(core.quizRevealed('wrong', right), false);
  assert.equal(core.quizRevealed('wrong', wrong), true);
  assert.equal(core.quizRevealed('always', fresh), true);
  assert.equal(core.quizRevealed('never', wrong), false);
});

test('routeOf recognizes every page the script works on', () => {
  assert.deepEqual(core.routeOf('/subjects/review'), { page: 'quiz' });
  assert.deepEqual(core.routeOf('/subjects/extra_study'), { page: 'quiz' });
  assert.deepEqual(core.routeOf('/subject-lessons/1406901002444223708/quiz'), { page: 'quiz' });
  assert.deepEqual(core.routeOf('/recent-mistakes/2026-10-18/quiz'), { page: 'quiz' });
  assert.deepEqual(core.routeOf('/subject-lessons/1406901002444223708/4266'), { page: 'lesson', id: 4266 });
  assert.deepEqual(core.routeOf('/recent-mistakes/2026-10-18/subjects/503/lesson'), { page: 'lesson', id: 503 });
  assert.deepEqual(core.routeOf('/subject-lessons/picker'), { page: 'picker' });
  assert.deepEqual(core.routeOf('/kanji/%E8%A6%A7'), { page: 'item' });
  assert.deepEqual(core.routeOf('/vocabulary/%E5%9C%A7%E5%8A%9B'), { page: 'item' });
  assert.deepEqual(core.routeOf('/level/20'), { page: 'other' });
  assert.deepEqual(core.routeOf('/dashboard'), { page: 'other' });
  assert.deepEqual(core.routeOf('/kanji'), { page: 'other' }, 'the kanji list is not an item page');
});

test('tileTarget decodes item links', () => {
  assert.deepEqual(core.tileTarget('https://www.wanikani.com/kanji/%E8%A6%A7'), { type: 'kanji', slug: '覧' });
  assert.deepEqual(core.tileTarget('/vocabulary/%E5%9C%A7%E5%8A%9B'), { type: 'vocabulary', slug: '圧力' });
  assert.equal(core.tileTarget('/radicals/gun'), null);
  assert.equal(core.tileTarget('/kanji/%E0%A4%A'), null, 'malformed escapes are ignored');
});

test('migrateLegacySettings keeps the review choice of v0.23', () => {
  assert.deepEqual(core.migrateLegacySettings(null), {});
  assert.deepEqual(core.migrateLegacySettings({ INDICATOR_REVIEW_POS: 'none' }), { quizReveal: 'never' });
  assert.deepEqual(core.migrateLegacySettings({ INDICATOR_REVIEW_POS: 'main', HIDE_UNTIL_ANSWER: false }), { quizReveal: 'always' });
  assert.deepEqual(core.migrateLegacySettings({ INDICATOR_REVIEW_POS: 'main', HIDE_UNTIL_ANSWER: true }), {});
  assert.deepEqual(core.migrateLegacySettings({ INDICATOR_REVIEW_POS: 'info', HIDE_UNTIL_ANSWER: true }), {});
});

test('describeCommunity words the position, range, votes, split and level moves', () => {
  const index = core.buildCommunityIndex(tiny);
  const rank = core.createRanker(index);
  const top = core.describeCommunity({ ...index.get(10), readingShare: 70 }, rank(10, 1));
  assert.equal(top.position, 'Harder than 95% of the kanji in levels 1–1.');
  assert.equal(top.votes, '100 of the 1,000 learners who had reached level 1 named it their worst kanji.');
  assert.deepEqual(top.split, { meaning: 30, reading: 70 });
  assert.equal(top.moved, null);
  const weak = core.describeCommunity(index.get(13), rank(13, 2));
  assert.equal(weak.position, 'Not enough data to say how it compares with the kanji in levels 1–2.');
  assert.match(weak.range, /^Likely range: \w+ to [\w ]+\.$/);
  assert.equal(weak.votes, '2 of the 990 learners who had reached level 2 named it their worst kanji.');
  assert.equal(core.describeCommunity(index.get(11), rank(11, 2)).votes, 'None of the 990 learners who had reached level 2 named it their worst kanji.');
  assert.equal(core.describeCommunity(index.get(20), rank(20, 2)).moved, 'It was a level 1 item in 2022; it is level 2 now.');
});

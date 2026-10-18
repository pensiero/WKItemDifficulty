import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../main.js');

test('bandIndex: easiest half, next 25%, next 15%, hardest 10%', () => {
  assert.equal(core.bandIndex(0), 0);
  assert.equal(core.bandIndex(49.9), 0);
  assert.equal(core.bandIndex(50), 1);
  assert.equal(core.bandIndex(75), 2);
  assert.equal(core.bandIndex(89.9), 2);
  assert.equal(core.bandIndex(90), 3);
  assert.equal(core.bandIndex(100), 3);
});

test('midRanks gives ties the average rank', () => {
  assert.deepEqual(core.midRanks([5, 0, 0, 9]), [2, 0.5, 0.5, 3]);
});

test('decodeCohort reads id deltas, votes and the optional reading share (base 36)', () => {
  // ids 440, 441, 450; votes 36, 0, 5; reading share 50 only on the first
  assert.deepEqual(core.decodeCohort('c8.10.1e,1.0,9.5'), [
    { id: 440, votes: 36, readingShare: 50 },
    { id: 441, votes: 0, readingShare: null },
    { id: 450, votes: 5, readingShare: null },
  ]);
  assert.deepEqual(core.decodeCohort(''), []);
});

const tiny = {
  snapshot: '2022-09-24',
  learners: Array.from({ length: 60 }, (_, i) => 1000 - i * 10),
  reliability: { kanji: Array(60).fill(90), vocabulary: Array(60).fill(60) },
  // level 3 kanji: ten items, ids 1..10, votes 0..9
  kanji: { 3: Array.from({ length: 10 }, (_, i) => `1.${i.toString(36)}`).join(',') },
  vocabulary: { 3: 'g.0,1.0' }, // ids 16 and 17, both zero votes
};

test('buildCommunityIndex ranks items inside their 2022 level and type', () => {
  const index = core.buildCommunityIndex(tiny);
  assert.equal(index.size, 12);
  const hardest = index.get(10);
  assert.equal(hardest.band, 3);
  assert.equal(hardest.harderThan, 90);
  assert.equal(hardest.level2022, 3);
  assert.equal(hardest.learners, 980);
  assert.equal(hardest.confidence, 'high');
  assert.equal(index.get(1).band, 0);
  assert.equal(index.get(1).harderThan, 0);
  // bands follow the 50/25/15/10 split
  const bands = [...Array(10)].map((_, i) => index.get(i + 1).band);
  assert.deepEqual(bands, [0, 0, 0, 0, 0, 1, 1, 2, 2, 3]);
  // all-zero ties sit in the middle, so they are not called hard
  assert.equal(index.get(16).band, 1);
  assert.equal(index.get(16).confidence, 'low');
});

test('confidenceOf thresholds', () => {
  assert.equal(core.confidenceOf(0.9), 'high');
  assert.equal(core.confidenceOf(0.7), 'medium');
  assert.equal(core.confidenceOf(0.69), 'low');
});

test('personalDifficulty: null without enough answers', () => {
  assert.equal(core.personalDifficulty(null), null);
  assert.equal(core.personalDifficulty({ meaning_correct: 1, meaning_incorrect: 0, reading_correct: 1, reading_incorrect: 0 }), null);
});

test('personalDifficulty: accuracy bands, weak side and leech', () => {
  const easy = core.personalDifficulty({
    meaning_correct: 20, meaning_incorrect: 0, meaning_current_streak: 10,
    reading_correct: 19, reading_incorrect: 1, reading_current_streak: 8,
  });
  assert.equal(easy.band, 0);
  assert.equal(easy.accuracy, 98);
  assert.equal(easy.weakSide, null);

  const leech = core.personalDifficulty({
    meaning_correct: 12, meaning_incorrect: 1, meaning_current_streak: 6,
    reading_correct: 9, reading_incorrect: 6, reading_current_streak: 1,
  });
  assert.equal(leech.band, 3, 'six wrong readings and a streak of 1 is a leech');
  assert.equal(leech.weakSide, 'reading');
  assert.equal(leech.meaning, 92);
  assert.equal(leech.reading, 60);

  const radical = core.personalDifficulty({ meaning_correct: 7, meaning_incorrect: 2, meaning_current_streak: 3, reading_correct: 0, reading_incorrect: 0, reading_current_streak: 0 });
  assert.equal(radical.reading, null);
  assert.equal(radical.band, 2); // 78% correct
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

test('describeCommunity words zero votes, votes, the split and level moves', () => {
  const index = core.buildCommunityIndex(tiny);
  const zero = core.describeCommunity(index.get(1), 3);
  assert.match(zero.position, /^None of the 980 learners who had reached level 3 had it as their worst kanji\.$/);
  assert.equal(zero.votes, null);
  assert.equal(zero.moved, null);
  const top = core.describeCommunity({ ...index.get(10), readingShare: 70 }, 10);
  assert.equal(top.position, 'Harder than 90% of level 3 kanji.');
  assert.equal(top.votes, 'The worst kanji of 9 of the 980 learners who had reached level 3.');
  assert.deepEqual(top.split, { meaning: 30, reading: 70 });
  assert.equal(top.moved, 'It was a level 3 item in 2022; it is level 10 now.');
});

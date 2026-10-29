import test from 'node:test';
import assert from 'node:assert/strict';
import { puzzles, story } from '../src/content.js';
import { isCorrect, normalizeAnswer, newGame, restoreGame } from '../src/game.js';

test('Логическая загадка имеет единственный ответ — бордовый конверт', () => {
  const possible = ['red', 'blue', 'green'].filter(place => [place === 'blue', place !== 'blue', place !== 'red'].filter(Boolean).length === 1);
  assert.deepEqual(possible, [puzzles[0].answer]);
});
test('Пароль действительно образован первыми буквами строк', () => {
  assert.equal(normalizeAnswer(puzzles[1].document.lines.map(line => [...line][0]).join('')), puzzles[1].answer);
});
test('Ответы принимают пробелы, регистр, пунктуацию и варианты имени', () => {
  assert.ok(isCorrect(puzzles[1], '  И С К Р А! '));
  assert.ok(isCorrect(puzzles[3], 'КСЮША'));
  assert.ok(isCorrect(puzzles[3], story.nickname));
  assert.ok(isCorrect(puzzles[3], `моя ${story.nickname}`));
  assert.equal(isCorrect(puzzles[1], 'архив'), false);
});
test('Реконструкция принимает только полную правильную последовательность', () => {
  assert.ok(isCorrect(puzzles[2], ['a', 'b', 'c', 'd']));
  assert.equal(isCorrect(puzzles[2], ['c', 'a', 'd', 'b']), false);
  assert.equal(isCorrect(puzzles[2], ['a', 'b', 'c']), false);
});
test('Повреждённое или устаревшее сохранение не открывает недоступные этапы', () => {
  for (const saved of [null, {}, { version: 0, solved: 2 }, { version: story.storyVersion, solved: -1 }, { version: story.storyVersion, solved: 5 }, { version: story.storyVersion, solved: '4' }]) assert.deepEqual(restoreGame(saved), newGame());
  assert.equal(restoreGame({ version: story.storyVersion, solved: 1, view: 'finale', accepted: true }).view, 'game');
});
test('Законченное прохождение и найденные материалы сохраняются', () => {
  const restored = restoreGame({ version: story.storyVersion, solved: 4, view: 'game', hints: [7, -1, 2, 0], skipped: [1, 1, 2, 6], accepted: true });
  assert.equal(restored.view, 'finale');
  assert.equal(restored.accepted, true);
  assert.deepEqual(restored.hints, [3, 0, 2, 0]);
  assert.deepEqual(restored.skipped, [1, 2]);
});

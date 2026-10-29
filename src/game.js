import { story, puzzles } from './content.js';

export const STORAGE_KEY = 'bureau-letters:progress';

export function normalizeAnswer(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function isCorrect(puzzle, value) {
  if (puzzle.type === 'order') return Array.isArray(value) && value.join('|') === puzzle.answer.join('|');
  const answers = puzzle.id === 'recipient' ? [...story.finalAnswers, story.nickname, story.recipient, `моя ${story.nickname}`] : [puzzle.answer];
  return answers.some(answer => normalizeAnswer(answer) === normalizeAnswer(value));
}

export function newGame() {
  return { version: story.storyVersion, view: 'home', solved: 0, hints: [0, 0, 0, 0], skipped: [], accepted: false };
}

export function restoreGame(saved) {
  const initial = newGame();
  if (!saved || saved.version !== story.storyVersion || !Number.isInteger(saved.solved) || saved.solved < 0 || saved.solved > puzzles.length) return initial;
  const solved = saved.solved;
  return {
    ...initial,
    view: saved.view === 'home' ? 'home' : solved === puzzles.length ? 'finale' : 'game',
    solved,
    hints: puzzles.map((_, index) => Math.max(0, Math.min(3, Number(saved.hints?.[index]) || 0))),
    skipped: Array.isArray(saved.skipped) ? [...new Set(saved.skipped.filter(value => Number.isInteger(value) && value >= 0 && value < solved))] : [],
    accepted: solved === puzzles.length && saved.accepted === true
  };
}

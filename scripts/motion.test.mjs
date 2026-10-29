import test from 'node:test';
import assert from 'node:assert/strict';
const frames = new Map();
let nextId = 1;
let time = 0;
let onPreferenceChange;
const preference = { matches: false, addEventListener: (_, callback) => { onPreferenceChange = callback; } };
globalThis.matchMedia = () => preference;
globalThis.requestAnimationFrame = callback => { const id = nextId++; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const { springTo, fade } = await import('../src/motion.js');
const element = () => ({ style: {}, isConnected: true });
const advance = () => {
  time += 16;
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(time);
};
const settle = () => {
  for (let index = 0; index < 400 && frames.size; index++) advance();
  assert.equal(frames.size, 0, 'Пружина должна завершиться и освободить цикл кадров');
};

test('Пружина доходит до цели и останавливает кадровый цикл', () => {
  const button = element();
  springTo(button, { scale: .965 });
  settle();
  assert.equal(button.style.scale, '0.965');
});
test('Новая цель начинается с текущего положения без скачка', () => {
  const card = element();
  springTo(card, { y: 100 });
  advance(); advance(); advance();
  const current = card.style.translate;
  assert.notEqual(current, '0px 0px');
  springTo(card, { y: 0 });
  assert.equal(card.style.translate, current);
  settle();
  assert.equal(card.style.translate, '0px 0px');
});
test('Удалённые элементы не оставляют работающую анимацию', () => {
  const card = element();
  springTo(card, { y: 30 });
  card.isConnected = false;
  settle();
});
test('Reduced motion завершает движение и предотвращает новые анимации', () => {
  const card = element();
  springTo(card, { y: 80 });
  advance();
  preference.matches = true;
  onPreferenceChange();
  assert.equal(card.style.translate, '0px 80px');
  assert.equal(frames.size, 0);
  springTo(card, { y: 0 });
  assert.equal(card.style.translate, '0px 0px');
  assert.equal(frames.size, 0);
  assert.equal(fade(card, [{ opacity: 0 }, { opacity: 1 }]), null);
  preference.matches = false;
});

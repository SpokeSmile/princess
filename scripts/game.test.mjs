import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { archive, evidence, cases, filmChallenge } from '../src/content.js';
import { emptyState, safeMessages, validMessage, escapeHtml } from '../src/game.js';

test('Открытые документы содержат обе восстанавливаемые улики', () => {
  const alphabet = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
  const code = evidence.find(item => item.id === 'envelope').code.match(/\d+/g).map(Number);
  assert.equal(code.map(n => alphabet[n - 1]).join(''), 'МАКСИМ');
  assert.equal(evidence.find(item => item.id === 'registry').lines.map(line => line[0]).join(''), 'КОТ');
});
test('Публичный сюжет не содержит ранних личных обращений или открытых ответов', () => {
  const text = JSON.stringify({ archive, evidence, cases, filmChallenge });
  assert.doesNotMatch(text, /Ксюша|Принцесса|Максим|И я тебя люблю|колготки|свидание/i);
  assert.equal(cases.length, 3);
  assert.equal(new Set(evidence.map(item => item.id)).size, evidence.length);
});
test('Фильм показывается с точным названием и согласованным интервалом', () => {
  assert.equal(filmChallenge.title, 'До встречи с тобой');
  assert.equal(filmChallenge.time, '01:02:43–01:03:30');
});
test('Пользовательский текст и ответы ИИ безопасны для HTML-шаблонов', () => {
  assert.equal(escapeHtml('<img onerror="alert(1)">&\''), '&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.deepEqual(safeMessages([{ role: 'system', content: 'private' }, null, { role: 'assistant', content: '<script>' }, { role: 'user', content: 1 }]), [{ role: 'assistant', content: '<script>' }]);
});
test('Без ответа сервера никакие этапы не считаются пройденными', () => {
  const first = emptyState();
  assert.equal(first.solved, false);
  assert.equal(first.film_solved, false);
  assert.equal(first.ai_configured, false);
  first.evidence.push('letter');
  assert.deepEqual(emptyState().evidence, []);
  assert.equal(validMessage('   '), false);
  assert.equal(validMessage('x'.repeat(1501)), false);
  assert.equal(validMessage('Почему исчезло имя?'), true);
});
test('Статический клиент не хранит ключ, готовую разгадку или старый финал', async () => {
  const sources = await Promise.all(['app.js', 'content.js', 'game.js', 'api.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  assert.doesNotMatch(sources.join('\n'), /Ксюша|Принцесса|И я тебя люблю|колготки|MISTRAL_API_KEY|api\.mistral\.ai/iu);
});

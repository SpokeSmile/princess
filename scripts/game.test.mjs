import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { archive, evidence, cases, filmChallenge, bookCipher, stageTitles } from '../src/content.js';
import { emptyState, escapeHtml, safeMessages, validMessage, registryWords, NOTES_KEY, UI_KEY } from '../src/game.js';

const registry = evidence.find(item => item.id === 'registry');
test('Открытые материалы содержат одно дело и шесть точных логических строк', () => {
  assert.equal(archive.caseId, 'undated-letter');
  assert.equal(registry.lines.length, 6);
  assert.equal(registry.lines.map(line => line[0]).join(''), 'ЯНВАРЯ');
  assert.equal(new Set(evidence.map(item => item.id)).size, evidence.length);
  assert.deepEqual(evidence.map(item => item.id), ['envelope', 'registry', 'film', 'stamp']);
  assert.equal(stageTitles.year, 'Книжный шифр');
  assert.equal(cases.length, 4);
  assert.doesNotMatch(JSON.stringify({ archive, evidence }), /Ксюша|Принцесса|Максим|И я тебя люблю|календар|пятниц|2025/iu);
});
test('Координаты читают слова из настоящей записки в заданном порядке', () => {
  assert.deepEqual(bookCipher.pairs, [[5, 6], [3, 4], [2, 9], [1, 6]]);
  const decoded = bookCipher.pairs.map(([row, word]) => registryWords(registry.lines[row - 1])[word - 1].text.toLowerCase());
  assert.deepEqual(decoded, ['две', 'тысячи', 'двадцать', 'пять']);
  assert.deepEqual(registry.lines.flatMap(line => registryWords(line).map(item => item.text.toLowerCase())).filter(word => decoded.includes(word)), ['пять', 'двадцать', 'тысячи', 'две']);
});
test('Пунктуация не считается словом, предлоги считаются, переносы не меняют индексы', () => {
  assert.deepEqual(registryWords('В архиве: к делу, без адреса.').map(item => item.text), ['В','архиве','к','делу','без','адреса']);
  for (const line of registry.lines) {
    assert.deepEqual(registryWords(line).map(item => item.text), registryWords(line.replaceAll(' ', '\n')).map(item => item.text));
    for (const token of registryWords(line)) assert.equal(line.slice(token.start, token.end), token.text);
  }
});
test('Фильм сохраняет источник и интервал', () => {
  assert.equal(filmChallenge.title, 'До встречи с тобой');
  assert.equal(filmChallenge.time, '01:02:43–01:03:30');
});
test('Пользовательский текст и ответы ИИ экранируются', () => {
  assert.equal(escapeHtml('<img onerror="alert(1)">&\''), '&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.deepEqual(safeMessages([{role:'system',content:'private'},null,{role:'assistant',content:'<script>'},{role:'user',content:1}]), [{role:'assistant',content:'<script>'}]);
});
test('Пока сервер не ответил, этапы и открытия остаются неподтверждёнными', () => {
  const first = emptyState();
  for (const field of ['solved','film_solved','stamp_solved','year_solved','letter_opened','ai_configured']) assert.equal(first[field], false);
  assert.deepEqual(first.discoveries, {month:null,day:null,year:null,reading_method:null});
  first.evidence.push('registry');
  assert.deepEqual(emptyState().evidence, []);
  assert.equal(validMessage('   '), false);
  assert.equal(validMessage('x'.repeat(1501)), false);
  assert.equal(validMessage('Как прочитать эти пары?'), true);
  assert.equal(NOTES_KEY, 'tihorechye:notes:v1');
  assert.equal(UI_KEY, 'tihorechye:undated-letter:ui:v1');
});
test('Клиент не хранит личное письмо, ключи или готовую дату', async () => {
  const names = ['app.js','content.js','game.js','api.js','home.js','letter.js','envelope.js'];
  const sources = await Promise.all(names.map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  assert.doesNotMatch(sources.join('\n'), /Ксюша|Принцесса|И я тебя люблю|(?:MISTRAL|GROQ)_API_KEY|api\.(?:mistral\.ai|groq\.com)|10\.01\.2025|10012025/iu);
  assert.doesNotMatch(sources.join('\n'), /januaryCalendar|volumeShelf|calendarsPanel|selectedYear|saved\.year|пятниц/iu);
});

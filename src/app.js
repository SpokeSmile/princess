import { story, puzzles } from './content.js';
import { STORAGE_KEY, isCorrect, newGame, restoreGame } from './game.js';
import { springTo, fade, reveal, reorderWithMotion, bindInteractions } from './motion.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#info-dialog');
let state = newGame();
try { state = restoreGame(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { /* Прохождение работает и без хранилища. */ }
let selected = '';
let order = [];
let outcome = null;
let draft = '';
const arrow = '<span aria-hidden="true">↗</span>';
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const personalize = value => String(value).replaceAll('{reply}', story.familiarReply).replaceAll('{nickname}', story.nickname).replaceAll('{recipient}', story.recipient).replaceAll('{author}', story.author);
const multiline = value => escape(personalize(value)).replace(/\n/g, '<br>');
const glyph = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="m4 7 8 6 8-6M4 18l6-6m10 6-6-6" stroke="currentColor" stroke-width="1.3"/></svg>';

function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Необязательное сохранение. */ } }
function focusMain() { window.scrollTo({ top: 0, behavior: 'instant' }); main.focus({ preventScroll: true }); }
function changeView(view) { state.view = view; outcome = null; selected = ''; draft = ''; order = []; save(); render(); focusMain(); }
let dialogClosing = null;
function openDialog(content) {
  const surface = dialog.querySelector('.dialog-content');
  const wasClosing = Boolean(dialogClosing);
  const currentOpacity = Number(getComputedStyle(surface).opacity);
  if (dialogClosing) { dialogClosing.cancel(); dialogClosing = null; }
  document.querySelector('#dialog-body').innerHTML = content;
  const wasOpen = dialog.open;
  if (!wasOpen) dialog.showModal();
  springTo(surface, { y: 0, scale: 1 }, wasOpen ? {} : { from: { y: 14, scale: .98 } });
  if (!wasOpen || wasClosing) fade(surface, [{ opacity: wasOpen ? currentOpacity : 0 }, { opacity: 1 }]);
}
function closeDialog(immediate = false) {
  if (dialogClosing && !immediate) return;
  if (dialogClosing) { dialogClosing.cancel(); dialogClosing = null; }
  if (immediate || !dialog.open) { dialog.close(); return; }
  const surface = dialog.querySelector('.dialog-content');
  springTo(surface, { y: 10, scale: .985 });
  const closing = fade(surface, [{ opacity: 1 }, { opacity: 0 }], { duration: 130, fill: 'forwards' });
  if (!closing) { dialog.close(); return; }
  dialogClosing = closing;
  closing.addEventListener('finish', () => {
    if (dialogClosing !== closing) return;
    dialog.close(); closing.cancel(); dialogClosing = null;
  }, { once: true });
}

function envelopeArt() {
  return `<div class="art-frame"><div class="archive-art">
    <div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div>
    <span class="art-coordinate" aria-hidden="true">ХРАНИЛИЩЕ 01 / ПОЛКА 07</span>
    <div class="back-note" aria-hidden="true"><span class="tiny-label">ФРАГМЕНТ НЕИЗВЕСТНОГО ПИСЬМА</span><p>Некоторые вещи<br>проще зашифровать,<br><em>чем сказать вслух.</em></p><div class="handwritten">Кажется, это важно.</div><span class="note-lines"></span></div>
    <button type="button" class="hero-envelope" data-action="start" aria-label="Открыть дело: неподписанное письмо"><div class="envelope-fold"></div><div class="envelope-address"><span class="tiny-label">АДРЕСАТ</span><span class="address-line">Не установлен<span class="pencil-line"></span></span><span class="tiny-label envelope-sender">ОТПРАВИТЕЛЬ: НЕИЗВЕСТЕН</span></div><div class="postage-stamp"><span>БЮРО</span><svg viewBox="0 0 40 40"><path d="m20 5 3.8 10.7L35 20l-11.2 4.3L20 35l-3.8-10.7L5 20l11.2-4.3Z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="20" cy="20" r="4" fill="currentColor"/></svg><span>ПИСЕМ · 01</span></div><div class="postmark"><span>НЕПОДПИСАННОЕ</span><strong>014</strong><span>ОСОБОЕ ДЕЛО</span></div><span class="envelope-bottom">ОТКРЫТЬ ПРИ ОБНАРУЖЕНИИ АДРЕСАТА</span></button>
    <div class="case-tag" aria-hidden="true"><span>ДЕЛО № ${story.caseNumber}</span><span class="tag-line"></span><strong>ЛИЧНО В РУКИ</strong></div>
    <span class="art-caption" aria-hidden="true"><span class="caption-line"></span> Нажми на конверт. История ждёт.</span>
  </div></div>`;
}

function renderHome() {
  const continued = state.solved > 0;
  main.innerHTML = `<div class="home-view view-enter">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy"><div class="eyebrow"><span class="small-cross">✳</span> ИНТЕРАКТИВНОЕ РАССЛЕДОВАНИЕ <span class="edition">№ ${story.caseNumber}</span></div>
        <h1 id="hero-title">Письмо без<br><em>подписи.</em><span class="title-spark" aria-hidden="true">✳</span></h1>
        <p class="hero-description">В архиве найдено письмо без имени и адреса.<br class="desktop-break"> Четыре улики. Один отправитель.<br class="desktop-break"> И кое-что, что стоит прочитать до конца.</p>
        <div class="hero-actions"><button class="primary-button" data-action="start">${continued ? state.solved === puzzles.length ? 'Прочитать письмо' : 'Продолжить дело' : 'Открыть дело'} <span class="button-arrow" aria-hidden="true">↗</span></button><span class="time-note"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><path d="M10 6v4l3 2" stroke="currentColor"/></svg>15–20 минут<br><span>Никакой спешки</span></span></div>
        ${continued ? `<p class="resume-note">Дело сохранено: найдено ${state.solved} из ${puzzles.length} улик. <button class="text-button" data-action="restart">Начать заново</button></p>` : '<p class="hero-postscript">Понадобятся только любопытство и немного внимания.</p>'}
      </div>${envelopeArt()}
    </section>
    <section class="case-summary" aria-label="Об этом деле"><div class="summary-label"><span class="small-cross">✳</span><span>ВНУТРИ<br>ЭТОГО ДЕЛА</span></div><div class="summary-item"><span class="summary-number">01</span><div><h2>Скрытые смыслы</h2><p>Иногда ответ — между строк.</p></div></div><div class="summary-item"><span class="summary-number">02</span><div><h2>Знакомые совпадения</h2><p>Некоторые детали не случайны.</p></div></div><div class="summary-item"><span class="summary-number">03</span><div><h2>Неожиданная развязка</h2><p>У этой истории особый финал.</p></div></div></section>
    <div class="archivist-note"><span>ЗАПИСКА АРХИВАРИУСА</span><p>«Здесь нет таймера. Хорошие истории не любят, когда их торопят».</p><button class="text-link" data-action="how">Прежде чем начать ${arrow}</button></div>
  </div>`;
}

function renderDocument(document) {
  return `<div class="document-sheet"><div class="document-pin" aria-hidden="true"></div><span class="tiny-label">${escape(document.label)}</span><div class="document-text">${document.lines.map(line => `<p>${escape(line)}</p>`).join('')}</div><span class="document-footnote">${escape(document.footnote)}</span></div>`;
}

function renderPuzzleInput(puzzle) {
  if (puzzle.type === 'choice') return `<div class="envelope-options" role="group" aria-label="Выбери конверт">${puzzle.options.map(option => `<button type="button" class="envelope-option ${option.color} ${selected === option.id ? 'is-selected' : ''}" data-action="select" data-value="${option.id}" aria-pressed="${selected === option.id}"><span class="mini-envelope"><span class="mini-fold"></span><span class="mini-number">${option.number}</span><span class="choice-check" aria-hidden="true">✓</span></span><strong>${option.name}</strong><span class="envelope-claim">${option.note}</span></button>`).join('')}</div>`;
  if (puzzle.type === 'order') {
    if (!order.length) order = puzzle.fragments.map(fragment => fragment.id);
    return `<p class="order-instruction">Меняй фрагменты местами стрелками справа.</p><ol class="fragment-list">${order.map((id, index) => { const fragment = puzzle.fragments.find(item => item.id === id); return `<li class="fragment" data-fragment="${id}"><span class="fragment-index">0${index + 1}</span><p>${escape(fragment.text)}</p><div class="fragment-controls"><button type="button" class="move-button" data-action="move" data-id="${id}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Переместить фрагмент ${index + 1} вверх">↑</button><button type="button" class="move-button" data-action="move" data-id="${id}" data-direction="1" ${index === order.length - 1 ? 'disabled' : ''} aria-label="Переместить фрагмент ${index + 1} вниз">↓</button></div></li>`; }).join('')}</ol><div id="order-announcement" class="sr-only" role="status"></div>`;
  }
  return `${renderDocument(puzzle.document)}<label class="answer-label" for="answer">${escape(puzzle.question)}</label><div class="answer-input-wrap"><input id="answer" name="answer" value="${escape(draft)}" type="text" placeholder="${escape(puzzle.placeholder)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="100" aria-describedby="form-error" /><span aria-hidden="true">↵</span></div>`;
}

function renderEvidenceSidebar(index) {
  return `<aside class="case-sidebar" aria-label="Найденные материалы"><div class="folder-heading">${glyph}<span>ПАПКА ДЕЛА</span><span class="folder-count">${state.solved} / ${puzzles.length}</span></div><div class="case-file"><span class="tiny-label">ДЕЛО № ${story.caseNumber}</span><h3>Неподписанное<br>письмо</h3><div class="case-file-line"><span>Статус</span><span class="status-badge">${state.solved === puzzles.length ? 'Раскрыто' : 'Расследуется'}</span></div><div class="case-file-line"><span>Адресат</span><span>${state.solved === puzzles.length ? escape(story.nickname) : 'Не установлен'}</span></div></div><div class="evidence-heading">МАТЕРИАЛЫ РАССЛЕДОВАНИЯ</div><ol class="evidence-list">${puzzles.map((puzzle, itemIndex) => `<li class="${itemIndex < state.solved ? 'is-found' : itemIndex === index ? 'is-current' : ''}">${itemIndex < state.solved ? `<button data-action="evidence" data-index="${itemIndex}"><span class="evidence-icon">✓</span><span>${escape(puzzle.evidence)}<small>Открыть находку</small></span><span class="evidence-arrow" aria-hidden="true">↗</span></button>` : `<div><span class="evidence-icon">${itemIndex === index ? '·' : '⌑'}</span><span>${itemIndex === index ? escape(puzzle.label) : 'Улика ещё не найдена'}<small>${itemIndex === index ? 'Сейчас в работе' : 'Появится по ходу дела'}</small></span></div>`}</li>`).join('')}</ol><div class="sidebar-note"><span class="note-asterisk">✳</span><p>Важные детали остаются здесь.<br>К ним всегда можно вернуться.</p></div></aside>`;
}

function renderGame() {
  const index = outcome ? outcome.index : state.solved;
  if (index >= puzzles.length) { state.view = 'finale'; save(); renderFinale(); return; }
  const puzzle = puzzles[index];
  const hintCount = state.hints[index];
  main.innerHTML = `<section class="investigation view-enter" aria-labelledby="puzzle-title"><div class="case-topbar"><button class="back-link" data-action="home"><span aria-hidden="true">←</span> В архив</button><span>ДЕЛО № ${story.caseNumber}<span class="topbar-separator">/</span>НЕПОДПИСАННОЕ ПИСЬМО</span><button class="text-link" data-action="notebook">Мои находки <span>${state.solved}</span></button></div><div class="investigation-grid"><div class="puzzle-column"><div class="step-progress" aria-label="Улика ${index + 1} из ${puzzles.length}">${puzzles.map((item, itemIndex) => `<span class="step ${itemIndex < state.solved ? 'complete' : ''} ${itemIndex === index ? 'active' : ''}"><span class="step-dot">${itemIndex < state.solved ? '✓' : `0${itemIndex + 1}`}</span><span class="step-label">${item.label}</span></span>`).join('')}</div><div class="puzzle-heading"><div class="eyebrow">УЛИКА 0${index + 1}<span class="eyebrow-rule"></span>${puzzle.category}</div><h1 id="puzzle-title">${multiline(puzzle.title)}</h1><p>${escape(puzzle.intro)}</p></div>
      ${outcome ? `<div class="discovery" role="status"><div class="discovery-seal" aria-hidden="true">✓</div><span class="tiny-label">${outcome.skipped ? 'МАТЕРИАЛ ДОБАВЛЕН В ДЕЛО' : 'УЛИКА НАЙДЕНА'}</span><h2>${puzzle.successTitle}</h2><p>${puzzle.success}</p>${outcome.skipped ? `<p class="solution-note">${escape(puzzle.hints[2])}</p>` : ''}<button class="primary-button" data-action="next">${index === puzzles.length - 1 ? 'Открыть письмо' : 'К следующей улике'}<span class="button-arrow" aria-hidden="true">↗</span></button></div>` : `<form id="puzzle-form" novalidate>${puzzle.type === 'text' ? '' : `<h2 class="puzzle-question">${escape(puzzle.question)}</h2>`}${renderPuzzleInput(puzzle)}<p class="form-error" id="form-error" role="alert" hidden></p><div class="puzzle-form-actions"><button class="primary-button" type="submit">Проверить ответ<span class="button-arrow" aria-hidden="true">↗</span></button><span class="attempts-note">Попытки не ограничены</span></div></form><div class="hint-area"><button class="hint-toggle" data-action="hint" ${hintCount === 3 ? 'disabled' : ''}><span class="hint-bulb" aria-hidden="true">✧</span> ${hintCount === 0 ? 'Нужна маленькая подсказка?' : hintCount < 3 ? 'Ещё одна подсказка' : 'Все подсказки открыты'}<span class="hint-counter">${hintCount} / 3</span></button><div class="hint-content" aria-live="polite">${puzzle.hints.slice(0, hintCount).map((hint, hintIndex) => `<p><span>0${hintIndex + 1}</span>${escape(hint)}</p>`).join('')}</div>${hintCount === 3 ? '<button class="text-link skip-button" data-action="skip">Открыть ответ и продолжить ↗</button>' : ''}</div>`}
      </div>${renderEvidenceSidebar(index)}</div></section>`;
}

function renderFinale() {
  document.title = 'Для тебя — Бюро писем';
  main.innerHTML = `<section class="finale view-enter" aria-labelledby="finale-title"><div class="finale-topline"><span class="eyebrow"><span class="small-cross">✳</span> ДЕЛО № ${story.caseNumber} РАСКРЫТО</span><button class="text-link" data-action="notebook">Все находки ${arrow}</button></div><div class="finale-intro"><span class="finale-pretitle">Никаких совпадений.</span><h1 id="finale-title">Это всё время<br>было <em>для тебя.</em></h1><p>Адресат: ${escape(story.recipient)}. Отправитель: ${escape(story.author)}.</p><span class="finale-star" aria-hidden="true">✳</span></div><article class="personal-letter"><div class="letter-top"><span class="tiny-label">ЛИЧНОЕ. ВАЖНОЕ. ТВОЁ.</span><span class="letter-date">Письмо № 001</span></div><h2>${escape(story.recipient)}, да, это всё я.</h2>${story.letter.map(paragraph => `<p>${escape(personalize(paragraph))}</p>`).join('')}<p class="letter-closing">${escape(story.familiarReply)},<br><em>моя ${escape(story.nickname)}.</em></p><div class="letter-signature"><span>Твой ${escape(story.author)}</span><span class="drawn-heart" aria-hidden="true">♡</span></div></article><div class="invitation"><div class="invitation-copy"><span class="eyebrow">ПРИГЛАШЕНИЕ ДЛЯ ДВОИХ</span><h2>${multiline(story.invitation.title)}</h2><p>${escape(story.invitation.description)}</p></div><div class="invitation-ticket"><div class="ticket-header">БИЛЕТ В НАШУ СЛЕДУЮЩУЮ ИСТОРИЮ <span aria-hidden="true">↗</span></div><div class="ticket-row"><span>КОГДА</span><strong>${escape(story.invitation.when)}</strong></div><div class="ticket-row"><span>ГДЕ</span><strong>${escape(story.invitation.where)}</strong></div><div class="ticket-row"><span>С СОБОЙ</span><strong>${escape(story.invitation.bring)}</strong></div><div class="ticket-bottom">${state.accepted ? `<div class="accepted-note" role="status"><span aria-hidden="true">♡</span><p>${escape(personalize(story.invitation.accepted))}</p></div>` : '<button class="primary-button" data-action="accept">Пойдём гулять<span class="button-arrow" aria-hidden="true">♡</span></button>'}</div></div></div><div class="finale-postscript"><span aria-hidden="true">✳</span><p>Некоторые истории начинаются с загадки.<br>А продолжаются — с тебя.</p><button class="text-link" data-action="home">Вернуться в бюро ↗</button></div></section>`;
}

function render() {
  document.title = 'Бюро писем — Неподписанное письмо';
  if (state.view === 'finale') renderFinale();
  else if (state.view === 'game') renderGame();
  else renderHome();
  reveal(main.firstElementChild);
}

function completePuzzle(skipped = false) {
  const index = state.solved;
  if (index >= puzzles.length || outcome) return;
  if (skipped) state.skipped.push(index);
  state.solved = index + 1;
  outcome = { index, skipped };
  selected = ''; draft = ''; order = [];
  save(); renderGame(); reveal(document.querySelector('.discovery')); focusMain();
}

function notebookContent(index) {
  const items = index === undefined ? puzzles.slice(0, state.solved) : [puzzles[index]];
  return `<span class="eyebrow">ДЕЛО № ${story.caseNumber}</span><h2 id="dialog-title">${index === undefined ? 'Найденные материалы' : escape(puzzles[index].evidence)}</h2>${items.length ? items.map(puzzle => `<div class="notebook-item"><span class="tiny-label">УЛИКА 0${puzzles.indexOf(puzzle) + 1}</span>${index === undefined ? `<h3>${escape(puzzle.evidence)}</h3>` : ''}<p>${escape(puzzle.evidenceDetail)}</p><p class="notebook-explanation">${escape(puzzle.success)}</p>${puzzle.type === 'order' ? `<blockquote>${puzzle.answer.map(id => escape(puzzle.fragments.find(item => item.id === id).text)).join('<br>')}</blockquote>` : ''}</div>`).join('') : '<p>Папка пока пуста. Открой первую улику — и здесь появятся важные детали.</p>'}`;
}

function showError(message) { const error = document.querySelector('#form-error'); error.hidden = false; error.textContent = message; if (document.querySelector('#answer')) document.querySelector('#answer').setAttribute('aria-invalid', 'true'); }

document.addEventListener('submit', event => {
  if (event.target.id !== 'puzzle-form') return;
  event.preventDefault();
  const puzzle = puzzles[state.solved];
  const value = puzzle.type === 'choice' ? selected : puzzle.type === 'order' ? order : new FormData(event.target).get('answer');
  if (puzzle.type === 'choice' && !value) { showError('Сначала выбери один из конвертов.'); return; }
  if (puzzle.type === 'text' && !String(value).trim()) { showError('Введи свою версию. Здесь можно пробовать сколько угодно.'); document.querySelector('#answer').focus(); return; }
  if (isCorrect(puzzle, value)) completePuzzle();
  else showError(puzzle.type === 'order' ? 'Мысль пока не складывается. Попробуй поменять фрагменты местами.' : 'Пока не сходится. Попробуй ещё раз или открой подсказку.');
});

document.addEventListener('input', event => { if (event.target.id === 'answer') { draft = event.target.value; event.target.removeAttribute('aria-invalid'); const error = document.querySelector('#form-error'); error.hidden = true; } });

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'home') { event.preventDefault(); changeView('home'); }
  if (action === 'start') changeView(state.solved === puzzles.length ? 'finale' : 'game');
  if (action === 'next') changeView(state.solved === puzzles.length ? 'finale' : 'game');
  if (action === 'select') {
    selected = target.dataset.value;
    document.querySelectorAll('.envelope-option').forEach(option => { const active = option.dataset.value === selected; option.classList.toggle('is-selected', active); option.setAttribute('aria-pressed', String(active)); });
    document.querySelector('#form-error').hidden = true;
  }
  if (action === 'move') {
    const oldIndex = order.indexOf(target.dataset.id);
    const newIndex = oldIndex + Number(target.dataset.direction);
    if (newIndex < 0 || newIndex >= order.length) return;
    [order[oldIndex], order[newIndex]] = [order[newIndex], order[oldIndex]];
    const list = document.querySelector('.fragment-list');
    reorderWithMotion(list, () => {
      for (const id of order) list.append(list.querySelector(`[data-fragment="${id}"]`));
      [...list.children].forEach((fragment, index) => {
        fragment.querySelector('.fragment-index').textContent = `0${index + 1}`;
        for (const button of fragment.querySelectorAll('.move-button')) {
          const direction = Number(button.dataset.direction);
          button.disabled = direction === -1 ? index === 0 : index === order.length - 1;
          button.setAttribute('aria-label', `Переместить фрагмент ${index + 1} ${direction === -1 ? 'вверх' : 'вниз'}`);
        }
      });
    });
    const controls = [...target.closest('.fragment-controls').querySelectorAll('.move-button')];
    (target.disabled ? controls.find(button => !button.disabled) : target)?.focus({ preventScroll: true });
    document.querySelector('#form-error').hidden = true;
    document.querySelector('#order-announcement').textContent = `Фрагмент перемещён на позицию ${newIndex + 1}.`;
  }
  if (action === 'hint') {
    if (state.hints[state.solved] >= 3) return;
    state.hints[state.solved]++;
    save();
    const count = state.hints[state.solved];
    const hint = document.createElement('p');
    const number = document.createElement('span');
    number.textContent = `0${count}`;
    hint.append(number, document.createTextNode(puzzles[state.solved].hints[count - 1]));
    document.querySelector('.hint-content').append(hint);
    reveal(hint, 6);
    target.innerHTML = `<span class="hint-bulb" aria-hidden="true">✧</span> ${count < 3 ? 'Ещё одна подсказка' : 'Все подсказки открыты'}<span class="hint-counter">${count} / 3</span>`;
    if (count === 3) {
      target.disabled = true;
      const skip = document.createElement('button');
      skip.className = 'text-link skip-button';
      skip.dataset.action = 'skip';
      skip.textContent = 'Открыть ответ и продолжить ↗';
      document.querySelector('.hint-area').append(skip);
      skip.focus({ preventScroll: true });
    }
  }
  if (action === 'skip') completePuzzle(true);
  if (action === 'evidence') openDialog(notebookContent(Number(target.dataset.index)));
  if (action === 'notebook') openDialog(notebookContent());
  if (action === 'close-dialog') closeDialog();
  if (action === 'how') openDialog(`<span class="eyebrow">КОРОТКОЕ НАПУТСТВИЕ</span><h2 id="dialog-title">Смотри внимательнее.<br>Доверяй любопытству.</h2><ol class="how-list"><li><span>01</span><div><h3>Иди по следам</h3><p>Четыре загадки откроют четыре части истории. Читай документы и проверяй свои версии.</p></div></li><li><span>02</span><div><h3>Не бойся ошибаться</h3><p>Таймера нет. Попытки не заканчиваются. У каждой загадки есть три подсказки, а после них можно открыть ответ.</p></div></li><li><span>03</span><div><h3>Сохраняй находки</h3><p>Всё важное останется в папке дела. Прогресс сохраняется в этом браузере, если в нём разрешено хранение данных.</p></div></li></ol><button class="primary-button dialog-start" data-action="begin-from-dialog">${state.solved ? 'Продолжить расследование' : 'Открыть дело'}<span class="button-arrow" aria-hidden="true">↗</span></button>`);
  if (action === 'about') openDialog('<span class="eyebrow">БЮРО ПИСЕМ</span><h2 id="dialog-title">У каждого письма<br>есть своя история.</h2><p>Бюро писем — маленький интерактивный мир, где истории открываются через загадки, найденные записки и внимание к деталям.</p><p>Сейчас в архиве одно особое дело: письмо без подписи. Его история ждёт того, кто захочет прочитать до конца.</p><p class="dialog-caption">Для прохождения не нужны регистрация, специальные знания или идеальные ответы.</p>');
  if (action === 'begin-from-dialog') { closeDialog(true); changeView(state.solved === puzzles.length ? 'finale' : 'game'); }
  if (action === 'restart') openDialog('<span class="eyebrow">НАЧАТЬ С ЧИСТОГО ЛИСТА</span><h2 id="dialog-title">Открыть дело заново?</h2><p>Найденные улики и сохранённый прогресс в этом браузере будут сброшены.</p><div class="dialog-actions"><button class="primary-button" data-action="confirm-restart">Начать заново<span class="button-arrow" aria-hidden="true">↗</span></button><button class="text-link" data-action="close-dialog">Оставить как есть</button></div>');
  if (action === 'confirm-restart') { state = newGame(); closeDialog(true); changeView('game'); }
  if (action === 'accept') { const scrollPosition = window.scrollY; state.accepted = true; save(); renderFinale(); window.scrollTo(0, scrollPosition); document.querySelector('.accepted-note').setAttribute('tabindex', '-1'); document.querySelector('.accepted-note').focus({ preventScroll: true }); }
});

dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(); } });
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
bindInteractions();
render();

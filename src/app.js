import { archive, evidence, cases, filmChallenge } from './content.js';
import { emptyState, escapeHtml as esc, safeMessages, validMessage, NOTES_KEY } from './game.js';
import { request } from './api.js';
import { reveal, springTo, fade, bindInteractions } from './motion.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#info-dialog');
let state = emptyState();
let serverAvailable = false;
let view = 'home';
let activeTab = 'letter';
let chatDraft = '';
let sending = false;
let chatError = '';
let starting = false;
let syncPromise = null;
let filmError = '';
let checkingFilm = false;
let checkingGuess = false;
let resetting = false;
let generation = 0;
let toastTimer;
let closeAnimation;
let lastDialogTrigger = null;
const icons = {
  letter: '<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3"/>',
  envelope: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="m4 7 8 6 8-6"/>',
  registry: '<path d="M5 3h14v18H5zM9 3v18M5 8h14M5 13h14M5 18h14"/>',
  recording: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="3"/><circle cx="16" cy="11" r="3"/><path d="m7 19 2-4h6l2 4"/>',
  signal: '<path d="M4 10a11 11 0 0 1 16 0M7 13a7 7 0 0 1 10 0M10 16a3 3 0 0 1 4 0"/><circle cx="12" cy="20" r="1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">${icons[name] || icons.letter}</svg>`;
const found = id => state.evidence.includes(id);
function focusMain() { window.scrollTo({ top: 0, behavior: 'instant' }); main.focus({ preventScroll: true }); }
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}
function applyState(next, expectedGeneration = generation) {
  if (expectedGeneration !== generation) return;
  if (!next || next.case_id !== archive.caseId) return;
  const previous = state;
  const messages = safeMessages(next.messages);
  state = { ...emptyState(), ...next, messages: messages.length >= previous.messages.length ? messages : previous.messages, evidence: [...new Set([...previous.evidence, ...(Array.isArray(next.evidence) ? next.evidence.filter(id => evidence.some(item => item.id === id)) : [])])], solved: previous.solved || Boolean(next.solved), film_unlocked: previous.film_unlocked || Boolean(next.film_unlocked), film_solved: previous.film_solved || Boolean(next.film_solved) };
}
async function syncState() {
  if (syncPromise) return syncPromise;
  const currentGeneration = generation;
  syncPromise = (async () => {
    try { applyState(await request('/api/game/'), currentGeneration); serverAvailable = true; }
    catch { serverAvailable = false; }
  })();
  try { await syncPromise; } finally { syncPromise = null; }
}
function setView(next) { view = next; document.body.classList.toggle('in-case', next === 'game'); render(); focusMain(); }
function showDialog(html) {
  if (closeAnimation) { closeAnimation.cancel(); closeAnimation = null; }
  lastDialogTrigger = document.activeElement;
  document.querySelector('#dialog-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  const surface = dialog.querySelector('.dialog-surface');
  springTo(surface, { y: 0, scale: 1 }, { from: { y: 10, scale: .99 } });
  fade(surface, [{ opacity: 0 }, { opacity: 1 }]);
}
function closeDialog(immediate = false) {
  if (closeAnimation && !immediate) return;
  if (closeAnimation) { closeAnimation.cancel(); closeAnimation = null; }
  if (immediate) { dialog.close(); return; }
  const surface = dialog.querySelector('.dialog-surface');
  const animation = fade(surface, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
  if (!animation) { dialog.close(); return; }
  closeAnimation = animation;
  animation.addEventListener('finish', () => {
    if (closeAnimation !== animation) return;
    dialog.close(); closeAnimation = null;
    if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus({ preventScroll: true });
  }, { once: true });
}

function paperMarkup(item, full = false) {
  return `<article class="paper-sheet ${full ? 'paper-full' : ''}"><div class="paper-meta"><span>АРХИВ № ${archive.caseNumber} / ЛИСТ ${item.number}</span><span>31·10·1996</span></div><h2>${esc(item.id === 'letter' ? 'Сотруднику ночной смены' : item.title)}</h2><div class="paper-copy">${item.lines.map(line => `<p>${esc(line)}</p>`).join('')}</div>${item.code ? `<div class="number-code">${esc(item.code)}</div>` : ''}<div class="paper-end"><p>${esc(item.footer)}</p><span class="paper-stamp" aria-hidden="true">АРХИВ<br>1996</span></div></article>`;
}

function renderHome() {
  const hasProgress = state.evidence.length > 0;
  main.innerHTML = `<div class="landing view-enter">
    <section class="hero" aria-labelledby="hero-title"><div class="hero-backdrop" aria-hidden="true"></div><div class="hero-grain" aria-hidden="true"></div><div class="hero-content"><div class="eyebrow"><span class="red-rule"></span> ГОРОД, КОТОРЫЙ НЕ ВСЁ РАССКАЗАЛ</div><h1 id="hero-title">ТИХОРЕЧЬЕ</h1><div class="year-stamp" aria-label="1996 год">1996</div><p class="hero-genre">МИСТИЧЕСКИЕ РАССЛЕДОВАНИЯ ОНЛАЙН</p><p class="hero-description">В ночном архиве находят письмо, которого нет в описи.<br>Обратный адрес стёрт. Но на старом канале связи<br class="desktop-only"> кто-то всё ещё ждёт ответа.</p><div class="hero-actions"><button class="primary-button" data-action="start">${state.solved ? 'Вернуться к делу' : hasProgress ? 'Продолжить расследование' : 'Начать бесплатное дело'}<span aria-hidden="true">↗</span></button><a href="#cases" class="secondary-button" data-action="section" data-target="cases">Другие расследования <span aria-hidden="true">↓</span></a></div><p class="hero-footnote">Без регистрации · Играйте в своём темпе · Задавайте свои вопросы</p></div><span class="hero-coordinate" aria-hidden="true">58° 17′ С. Ш. / АРХИВ ЗАПИСЬ № 017</span><div class="hero-bottom"><span><i class="signal-dot"></i> НОЧНАЯ СМЕНА</span><span>31 ОКТЯБРЯ 1996</span><a href="#cases" data-action="section" data-target="cases" aria-label="Перейти к расследованиям">↓</a></div></section>
    <section class="cases-section section-wrap" id="cases" aria-labelledby="cases-title"><div class="section-heading"><div><div class="eyebrow">МАТЕРИАЛЫ АРХИВА</div><h2 id="cases-title">У каждого дела<br><em>есть незакрытая строка.</em></h2></div><p>Изучайте документы. Замечайте несовпадения.<br>Спрашивайте тех, кто ещё отвечает.</p></div>
      <article class="featured-case"><div class="featured-art" aria-hidden="true"><div class="case-photo"><span>СОРТИРОВОЧНОЕ ОТДЕЛЕНИЕ · 02:17</span></div><div class="prop-letter"><span>НОЧНАЯ ОПИСЬ</span><p>В журнале нет имени.<br>В конверте нет адреса.</p><b>017</b></div><div class="prop-envelope"><span>КОМУ: НОЧНОЙ СМЕНЕ</span><div class="prop-lines"></div><span class="prop-seal">ПРИНЯТО<br>02:17</span></div></div><div class="featured-copy"><div class="case-kicker"><span class="free-label">БЕСПЛАТНОЕ ДЕЛО</span><span>№ 017</span></div><h3>Письмо без<br>обратного адреса</h3><p>Почтовое отделение закрылось в десять. В два семнадцать в пустом архиве появилось письмо. Имени отправителя нет, но голос на старом канале узнаёт каждую строчку.</p><div class="case-tags"><span>1 игрок</span><span>Документы и шифры</span><span>Разговор с ИИ</span></div><button class="primary-button" data-action="start">Открыть дело <span aria-hidden="true">↗</span></button></div></article>
      <div class="case-grid">${cases.map(item => `<button class="case-card ${item.art}" data-action="paid" data-case="${item.id}" aria-label="Открыть дело «${item.title}», ${item.price}"><span class="case-cover"><span class="cover-number">${item.cover}</span><span class="cover-caption">${item.tag}</span><span class="cover-index">ДЕЛО № ${item.number}</span></span><span class="case-card-body"><span class="case-card-meta"><span>${item.time}</span><span>${item.price}</span></span><strong>${item.title}</strong><span class="case-card-description">${item.description}</span><span class="case-card-action">Изучить дело <span aria-hidden="true">↗</span></span></span></button>`).join('')}</div>
    </section>
    <section class="how-section section-wrap" id="how" aria-labelledby="how-title"><div class="eyebrow">ПАМЯТКА НОЧНОЙ СМЕНЫ</div><h2 id="how-title">Правда не появится сама.</h2><div class="how-grid"><article><span class="how-number">01</span><h3>Откройте архив</h3><p>Прочтите письмо, осмотрите конверт и записи. Каждый документ может оказаться важным.</p></article><article><span class="how-number">02</span><h3>Выйдите на связь</h3><p>Задавайте неизвестному свои вопросы. Он знает больше, чем написано в журнале.</p></article><article><span class="how-number">03</span><h3>Назовите отправителя</h3><p>Сопоставьте найденные следы. Когда появится версия — внесите имя или позывной в дело.</p></article></div></section>
    <section class="archive-note section-wrap"><div class="note-symbol" aria-hidden="true">✳</div><div><div class="eyebrow">ПЕРЕД ТЕМ КАК НАЧАТЬ</div><h2>Здесь можно ошибаться.<br>Главное — продолжать замечать.</h2><p>Попытки не заканчиваются. Документы остаются в папке дела.<br>Расследование сохраняется в этом браузере.</p></div><button class="text-link" data-action="rules">Открыть памятку <span aria-hidden="true">↗</span></button></section>
  </div>`;
}

function renderSidebar() {
  return `<aside class="case-sidebar"><div class="sidebar-label">${icon('registry')}<span>ПАПКА ДЕЛА № 017</span></div><div class="case-sidebar-title">Неизвестный<br> отправитель</div><div class="sidebar-status"><i class="signal-dot"></i>${state.solved ? 'Личность установлена' : 'Личность не установлена'}</div><div class="sidebar-divider"></div><div class="sidebar-subheading">СОБРАННЫЕ МАТЕРИАЛЫ <span>${state.evidence.length}/4</span></div><div class="sidebar-files">${evidence.map(item => `<button class="file-button ${found(item.id) ? 'is-found' : ''}" data-action="evidence" data-id="${item.id}">${icon(item.icon)}<span>${item.title}<small>${found(item.id) ? 'В папке дела' : 'Нажмите, чтобы изучить'}</small></span><span class="file-check" aria-hidden="true">${found(item.id) ? '✓' : '+'}</span></button>`).join('')}</div>${state.film_unlocked && !state.film_solved ? '<div class="film-signal"><span>На линии новый фрагмент.</span><button data-action="tab" data-tab="chat">Открыть связь ↗</button></div>' : ''}<button class="notebook-button" data-action="notes">✎ Мой блокнот <span aria-hidden="true">↗</span></button><p class="sidebar-note">«Если записи не сходятся,<br>начните с того, что осталось».</p></aside>`;
}

function filmMarkup() {
  if (state.film_solved) return '<p class="film-complete">✓ Фрагмент проверен. Можно сопоставлять остальные следы.</p>';
  if (!state.film_unlocked) return '';
  return `<section class="film-clue" aria-labelledby="film-title"><div class="eyebrow">НОВЫЙ СЛЕД / ФРАГМЕНТ ВНЕ АРХИВА</div><h3 id="film-title">${esc(filmChallenge.title)}</h3><p>Откройте фильм и посмотрите этот фрагмент.</p><span class="film-time">${filmChallenge.time}</span><p>${esc(filmChallenge.question)}</p><form id="film-form"><label class="sr-only" for="film-input">Название предмета из фильма</label><input id="film-input" name="answer" type="text" maxlength="120" autocomplete="off" placeholder="Что было в коробке?" ${checkingFilm ? 'disabled' : ''}><button class="primary-button" type="submit" ${checkingFilm ? 'disabled' : ''}>${checkingFilm ? 'Проверка…' : 'Проверить'} <span aria-hidden="true">↗</span></button></form><p id="film-error" class="inline-error" role="alert" ${filmError ? '' : 'hidden'}>${esc(filmError)}</p></section>`;
}

function renderChat() {
  return `<div class="conversation"><div class="contact-heading"><span class="unknown-avatar" aria-hidden="true">?</span><div><span class="small-label">КАНАЛ № 17 / УДАЛЁННАЯ ЛИНИЯ</span><h2>Неизвестный отправитель</h2></div><span class="contact-status"><i class="signal-dot ${state.ai_configured ? '' : 'muted-dot'}"></i>${state.ai_configured ? 'Канал доступен' : 'Канал не настроен'}</span></div>${!state.ai_configured ? '<div class="connection-notice">Свободные вопросы пока недоступны: не подключён ключ Mistral. Материалы дела и проверка ответов работают.</div>' : ''}${filmMarkup()}<div class="transcript" id="transcript" role="log" aria-label="Переписка с отправителем" aria-live="polite">${state.messages.map(message => `<article class="chat-message ${message.role}"><span class="message-author">${message.role === 'user' ? 'ВАШЕ СООБЩЕНИЕ' : message.source === 'script' ? 'НЕИЗВЕСТНЫЙ · СОХРАНЁННАЯ ЗАПИСЬ' : message.source === 'mistral' ? 'НЕИЗВЕСТНЫЙ · ИИ' : 'НЕИЗВЕСТНЫЙ'}</span><p>${esc(message.content)}</p></article>`).join('')}</div><div class="chat-suggestions" aria-label="Варианты вопросов"><button data-action="suggest" data-message="Почему на письме нет обратного адреса?">Почему нет адреса?</button><button data-action="suggest" data-message="Что можно понять из отметок на конверте?">Что значат отметки?</button><button data-action="suggest" data-message="С какого документа стоит начать?">С чего начать?</button></div><form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">Ваш вопрос отправителю</label><textarea id="chat-input" name="message" rows="2" maxlength="1500" placeholder="Ваш вопрос неизвестному…" ${sending ? 'readonly' : ''}>${esc(chatDraft)}</textarea><button class="primary-button" type="submit" ${sending ? 'disabled' : ''}>${sending ? 'Передача…' : 'Спросить'}<span aria-hidden="true">↗</span></button></form><p id="chat-error" class="inline-error" role="alert" ${chatError ? '' : 'hidden'}>${esc(chatError)}</p><div class="chat-help"><span>${sending ? 'Запрос отправлен. Ждём ответ.' : 'Ваши вопросы остаются в материалах дела.'}</span><span>Ctrl / ⌘ + Enter</span></div></div>`;
}

function renderGamePanel() {
  if (state.solved) return `<section class="case-resolution" aria-labelledby="resolution-title"><div class="resolution-stamp" aria-hidden="true">ЛИЧНОСТЬ<br>УСТАНОВЛЕНА</div><div class="eyebrow">ДЕЛО № 017 / СТАТУС ОБНОВЛЁН</div><h2 id="resolution-title">Версия подтверждена.</h2><p>Личность отправителя установлена.<br>Дело закрыто.</p><span class="resolution-line"></span></section>`;
  if (activeTab === 'letter') return `<div class="letter-panel"><div class="panel-heading"><span class="eyebrow">МАТЕРИАЛ № 01 / ВХОДЯЩЕЕ ПИСЬМО</span><span class="small-label">02:17</span></div>${paperMarkup(evidence[0])}<div class="panel-bottom"><p>Автор не оставил подписи.<br>Осмотрите остальные материалы или попробуйте выйти на связь.</p><button class="primary-button" data-action="tab" data-tab="chat">Связаться с отправителем <span aria-hidden="true">↗</span></button></div></div>`;
  if (activeTab === 'evidence') return `<div class="evidence-panel"><div class="eyebrow">ЧЕТЫРЕ СЛЕДА ОДНОГО ДЕЛА</div><h2>Всё, что осталось.</h2><p class="panel-description">Откройте документы. Иногда запись на полях важнее основного текста.</p><div class="evidence-grid">${evidence.map(item => `<button class="evidence-card ${found(item.id) ? 'is-found' : ''}" data-action="evidence" data-id="${item.id}"><span class="evidence-top">${icon(item.icon)}<span>МАТЕРИАЛ ${item.number}</span><b>${found(item.id) ? '✓' : '↗'}</b></span><span class="small-label">${item.kind}</span><strong>${item.title}</strong><span>${item.short}</span><small>${found(item.id) ? 'Изучен · открыть снова' : 'Открыть материал'}</small></button>`).join('')}</div></div>`;
  if (activeTab === 'chat') return renderChat();
  if (!state.film_solved) return `<section class="guess-panel"><div class="eyebrow">ДЕЛО № 017 / НЕДОСТАЮЩИЙ ФРАГМЕНТ</div><h2 style="margin-top:28px">В деле остался ещё один вопрос.</h2>${state.film_unlocked ? filmMarkup() : '<p>Изучите письмо и хотя бы ещё один материал. Неизвестный оставил на линии следующий след.</p><button class="primary-button" data-action="tab" data-tab="evidence" style="margin-top:25px">Изучить материалы ↗</button>'}<p class="guess-note">После проверки фрагмента можно будет внести версию об отправителе.</p></section>`;
  return `<section class="guess-panel" aria-labelledby="guess-title"><div class="eyebrow">ЗАКЛЮЧЕНИЕ ПО ДЕЛУ № 017</div><div class="identity-mark" aria-hidden="true">?</div><h2 id="guess-title">Кто на другом конце?</h2><p>Имя или служебный позывной скрыты в материалах дела.<br>Когда появится версия, внесите её в графу ниже.</p><form id="guess-form"><label for="guess-input">ОТПРАВИТЕЛЬ</label><input id="guess-input" name="answer" type="text" autocomplete="off" spellcheck="false" maxlength="100" placeholder="Имя или позывной"><button class="primary-button" type="submit">Проверить версию <span aria-hidden="true">↗</span></button><p id="guess-error" class="inline-error" role="alert" hidden></p></form><p class="guess-note">Можно пробовать снова. Неподтверждённая версия не закрывает расследование.</p></section>`;
}

function renderGame() {
  main.innerHTML = `<section class="investigation view-enter" aria-labelledby="case-title"><div class="case-topbar"><button class="back-link" data-action="home">← В архив</button><span class="small-label">31 ОКТЯБРЯ 1996 · НОЧНАЯ СМЕНА</span><span class="save-status">${serverAvailable ? '✓ Дело сохранено' : 'Чтение без связи'}</span></div><div class="case-title-row"><div><div class="eyebrow">РАССЛЕДОВАНИЕ № 017</div><h1 id="case-title">${archive.title}</h1></div><button class="round-button" data-action="rules" aria-label="Как вести расследование">?</button></div><div class="case-layout"><div class="work-panel">${state.solved ? '' : `<nav class="case-tabs" aria-label="Разделы расследования">${[['letter', 'Письмо'], ['evidence', 'Материалы'], ['chat', 'Связь'], ['guess', 'Версия']].map(([id, label]) => `<button class="tab-button ${activeTab === id ? 'is-active' : ''}" data-action="tab" data-tab="${id}" aria-current="${activeTab === id ? 'page' : 'false'}">${label}${id === 'evidence' ? `<span>${state.evidence.length}</span>` : ''}${id === 'chat' ? '<i class="signal-dot"></i>' : ''}</button>`).join('')}</nav>`}<div class="active-panel" id="active-panel">${renderGamePanel()}</div></div>${renderSidebar()}</div><div class="case-footer"><span>АРХИВ ТИХОРЕЧЬЯ · ЛИЧНОЕ ДЕЛО № 017</span><button class="text-link" data-action="reset">Начать расследование заново</button></div></section>`;
}
function render() { document.title = view === 'game' ? 'Дело № 017 — Тихоречье, 1996' : 'Тихоречье, 1996 — мистические расследования'; if (view === 'game') renderGame(); else renderHome(); reveal(main.firstElementChild, 7); }
function updateGamePanel() {
  const area = document.querySelector('#active-panel');
  if (!area) return;
  area.innerHTML = renderGamePanel(); reveal(area.firstElementChild, 6);
}
async function markEvidence(id) {
  if (state.solved || found(id)) return;
  if (!serverAvailable) { state.evidence = [...new Set([...state.evidence, id])]; state.film_unlocked = state.evidence.includes('letter') && state.evidence.length >= 2; return; }
  const currentGeneration = generation;
  applyState(await request('/api/evidence/', { id }), currentGeneration);
}
async function openEvidence(id) {
  const currentGeneration = generation;
  const item = evidence.find(entry => entry.id === id);
  if (!item) return;
  try { await markEvidence(id); } catch (error) { toast(error.message); }
  if (currentGeneration !== generation || view !== 'game') return;
  if (view === 'game') {
    const scroll = window.scrollY;
    renderGame(); window.scrollTo(0, scroll);
  }
  showDialog(`<span class="eyebrow">${esc(item.kind)} / МАТЕРИАЛ ${item.number}</span><h2 id="dialog-title" class="document-dialog-title">${esc(item.title)}</h2>${paperMarkup(item, true)}`);
}
async function startGame() {
  if (starting || resetting) return;
  if (sending || checkingFilm || checkingGuess) { setView('game'); return; }
  starting = true;
  try {
    await syncState();
    await markEvidence('letter');
    activeTab = 'letter';
    setView('game');
  } catch (error) { toast(error.message); }
  finally { starting = false; }
}
async function sendChat(form) {
  if (sending || checkingFilm || checkingGuess || resetting || state.solved) return;
  const currentGeneration = generation;
  chatDraft = String(new FormData(form).get('message') || '').trim();
  if (!validMessage(chatDraft)) { chatError = 'Напишите вопрос длиной от 1 до 1500 символов.'; updateGamePanel(); return; }
  if (!serverAvailable) { chatError = 'Архив не отвечает. Разговор станет доступен после восстановления связи.'; updateGamePanel(); return; }
  sending = true; chatError = ''; updateGamePanel();
  try {
    const response = await request('/api/chat/', { message: chatDraft });
    if (currentGeneration !== generation) return;
    applyState(response.state, currentGeneration); chatDraft = '';
    if (state.film_solved) filmError = '';
  } catch (error) { if (currentGeneration !== generation) return; if (error.state) applyState(error.state, currentGeneration); chatError = error.message; }
  finally {
    sending = false;
    if (view === 'game') { const scroll = window.scrollY; renderGame(); window.scrollTo(0, scroll); }
    if (view === 'game' && activeTab === 'chat') {
      updateGamePanel();
      const transcript = document.querySelector('#transcript');
      transcript.scrollTop = transcript.scrollHeight;
      document.querySelector('#chat-input')?.focus({ preventScroll: true });
    }
  }
}
async function submitFilm(form) {
  if (checkingFilm || sending || checkingGuess || resetting || state.solved) return;
  const currentGeneration = generation;
  const answer = String(new FormData(form).get('answer') || '').trim();
  if (!answer) { filmError = 'Впишите название предмета.'; updateGamePanel(); document.querySelector('#film-input')?.focus(); return; }
  if (!serverAvailable) { filmError = 'Архив не отвечает. Проверить ответ пока не удалось.'; updateGamePanel(); return; }
  checkingFilm = true; filmError = '';
  form.querySelector('[type="submit"]').disabled = true;
  try {
    const response = await request('/api/film/', { answer });
    applyState(response.state);
    if (response.correct) { filmError = ''; toast('Фрагмент проверен. Следующий шаг — версия об отправителе.'); }
    else filmError = response.message || 'Предмет не совпал. Посмотрите фрагмент ещё раз.';
  } catch (error) { filmError = error.message; if (error.state) applyState(error.state); }
  finally { checkingFilm = false; if (view === 'game') { const scroll = window.scrollY; renderGame(); window.scrollTo(0, scroll); document.querySelector('#film-input')?.focus({ preventScroll: true }); } }
}

async function submitGuess(form) {
  if (checkingGuess || checkingFilm || sending || resetting || state.solved) return;
  const currentGeneration = generation;
  const answer = String(new FormData(form).get('answer') || '').trim();
  const errorElement = document.querySelector('#guess-error');
  if (!answer) { errorElement.hidden = false; errorElement.textContent = 'Сначала впишите свою версию.'; document.querySelector('#guess-input').focus(); return; }
  if (!serverAvailable) { errorElement.hidden = false; errorElement.textContent = 'Архив не отвечает. Проверить версию пока не удалось.'; return; }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true; checkingGuess = true;
  try {
    const response = await request('/api/guess/', { answer });
    if (currentGeneration !== generation) return;
    applyState(response.state, currentGeneration);
    if (response.correct) { renderGame(); reveal(document.querySelector('.case-resolution'), 8); focusMain(); }
    else { errorElement.hidden = false; errorElement.textContent = response.message || 'Версия не подтвердилась. Сопоставьте материалы ещё раз.'; }
  } catch (error) { errorElement.hidden = false; errorElement.textContent = error.message; }
  finally { checkingGuess = false; if (submit.isConnected) submit.disabled = false; }
}

document.addEventListener('submit', event => {
  if (!['chat-form', 'guess-form', 'film-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (event.target.id === 'chat-form') void sendChat(event.target);
  else if (event.target.id === 'film-form') void submitFilm(event.target);
  else void submitGuess(event.target);
});
document.addEventListener('input', event => {
  if (event.target.id === 'chat-input') chatDraft = event.target.value;
  if (event.target.id === 'notes-input') { try { localStorage.setItem(NOTES_KEY, event.target.value); } catch { /* Блокнот необязателен. */ } }
  if (event.target.id === 'film-input') { filmError = ''; document.querySelector('#film-error').hidden = true; }
  if (event.target.id === 'guess-input') document.querySelector('#guess-error').hidden = true;
});
document.addEventListener('keydown', event => { if (event.target.id === 'chat-input' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.target.form.requestSubmit(); } });
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'home') { event.preventDefault(); setView('home'); }
  if (action === 'section') {
    event.preventDefault();
    if (view !== 'home') setView('home');
    document.getElementById(target.dataset.target)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  if (action === 'start') void startGame();
  if (action === 'tab') { activeTab = target.dataset.tab; const scroll = window.scrollY; renderGame(); window.scrollTo(0, scroll); document.querySelector(`.tab-button[data-tab="${activeTab}"]`)?.focus({ preventScroll: true }); reveal(document.querySelector('#active-panel').firstElementChild, 5); }
  if (action === 'evidence') void openEvidence(target.dataset.id);
  if (action === 'paid') {
    const item = cases.find(entry => entry.id === target.dataset.case);
    showDialog(`<span class="eyebrow">ПОРЯДОК ДОСТУПА К АРХИВУ</span><h2 id="dialog-title">Сначала —<br>бесплатное дело.</h2><p>Чтобы открыть расследование «${esc(item?.title || '')}», сначала пройдите «Письмо без обратного адреса».</p><p class="dialog-muted">Начните с ночной смены. Все необходимые материалы уже ждут в архиве.</p><button class="primary-button" data-action="start-dialog">Открыть бесплатное дело <span aria-hidden="true">↗</span></button>`);
  }
  if (action === 'close-dialog') closeDialog();
  if (action === 'start-dialog') { closeDialog(true); void startGame(); }
  if (action === 'suggest' && !sending) { chatDraft = target.dataset.message; const input = document.querySelector('#chat-input'); input.value = chatDraft; input.focus(); }
  if (action === 'notes') {
    let notes = ''; try { notes = localStorage.getItem(NOTES_KEY) || ''; } catch { /* Без локального хранилища можно читать материалы. */ }
    showDialog(`<span class="eyebrow">ЛИЧНЫЕ ЗАПИСИ СЛЕДОВАТЕЛЯ</span><h2 id="dialog-title">Мой блокнот</h2><label class="sr-only" for="notes-input">Заметки по делу</label><textarea id="notes-input" class="notes-input" placeholder="Что не сходится? Какие числа и слова повторяются?" rows="8">${esc(notes)}</textarea><p class="dialog-muted">Записи сохраняются в этом браузере.</p>`);
  }
  if (action === 'rules') showDialog('<span class="eyebrow">ПАМЯТКА НОЧНОЙ СМЕНЫ</span><h2 id="dialog-title">Не спешите<br>закрывать дело.</h2><ol class="rules-list"><li><b>Прочтите письмо.</b><p>В нём завязка истории. Другие материалы доступны в папке справа или в разделе «Материалы».</p></li><li><b>Сопоставьте находки.</b><p>Записывайте детали в блокнот. Документы можно открывать сколько угодно раз.</p></li><li><b>Задавайте свои вопросы.</b><p>В разделе «Связь» можно поговорить с неизвестным. Открытые документы помогают ему понять, что вам уже известно.</p></li><li><b>Проверьте фрагмент.</b><p>Когда на линии появится следующий след, посмотрите указанный эпизод фильма и назовите предмет.</p></li><li><b>Внесите версию.</b><p>Когда поймёте, кто отправил письмо, укажите имя или позывной в разделе «Версия».</p></li></ol>');
  if (action === 'about') showDialog('<span class="eyebrow">ТИХОРЕЧЬЕ · 1996</span><h2 id="dialog-title">У города<br>долгая память.</h2><p>Тихоречье — вымышленный город, где старые записи иногда расходятся с тем, что помнят люди. В архиве остаются письма без адреса, чужие ключи и вопросы без ответа.</p><p>Это интерактивные расследования: вы изучаете материалы и сами решаете, о чём спросить. Первое дело доступно бесплатно.</p>');
  if (action === 'reset' && (sending || checkingFilm || checkingGuess || resetting)) { toast('Дождитесь ответа, затем можно начать дело заново.'); return; }
  if (action === 'reset') showDialog('<span class="eyebrow">НОВАЯ НОЧНАЯ СМЕНА</span><h2 id="dialog-title">Начать дело заново?</h2><p>История разговора и найденные материалы этого расследования будут сброшены.</p><div class="dialog-actions"><button class="primary-button" data-action="confirm-reset">Начать заново ↗</button><button class="text-link" data-action="close-dialog">Остаться в деле</button></div>');
  if (action === 'confirm-reset') {
    if (resetting || sending || checkingFilm || checkingGuess) return;
    resetting = true; generation += 1;
    void (async () => { try { if (serverAvailable) { const fresh = await request('/api/reset/', {}); state = emptyState(); applyState(fresh); } else state = emptyState(); activeTab = 'letter'; chatDraft = ''; chatError = ''; filmError = ''; closeDialog(true); await markEvidence('letter'); renderGame(); focusMain(); } catch (error) { toast(error.message); } finally { resetting = false; } })();
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
bindInteractions();
render();
void syncState().then(() => { if (view === 'home') renderHome(); });

import { archive, evidence, cases, filmChallenge, bookCipher, stageTitles } from './content.js';
import { emptyState, escapeHtml as esc, safeMessages, validMessage, registryWords, NOTES_KEY, UI_KEY } from './game.js';
import { request, setRunId } from './api.js';
import { landingMarkup } from './home.js';
import { openEnvelope } from './envelope.js';
import { finalLetterMarkup, animateFinalLetter } from './letter.js';
import { springTo, fade, bindInteractions } from './motion.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#info-dialog');
let state = emptyState();
let serverAvailable = false;
let syncing = null;
let view = ['#case', '#letter'].includes(location.hash) ? 'game' : 'home';
let material = 'envelope';
let tab = 'documents';
let mobilePanel = 'materials';
let pattern = '';
let showWordNumbers = false;
let generation = 0;
let starting = false;
let mutating = false;
let sending = false;
let openingLetter = false;
let chatDraft = '';
const drafts = { date: '', month: '', film: '', year: '' };
const feedback = { date: '', month: '', film: '', year: '', stamp: '', chat: '' };
let toastTimer;
let closeAnimation;
let lastDialogTrigger;
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (evidence.some(item => item.id === saved.material)) material = saved.material;
  if (['documents', 'chat', 'letter'].includes(saved.tab)) tab = saved.tab;
  if (saved.material === 'calendars') material = 'registry';
  showWordNumbers = saved.showWordNumbers === true;
  mobilePanel = ['materials', 'dialog', 'date'].includes(saved.mobilePanel) ? saved.mobilePanel : tab === 'chat' ? 'dialog' : 'materials';
} catch { /* Повреждённое предпочтение не влияет на серверный прогресс. */ }
const icons = {
  envelope: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="m4 7 8 6 8-6"/>',
  registry: '<path d="M5 3h14v18H5zM9 3v18M5 8h14M5 13h14M5 18h14"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4m-10-6 4 3-4 3z"/>',
  stamp: '<path d="M7 15v-3h10v3M9 12V6a3 3 0 0 1 6 0v6M4 15h16v5H4z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">${icons[name] || icons.registry}</svg>`;
const found = id => state.evidence.includes(id);
const materialForStage = stage => ({ month: 'registry', film: 'film', stamp: 'stamp', year: 'registry', date: 'envelope', letter: 'envelope' })[stage] || 'registry';
function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ material, tab, showWordNumbers, mobilePanel })); } catch { /* Необязательные предпочтения интерфейса. */ } }
function focusMain() { window.scrollTo({ top: 0, behavior: 'instant' }); main.focus({ preventScroll: true }); }
function toast(message) {
  const element = document.querySelector('#toast'); element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 6000);
}
function applyState(next, expectedGeneration = generation, acceptNew = false) {
  if (!next || next.case_id !== archive.caseId || generation !== expectedGeneration) return false;
  if (state.run_id && next.run_id !== state.run_id && !acceptNew) return false;
  if (state.run_id === next.run_id && Number(next.revision) < state.revision) return false;
  state = { ...emptyState(), ...next, messages: safeMessages(next.messages), evidence: (next.evidence || []).filter(id => evidence.some(item => item.id === id)) };
  if (!state.film_solved) { pattern = ''; if (material === 'stamp') material = 'film'; }
  setRunId(state.run_id);
  return true;
}
async function syncState() {
  if (syncing) return syncing;
  const currentGeneration = generation;
  syncing = (async () => {
    try { applyState(await request('/api/game/'), currentGeneration, true); serverAvailable = true; }
    catch { serverAvailable = false; }
  })();
  try { await syncing; } finally { syncing = null; }
}
function setView(next) {
  view = next; document.body.classList.toggle('in-case', view === 'game');
  history.replaceState(null, '', next === 'game' ? '#case' : location.pathname);
  render(); focusMain();
}
function showDialog(html) {
  closeAnimation?.cancel(); closeAnimation = null; lastDialogTrigger = document.activeElement;
  document.querySelector('#dialog-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  const surface = dialog.querySelector('.dialog-surface');
  springTo(surface, { y: 0, scale: 1 }, { from: { y: 9, scale: .99 } });
  fade(surface, [{ opacity: 0 }, { opacity: 1 }]);
}
function closeDialog(immediate = false) {
  if (closeAnimation && !immediate) return;
  closeAnimation?.cancel(); closeAnimation = null;
  const finish = () => { dialog.close(); closeAnimation = null; if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus({ preventScroll: true }); };
  if (immediate) { finish(); return; }
  closeAnimation = fade(dialog.querySelector('.dialog-surface'), [{ opacity: 1 }, { opacity: 0 }], { duration: 110 });
  if (!closeAnimation) finish(); else closeAnimation.addEventListener('finish', finish, { once: true });
}

function renderHome() { main.innerHTML = landingMarkup(state); }

function feedbackMarkup(name) { return `<p class="inline-error" id="${name}-feedback" role="status" ${feedback[name] ? '' : 'hidden'}>${esc(feedback[name])}</p>`; }
const materialNames = { envelope: 'Конверт', registry: 'Запись дежурного', film: 'Кинофрагмент', stamp: 'Оттиск' };
function materialProgress(id) {
  const solved = ({ envelope: state.solved, registry: state.month_solved && (!state.stamp_solved || state.year_solved), film: state.film_solved, stamp: state.stamp_solved })[id];
  const label = id === 'registry' && state.month_solved ? state.year_solved ? 'месяц и год найдены' : state.stamp_solved ? 'месяц найден · ищем год' : 'месяц найден' : solved ? id === 'envelope' ? 'дата восстановлена' : 'решено' : found(id) ? 'просмотрен' : 'не просмотрен';
  return { solved, label };
}
function taskButtonLabel() {
  return ({ month: 'Открыть запись дежурного', film: 'Открыть кинофрагмент', stamp: 'Перейти к оттиску', year: 'Открыть второе чтение записки', date: 'Проверить полную дату', letter: 'Открыть письмо' })[state.current_stage] || 'Открыть запись дежурного';
}
function commandBar() {
  const materials = evidence.filter(item => item.id !== 'stamp' || state.film_solved);
  const viewed = materials.filter(item => found(item.id)).length;
  return `<section class="case-command" aria-label="Текущая задача и материалы"><div class="current-task-row"><div class="current-task-copy"><span class="eyebrow">ТЕКУЩАЯ ЗАДАЧА</span><h2>${esc(state.current_task || archive.firstTask)}</h2><p>Общая цель — восстановить дату.</p></div><button class="primary-button task-primary" data-action="task">${taskButtonLabel()} <span aria-hidden="true">↗</span></button></div>
    <div class="command-tools"><button class="hint-button" data-action="hints">Подсказка по этому этапу</button><button class="command-tool" data-action="notes">Блокнот</button><button class="command-tool" data-action="rules">Правила игры</button></div>
    <nav class="command-materials" aria-label="Материалы дела"><div class="materials-caption"><span>Просмотрено материалов: ${viewed} из ${materials.length}</span><span>✓ — загадка решена</span></div><div class="material-chips">${materials.map(item => { const progress = materialProgress(item.id); const active = tab !== 'chat' && (tab === 'letter' ? item.id === 'envelope' : material === item.id); return `<button class="material-chip ${found(item.id) ? 'is-viewed' : ''} ${progress.solved ? 'is-solved' : ''} ${active ? 'is-active' : ''}" data-action="material" data-id="${item.id}" ${active ? 'aria-current="page"' : ''}><span class="material-chip-label">${progress.solved ? '<span class="material-check" aria-hidden="true">✓</span> ' : ''}${materialNames[item.id]}</span><span class="material-chip-status">${progress.label}</span></button>`; }).join('')}</div></nav></section>`;
}
function dateVerificationMarkup() {
  const next = state.year_solved && !state.solved;
  return `<section id="date-check-panel" class="date-check-panel ${next ? 'is-next-step' : ''}" aria-labelledby="date-check-title"><span class="eyebrow">${next ? 'СЛЕДУЮЩИЙ ШАГ' : 'ПРОВЕРКА ВЕРСИИ'}</span><h3 id="date-check-title">${state.solved ? 'Дата восстановлена' : 'Соберите полную дату'}</h3><p>${state.solved ? 'Конверт доступен для открытия.' : next ? 'Год найден. Внесите день, месяц и год.' : 'Версию можно проверить в любой момент, даже до решения всех загадок.'}</p><form id="date-form" class="date-form"><label for="date-input">Ваша версия полной даты</label><input id="date-input" name="answer" type="text" inputmode="numeric" autocomplete="off" maxlength="80" placeholder="ДД.ММ.ГГГГ" aria-describedby="date-feedback" value="${esc(state.confirmed_date || drafts.date)}" ${state.solved ? 'readonly' : ''}><button type="submit" class="date-submit ${next ? 'primary-button' : 'secondary-button'}" ${mutating || state.solved ? 'disabled' : ''}>${state.solved ? 'Дата проверена ✓' : 'Проверить дату'}</button>${feedbackMarkup('date')}</form>${state.solved ? '<button class="primary-button dossier-letter" data-action="open-letter">Открыть письмо ↗</button>' : ''}</section>`;
}
function renderDossier() {
  return `<aside id="case-dossier" class="case-sidebar date-dossier" aria-labelledby="dossier-title"><div class="sidebar-label">${icon('registry')}<span>ДОСЬЕ № 017</span></div><h2 id="dossier-title" class="case-sidebar-title">Найденные сведения</h2><div class="sidebar-status"><i class="signal-dot"></i>${state.letter_opened ? 'Письмо открыто' : state.solved ? 'Конверт можно открыть' : 'Расследование продолжается'}</div><dl class="discovery-list"><div><dt>Месяц</dt><dd class="${state.month_solved ? 'discovered' : ''}">${esc(state.discoveries.month || 'не восстановлен')}</dd></div><div><dt>Число</dt><dd class="${state.stamp_solved ? 'discovered' : ''}">${esc(state.discoveries.day || '—')}</dd></div><div><dt>Год</dt><dd class="${state.year_solved || state.solved ? 'discovered' : ''}">${esc(state.discoveries.year || 'не восстановлен')}</dd></div></dl>${dateVerificationMarkup()}<button class="text-link" data-action="material" data-id="registry">${state.stamp_solved ? 'Второе чтение записки' : 'Запись дежурного'} ↗</button><button class="notebook-button" data-action="notes">Мой блокнот <span aria-hidden="true">↗</span></button></aside>`;
}
function cipherPairsMarkup() {
  return bookCipher.pairs.map(([row, word]) => `<span class="cipher-pair">${row}:${word}</span>`).join(' / ');
}
function registryLineMarkup(line) {
  let cursor = 0;
  let html = '';
  for (const token of registryWords(line)) {
    html += esc(line.slice(cursor, token.start));
    const text = token.number === 1 ? `<span class="line-initial">${esc(token.text[0])}</span>${esc(token.text.slice(1))}` : esc(token.text);
    html += `<span class="registry-word" data-word-number="${token.number}">${text}</span>`;
    cursor = token.end;
  }
  return html + esc(line.slice(cursor));
}
function paperMarkup(item, extra = '') {
  const registry = item.id === 'registry';
  return `<article ${registry ? 'id="registry-document"' : ''} class="paper-sheet ${registry ? 'duty-sheet' : ''} ${registry && state.stamp_solved && showWordNumbers ? 'is-numbered' : ''} ${extra}"><div class="paper-meta"><span>ДЕЛО № 017 / ЛИСТ ${item.number}</span><span>${registry ? 'НОЧНАЯ СМЕНА' : 'АРХИВНАЯ КОПИЯ'}</span></div><h2>${esc(item.title)}</h2><div class="paper-copy ${registry && (state.hints.month || 0) >= 2 ? 'show-initials' : ''}">${item.lines.map((line, index) => `<p${registry ? ` class="duty-line" data-line-number="${index + 1}"` : ''}>${registry ? registryLineMarkup(line) : esc(line)}</p>`).join('')}</div><div class="paper-end"><p>${esc(item.footer)}</p><span class="paper-stamp" aria-hidden="true">НОЧНОЙ<br>АРХИВ</span></div></article>`;
}
function envelopePanel() {
  return `<section class="envelope-panel"><div class="panel-heading"><span class="eyebrow">ОТПРАВЛЕНИЕ № 017 / КОНВЕРТ ЗАПЕЧАТАН</span></div><div class="sealed-case-envelope ${state.solved ? 'is-unlocked' : ''}"><span class="envelope-postmark">ТИХОРЕЧЬЕ<br>НОЧНОЕ БЮРО</span><div class="envelope-condition">Передать тому,<br>кто восстановит дату.</div><div class="envelope-wax" aria-hidden="true">017</div><span class="envelope-date-slot">ДАТА: ${state.confirmed_date ? esc(state.confirmed_date) : '____ · ____ · ________'}</span></div>
    <section class="envelope-reverse" aria-labelledby="envelope-reverse-title"><h3 id="envelope-reverse-title">Оборот конверта</h3><p class="cipher-pairs">${cipherPairsMarkup()}</p><p class="document-footnote">Четыре пары чисел нанесены карандашом. Их назначение не указано.</p>${state.stamp_solved ? '<p>На оттиске: «Строка. Слово.»</p><button class="text-link" data-action="material" data-id="registry">Открыть второе чтение записки ↗</button>' : ''}</section>
    ${state.solved ? `<div class="date-confirmation" role="status"><span class="eyebrow">ДАТА СОВПАЛА</span><h2>Дата восстановлена: ${esc(state.confirmed_date)}</h2><p>Конверт можно открыть. Или продолжите исследовать материалы — все они остаются доступны.</p><div class="panel-actions"><button class="primary-button" data-action="open-letter">Открыть письмо <span aria-hidden="true">↗</span></button><button class="text-link" data-action="continue">Продолжить исследование ↗</button></div></div>` : `<div class="case-brief"><h2>Какой день здесь зашифрован?</h2><p>${esc(archive.description)}</p><p>Отправитель помнит дату и намеренно оставил следы. Почему этот день заслуживает целого расследования — объяснит само письмо.</p><button class="primary-button" data-action="material" data-id="registry">Открыть запись дежурного <span aria-hidden="true">↗</span></button></div>`}
    <details class="document-details"><summary>Сопроводительная записка</summary>${paperMarkup(evidence[0])}</details></section>`;
}
function monthAnswerMarkup() {
  return `<form id="month-form" class="stage-form month-answer"><label for="month-input">КАКОЙ МЕСЯЦ СОХРАНИЛСЯ В ЗАПИСКЕ?</label><div><input id="month-input" name="answer" maxlength="80" placeholder="Название или номер месяца" autocomplete="off" value="${esc(drafts.month)}"><button class="primary-button" ${mutating ? 'disabled' : ''}>Восстановить месяц ↗</button></div>${feedbackMarkup('month')}</form>`;
}
function yearCipherPanel(registry) {
  return `<section id="year-cipher-panel" class="book-cipher-panel" aria-labelledby="year-cipher-title"><div class="rereading-heading"><span class="eyebrow">ЗАПИСЬ ДЕЖУРНОГО · ВТОРОЕ ЧТЕНИЕ</span><h2 id="year-cipher-title">Второе чтение записки</h2><p>Прочитайте пары с конверта по найденной пометке. Определите год по словам этой записки.</p><span class="month-complete">${state.month_solved ? `✓ Месяц уже найден: ${esc(state.discoveries.month)}` : 'Месяц пока не восстановлен'}</span></div>
    <div class="cipher-context"><div><span class="small-label">ПАРЫ НА КОНВЕРТЕ</span><p class="cipher-pairs">${cipherPairsMarkup()}</p></div><div><span class="small-label">ПОМЕТКА НА ОТТИСКЕ</span><p class="cipher-method">${esc(state.discoveries.reading_method)}</p></div></div>
    <div class="document-controls"><button type="button" id="toggle-word-numbers" class="number-toggle" data-action="toggle-word-numbers" role="switch" aria-checked="${showWordNumbers}" aria-controls="registry-document"><span class="number-toggle-track" aria-hidden="true"><i></i></span><span>Нумерация строк и слов<small>${showWordNumbers ? 'Включена' : 'Выключена'}</small></span></button><details class="counting-rules"><summary>Как считать строки и слова</summary><p>Строки — шесть абзацев записки. Переносы на экране не меняют их номера. Заголовок, подпись, номера и печать не считаются. Предлоги — отдельные слова; знаки препинания пропускайте.</p></details></div>
    ${paperMarkup(registry)}${!state.month_solved ? monthAnswerMarkup() : ''}
    <div class="year-answer">${state.year_solved ? `<div class="stage-result"><strong>✓ Год восстановлен: ${esc(state.discoveries.year)}</strong><p>Теперь соберите день, месяц и год в полную дату.</p><button class="primary-button" data-action="focus-date">Проверить полную дату ↗</button></div>` : `<form id="year-form" class="stage-form"><label for="year-input">КАКОЙ ГОД ПОЛУЧИЛСЯ?</label><div><input id="year-input" name="answer" type="text" maxlength="100" autocomplete="off" placeholder="Год цифрами или словами" value="${esc(drafts.year)}"><button type="submit" class="primary-button" ${mutating ? 'disabled' : ''}>Проверить год ↗</button></div>${feedbackMarkup('year')}</form>`}</div></section>`;
}
function monthPanel() {
  const registry = evidence.find(item => item.id === 'registry');
  if (state.stamp_solved) return `<section class="month-panel rereading-panel">${yearCipherPanel(registry)}</section>`;
  return `<section class="month-panel"><div class="panel-heading"><span class="eyebrow">МАТЕРИАЛ 02 / ЗАПИСЬ ДЕЖУРНОГО</span></div>${paperMarkup(registry)}${state.month_solved ? `<div class="stage-result"><strong>✓ Месяц восстановлен: ${esc(state.discoveries.month)}</strong><p>Следующая улика — предмет из кинофрагмента.</p><button class="primary-button" data-action="material" data-id="film">Открыть кинофрагмент ↗</button></div>` : monthAnswerMarkup()}</section>`;
}
function stampWorkspace(compact = false) {
  if (!state.film_solved) return '';
  const isReadable = state.stamp_solved && pattern === 'stripes';
  return `<section class="stamp-workspace ${compact ? 'in-connection-room' : ''}" aria-labelledby="stamp-work-title"><div class="eyebrow">${compact ? 'РЯДОМ С КАРТОЧКОЙ / МАТЕРИАЛ 04' : 'ДВА СЛОЯ ПЕЧАТИ'}</div><h2 id="stamp-work-title">Повреждённый оттиск</h2><p class="panel-description">Тёмные участки закрывают лишнюю печать. Светлые сохраняют исходную запись.</p>
    <div class="damaged-stamp ${isReadable ? 'stamp-readable' : ''} mask-${pattern || 'none'}" role="img" aria-label="${isReadable ? `Восстановлено: ${esc(state.discoveries.day)}. Пометка: ${esc(state.discoveries.reading_method)}.` : 'Исходная запись и служебная печать наложены друг на друга. Подберите шаблон чтения.'}"><div class="stamp-underprint" aria-hidden="true"><span>${isReadable ? esc(state.discoveries.day) : '1 · 0'}</span><strong>${isReadable ? esc(state.discoveries.reading_method) : 'С · Т · · · / · · О · ·'}</strong><small>ИСХОДНАЯ ЗАПИСЬ</small></div><div class="stamp-overprint" aria-hidden="true"><span>СЛУЖЕБНЫЙ ОТТИСК</span><b>ПРИНЯТО / ПОВТОРНАЯ ПЕЧАТЬ</b><i>БЮРО 017 · КОНТРОЛЬ · КОПИЯ</i><span>НЕ ПОДЛЕЖИТ ПЕРЕНОСУ</span></div><div class="template-overlay" aria-hidden="true"></div><span class="stamp-corner" aria-hidden="true">ЛИСТ 04</span></div>
    <fieldset class="pattern-picker"><legend>Шаблоны чтения</legend>${[['stripes','Полосы'],['checks','Клетка'],['dots','Точки']].map(([id,label]) => `<label class="pattern-option ${pattern === id ? 'selected' : ''}"><input type="radio" name="reading-pattern" value="${id}" ${pattern === id ? 'checked' : ''}><span class="pattern-swatch ${id}" aria-hidden="true"></span><span>${label}</span></label>`).join('')}</fieldset>
    <button class="primary-button apply-pattern" data-action="apply-pattern" ${mutating || !pattern ? 'disabled' : ''}>Приложить шаблон <span aria-hidden="true">↗</span></button>${feedbackMarkup('stamp')}
    ${state.stamp_solved ? `<div class="stamp-transcription stage-result"><span class="eyebrow">ВОССТАНОВЛЕННАЯ ЗАПИСЬ</span><h3>${esc(state.discoveries.day)}<span class="reading-method">${esc(state.discoveries.reading_method)}</span></h3><p>Пометка объясняет пары на обороте конверта. Вернитесь к уже знакомой записи дежурного.</p><button class="primary-button" data-action="material" data-id="registry">Открыть второе чтение записки ↗</button></div>` : '<p class="document-footnote">Выберите шаблон вручную и приложите его к оттиску. Можно пробовать разные узоры.</p>'}</section>`;
}
function filmPanel() {
  return `<section class="connection-room"><div class="eyebrow">МАТЕРИАЛ 03 / КИНОФРАГМЕНТ</div><h2>Кинофрагмент</h2><p class="panel-description">Определите предмет, который получает героиня. Его узор поможет прочитать оттиск.</p><section class="film-clue"><span class="eyebrow">ИСТОЧНИК</span><h3>${esc(filmChallenge.title)}</h3><span class="film-time">${filmChallenge.time}</span><div class="film-availability"><p>Встроенного плеера нет. Посмотрите этот фрагмент в доступном вам сервисе или пройдите этап с помощью подсказок.</p><button class="secondary-button" data-action="film-help">Как пройти без просмотра</button></div><p>${esc(filmChallenge.question)}</p>${state.film_solved ? '<div class="stage-result"><strong>✓ Предмет установлен: колготки</strong><p>Теперь используйте узор предмета на повреждённом оттиске.</p><button class="primary-button" data-action="material" data-id="stamp">Перейти к оттиску ↗</button></div>' : `<form id="film-form"><label for="film-input">Предмет и замеченный узор</label><input id="film-input" name="answer" type="text" maxlength="150" placeholder="Предмет; что вы заметили в узоре" autocomplete="off" value="${esc(drafts.film)}"><button class="primary-button" ${mutating ? 'disabled' : ''}>Проверить предмет ↗</button></form>${feedbackMarkup('film')}`}</section></section>`;
}
function renderChat() {
  return `<section class="conversation"><div class="contact-heading"><span class="unknown-avatar" aria-hidden="true">?</span><div><span class="small-label">КАНАЛ № 17 / ПОЧТОВОЕ БЮРО</span><h2>Неизвестный</h2></div><span class="contact-status"><i class="signal-dot"></i>${state.ai_configured ? 'На линии' : 'Записи канала'}</span></div>${!state.ai_configured ? '<p class="connection-notice">Свободный разговор сейчас недоступен. Документы, подсказки и все проверки работают независимо от него.</p>' : ''}
    <div class="transcript" id="transcript" role="log" aria-label="Переписка с неизвестным" aria-live="polite">${state.messages.map(message => `<article class="chat-message ${message.role}"><span class="message-author">${message.role === 'user' ? 'ВЫ' : message.source === 'script' ? 'НЕИЗВЕСТНЫЙ · ЗАПИСЬ КАНАЛА' : 'НЕИЗВЕСТНЫЙ · ИИ'}</span><p>${esc(message.content)}</p></article>`).join('')}</div>
    <div class="chat-suggestions"><button data-action="suggest" data-message="Что делать?">Что делать?</button><button data-action="suggest" data-message="Зачем этот фильм?">Зачем этот фильм?</button><button data-action="suggest" data-message="Почему вы оставили эти следы?">Почему эти следы?</button></div><form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">Сообщение неизвестному</label><textarea id="chat-input" name="message" rows="2" maxlength="1500" placeholder="Ваш вопрос неизвестному…" ${sending ? 'readonly' : ''}>${esc(chatDraft)}</textarea><button class="primary-button" ${sending ? 'disabled' : ''}>${sending ? 'Передача…' : 'Отправить'} ↗</button></form>${feedbackMarkup('chat')}<p class="chat-help">Связь помогает расследованию. Проверки и подсказки работают отдельно.</p></section>`;
}
function renderPanel() {
  if (tab === 'chat') return renderChat();
  if (tab === 'letter') return envelopePanel();
  return ({ envelope: envelopePanel, registry: monthPanel, film: filmPanel, stamp: () => state.film_solved ? `<section class="stamp-panel">${stampWorkspace()}</section>` : filmPanel() })[material]();
}
function mobileNavigation() {
  const selected = mobilePanel === 'date' ? 'date' : tab === 'chat' ? 'dialog' : 'materials';
  return `<nav class="case-mobile-nav" aria-label="Разделы расследования">${[['materials','Материалы'],['dialog','Диалог'],['notes','Блокнот'],['date','Дата']].map(([id,label]) => `<button data-action="${id === 'notes' ? 'notes' : `mobile-${id}`}" ${selected === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}
function renderGame() {
  main.innerHTML = `<section class="investigation date-investigation" aria-labelledby="case-title" data-mobile-panel="${mobilePanel}"><div class="case-topbar"><button class="back-link" data-action="home">← В архив</button><span class="small-label">НОЧНОЕ ПОЧТОВОЕ БЮРО</span><span class="save-status">${serverAvailable ? '✓ Прогресс сохранён' : 'Соединение с архивом…'}</span></div><div class="case-title-row"><div><div class="eyebrow">БЕСПЛАТНОЕ ДЕЛО № 017 · 20–30 МИНУТ</div><h1 id="case-title">Письмо без даты</h1></div></div>${commandBar()}<div class="case-layout"><div class="work-panel"><nav class="case-tabs" aria-label="Рабочий стол"><button class="tab-button ${tab === 'documents' ? 'is-active' : ''}" data-action="tab" data-tab="documents">Материалы</button><button class="tab-button ${tab === 'chat' ? 'is-active' : ''}" data-action="tab" data-tab="chat">Диалог с неизвестным <i class="signal-dot"></i></button>${state.solved ? '<button class="tab-button" data-action="open-letter">Открыть письмо ↗</button>' : ''}</nav>${tab !== 'chat' ? `<div class="active-material-heading"><span class="small-label">ОТКРЫТ МАТЕРИАЛ</span><strong>${materialNames[tab === 'letter' ? 'envelope' : material]}</strong></div>` : ''}<div id="active-panel" class="active-panel">${renderPanel()}</div></div>${renderDossier()}</div><div class="case-footer"><span>АРХИВ ТИХОРЕЧЬЯ · ДЕЛО № 017</span><button class="text-link" data-action="reset">Начать расследование заново</button></div>${mobileNavigation()}</section>`;
  sizeCommandBar();
}
function sizeCommandBar() {
  const bar = document.querySelector('.case-command');
  if (bar) document.documentElement.style.setProperty('--case-command-height', `${bar.offsetHeight + 22}px`);
}
window.addEventListener('resize', sizeCommandBar);
function showFinalLetter(animate = false) {
  if (!state.letter_opened || !state.letter) return;
  const entering = view !== 'letter' || !main.querySelector('.love-page');
  view = 'letter'; tab = 'letter'; saveUi();
  document.body.classList.remove('in-case');
  document.body.classList.add('letter-finale');
  document.documentElement.classList.add('letter-finale');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#fff1f6');
  document.title = 'Письмо для тебя';
  history.replaceState(null, '', '#letter');
  clearTimeout(toastTimer); document.querySelector('#toast').hidden = true;
  if (!entering) return;
  if (dialog.open) closeDialog(true);
  main.innerHTML = finalLetterMarkup(state.letter);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (animate) animateFinalLetter();
  if (!openingLetter) document.querySelector('.love-letter')?.focus({ preventScroll: true });
}
function render() {
  if (state.letter_opened && state.letter && (view === 'letter' || location.hash === '#letter')) { showFinalLetter(); return; }
  document.body.classList.remove('letter-finale'); document.documentElement.classList.remove('letter-finale');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#101817');
  document.body.classList.toggle('in-case', view === 'game');
  document.title = view === 'game' ? 'Письмо без даты — Тихоречье' : 'Тихоречье — ночной архив';
  if (view === 'home') renderHome(); else renderGame();
}
function refreshGame() {
  if (state.letter_opened && state.letter && (view === 'letter' || location.hash === '#letter')) { showFinalLetter(); return; }
  if (view !== 'game') return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroll = window.scrollY;
  const transcriptScroll = document.querySelector('#transcript')?.scrollTop;
  renderGame(); window.scrollTo(0, scroll);
  const replacement = focusId ? document.getElementById(focusId) : null;
  if (replacement) { replacement.focus({ preventScroll: true }); if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection); }
  else if (focused && focused !== document.body && !focused.isConnected) main.focus({ preventScroll: true });
  if (transcriptScroll != null && document.querySelector('#transcript')) document.querySelector('#transcript').scrollTop = transcriptScroll;
}
async function markEvidence(id) {
  if (found(id) || !serverAvailable) return;
  const currentGeneration = generation;
  try { applyState(await request('/api/evidence/', { id }), currentGeneration); refreshGame(); }
  catch (error) { toast(error.message); }
}

function focusDate() {
  mobilePanel = 'date'; saveUi(); refreshGame();
  const target = matchMedia('(max-width: 800px)').matches ? 'case-dossier' : 'date-check-panel';
  document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  document.getElementById('date-input')?.focus({ preventScroll: true });
}
function openMobilePanel(panel) {
  if (panel === 'date') { focusDate(); return; }
  mobilePanel = panel; tab = panel === 'dialog' ? 'chat' : 'documents'; saveUi(); refreshGame();
  document.querySelector('.work-panel')?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
function toggleWordNumbers() {
  const top = matchMedia('(max-width: 800px)').matches ? 0 : document.querySelector('.case-command')?.getBoundingClientRect().bottom || 0;
  const lines = [...document.querySelectorAll('.duty-line')];
  const anchor = lines.find(line => line.getBoundingClientRect().bottom > top) || lines[0];
  const row = anchor?.dataset.lineNumber;
  const offset = anchor?.getBoundingClientRect().top;
  showWordNumbers = !showWordNumbers; saveUi(); refreshGame();
  const next = row ? document.querySelector(`.duty-line[data-line-number="${row}"]`) : null;
  if (next && offset !== undefined) window.scrollBy({ top: next.getBoundingClientRect().top - offset, behavior: 'instant' });
}

function openMaterial(id, scroll = true) {
  if (id === 'stamp' && !state.film_solved) id = 'film';
  if (!evidence.some(item => item.id === id)) return;
  material = id; tab = 'documents'; mobilePanel = 'materials'; saveUi(); refreshGame();
  if (scroll) document.querySelector('.work-panel')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  void markEvidence(id);
}
async function startGame() {
  if (starting) return;
  starting = true;
  try {
    await syncState();
    if (!state.run_id) { toast('Архив пока не отвечает. Проверьте, запущен ли сервер.'); return; }
    if (state.letter_opened) { material = 'envelope'; tab = 'documents'; mobilePanel = 'materials'; }
    else if (tab === 'letter') tab = 'documents';
    setView('game'); saveUi();
  } finally { starting = false; }
}
async function mutate(path, body, onSuccess) {
  if (mutating) return;
  if (!serverAvailable) { toast('Нет связи с архивом. Прогресс не изменён.'); return; }
  mutating = true; refreshGame();
  const currentGeneration = generation;
  try {
    const response = await request(path, body);
    if (currentGeneration !== generation) return;
    const next = ['/api/reset/', '/api/letter/'].includes(path) ? response : response.state;
    applyState(next, currentGeneration, path === '/api/reset/');
    onSuccess?.(response);
  } catch (error) { if (error.state) applyState(error.state, currentGeneration); toast(error.message); }
  finally { mutating = false; refreshGame(); }
}
async function openLetter() {
  if (!state.solved || openingLetter || mutating) return;
  if (state.letter_opened && state.letter) { showFinalLetter(); return; }
  openingLetter = true;
  try {
    await openEnvelope({
      unseal: async () => {
        if (state.letter_opened && state.letter) return;
        if (!serverAvailable) throw new Error('Нет связи с архивом. Повторите открытие немного позже.');
        const currentGeneration = generation;
        mutating = true;
        try {
          const next = await request('/api/letter/', {});
          if (!applyState(next, currentGeneration) || !state.letter_opened || !state.letter) {
            throw new Error('Состояние дела изменилось. Вернитесь к материалам и обновите страницу.');
          }
        } catch (error) {
          if (error.state) applyState(error.state, currentGeneration);
          throw error;
        } finally { mutating = false; refreshGame(); }
      },
      reveal: () => showFinalLetter(true)
    });
  } finally {
    openingLetter = false;
    if (state.letter_opened && state.letter) {
      showFinalLetter();
      document.querySelector('.love-letter')?.focus({ preventScroll: true });
    }
  }
}

async function submitStage(name, form) {
  const answer = String(new FormData(form).get('answer') || '').trim();
  drafts[name] = answer;
  if (!answer) { feedback[name] = name === 'date' ? 'Впишите свою версию даты.' : 'Впишите свой ответ.'; refreshGame(); return; }
  feedback[name] = '';
  let showEnvelope = false;
  await mutate(`/api/${name}/`, { answer }, response => {
    feedback[name] = response.correct ? '' : response.message;
    if (!response.correct) return;
    if (name === 'date') { material = 'envelope'; tab = 'documents'; drafts.date = ''; saveUi(); showEnvelope = true; }
    else toast(response.message);
  });
  if (showEnvelope && view === 'game') await openLetter();
}
async function sendChat(form) {
  if (sending) return;
  chatDraft = String(new FormData(form).get('message') || '').trim();
  if (!validMessage(chatDraft)) { feedback.chat = 'Напишите сообщение от 1 до 1500 символов.'; refreshGame(); return; }
  const currentGeneration = generation;
  const message = chatDraft;
  sending = true; feedback.chat = ''; refreshGame();
  let showEnvelope = false;
  try {
    const response = await request('/api/chat/', { message });
    if (generation !== currentGeneration) return;
    const justRestored = !state.solved && response.state?.solved;
    applyState(response.state, currentGeneration); chatDraft = '';
    if (justRestored) { material = 'envelope'; tab = 'documents'; saveUi(); showEnvelope = true; }
  } catch (error) { if (generation !== currentGeneration) return; if (error.state) applyState(error.state, currentGeneration); feedback.chat = error.message; }
  finally {
    sending = false; refreshGame();
    const transcript = document.querySelector('#transcript'); if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }
  if (showEnvelope && view === 'game') await openLetter();
}
function hintStage() {
  if (mobilePanel === 'date') return stageTitles[state.current_stage] ? state.current_stage : 'year';
  if (tab === 'documents') return ({registry:state.stamp_solved ? 'year' : 'month',film:'film',stamp:'stamp'})[material] || (stageTitles[state.current_stage] ? state.current_stage : 'year');
  return stageTitles[state.current_stage] ? state.current_stage : 'year';
}
function showHints(stage = hintStage()) {
  if (!stageTitles[stage]) stage = 'month';
  const level = Number(state.hints[stage] || 0);
  const hints = (state.hint_log || []).filter(item => item.stage === stage);
  showDialog(`<span class="eyebrow">ПОМОЩЬ АРХИВА / БЕЗ ШТРАФОВ</span><h2 id="dialog-title">${esc(stageTitles[stage])}</h2><div class="hint-stage-tabs">${Object.entries(stageTitles).map(([id,label]) => `<button data-action="hints" data-stage="${id}" class="${id === stage ? 'active' : ''}">${label}</button>`).join('')}</div><ol class="hint-log">${hints.map(item => `<li><span>УРОВЕНЬ ${item.level} / ${['Куда посмотреть','Какой способ применить','Прямая помощь'][item.level - 1]}</span><p>${esc(item.text)}</p></li>`).join('') || '<li><p>Подсказки открываются постепенно. Последний уровень прямо помогает решить эту часть дела.</p></li>'}</ol>${level < 3 ? `<button class="primary-button" data-action="next-hint" data-stage="${stage}" data-level="${level + 1}">${level === 2 ? 'Попросить прямую помощь' : `Открыть подсказку ${level + 1}`} ↗</button>` : '<p class="dialog-muted">Все три уровня открыты и сохранены в деле.</p>'}<button class="text-link" data-action="hint-material" data-id="${materialForStage(stage)}">Вернуться к материалу ↗</button>`);
}
async function getHint(stage, level, confirm = false) {
  await mutate('/api/hint/', { stage, level, ...(confirm ? { confirm: true } : {}) }, () => showHints(stage));
}
function showNotes() {
  let notes = ''; try { notes = localStorage.getItem(NOTES_KEY) || ''; } catch { /* Необязательное локальное хранилище. */ }
  showDialog(`<span class="eyebrow">ЛИЧНЫЕ ЗАПИСИ СЛЕДОВАТЕЛЯ</span><h2 id="dialog-title">Мой блокнот</h2><label class="sr-only" for="notes-input">Заметки по делу</label><textarea id="notes-input" class="notes-input" rows="8" placeholder="Месяц, число, узор, совпадения…">${esc(notes)}</textarea><p class="dialog-muted">Записи сохраняются в этом браузере. Их не видит неизвестный.</p>`);
}
document.addEventListener('submit', event => {
  const name = ({'date-form':'date','month-form':'month','film-form':'film','year-form':'year','chat-form':'chat'})[event.target.id];
  if (!name) return; event.preventDefault();
  if (name === 'chat') void sendChat(event.target); else void submitStage(name, event.target);
});
function formatDateInput(input) {
  const raw = input.value;
  // Written dates can still be pasted; the numeric version gets separators automatically.
  if (/[a-zа-яё]/i.test(raw)) return;
  const position = input.selectionStart ?? raw.length;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const before = Math.min(raw.slice(0, position).replace(/\D/g, '').length, digits.length);
  let formatted = digits.slice(0, 2);
  if (digits.length >= 2) formatted += '.' + digits.slice(2, 4);
  if (digits.length >= 4) formatted += '.' + digits.slice(4, 8);
  input.value = formatted;
  const caret = Math.min(formatted.length, before + (before >= 2 ? 1 : 0) + (before >= 4 ? 1 : 0));
  input.setSelectionRange(caret, caret);
}
document.addEventListener('beforeinput', event => {
  const input = event.target;
  if (input.id !== 'date-input' || input.readOnly || event.isComposing || /[a-zа-яё]/i.test(input.value)) return;
  const position = input.selectionStart;
  if (position === null || position !== input.selectionEnd) return;
  const backward = event.inputType === 'deleteContentBackward' && input.value[position - 1] === '.';
  const forward = event.inputType === 'deleteContentForward' && input.value[position] === '.';
  if (!backward && !forward) return;
  event.preventDefault();
  input.setRangeText('', backward ? Math.max(0, position - 2) : position, backward ? position : position + 2, 'start');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('input', event => {
  const name = ({'date-input':'date','month-input':'month','film-input':'film','year-input':'year'})[event.target.id];
  if (name === 'date' && !event.isComposing) formatDateInput(event.target);
  if (name) { drafts[name] = event.target.value; feedback[name] = ''; const area = document.getElementById(`${name}-feedback`); if (area) area.hidden = true; }
  if (event.target.id === 'chat-input') chatDraft = event.target.value;
  if (event.target.id === 'notes-input') { try { localStorage.setItem(NOTES_KEY, event.target.value); } catch { /* Запись необязательна. */ } }
});
document.addEventListener('change', event => {
  if (event.target.name === 'reading-pattern') { pattern = event.target.value; feedback.stamp = ''; saveUi(); refreshGame(); }
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'chat-input' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.target.form.requestSubmit(); }
});
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  const action = target.dataset.action;
  if (action === 'home') { event.preventDefault(); setView('home'); }
  if (action === 'start') void startGame();
  if (action === 'section') { event.preventDefault(); if (view !== 'home') setView('home'); document.getElementById(target.dataset.target)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  if (action === 'material') openMaterial(target.dataset.id);
  if (action === 'toggle-word-numbers') toggleWordNumbers();
  if (action === 'tab') { tab = target.dataset.tab; mobilePanel = tab === 'chat' ? 'dialog' : 'materials'; saveUi(); refreshGame(); }
  if (action === 'task') { if (state.solved) void openLetter(); else if (state.current_stage === 'date') focusDate(); else openMaterial(materialForStage(state.current_stage)); }
  if (action === 'continue') openMaterial('registry');
  if (action === 'focus-date') focusDate();
  if (action === 'apply-pattern') void mutate('/api/stamp/', { pattern }, response => { feedback.stamp = response.correct ? '' : response.message + (response.reading ? ` Фрагмент: ${response.reading}` : ''); if (response.correct) toast(response.message); });
  if (action === 'open-letter') void openLetter();
  if (action === 'mobile-materials') openMobilePanel('materials');
  if (action === 'mobile-dialog') openMobilePanel('dialog');
  if (action === 'mobile-date') openMobilePanel('date');
  if (action === 'notes') showNotes();
  if (action === 'film-help') showDialog('<span class="eyebrow">КИНОУЛИКА БЕЗ ПРОСМОТРА</span><h2 id="dialog-title">Можно продолжить<br>без фильма.</h2><p>Откройте подсказки кинофрагмента. Первые два уровня направляют внимание, третий прямо называет предмет и рисунок.</p><p>Перед третьим уровнем появится отдельное предупреждение и кнопка подтверждения. Решение не откроется автоматически.</p><button class="primary-button" data-action="hints" data-stage="film">Открыть подсказки кинофрагмента ↗</button>');
  if (action === 'hints') showHints(target.dataset.stage || hintStage());
  if (action === 'next-hint') {
    const stage = target.dataset.stage; const level = Number(target.dataset.level);
    if (level === 3) showDialog(`<span class="eyebrow">ПРЯМАЯ ПОМОЩЬ / ${esc(stageTitles[stage])}</span><h2 id="dialog-title">Открыть решение<br>этого этапа?</h2><p>Последняя подсказка прямо назовёт предмет, способ чтения или нужную часть даты. Остальной прогресс сохранится.</p><button class="primary-button" data-action="confirm-hint" data-stage="${stage}">Да, показать решение ↗</button><button class="text-link" data-action="hints" data-stage="${stage}">Вернуться к подсказкам</button>`);
    else void getHint(stage, level);
  }
  if (action === 'confirm-hint') void getHint(target.dataset.stage, 3, true);
  if (action === 'hint-material') { closeDialog(true); openMaterial(target.dataset.id); }
  if (action === 'suggest' && !sending) { chatDraft = target.dataset.message; const input = document.getElementById('chat-input'); if (input) { input.value = chatDraft; input.focus(); } }
  if (action === 'paid') { const item = cases.find(entry => entry.id === target.dataset.case); const name = item ? `расследование «${esc(item.title)}»` : 'набор расследований'; showDialog(`<span class="eyebrow">ПОРЯДОК ДОСТУПА К АРХИВУ</span><h2 id="dialog-title">Сначала —<br>бесплатное дело.</h2><p>Чтобы открыть ${name}, сначала пройдите «Письмо без даты».</p><button class="primary-button" data-action="start-dialog">Принять бесплатное дело ↗</button>`); }
  if (action === 'start-dialog') { closeDialog(true); void startGame(); }
  if (action === 'close-dialog') closeDialog();
  if (action === 'rules') showDialog(`<span class="eyebrow">ПАМЯТКА НОЧНОГО БЮРО</span><h2 id="dialog-title">Восстановите дату.<br>Откройте конверт.</h2><ol class="rules-list"><li><b>Начните с записи дежурного.</b><p>В ней сохранился месяц. Дальнейшее направление указано в самом документе.</p></li><li><b>Изучайте вложения.</b><p>Назовите предмет из кинофрагмента, чтобы открыть оттиск и шаблоны. Затем самостоятельно выберите узор для чтения документа.</p></li><li><b>Прочитайте записку снова.</b><p>${state.stamp_solved ? 'Первая цифра пары — номер строки записи дежурного, вторая — номер слова. Считайте с единицы, пропуская знаки препинания.' : 'Когда прочитаете оттиск, его пометка объяснит пары на конверте. Вернитесь к той же записи дежурного: она понадобится ещё раз.'}</p></li><li><b>Вносите версию в любой момент.</b><p>Правильная дата принимается даже раньше остальных ответов. Ошибки не уничтожают находки.</p></li><li><b>Просите помощь.</b><p>У каждой части есть три подсказки, включая прямую помощь. Фильм не обязателен для завершения дела.</p></li></ol>`);
  if (action === 'about') showDialog('<span class="eyebrow">ТИХОРЕЧЬЕ / НОЧНОЕ ПОЧТОВОЕ БЮРО</span><h2 id="dialog-title">У записей<br>долгая память.</h2><p>Старое бюро хранит документы разных лет. В папки попадают письма, оттиски, служебные заметки и вещи, которые требуют внимательного взгляда.</p><p>Каждое расследование можно проходить в своём темпе. Первое дело доступно бесплатно.</p>');
  if (action === 'reset') { if (mutating || sending) { toast('Дождитесь завершения текущего действия.'); return; } showDialog('<span class="eyebrow">НОВОЕ РАССЛЕДОВАНИЕ</span><h2 id="dialog-title">Начать дело заново?</h2><p>Найденные части даты, переписка, подсказки и открытое письмо будут сброшены. Записи в блокноте останутся.</p><button class="primary-button" data-action="confirm-reset">Начать заново ↗</button><button class="text-link" data-action="close-dialog">Остаться в деле</button>'); }
  if (action === 'confirm-reset') {
    if (mutating || sending) return; generation += 1;
    void mutate('/api/reset/', {}, () => { material = 'envelope'; tab = 'documents'; mobilePanel = 'materials'; pattern = ''; showWordNumbers = false; chatDraft = ''; for (const key of Object.keys(drafts)) drafts[key] = ''; for (const key of Object.keys(feedback)) feedback[key] = ''; closeDialog(true); saveUi(); focusMain(); });
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
window.addEventListener('scroll', () => { document.body.classList.toggle('home-scrolled', window.scrollY > 24); }, { passive: true });
bindInteractions();
render();
void syncState().then(() => { if (!state.letter_opened && tab === 'letter') tab = 'documents'; render(); });

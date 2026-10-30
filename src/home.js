import { archive, cases, bookCipher } from './content.js';
import { escapeHtml as esc } from './game.js';

const steps = [
  ['01', '✉', 'Примите дело', 'Откройте конверт и сопроводительные материалы. В начале сразу понятно, что нужно восстановить и где искать первый след.'],
  ['02', '☎', 'Задавайте свои вопросы', 'Неизвестный выходит на связь. Спрашивайте о находках своими словами — он поможет разобраться в том, что уже открыто.'],
  ['03', '⌕', 'Изучайте находки', 'Служебные записи, кинофрагмент, слои печати и карандашные отметки. Замечайте детали и проверяйте, как они связаны.'],
  ['04', '◷', 'Восстановите дату', 'Сопоставьте день, месяц и год. Правильную версию можно назвать сразу — даже если не все материалы изучены.']
];
const shots = [
  ['desk', 'Рабочий стол дела: общая цель, конверт, материалы и найденные сведения в одном месте.'],
  ['line', 'Канал связи: неизвестному можно задать собственный вопрос, а не выбирать готовую реплику.'],
  ['paper', 'Служебная записка: важными могут оказаться порядок строк и пометка на полях.'],
  ['print', 'Повреждённый оттиск: разные узоры отделяют исходную запись от лишней печати.'],
  ['cipher', 'Оборот конверта: четыре карандашные отметки. Их значение предстоит установить по найденным материалам.'],
  ['notes', 'Личный блокнот: сохраняйте версии, наблюдения и детали, которые пока не складываются.'],
  ['hints', 'Подсказки: от направления поиска до прямой помощи — по вашему выбору.'],
  ['envelope', 'Запечатанный конверт: восстановленная дата даст право прочитать, что находится внутри.']
];
const faq = [
  ['Нужны регистрация и установка?', 'Нет. Дело открывается в браузере на компьютере или телефоне. Прохождение сохраняется автоматически в сессии этого браузера.'],
  ['Можно проходить в одиночку?', 'Да. Первое расследование рассчитано на одного игрока. Можно обсуждать находки вместе, проходя дело на одном устройстве.'],
  ['Насколько это страшно?', 'Это спокойный мистический детектив с ночной атмосферой. В первом деле нет скримеров, угроз или жестоких сцен.'],
  ['Что делать, если не получается?', 'Для каждой части есть три уровня подсказок. Последняя подсказка прямо помогает решить этап и открывается только после вашего подтверждения.'],
  ['Обязательно смотреть фильм?', 'Нет. Карточка указывает нужный фрагмент, а последняя подсказка сообщает всё необходимое для продолжения.'],
  ['Сколько длится первое дело?', 'Ориентир — 20–30 минут. Таймера нет: можно прерваться, вернуться к материалам и продолжить в своём темпе.'],
  ['Как открыть остальные расследования?', 'Начните с бесплатного дела «Письмо без даты». Карточки других расследований сначала предложат пройти его. Оплата на этой странице не производится.']
];

function preview(kind) {
  if (kind === 'desk') return '<img src="/public/images/landing/archive-desk.webp" alt="Начальный экран расследования с запечатанным конвертом" loading="lazy" width="1440" height="1725">';
  const lines = '<i></i><i></i><i></i><i></i>';
  const content = {
    line: `<div class="preview-channel"><span>КАНАЛ № 17</span><b>Неизвестный</b><div class="preview-message">Конверт перед вами. Начните с записи дежурного: там сохранился месяц.</div><div class="preview-message own">С чего стоит начать?</div><div class="preview-input">Ваш вопрос неизвестному… <em>↗</em></div></div>`,
    paper: `<div class="preview-paper"><span>НОЧНОЕ ПОЧТОВОЕ БЮРО</span><b>Запись дежурного</b><div class="preview-ruled">${lines}<i></i><i></i></div><span class="preview-seal">АРХИВ<br>017</span></div>`,
    print: `<div class="preview-print"><span>СЛУЖЕБНАЯ КОПИЯ</span><b>ПОВТОРНЫЙ<br>ОТТИСК</b><i>АРХИВ · 017 · КОНТРОЛЬ</i></div><div class="preview-patterns"><i></i><i></i><i></i></div>`,
    cipher: `<div class="preview-reverse"><span>ОБОРОТ КОНВЕРТА</span><b>Карандашные отметки</b><div class="preview-cipher-pairs">${bookCipher.pairs.map(pair => `<i>${esc(pair.join(':'))}</i>`).join('<em>/</em>')}</div><small>Их назначение не указано.</small></div>`,
    notes: `<div class="preview-notebook"><b>Мой блокнот</b><p>Что не сходится?<br>Какие детали повторяются?</p><div class="preview-ruled">${lines}<i></i></div></div>`,
    hints: `<div class="preview-hints"><span>ПОМОЩЬ АРХИВА</span><b>Подсказки по делу</b><p><i>01</i> Куда обратить внимание</p><p><i>02</i> Какой способ применить</p><p><i>03</i> Прямая помощь</p><small>Последний уровень — по вашему выбору.</small></div>`,
    envelope: `<div class="preview-envelope"><span>ТИХОРЕЧЬЕ · НОЧНОЕ БЮРО</span><b>Передать тому,<br>кто восстановит дату.</b><i>017</i><small>ДАТА: ____ · ____ · ________</small></div>`
  }[kind];
  return `<div class="home-screen-preview preview-${kind}" aria-hidden="true"><div class="preview-toolbar"><span>ТИХОРЕЧЬЕ</span><span>ДЕЛО № 017</span></div><div class="preview-content">${content}</div></div>`;
}
function difficulty(value) {
  return `<span class="home-difficulty" aria-label="Сложность ${value} из 5">${Array.from({length:5},(_,i)=>`<i class="${i < value ? 'filled' : ''}"></i>`).join('')}</span>`;
}
function meta(time, price, level) {
  return `<dl class="home-game-meta"><div><dt>Сложность</dt><dd>${difficulty(level)}</dd></div><div><dt>Время</dt><dd>${esc(time)}</dd></div><div><dt>Игроки</dt><dd>1</dd></div><div><dt>Стоимость</dt><dd>${esc(price)}</dd></div></dl>`;
}
function paidCard(item, index) {
  return `<article class="home-game" data-action="paid" data-case="${item.id}">
    <button class="home-game-image home-art-${item.art}" data-action="paid" data-case="${item.id}" aria-label="Открыть расследование «${esc(item.title)}»"><span class="home-game-badge">Самостоятельное расследование</span><span class="cover-object">${esc(item.cover)}</span></button>
    <div class="home-game-body"><span class="home-game-number">ДЕЛО № ${item.number}</span><h3>${esc(item.title)}</h3>${meta(item.time,item.price,index % 2 ? 4 : 3)}<div class="home-tags"><span>${esc(item.tag)}</span><span>улики</span><span>разговоры</span></div><p class="home-game-blurb">${esc(item.description)}</p><div class="home-game-actions"><button class="home-pill" data-action="paid" data-case="${item.id}">Открыть дело — ${esc(item.price)}</button><button class="home-pill home-pill-outline" data-action="paid" data-case="${item.id}">Читать завязку</button><button class="home-card-link" data-action="paid" data-case="${item.id}">Подробнее о расследовании →</button></div><p class="home-game-fine">Сначала пройдите первое бесплатное дело.</p></div>
  </article>`;
}

export function landingMarkup(state) {
  const started = state.revision > 0 || state.messages.length > 1;
  const startLabel = state.solved ? 'Вернуться к делу' : started ? 'Продолжить расследование' : 'Сыграть бесплатно';
  return `<div class="showcase-home">
    <section class="home-hero" aria-labelledby="home-title"><div class="home-hero-background" aria-hidden="true"></div><div class="home-hero-inner"><h1 id="home-title">Тихоречье</h1><span class="home-title-stamp">017</span><p class="home-genre">Мистический детектив в браузере · 16+</p><p class="home-lead">В старом почтовом бюро хранятся дела, в которых не хватает самой важной записи. Ночью в архив передают запечатанный конверт: его получит тот, кто восстановит дату. Отправитель намеренно оставил следы и ждёт на линии. Изучайте документы, замечайте узоры, возвращайтесь к знакомым записям и задавайте свои вопросы. Когда сведения сойдутся, можно будет открыть письмо.</p><div class="home-cta"><button class="home-pill" data-action="start">${startLabel}</button><a class="home-pill home-pill-outline" href="#cases" data-action="section" data-target="cases">Все расследования</a></div><p class="home-hero-note">Первое дело «Письмо без даты» полностью бесплатно. Без установки и регистрации. Прогресс сохраняется автоматически — можно продолжить позже.</p></div></section>
    <section class="home-section" id="look"><div class="home-wrap"><p class="home-kicker">Внутри расследования</p><h2 class="home-heading">Архив, в который вы войдёте</h2><div class="home-shots">${shots.map(([kind,caption]) => `<figure class="home-shot"><div class="home-shot-frame">${preview(kind)}</div><figcaption>${esc(caption)}</figcaption></figure>`).join('')}</div></div></section>
    <section class="home-section home-how" id="how"><div class="home-wrap"><p class="home-kicker">Как устроена игра</p><h2 class="home-heading">Расследование в ваших руках</h2><p class="home-section-intro">Неизвестному можно задавать собственные вопросы. Но окончательную версию складываете вы — из документов, наблюдений и найденных совпадений.</p><div class="home-steps">${steps.map(([number,symbol,title,copy]) => `<article><span class="home-step-number">${number}</span><span class="home-step-icon" aria-hidden="true">${symbol}</span><h3>${title}</h3><p>${copy}</p></article>`).join('')}</div><button class="home-rules-link" data-action="rules">Памятка следователя: документы, узоры, повторное чтение и подсказки →</button><div class="home-facts"><div><b>0 ₽</b><span>для прохождения первого дела целиком</span></div><div><b>20–30</b><span>минут на первое расследование, без таймера</span></div><div><b>3</b><span>уровня подсказок для каждой части</span></div></div></div></section>
    <section class="home-section home-catalog" id="cases"><div class="home-wrap"><p class="home-kicker">Каталог дел</p><h2 class="home-heading">С какого дела начнётся ваша ночь?</h2><button class="home-bundle" data-action="paid" data-case="collection"><span class="home-bundle-copy"><span class="home-bundle-kicker">Архивный набор · четыре расследования</span><strong>Больше дел в одном конверте</strong><span>Закрытая гостиница, ночной рейс, лишний этаж и непроявленная плёнка. Начните знакомство с архивом с бесплатного дела.</span></span><span class="home-bundle-price"><s>1 660 ₽</s><b>990 ₽</b><span class="home-pill home-pill-small">Открыть набор</span></span></button>
    <div class="home-games"><article class="home-game home-game-wide"><button class="home-game-image home-art-letter" data-action="start" aria-label="Принять бесплатное дело «Письмо без даты»"><span class="home-game-badge">Первое дело · бесплатно</span><span class="home-cover-envelope"><small>НОЧНОЕ ПОЧТОВОЕ БЮРО</small><b>Передать тому,<br>кто восстановит дату.</b><i>017</i></span></button><div class="home-game-body"><span class="home-game-number">ДЕЛО № 017</span><h3>Письмо без даты</h3>${meta('20–30 минут','Бесплатно',2)}<div class="home-tags"><span>письмо</span><span>документы</span><span>кинофрагмент</span><span>узоры</span><span>разговор с ИИ</span></div><p class="home-game-blurb">${esc(archive.description)}</p><div class="home-game-actions"><button class="home-pill" data-action="start">${started ? 'Продолжить дело' : 'Принять дело бесплатно'}</button><details class="home-premise"><summary>Прочитать завязку</summary><div><p>Конверт передан в ночной архив вместе со служебной запиской, повреждённым оттиском и карточкой из комнаты связи.</p><p>Ни один из документов не даёт полного ответа. Но вместе они указывают на один день — и право открыть письмо.</p></div></details></div><p class="home-game-fine">Полное прохождение без покупки и подписки.</p></div></article>${cases.map(paidCard).join('')}</div></div></section>
    <section class="home-section home-features"><div class="home-wrap"><p class="home-kicker">Почему это работает</p><h2 class="home-heading">Детали складываются в ответ</h2><div class="home-feature-grid"><article><h3>Разговор своими словами</h3><p>Уточняйте, сомневайтесь, спрашивайте о находках. На линии — собеседник, а не список кнопок с репликами.</p></article><article><h3>Ответ — в материалах</h3><p>Документы можно открыть снова. Каждый найденный фрагмент остаётся в досье.</p></article><article><h3>Помощь без штрафов</h3><p>Подсказки помогают двигаться дальше. Неверный ответ не уничтожает то, что уже удалось найти.</p></article><article><h3>В своём темпе</h3><p>Таймер не торопит. Блокнот и сохранение позволяют вернуться к расследованию позже.</p></article></div></div></section>
    <section class="home-section" id="faq"><div class="home-wrap"><p class="home-kicker">Частые вопросы</p><h2 class="home-heading">Прежде чем открыть архив</h2><div class="home-faq">${faq.map(([question,answer])=>`<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div></div></section>
    <section class="home-section home-final"><div class="home-wrap"><h2 class="home-heading">На линии всё ещё ждут</h2><p class="home-section-intro">В Тихоречье осталось письмо, которое пока никто не открыл.</p><div class="home-cta"><button class="home-pill" data-action="start">${startLabel}</button><a class="home-pill home-pill-outline" href="#cases" data-action="section" data-target="cases">Выбрать расследование</a></div></div></section>
    <footer class="home-footer"><div class="home-wrap"><a class="home-footer-brand" href="#" data-action="home">ТИХОРЕЧЬЕ · АРХИВ</a><a href="#how" data-action="section" data-target="how">Как играть</a><a href="#cases" data-action="section" data-target="cases">Расследования</a><a href="#faq" data-action="section" data-target="faq">Вопросы</a><button data-action="about">О ночном бюро</button><span class="home-age">16+</span><p>© 2026 «Тихоречье» · Архивная история и события расследований вымышлены.</p></div></footer>
  </div>`;
}

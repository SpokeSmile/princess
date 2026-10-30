const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// The letter is requested only after the strip has been torn off.
export function openEnvelope({ unseal, reveal }) {
  const trigger = document.activeElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const animations = new Set();
  const dialog = document.createElement('dialog');
  dialog.className = 'letter-opening';
  dialog.setAttribute('aria-labelledby', 'opening-title');
  dialog.setAttribute('aria-describedby', 'opening-instruction');
  dialog.innerHTML = `
    <div class="opening-flash" aria-hidden="true"></div>
    <button class="opening-close" type="button" aria-label="Вернуться к материалам">×</button>
    <div class="opening-body">
      <header class="opening-heading"><span>ДАТА ВОССТАНОВЛЕНА</span><h2 id="opening-title">Осталось только открыть.</h2><p id="opening-instruction">Зажмите край полоски и проведите слева направо.</p></header>
      <div class="opening-scene">
        <div class="opening-envelope">
          <div class="opening-back" aria-hidden="true"></div>
          <div class="opening-paper" aria-hidden="true"><span>ЛИЧНОЕ ПИСЬМО</span><b>Для того,<br>кто нашёл этот день.</b><i></i><i></i><i></i><i></i><i></i></div>
          <div class="opening-face" aria-hidden="true"><span class="opening-postmark">ТИХОРЕЧЬЕ<br>НОЧНОЕ БЮРО</span><p>Передать тому,<br>кто восстановит дату.</p><span class="opening-mark">017</span><small>ВРУЧИТЬ ЛИЧНО · ВЛОЖЕНИЕ ВНУТРИ</small></div>
          <div class="opening-flap" aria-hidden="true"></div>
          <div class="opening-tear">
            <div class="opening-scar" aria-hidden="true"></div><div class="opening-strip" aria-hidden="true"><span>ПОТЯНИТЕ СЛЕВА НАПРАВО</span></div><div class="opening-peel" aria-hidden="true"></div>
            <button class="opening-grip" type="button" role="slider" aria-label="Оторвать полоску конверта" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-orientation="horizontal" aria-describedby="opening-keyboard"><span aria-hidden="true">→</span></button>
          </div>
        </div>
      </div>
      <div class="opening-caption"><p class="opening-status" role="status" aria-live="polite">Письмо ждёт внутри.</p><p id="opening-keyboard">Можно отпустить и продолжить. С клавиатуры: стрелка вправо или Enter.</p><button class="opening-alternative" type="button">Открыть без жеста</button><button class="opening-retry" type="button" hidden>Попробовать открыть ещё раз</button></div>
    </div>`;
  const grip = dialog.querySelector('.opening-grip');
  const rail = dialog.querySelector('.opening-tear');
  const status = dialog.querySelector('.opening-status');
  const alternative = dialog.querySelector('.opening-alternative');
  const retry = dialog.querySelector('.opening-retry');
  let progress = 0;
  let torn = 0;
  let lift = 0;
  let velocity = 0;
  let dragging = null;
  let frame = 0;
  let settleResolve;
  let springTarget = 0;
  let busy = false;
  let disposed = false;
  let flightStarted = false;
  let resolveOpening;
  const completion = new Promise(resolve => { resolveOpening = resolve; });
  const on = (element, name, callback, options = {}) => element.addEventListener(name, callback, { ...options, signal: events.signal });

  function paint() {
    const travel = Math.max(1, rail.clientWidth - grip.offsetWidth);
    rail.style.setProperty('--grip-x', `${progress * travel}px`);
    rail.style.setProperty('--cut', `${torn === 0 ? 0 : torn === 1 ? rail.clientWidth : torn * travel + grip.offsetWidth / 2}px`);
    rail.style.setProperty('--lift', `${motion.matches ? 0 : lift}px`);
    rail.style.setProperty('--peel-angle', `${motion.matches ? 0 : -torn * 9 + lift / 8}deg`);
    dialog.classList.toggle('has-tear', torn > .005);
    grip.setAttribute('aria-valuenow', String(Math.round(torn * 100)));
    grip.setAttribute('aria-valuetext', `Оторвано ${Math.round(torn * 100)} процентов`);
  }
  function stopSpring() {
    cancelAnimationFrame(frame); frame = 0;
    settleResolve?.(false); settleResolve = null;
  }
  function settle(target, initialVelocity = velocity) {
    stopSpring(); springTarget = target;
    if (disposed) return Promise.resolve(false);
    if (motion.matches) {
      progress = target; torn = Math.max(torn, progress); lift = 0; velocity = 0; paint();
      return Promise.resolve(true);
    }
    velocity = clamp(initialVelocity, -3, 5);
    let previous = performance.now();
    return new Promise(resolve => {
      settleResolve = resolve;
      function tick(time) {
        const delta = Math.min((time - previous) / 1000, .032); previous = time;
        const steps = Math.max(1, Math.ceil(delta / .008));
        for (let i = 0; i < steps; i++) {
          const step = delta / steps;
          velocity += ((target - progress) * 460 - velocity * 43) * step;
          progress = clamp(progress + velocity * step);
        }
        torn = Math.max(torn, Math.min(progress, target)); lift *= Math.exp(-delta * 14); paint();
        if (Math.abs(target - progress) < .0008 && Math.abs(velocity) < .008) {
          progress = target; torn = Math.max(torn, target); lift = 0; paint();
          frame = 0; settleResolve = null; resolve(true);
        } else frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    });
  }
  function releasePointer() {
    const current = dragging; dragging = null;
    dialog.classList.remove('is-held');
    if (current && grip.hasPointerCapture(current.id)) grip.releasePointerCapture(current.id);
  }
  function close(opened = false) {
    if (disposed) return;
    disposed = true; releasePointer(); stopSpring(); events.abort(); resize.disconnect();
    for (const animation of animations) animation.cancel();
    dialog.close(); dialog.remove(); document.body.classList.remove('is-opening-letter');
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    resolveOpening(opened);
  }
  async function play(element, frames, options = {}) {
    if (disposed) return;
    const spatial = frames.some(frame => 'transform' in frame || 'translate' in frame);
    const animation = element.animate(motion.matches && spatial ? [frames.at(-1)] : frames, {
      duration: 500, easing: 'cubic-bezier(.22,.75,.2,1)', fill: 'forwards', ...options,
      ...(motion.matches ? { duration: spatial ? 1 : 140, delay: 0 } : {})
    });
    animations.add(animation);
    try { await animation.finished; } catch { /* Closing the dialog cancels its animation. */ }
  }
  async function unpack() {
    dialog.classList.add('is-unpacking');
    status.textContent = 'Конверт открыт. Достаём письмо…';
    alternative.hidden = true;
    dialog.querySelector('#opening-keyboard').hidden = true;
    if (motion.matches) {
      await revealLetter();
      return;
    }
    await play(dialog.querySelector('.opening-flap'), [
      { transform: 'rotateX(0deg)' }, { transform: 'rotateX(-176deg)' }
    ], { duration: 580 });
    if (disposed) return;
    const envelopeParts = ['.opening-back', '.opening-face', '.opening-flap', '.opening-tear'];
    await Promise.all([
      play(dialog.querySelector('.opening-paper'), [
        { transform: 'translateY(0) rotate(-2deg)', opacity: 1 },
        { transform: 'translateY(-65%) rotate(0deg) scale(1.04)', opacity: 1 }
      ], { duration: 850 }),
      ...envelopeParts.map(selector => play(dialog.querySelector(selector), [
        { translate: '0 0', opacity: 1 }, { translate: '0 80px', opacity: 0 }
      ], { duration: 650, delay: 320 }))
    ]);
    if (!disposed) await revealLetter();
  }
  async function revealLetter() {
    if (disposed) return;
    if (!motion.matches) {
      await play(dialog.querySelector('.opening-flash'), [{ opacity: 0 }, { opacity: 1 }], {
        duration: 280, easing: 'cubic-bezier(.3,0,.2,1)'
      });
    }
    if (disposed) return;
    await reveal?.();
    if (disposed) return;
    dialog.classList.add('is-revealing');
    if (!motion.matches) dialog.classList.add('is-flashed');
    await play(dialog, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
  }
  async function finish(initialVelocity = 0) {
    if (busy || disposed) return;
    busy = true; releasePointer();
    dialog.classList.remove('opening-failed');
    grip.setAttribute('aria-disabled', 'true');
    alternative.disabled = true; retry.hidden = true;
    status.textContent = 'Снимаем полоску…';
    try {
      if (!await settle(1, initialVelocity) || disposed) return;
      dialog.classList.add('is-torn');
      if (!flightStarted && !motion.matches) {
        flightStarted = true;
        const peel = dialog.querySelector('.opening-peel');
        void play(peel, [
          { transform: getComputedStyle(peel).transform, opacity: 1 },
          { transform: 'translate(70px, 85px) rotate(19deg)', opacity: 0 }
        ], { duration: 450 });
      }
      status.textContent = 'Полоска снята. Получаем письмо…';
      await unseal();
      if (disposed) return;
      await unpack();
      if (!disposed) close(true);
    } catch (error) {
      if (disposed) return;
      status.textContent = error.message || 'Не удалось получить письмо. Попробуйте снова.';
      dialog.classList.add('opening-failed');
      alternative.hidden = true; retry.hidden = false; retry.focus({ preventScroll: true });
    } finally { busy = false; }
  }

  on(grip, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || busy || torn === 1) return;
    event.preventDefault(); stopSpring();
    grip.focus({ preventScroll: true });
    dragging = {
      id: event.pointerId, x: event.clientX, y: event.clientY, start: progress,
      travel: Math.max(1, rail.getBoundingClientRect().width - grip.getBoundingClientRect().width),
      samples: [{ time: event.timeStamp, value: progress }]
    };
    grip.setPointerCapture(event.pointerId); dialog.classList.add('is-held');
    status.textContent = 'Тяните полоску вправо.';
  });
  on(grip, 'pointermove', event => {
    if (!dragging || dragging.id !== event.pointerId) return;
    progress = clamp(dragging.start + (event.clientX - dragging.x) / dragging.travel);
    torn = Math.max(torn, progress);
    const scale = rail.getBoundingClientRect().width / Math.max(1, rail.clientWidth);
    lift = clamp((event.clientY - dragging.y) / scale, -28, 26);
    dragging.samples.push({ time: event.timeStamp, value: progress });
    dragging.samples = dragging.samples.filter(sample => sample.time >= event.timeStamp - 100);
    const first = dragging.samples[0];
    velocity = first && event.timeStamp > first.time ? (progress - first.value) * 1000 / (event.timeStamp - first.time) : 0;
    paint();
    if (progress >= .985) void finish(velocity);
  });
  function endDrag(event, cancelled = false) {
    if (!dragging || dragging.id !== event.pointerId) return;
    const last = dragging.samples.at(-1);
    const releaseVelocity = last && event.timeStamp - last.time < 100 ? velocity : 0;
    releasePointer();
    if (!cancelled && (torn >= .94 || (torn >= .8 && releaseVelocity > 0 && torn + releaseVelocity * .1 >= .98))) {
      void finish(releaseVelocity);
    } else {
      void settle(torn, releaseVelocity);
      status.textContent = torn > 0 ? 'Полоска уже надорвана. Возьмите за край и продолжите вправо.' : 'Зажмите край полоски и потяните вправо.';
    }
  }
  on(grip, 'pointerup', event => endDrag(event));
  on(grip, 'pointercancel', event => endDrag(event, true));
  on(grip, 'lostpointercapture', event => endDrag(event, true));
  on(window, 'blur', () => { if (dragging) endDrag({ pointerId: dragging.id, timeStamp: performance.now() }, true); });
  on(grip, 'keydown', event => {
    if (busy) return;
    if (['Enter', ' ', 'End'].includes(event.key)) { event.preventDefault(); void finish(); }
    if (event.key === 'ArrowRight') {
      event.preventDefault(); stopSpring(); progress = Math.min(1, torn + .1); torn = progress; paint();
      if (torn >= .98) void finish();
    }
  });
  on(alternative, 'click', () => { void finish(); });
  on(retry, 'click', () => { void finish(); });
  on(dialog.querySelector('.opening-close'), 'click', () => close());
  on(dialog, 'cancel', event => { event.preventDefault(); close(); });
  on(motion, 'change', () => {
    if (!motion.matches) return;
    if (frame) {
      cancelAnimationFrame(frame); frame = 0;
      progress = springTarget; torn = Math.max(torn, progress); lift = 0; paint();
      const resolve = settleResolve; settleResolve = null; resolve?.(true);
    }
    for (const animation of animations) if (animation.playState === 'running') animation.finish();
    paint();
  });
  const resize = new ResizeObserver(paint);
  document.body.append(dialog); document.body.classList.add('is-opening-letter'); dialog.showModal();
  resize.observe(rail); paint(); grip.focus({ preventScroll: true });
  return completion;
}

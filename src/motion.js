// Небольшие пружины без зависимостей. Новая цель сохраняет текущую скорость.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const states = new WeakMap();
const moving = new Map();
const fades = new Set();
const defaults = { x: 0, y: 0, scale: 1, rotate: 0 };
let frame = 0;
let previousTime = 0;

function paint(element, state) {
  element.style.translate = `${state.value.x}px ${state.value.y}px`;
  element.style.scale = String(state.value.scale);
  element.style.rotate = `${state.value.rotate}deg`;
}

function tick(time) {
  const delta = Math.min((time - (previousTime || time - 16)) / 1000, .032);
  previousTime = time;
  for (const [element, state] of moving) {
    if (!element.isConnected) { moving.delete(element); continue; }
    let settled = true;
    // Короткие шаги интегрирования остаются устойчивыми после пропущенного кадра.
    const steps = Math.ceil(delta / .008);
    const step = delta / steps;
    for (const property of Object.keys(defaults)) {
      for (let index = 0; index < steps; index++) {
        state.velocity[property] += ((state.target[property] - state.value[property]) * state.stiffness - state.velocity[property] * state.damping) * step;
        state.value[property] += state.velocity[property] * step;
      }
      const precision = property === 'scale' ? .0002 : .03;
      if (Math.abs(state.target[property] - state.value[property]) > precision || Math.abs(state.velocity[property]) > precision) settled = false;
    }
    if (settled) { state.value = { ...state.target }; moving.delete(element); }
    paint(element, state);
  }
  if (moving.size) frame = requestAnimationFrame(tick);
  else { frame = 0; previousTime = 0; }
}

export function springTo(element, target, { from, stiffness = 420, damping = 41 } = {}) {
  if (!element) return;
  let state = states.get(element);
  if (!state) {
    state = { value: { ...defaults }, target: { ...defaults }, velocity: { ...defaults, scale: 0 } };
    states.set(element, state);
  }
  if (from) Object.assign(state.value, from);
  Object.assign(state.target, target);
  state.stiffness = stiffness;
  state.damping = damping;
  if (reducedMotion.matches) {
    state.value = { ...state.target };
    state.velocity = { x: 0, y: 0, scale: 0, rotate: 0 };
    moving.delete(element);
  } else moving.set(element, state);
  paint(element, state);
  if (moving.size && !frame) frame = requestAnimationFrame(tick);
}

export function fade(element, keyframes, options = {}) {
  if (!element || reducedMotion.matches) return null;
  const animation = element.animate(keyframes, { duration: 180, easing: 'ease-out', ...options });
  fades.add(animation);
  const cleanup = () => fades.delete(animation);
  animation.addEventListener('finish', cleanup, { once: true });
  animation.addEventListener('cancel', cleanup, { once: true });
  return animation;
}

export function reveal(element, distance = 12) {
  if (!element) return;
  springTo(element, { y: 0 }, { from: { y: reducedMotion.matches ? 0 : distance } });
  fade(element, [{ opacity: 0 }, { opacity: 1 }]);
}

export function reorderWithMotion(list, mutate) {
  const positions = new Map([...list.children].map(element => [element, element.getBoundingClientRect().top]));
  mutate();
  for (const element of list.children) {
    const offset = positions.get(element) - element.getBoundingClientRect().top;
    const current = states.get(element)?.value.y || 0;
    springTo(element, { y: 0 }, { from: { y: reducedMotion.matches ? 0 : current + offset } });
  }
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  if (frame) cancelAnimationFrame(frame);
  frame = 0; previousTime = 0;
  for (const [element, state] of moving) {
    state.value = { ...state.target };
    state.velocity = { x: 0, y: 0, scale: 0, rotate: 0 };
    paint(element, state);
  }
  moving.clear();
  for (const animation of [...fades]) animation.finish();
});

// Мгновенный отклик на нажатие, включая отпускание пальца за пределами кнопки.
export function bindInteractions(root = document) {
  const pressed = new Map();
  const release = event => {
    const element = pressed.get(event.pointerId);
    if (element) { springTo(element, { scale: 1 }); pressed.delete(event.pointerId); }
  };
  root.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    release(event);
    const element = event.target.closest('.primary-button, .case-card, .file-button, .tab-button, .evidence-card');
    if (!element || element.disabled) return;
    pressed.set(event.pointerId, element);
    springTo(element, { scale: .975 }, { stiffness: 700, damping: 53 });
  });
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  window.addEventListener('blur', () => {
    for (const element of pressed.values()) springTo(element, { scale: 1 });
    pressed.clear();
  });
  root.addEventListener('pointerout', event => { if (event.relatedTarget === null) release(event); });
}

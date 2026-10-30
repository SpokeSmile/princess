import { escapeHtml as esc } from './game.js';
import { fade, springTo } from './motion.js';

export function finalLetterMarkup(letter) {
  return `<section class="love-page" aria-labelledby="love-title"><article class="love-letter" tabindex="-1"><h1 id="love-title">${esc(letter.salutation)}</h1><div class="love-copy">${letter.paragraphs.map((paragraph, index) => `<p${index === letter.paragraphs.length - 1 ? ' class="love-confession"' : ''}>${esc(paragraph)}</p>`).join('')}</div><p class="love-signature">${esc(letter.signature)}</p></article><a class="love-home" href="/" data-action="home">Вернуться на главную страницу</a></section>`;
}

export function animateFinalLetter() {
  const letter = document.querySelector('.love-letter');
  if (!letter) return;
  springTo(letter, { y: 0 }, { from: { y: 16 }, stiffness: 160, damping: 26 });
  fade(letter, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000, delay: 80, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
}

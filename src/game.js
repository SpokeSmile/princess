import { archive } from './content.js';

export const NOTES_KEY = 'tihorechye:notes:v1';
export const UI_KEY = 'tihorechye:undated-letter:ui:v1';
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
export function emptyState() {
  return { case_id: archive.caseId, run_id: '', revision: -1, messages: [{ role: 'assistant', source: 'script', content: archive.opening }], evidence: [], solved: false, month_solved: false, film_solved: false, stamp_solved: false, year_solved: false, letter_opened: false, hints: {}, hint_log: [], discoveries: { month: null, day: null, year: null, reading_method: null }, current_stage: 'month', current_task: archive.firstTask, ai_configured: false, csrf_token: '' };
}
export function safeMessages(messages) {
  if (!Array.isArray(messages)) return emptyState().messages;
  return messages.filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').map(message => ({ role: message.role, content: message.content, ...(['script', 'groq'].includes(message.source) ? { source: message.source } : {}) }));
}
export function validMessage(value) {
  const message = String(value ?? '').trim();
  return message.length > 0 && message.length <= 1500;
}
// Logical words are independent of punctuation and visual line wrapping.
export function registryWords(line) {
  return [...String(line).matchAll(/[а-яёa-z0-9]+/giu)].map((match, index) => ({
    text: match[0], start: match.index, end: match.index + match[0].length, number: index + 1
  }));
}

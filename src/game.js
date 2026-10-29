import { archive } from './content.js';

export const NOTES_KEY = 'tihorechye:notes:v1';
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
export function emptyState() {
  return { case_id: archive.caseId, messages: [{ role: 'assistant', source: 'script', content: archive.opening }], evidence: [], solved: false, film_unlocked: false, film_solved: false, ai_configured: false, csrf_token: '' };
}
export function safeMessages(messages) {
  if (!Array.isArray(messages)) return emptyState().messages;
  return messages.filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').map(message => ({ role: message.role, content: message.content, ...(['script', 'mistral'].includes(message.source) ? { source: message.source } : {}) }));
}
export function validMessage(value) {
  const message = String(value ?? '').trim();
  return message.length > 0 && message.length <= 1500;
}

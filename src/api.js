let csrfToken = '';
let runId = '';
export function setRunId(value) { runId = String(value || ''); }
const stateRoutes = new Set(['/api/game/', '/api/evidence/', '/api/reset/', '/api/letter/']);
export async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRFToken': csrfToken },
      ...(body === undefined ? {} : { body: JSON.stringify({ ...body, ...(runId ? { run_id: runId } : {}) }) }),
      signal: controller.signal
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('Архив не отвечает. Проверьте соединение и попробуйте снова.'); }
    const state = stateRoutes.has(path) ? data : data.state;
    if (state?.csrf_token) csrfToken = state.csrf_token;
    if (!response.ok) {
      const error = new Error(data.error?.message || 'Не удалось получить ответ. Попробуйте ещё раз.');
      error.code = data.error?.code || 'request_failed';
      error.state = data.state;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Ответ задерживается. Соединение прервано; можно попробовать снова.');
    if (error instanceof TypeError) throw new Error('Связь с архивом прервалась. Попробуйте позже.');
    throw error;
  } finally { clearTimeout(timeout); }
}

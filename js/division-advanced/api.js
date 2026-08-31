export async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  if (res.status === 403) {
    const embed = document.documentElement.classList.contains('da-embed');
    if (!embed) window.location.href = '/landing';
    throw new Error('access denied');
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'request failed');
    return data;
  }
  if (!res.ok) throw new Error('request failed');
  return res;
}

export function logInteraction(action, details) {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interaction: { action, page: 'division-advanced', ...(details || {}) } })
  }).catch(() => {});
}

const PORTAL_LAST_EVENT_KEY = 'portal-last-event-id';

export function readPortalEventId() {
  try {
    return String(sessionStorage.getItem(PORTAL_LAST_EVENT_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

export function rememberPortalEventId(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return;
  try {
    sessionStorage.setItem(PORTAL_LAST_EVENT_KEY, id);
  } catch (_) { /* ignore */ }
}

export function notifyPortalEventSelected(eventId) {
  if (eventId) rememberPortalEventId(eventId);
  const payload = {
    type: 'portal-event-selected',
    eventId: String(eventId || '')
  };
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, window.location.origin);
    }
  } catch (_) { /* ignore */ }
}

/** Tell landing (and other tool iframes) that draws/schedule data changed. */
export function notifyPortalDataUpdated({ eventId = '', deleted = false } = {}) {
  if (eventId) rememberPortalEventId(eventId);
  const payload = {
    type: 'portal-data-updated',
    eventId: String(eventId || ''),
    deleted: Boolean(deleted)
  };
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, window.location.origin);
    }
  } catch (_) { /* ignore */ }
}

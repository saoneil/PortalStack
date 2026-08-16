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

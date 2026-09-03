export function detectPortalPage() {
  const path = location.pathname || '';
  if (path.includes('/landing')) return 'landing';
  if (path.includes('/live-schedule')) return 'live-schedule';
  if (path.includes('/umpire-management')) return 'umpire-management';
  if (path.includes('/digital-id')) return 'digital-id';
  if (path.includes('/division-advanced')) return 'division-advanced';
  if (path.includes('/registration')) return 'registration';
  return 'portal';
}

export function logInteraction(action, details = {}, pageOverride) {
  const page = pageOverride || detectPortalPage();
  const payload = {
    interaction: Object.assign({ action, page }, details || {})
  };
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin'
  }).catch(() => {});
}

if (typeof window !== 'undefined') {
  window.portalLogInteraction = logInteraction;
}

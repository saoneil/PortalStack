function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'division-advanced' }, details || {}) };
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {});
}

function redirectToLanding() {
  window.location.href = '/landing';
}

function applyProfile(profile) {
  var clientName = profile && profile.clientName ? String(profile.clientName) : '';
  var username = profile && profile.username ? String(profile.username) : '';
  var principleUserAdvanced = Number(profile && profile.principleUserAdvanced) === 1;

  if (!principleUserAdvanced) {
    redirectToLanding();
    return false;
  }

  var profileLabel = document.getElementById('profileLabel');
  var profileClientName = document.getElementById('profileClientName');
  var loggedInUser = document.getElementById('loggedInUser');
  var loggedInUsername = document.getElementById('loggedInUsername');

  if (profileLabel && profileClientName && clientName) {
    profileClientName.textContent = clientName;
    profileLabel.hidden = false;
  }

  if (loggedInUser && loggedInUsername && username) {
    loggedInUsername.textContent = username;
    loggedInUser.hidden = false;
  }

  return true;
}

logInteraction('page_view', { description: 'Advanced division creation page loaded' });

fetch('/api/profile')
  .then(function(res) {
    if (res.status === 401 || res.redirected) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) throw new Error('Unable to load profile');
    return res.json();
  })
  .then(function(profile) {
    if (!profile) return;
    applyProfile(profile);
  })
  .catch(function() {
    redirectToLanding();
  });

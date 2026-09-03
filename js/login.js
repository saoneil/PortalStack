function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'login' }, details || {}) };
  fetch('/api/public-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {});
}

logInteraction('page_view', { description: 'Login page loaded' });

document.getElementById('loginForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var client = form.querySelector('[name="client"]').value;
  var username = form.querySelector('[name="username"]').value;
  var password = form.querySelector('[name="password"]').value;
  logInteraction('login_attempt', { client: client, username: username });

  fetch('/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: client, username: username, password: password })
  })
  .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
  .then(function(result) {
    if (result.data.success && result.data.redirect) {
      logInteraction('login_success', { client: client, username: username });
      window.location.href = result.data.redirect;
    } else {
      logInteraction('login_error', { client: client, username: username, error: result.data.error || 'unknown' });
      alert(result.data.error || 'Login failed. Please try again.');
    }
  })
  .catch(function() {
    logInteraction('login_error', { client: client, username: username, error: 'network' });
    alert('Unable to reach the server. Please try again shortly.');
  });
});

var backToPortalBtn = document.getElementById('backToPortalBtn');
if (backToPortalBtn) {
  backToPortalBtn.addEventListener('click', function() {
    logInteraction('navigate_back_to_portal', { description: 'User clicked back to portal button' });
  });
}

var createAccountBtn = document.getElementById('createAccountBtn');
if (createAccountBtn) {
  createAccountBtn.addEventListener('click', function() {
    logInteraction('navigate_create_account', { description: 'User clicked create account button' });
  });
}

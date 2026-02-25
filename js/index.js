function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'index' }, details || {}) };
  fetch('/api/log', {
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
      window.location.href = result.data.redirect;
    } else {
      alert(result.data.error || 'Login failed. Please try again.');
    }
  })
  .catch(function() {
    alert('Unable to reach the server. Please try again shortly.');
  });
});

document.getElementById('signupNavForm').addEventListener('submit', function() {
  logInteraction('navigate_signup', { description: 'User clicked sign up button' });
});

document.getElementById('returnPmaForm').addEventListener('submit', function() {
  logInteraction('navigate_return_pma', { description: 'User clicked Return to PMA button' });
});

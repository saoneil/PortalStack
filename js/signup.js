function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'signup' }, details || {}) };
  fetch('/api/public-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {});
}

logInteraction('page_view', { description: 'Signup page loaded' });

var RESERVED_USERNAMES = ['admin', 'administrator'];

function isReservedUsername(val) {
  return RESERVED_USERNAMES.indexOf(val.trim().toLowerCase()) !== -1;
}

(function () {
  var input = document.getElementById('signup-username');
  var error = document.getElementById('username-error');
  if (!input || !error) return;
  input.addEventListener('input', function () {
    var reserved = isReservedUsername(input.value);
    error.hidden = !reserved;
  });
}());

document.getElementById('registerForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var client = form.querySelector('[name="client"]').value;
  var username = form.querySelector('[name="username"]').value;
  var password = form.querySelector('[name="password"]').value;

  if (isReservedUsername(username)) {
    var error = document.getElementById('username-error');
    if (error) error.hidden = false;
    logInteraction('register_validation_error', { client: client, username: username, reason: 'reserved_username' });
    return;
  }

  logInteraction('register_attempt', { client: client, username: username });

  fetch('/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: client, username: username, password: password })
  })
  .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
  .then(function(result) {
    if (result.data.success && result.data.redirect) {
      logInteraction('register_success', { client: client, username: username });
      window.location.href = result.data.redirect;
    } else {
      logInteraction('register_error', { client: client, username: username, error: result.data.error || 'unknown' });
      alert(result.data.error || 'Registration failed. Please try again.');
    }
  })
  .catch(function() {
    logInteraction('register_error', { client: client, username: username, error: 'network' });
    alert('Unable to reach the server. Please try again shortly.');
  });
});

document.getElementById('backToLoginForm').addEventListener('submit', function() {
  logInteraction('navigate_back_to_login', { description: 'User clicked back to login from signup' });
});

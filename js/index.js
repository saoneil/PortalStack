function logInteraction(action, details) {
  var payload = { interaction: Object.assign({ action: action, page: 'index' }, details || {}) };
  fetch('/api/public-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {});
}

logInteraction('page_view', { description: 'Portal chooser page loaded' });

document.getElementById('eventRegistrationBtn').addEventListener('click', function() {
  logInteraction('navigate_event_information', { description: 'User clicked Event Information button' });
});

document.getElementById('organizerPortalBtn').addEventListener('click', function() {
  logInteraction('navigate_organizer_portal', { description: 'User clicked Organizer Portal button' });
});

function stripPaymentLinks(container) {
  if (!container) return;
  container.querySelectorAll('a.paypal-link, .paypal-logo').forEach(function(el) {
    el.remove();
  });
  container.querySelectorAll('table').forEach(function(table) {
    table.querySelectorAll('tr').forEach(function(tr) {
      var cells = tr.querySelectorAll('th, td');
      if (cells.length >= 4) {
        cells[cells.length - 1].remove();
      }
      var spanned = tr.querySelector('td[colspan]');
      if (spanned) {
        spanned.colSpan = 3;
      }
    });
  });
  var desc = container.querySelector('#pricingDescription');
  if (desc) {
    desc.textContent = 'Compare options below. Contact PMA or register an organizer account to subscribe.';
  }
}

function loadPublicPricing(lang) {
  var content = document.getElementById('pricingContent');
  if (!content) return Promise.resolve();
  content.innerHTML = '<p class="pricing-loading">Loading pricing…</p>';
  return fetch('/html/pricing/pricing_' + lang + '.html')
    .then(function(res) {
      if (!res.ok) throw new Error('Unable to load pricing');
      return res.text();
    })
    .then(function(html) {
      var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      content.innerHTML = bodyMatch ? bodyMatch[1] : html;
      stripPaymentLinks(content);
      enhancePricingForMobile(content);
    })
    .catch(function() {
      content.innerHTML = '<p class="pricing-error">Unable to load pricing right now. Please try again shortly.</p>';
    });
}

function openPricingModal() {
  var overlay = document.getElementById('pricingOverlay');
  var langSelect = document.getElementById('pricingLanguageSelect');
  if (!overlay) return;
  logInteraction('open_public_pricing', { description: 'Opened public pricing overlay (no payment links)' });
  overlay.hidden = false;
  if (langSelect) langSelect.value = 'en';
  loadPublicPricing('en');
}

function closePricingModal() {
  var overlay = document.getElementById('pricingOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  logInteraction('close_public_pricing', { description: 'Closed public pricing overlay' });
}

document.getElementById('openPricingBtn').addEventListener('click', openPricingModal);
document.getElementById('closePricingBtn').addEventListener('click', closePricingModal);
document.getElementById('pricingOverlay').addEventListener('click', function(evt) {
  if (evt.target === this) closePricingModal();
});
document.getElementById('pricingLanguageSelect').addEventListener('change', function(evt) {
  var lang = evt.target.value || 'en';
  logInteraction('public_pricing_language', { language: lang });
  loadPublicPricing(lang);
});
document.addEventListener('keydown', function(evt) {
  if (evt.key !== 'Escape') return;
  var overlay = document.getElementById('pricingOverlay');
  if (overlay && !overlay.hidden) closePricingModal();
});

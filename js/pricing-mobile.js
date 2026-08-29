function getPricingLayoutMode() {
  if (window.matchMedia('(max-width: 480px)').matches) return 'phone';
  if (window.matchMedia('(max-width: 1024px)').matches) return 'tablet';
  return 'desktop';
}

function appendPricingCustomRow(list, tr) {
  var customCell = tr.querySelector('td');
  if (!customCell) return;
  var custom = document.createElement('div');
  custom.className = 'pricing-mobile-custom';
  custom.innerHTML = customCell.innerHTML;
  list.appendChild(custom);
}

function appendPricingPhoneRow(list, cells) {
  var details = document.createElement('details');
  details.className = 'pricing-mobile-item';

  var summary = document.createElement('summary');
  summary.className = 'pricing-mobile-summary';

  var name = document.createElement('span');
  name.className = 'pricing-mobile-name';
  name.innerHTML = cells[0].innerHTML;

  var price = document.createElement('span');
  price.className = 'pricing-mobile-price';
  price.innerHTML = cells[1].innerHTML;

  summary.appendChild(name);
  summary.appendChild(price);

  var body = document.createElement('div');
  body.className = 'pricing-mobile-body';

  var desc = document.createElement('div');
  desc.className = 'pricing-mobile-desc';
  desc.innerHTML = cells[2].innerHTML;
  body.appendChild(desc);

  if (cells.length >= 4 && cells[3].innerHTML.trim()) {
    var checkout = document.createElement('div');
    checkout.className = 'pricing-mobile-checkout';
    checkout.innerHTML = cells[3].innerHTML;
    body.appendChild(checkout);
  }

  details.appendChild(summary);
  details.appendChild(body);
  list.appendChild(details);
}

function appendPricingTabletRow(list, cells) {
  var item = document.createElement('div');
  item.className = 'pricing-tablet-item';

  var head = document.createElement('div');
  head.className = 'pricing-tablet-head';

  var name = document.createElement('span');
  name.className = 'pricing-mobile-name';
  name.innerHTML = cells[0].innerHTML;

  var price = document.createElement('span');
  price.className = 'pricing-mobile-price';
  price.innerHTML = cells[1].innerHTML;

  head.appendChild(name);
  head.appendChild(price);
  item.appendChild(head);

  var desc = document.createElement('div');
  desc.className = 'pricing-mobile-desc';
  desc.innerHTML = cells[2].innerHTML;
  item.appendChild(desc);

  if (cells.length >= 4 && cells[3].innerHTML.trim()) {
    var checkout = document.createElement('div');
    checkout.className = 'pricing-mobile-checkout';
    checkout.innerHTML = cells[3].innerHTML;
    item.appendChild(checkout);
  }

  list.appendChild(item);
}

function enhancePricingForMobile(container) {
  if (!container) return;

  container.querySelectorAll('.pricing-compact-list').forEach(function(el) {
    el.remove();
  });

  var table = container.querySelector('table');
  if (!table) return;

  var mode = getPricingLayoutMode();
  if (mode === 'desktop') {
    table.style.removeProperty('display');
    return;
  }

  table.style.display = 'none';

  var list = document.createElement('div');
  list.className = 'pricing-compact-list pricing-layout-' + mode;

  table.querySelectorAll('tr').forEach(function(tr, rowIndex) {
    if (rowIndex === 0) return;

    if (tr.classList.contains('pricing-custom-row')) {
      appendPricingCustomRow(list, tr);
      return;
    }

    var cells = tr.querySelectorAll('td');
    if (cells.length < 3) return;

    if (mode === 'phone') {
      appendPricingPhoneRow(list, cells);
      return;
    }

    appendPricingTabletRow(list, cells);
  });

  table.insertAdjacentElement('afterend', list);
}

function refreshAllPricingLayouts() {
  document.querySelectorAll('.pricing-lang-panel, .pricing-content').forEach(function(container) {
    if (container.querySelector('table')) enhancePricingForMobile(container);
  });
}

var pricingResizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(pricingResizeTimer);
  pricingResizeTimer = setTimeout(refreshAllPricingLayouts, 150);
});

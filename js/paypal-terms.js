(function () {
  var STRINGS = {
    en: {
      title: 'Purchasing terms',
      intro: 'Before you continue to PayPal checkout, read and accept the following:',
      terms: [
        'You are purchasing access to a self-service application. You are responsible for setting up and operating the application for your events.',
        'Your results may vary. Outcomes from your use of the application are not guaranteed to match demonstrations, videos, or examples you may have seen.',
        'The application may be updated, changed, or modified at any time. By completing your purchase, you accept that continued use may include future updates.'
      ],
      acceptLabel: 'I have read and accept these purchasing terms',
      cancel: 'Cancel',
      continue: 'Continue to PayPal'
    },
    es: {
      title: 'Términos de compra',
      intro: 'Antes de continuar al pago con PayPal, lea y acepte lo siguiente:',
      terms: [
        'Está comprando acceso a una aplicación de autoservicio. Usted es responsable de configurar y operar la aplicación para sus eventos.',
        'Sus resultados pueden variar. Los resultados de su uso de la aplicación no están garantizados para coincidir con demostraciones, videos o ejemplos que haya visto.',
        'La aplicación puede actualizarse, cambiarse o modificarse en cualquier momento. Al completar su compra, acepta que el uso continuado puede incluir actualizaciones futuras.'
      ],
      acceptLabel: 'He leído y acepto estos términos de compra',
      cancel: 'Cancelar',
      continue: 'Continuar a PayPal'
    },
    fr: {
      title: "Conditions d'achat",
      intro: "Avant de continuer vers le paiement PayPal, veuillez lire et accepter ce qui suit :",
      terms: [
        "Vous achetez l'accès à une application en libre-service. Vous êtes responsable de la configuration et de l'utilisation de l'application pour vos événements.",
        "Vos résultats peuvent varier. Les résultats de votre utilisation de l'application ne sont pas garantis pour correspondre aux démonstrations, vidéos ou exemples que vous avez pu voir.",
        "L'application peut être mise à jour, modifiée ou changée à tout moment. En finalisant votre achat, vous acceptez que l'utilisation continue puisse inclure des mises à jour futures."
      ],
      acceptLabel: "J'ai lu et j'accepte ces conditions d'achat",
      cancel: 'Annuler',
      continue: 'Continuer vers PayPal'
    },
    it: {
      title: 'Termini di acquisto',
      intro: 'Prima di procedere al pagamento PayPal, leggi e accetta quanto segue:',
      terms: [
        "Stai acquistando l'accesso a un'applicazione self-service. Sei responsabile della configurazione e dell'utilizzo dell'applicazione per i tuoi eventi.",
        'I tuoi risultati possono variare. I risultati del tuo utilizzo dell\'applicazione non sono garantiti per corrispondere a dimostrazioni, video o esempi che potresti aver visto.',
        "L'applicazione può essere aggiornata, modificata o cambiata in qualsiasi momento. Completando l'acquisto, accetti che l'uso continuato possa includere aggiornamenti futuri."
      ],
      acceptLabel: 'Ho letto e accetto questi termini di acquisto',
      cancel: 'Annulla',
      continue: 'Continua su PayPal'
    },
    ja: {
      title: '購入条件',
      intro: 'PayPalのチェックアウトに進む前に、以下を読み、同意してください。',
      terms: [
        'セルフサービス型アプリケーションへのアクセスを購入しています。イベント向けの設定と運用はお客様の責任です。',
        '結果は異なる場合があります。アプリケーションの利用結果が、ご覧になったデモ、動画、例と一致することは保証されません。',
        'アプリケーションはいつでも更新、変更、修正される場合があります。購入を完了することで、今後の更新を含む継続利用に同意したものとみなされます。'
      ],
      acceptLabel: 'これらの購入条件を読み、同意します',
      cancel: 'キャンセル',
      continue: 'PayPalに進む'
    },
    pl: {
      title: 'Warunki zakupu',
      intro: 'Przed przejściem do płatności PayPal przeczytaj i zaakceptuj poniższe:',
      terms: [
        'Kupujesz dostęp do aplikacji samoobsługowej. Ty odpowiadasz za konfigurację i obsługę aplikacji podczas swoich wydarzeń.',
        'Twoje wyniki mogą się różnić. Efekty korzystania z aplikacji nie są gwarantowane takie same jak w demonstracjach, filmach lub przykładach, które mogłeś zobaczyć.',
        'Aplikacja może być aktualizowana, zmieniana lub modyfikowana w dowolnym momencie. Dokonując zakupu, akceptujesz, że dalsze korzystanie może obejmować przyszłe aktualizacje.'
      ],
      acceptLabel: 'Przeczytałem/am i akceptuję te warunki zakupu',
      cancel: 'Anuluj',
      continue: 'Przejdź do PayPal'
    },
    nl: {
      title: 'Aankoopvoorwaarden',
      intro: 'Lees en accepteer het volgende voordat u doorgaat naar PayPal:',
      terms: [
        'U koopt toegang tot een selfservice-applicatie. U bent zelf verantwoordelijk voor het instellen en gebruiken van de applicatie voor uw evenementen.',
        'Uw resultaten kunnen variëren. Resultaten van uw gebruik van de applicatie worden niet gegarandeerd gelijk aan demonstraties, video\'s of voorbeelden die u mogelijk hebt gezien.',
        'De applicatie kan op elk moment worden bijgewerkt, gewijzigd of aangepast. Door uw aankoop te voltooien, accepteert u dat voortgezet gebruik toekomstige updates kan omvatten.'
      ],
      acceptLabel: 'Ik heb deze aankoopvoorwaarden gelezen en accepteer ze',
      cancel: 'Annuleren',
      continue: 'Doorgaan naar PayPal'
    },
    ms: {
      title: 'Terma pembelian',
      intro: 'Sebelum meneruskan ke pembayaran PayPal, sila baca dan terima perkara berikut:',
      terms: [
        'Anda membeli akses kepada aplikasi layan diri. Anda bertanggungjawab untuk menyediakan dan mengendalikan aplikasi untuk acara anda.',
        'Keputusan anda mungkin berbeza. Hasil penggunaan aplikasi tidak dijamin sama dengan demonstrasi, video, atau contoh yang anda mungkin telah lihat.',
        'Aplikasi boleh dikemas kini, diubah, atau diubah suai pada bila-bila masa. Dengan melengkapkan pembelian, anda menerima bahawa penggunaan berterusan mungkin termasuk kemas kini pada masa hadapan.'
      ],
      acceptLabel: 'Saya telah membaca dan menerima terma pembelian ini',
      cancel: 'Batal',
      continue: 'Teruskan ke PayPal'
    },
    ru: {
      title: 'Условия покупки',
      intro: 'Перед переходом к оплате через PayPal прочитайте и примите следующее:',
      terms: [
        'Вы приобретаете доступ к приложению самообслуживания. Вы несёте ответственность за настройку и использование приложения для своих мероприятий.',
        'Ваши результаты могут отличаться. Итоги использования приложения не гарантируются такими же, как в демонстрациях, видео или примерах, которые вы могли видеть.',
        'Приложение может обновляться, изменяться или модифицироваться в любое время. Завершая покупку, вы соглашаетесь, что дальнейшее использование может включать будущие обновления.'
      ],
      acceptLabel: 'Я прочитал(а) и принимаю эти условия покупки',
      cancel: 'Отмена',
      continue: 'Перейти к PayPal'
    }
  };

  var overlay = null;
  var checkbox = null;
  var continueBtn = null;
  var pendingUrl = '';
  var pendingTarget = '_blank';
  var pendingCheckoutOption = '';

  var CHECKOUT_LABELS = {
    'P-3SX09611CF132153YNDNVW5Y': 'Subscriber ($25/month)',
    'P-8L961653DD368650MNDNVX5Q': 'Club subscription (yearly)',
    'P-63D48453377935614NDNVY3Q': 'Organizer subscription (monthly)',
    'P-2UX54115DY587734SNDNVZ2I': 'Organizer subscription (yearly)',
    'N73R9PNA4ZUSU': 'Small Event ($150)',
    'KAZVAY7VT6Y9N': 'Large Event ($300)',
    '6FGYWDMSQSEZ8': 'Large Event + Organizer Tools ($450)',
    '8TKGTZMNLLD52': 'Extra instance (non-subscribers)'
  };

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function lookupCheckoutOption(url) {
    try {
      var parsed = new URL(url);
      var planId = parsed.searchParams.get('plan_id');
      if (planId && CHECKOUT_LABELS[planId]) return CHECKOUT_LABELS[planId];
      var paymentMatch = /\/payment\/([^/?#]+)/.exec(parsed.pathname);
      if (paymentMatch && CHECKOUT_LABELS[paymentMatch[1]]) return CHECKOUT_LABELS[paymentMatch[1]];
    } catch (e) {}
    return '';
  }

  function getCheckoutType(url) {
    try {
      var parsed = new URL(url);
      if (parsed.searchParams.get('plan_id')) return 'subscription';
      if (/\/payment\//.test(parsed.pathname)) return 'one_time';
    } catch (e) {}
    return 'unknown';
  }

  function describeCheckoutFromLink(link) {
    if (!link) return '';

    var row = link.closest('tr');
    if (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        var optionName = normalizeText(cells[0].textContent);
        var optionPrice = normalizeText(cells[1].textContent);
        if (optionName) {
          return optionPrice ? optionName + ' (' + optionPrice + ')' : optionName;
        }
      }
    }

    var card = link.closest('.payment-card');
    if (card) {
      var titleEl = card.querySelector('.payment-title, .subscription-title');
      var title = normalizeText(titleEl && titleEl.textContent);
      var cycle = normalizeText(link.textContent)
        .replace(/pay\s*pal/gi, '')
        .replace(/^[—–-]+\s*|\s*[—–-]+$/g, '')
        .trim();
      if (title && cycle) return title + ' — ' + cycle;
      if (title) return title;
    }

    return lookupCheckoutOption(link.href);
  }

  function getLogDetails(url) {
    var checkoutOption = pendingCheckoutOption || lookupCheckoutOption(url) || 'Unknown PayPal checkout option';
    return {
      language: detectLang(),
      paypal_url: url,
      description: checkoutOption,
      checkout_type: getCheckoutType(url)
    };
  }

  function detectPage() {
    var path = location.pathname || '';
    if (path.indexOf('/landing') !== -1) return 'landing';
    if (path.indexOf('/payments/') !== -1) return 'payments';
    if (path.indexOf('/pricing/') !== -1) return 'pricing';
    return 'pricing';
  }

  function logInteraction(action, details) {
    var payload = {
      interaction: Object.assign({ action: action, page: detectPage() }, details || {})
    };
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    }).then(function (res) {
      if (res.ok || res.status !== 401) return null;
      return fetch('/api/public-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }).catch(function () {});
  }

  function detectLang() {
    var sel = document.getElementById('pricingLanguageSelect');
    if (sel && sel.value && STRINGS[sel.value]) return sel.value;
    var match = /(?:pricing|payments)_([a-z]{2})\.html/i.exec(location.pathname);
    if (match && STRINGS[match[1]]) return match[1];
    var htmlLang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
    if (htmlLang && STRINGS[htmlLang]) return htmlLang;
    return 'en';
  }

  function stringsForLang(lang) {
    return STRINGS[lang] || STRINGS.en;
  }

  function buildModal() {
    overlay = document.createElement('div');
    overlay.id = 'paypalTermsOverlay';
    overlay.className = 'paypal-terms-overlay';
    overlay.setAttribute('role', 'presentation');

    overlay.innerHTML =
      '<div class="paypal-terms-modal" role="dialog" aria-modal="true" aria-labelledby="paypalTermsTitle">' +
        '<button type="button" class="paypal-terms-close" aria-label="Close">&times;</button>' +
        '<div class="paypal-terms-header"><h2 id="paypalTermsTitle" class="paypal-terms-title"></h2></div>' +
        '<div class="paypal-terms-body">' +
          '<p class="paypal-terms-intro"></p>' +
          '<ul class="paypal-terms-list"></ul>' +
        '</div>' +
        '<div class="paypal-terms-footer">' +
          '<label class="paypal-terms-accept-row">' +
            '<input type="checkbox" id="paypalTermsAcceptCheckbox">' +
            '<span class="paypal-terms-accept-text"></span>' +
          '</label>' +
          '<div class="paypal-terms-actions">' +
            '<button type="button" class="paypal-terms-btn paypal-terms-btn-cancel"></button>' +
            '<button type="button" class="paypal-terms-btn paypal-terms-btn-continue" disabled></button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    checkbox = overlay.querySelector('#paypalTermsAcceptCheckbox');
    continueBtn = overlay.querySelector('.paypal-terms-btn-continue');
    var cancelBtn = overlay.querySelector('.paypal-terms-btn-cancel');
    var closeBtn = overlay.querySelector('.paypal-terms-close');

    checkbox.addEventListener('change', function () {
      continueBtn.disabled = !checkbox.checked;
    });

    cancelBtn.addEventListener('click', function () {
      closeModal('declined');
    });
    closeBtn.addEventListener('click', function () {
      closeModal('declined');
    });
    overlay.addEventListener('click', function (evt) {
      if (evt.target === overlay) closeModal('declined');
    });

    continueBtn.addEventListener('click', function () {
      if (!checkbox.checked || !pendingUrl) return;
      var url = pendingUrl;
      var target = pendingTarget;
      logInteraction('paypal_terms_accepted', getLogDetails(url));
      closeModal('accepted');
      if (target === '_blank') {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        window.location.href = url;
      }
    });

    document.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && overlay.classList.contains('is-open')) {
        closeModal('declined');
      }
    });
  }

  function renderModal(lang) {
    var s = stringsForLang(lang);
    overlay.querySelector('.paypal-terms-title').textContent = s.title;
    overlay.querySelector('.paypal-terms-intro').textContent = s.intro;
    var list = overlay.querySelector('.paypal-terms-list');
    list.innerHTML = s.terms.map(function (term) {
      return '<li>' + term + '</li>';
    }).join('');
    overlay.querySelector('.paypal-terms-accept-text').textContent = s.acceptLabel;
    overlay.querySelector('.paypal-terms-btn-cancel').textContent = s.cancel;
    continueBtn.textContent = s.continue;
    checkbox.checked = false;
    continueBtn.disabled = true;
  }

  function openModal(url, target, link) {
    if (!overlay) buildModal();
    pendingUrl = url;
    pendingTarget = target || '_blank';
    pendingCheckoutOption = describeCheckoutFromLink(link) || lookupCheckoutOption(url);
    renderModal(detectLang());
    overlay.classList.add('is-open');
    logInteraction('paypal_terms_shown', getLogDetails(url));
    checkbox.focus();
  }

  function closeModal(reason) {
    if (!overlay) return;
    var wasOpen = overlay.classList.contains('is-open');
    var url = pendingUrl;
    overlay.classList.remove('is-open');
    if (wasOpen && reason === 'declined' && url) {
      logInteraction('paypal_terms_declined', getLogDetails(url));
    }
    pendingUrl = '';
    pendingCheckoutOption = '';
    checkbox.checked = false;
    continueBtn.disabled = true;
  }

  function isPayPalLink(el) {
    if (!el || el.nodeName !== 'A') return false;
    var href = el.getAttribute('href') || '';
    return href.indexOf('paypal.com') !== -1;
  }

  document.addEventListener('click', function (evt) {
    var link = evt.target.closest('a');
    if (!isPayPalLink(link)) return;
    evt.preventDefault();
    var target = link.getAttribute('target') || '_blank';
    openModal(link.href, target, link);
  }, true);
})();

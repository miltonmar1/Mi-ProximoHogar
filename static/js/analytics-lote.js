/* Analytics: eventos de vista en lotes del masterplan (detalle publico). */
(function () {
  'use strict';

  var SESSION_KEY = 'mph_session_v1';
  var DEBOUNCE_MS = 30000;
  var _lastSent = {};

  var COOKIE_CONSENT_KEY = 'mph_cookies_v1';

  function analyticsAllowed() {
    try {
      return localStorage.getItem(COOKIE_CONSENT_KEY) === 'accepted';
    } catch (e) {
      return false;
    }
  }

  function getSessionId() {
    try {
      var id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return 'anon';
    }
  }

  function getPropId() {
    var body = document.body;
    if (!body) return null;
    var raw = body.getAttribute('data-prop-id');
    if (!raw) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function loteRefFromFeat(feat) {
    if (!feat) return '';
    if (feat.lote) return String(feat.lote);
    if (feat.label) return String(feat.label).slice(0, 80);
    if (feat.id) return String(feat.id);
    return '';
  }

  function trackLote(feat, evento) {
    if (!analyticsAllowed()) return;
    var pid = getPropId();
    var ref = loteRefFromFeat(feat);
    if (!pid || !ref) return;

    var key = pid + ':' + ref;
    var now = Date.now();
    if (_lastSent[key] && now - _lastSent[key] < DEBOUNCE_MS) return;
    _lastSent[key] = now;

    var payload = JSON.stringify({
      propiedad_id: pid,
      lote_ref: ref,
      evento: evento || 'view',
      session_id: getSessionId()
    });

    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/lote', blob);
      return;
    }

    fetch('/api/analytics/lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'same-origin'
    }).catch(function () { /* ignore */ });
  }

  window.MPHAnalytics = {
    trackLote: trackLote
  };

  window.addEventListener('mph:lote-view', function (ev) {
    if (ev && ev.detail && ev.detail.feat) {
      trackLote(ev.detail.feat, 'view');
    }
  });
})();

/* Interacciones generales del sitio. */
(function () {
  'use strict';

  // Toggle menu mobile
  var toggle = document.getElementById('navToggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('is-open');
    });
  }

  // Cierre de mensajes flash
  document.querySelectorAll('.flash__close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var flash = btn.closest('.flash');
      if (flash) flash.remove();
    });
  });

  // Auto-dismiss flashes despues de 6s
  setTimeout(function () {
    document.querySelectorAll('.flash').forEach(function (f) {
      f.style.transition = 'opacity .4s ease, transform .4s ease';
      f.style.opacity = '0';
      f.style.transform = 'translateX(10px)';
      setTimeout(function () { f.remove(); }, 500);
    });
  }, 6000);

  // Smooth fade-in para tarjetas al hacer scroll (IntersectionObserver)
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.card-prop, .cat-card, .city-card, .feature, .agent-card, .card, .info-card, .action-card, .mis-anuncio, .section__head, .terreno-hub__card, .stats-card').forEach(function (el) {
      el.classList.add('fx-reveal');
      io.observe(el);
    });
  }

  // Stagger para grids de propiedades
  document.querySelectorAll('.grid-props .card-prop').forEach(function (el, i) {
    el.style.transitionDelay = Math.min(i * 0.06, 0.45) + 's';
  });

  // Submit con Enter en formularios de busqueda
  document.querySelectorAll('.filters select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var form = sel.closest('form');
      if (form && sel.dataset.autosubmit === 'true') form.submit();
    });
  });

  // Banner de cookies
  var cookieKey = 'mph_cookies_v1';
  var banner = document.getElementById('cookieBanner');
  if (banner && !localStorage.getItem(cookieKey)) {
    banner.hidden = false;
    var hideBanner = function (value) {
      localStorage.setItem(cookieKey, value);
      banner.hidden = true;
    };
    var acceptBtn = document.getElementById('cookieAccept');
    var rejectBtn = document.getElementById('cookieReject');
    if (acceptBtn) acceptBtn.addEventListener('click', function () { hideBanner('accepted'); });
    if (rejectBtn) rejectBtn.addEventListener('click', function () { hideBanner('essential'); });
  }

  // Seguir viendo (ultima propiedad visitada)
  var recentKey = 'mph_recent_prop_v1';
  var body = document.body;
  if (body.classList.contains('page-detalle')) {
    var rid = body.getAttribute('data-prop-id');
    if (rid) {
      try {
        localStorage.setItem(recentKey, JSON.stringify({
          id: rid,
          title: body.getAttribute('data-prop-title') || '',
          url: body.getAttribute('data-prop-url') || '',
          img: body.getAttribute('data-prop-img') || '',
          price: body.getAttribute('data-prop-price') || '',
          loc: body.getAttribute('data-prop-loc') || '',
          ts: Date.now()
        }));
      } catch (e) { /* ignore */ }
    }
  } else {
    var banner = document.getElementById('continueBanner');
    var link = document.getElementById('continueBannerLink');
    var titleEl = document.getElementById('continueBannerTitle');
    var imgEl = document.getElementById('continueBannerImg');
    var closeBtn = document.getElementById('continueBannerClose');
    var raw = null;
    try {
      raw = localStorage.getItem(recentKey);
      if (banner && link && titleEl && raw) {
        var data = JSON.parse(raw);
        if (data && data.url && data.title && (Date.now() - (data.ts || 0)) < 7 * 24 * 3600 * 1000) {
          if (window.location.pathname === data.url) return;
          link.href = data.url;
          titleEl.textContent = data.title;
          if (data.img && imgEl) {
            imgEl.src = data.img;
            imgEl.alt = data.title;
            imgEl.hidden = false;
          }
          banner.hidden = false;
          if (closeBtn) {
            closeBtn.addEventListener('click', function () {
              localStorage.removeItem(recentKey);
              banner.hidden = true;
            });
          }
        }
      }
    } catch (e2) { /* ignore */ }

    // Tarjeta "Visto reciente" en hub de terrenos (home)
    var hubRecent = document.getElementById('terrenoHubRecent');
    if (hubRecent && raw) {
      try {
        var hubData = JSON.parse(raw);
        if (hubData && hubData.url && hubData.title && (Date.now() - (hubData.ts || 0)) < 7 * 24 * 3600 * 1000) {
          hubRecent.href = hubData.url;
          var hubTitle = document.getElementById('terrenoHubRecentTitle');
          var hubPrice = document.getElementById('terrenoHubRecentPrice');
          var hubLoc = document.getElementById('terrenoHubRecentLoc');
          var hubImg = document.getElementById('terrenoHubRecentImg');
          if (hubTitle) hubTitle.textContent = hubData.title;
          if (hubPrice) {
            hubPrice.textContent = hubData.price ? ('Desde ' + hubData.price) : '';
            hubPrice.hidden = !hubData.price;
          }
          if (hubLoc) hubLoc.textContent = hubData.loc || '';
          if (hubImg && hubData.img) {
            hubImg.src = hubData.img;
            hubImg.alt = hubData.title;
            hubImg.hidden = false;
          }
          hubRecent.hidden = false;
        }
      } catch (e3) { /* ignore */ }
    }
  }
})();

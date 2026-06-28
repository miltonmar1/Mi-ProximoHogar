/* Reproductor glass: TikTok vertical, botones transparentes, fondo moderno. */
(function () {
  'use strict';

  var lightbox = document.getElementById('videoLightbox');
  if (!lightbox) return;

  var backdrop = lightbox.querySelector('.video-lightbox__backdrop');
  var dialog = lightbox.querySelector('.video-lightbox__dialog');
  var frame = document.getElementById('videoLightboxFrame');
  var closeBtns = lightbox.querySelectorAll('.video-lightbox__close');
  var external = document.getElementById('videoLightboxExternal');
  var externalLabel = document.getElementById('videoLightboxExternalLabel');
  var fsBtn = document.getElementById('videoLightboxFs');
  var metaEl = document.getElementById('videoLightboxMeta');
  var platformEl = document.getElementById('videoLightboxPlatform');
  var userEl = document.getElementById('videoLightboxUser');
  var glassPanel = lightbox.querySelector('.video-lightbox__glass-panel');

  if (lightbox.parentNode !== document.body) {
    document.body.appendChild(lightbox);
  }

  function tiktokIdFrom(url) {
    if (!url) return null;
    var m = url.match(/(?:embed\/v2|player\/v1)\/(\d+)/);
    if (m) return m[1];
    m = url.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  }

  function tiktokHandleFrom(url) {
    if (!url) return '';
    var m = url.match(/tiktok\.com\/@([^/?#]+)/i);
    return m ? '@' + m[1] : '';
  }

  function tiktokPlayerUrl(embedUrl, originalUrl) {
    var id = tiktokIdFrom(embedUrl) || tiktokIdFrom(originalUrl);
    if (!id) return embedUrl;
    return (
      'https://www.tiktok.com/player/v1/' + id +
      '?autoplay=1&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0'
    );
  }

  function embedAutoplay(url, platform, originalUrl) {
    if (!url) return '';
    if (platform === 'youtube') {
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      return url + sep + 'autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=1';
    }
    if (platform === 'facebook') {
      var s = url.indexOf('?') >= 0 ? '&' : '?';
      return url + s + 'autoplay=1&show_text=false&width=1280';
    }
    if (platform === 'tiktok') {
      return tiktokPlayerUrl(url, originalUrl);
    }
    return url;
  }

  function platformLabel(platform) {
    if (platform === 'tiktok') return 'TikTok';
    if (platform === 'youtube') return 'YouTube';
    if (platform === 'facebook') return 'Facebook';
    return 'Video';
  }

  function externalLabelFor(platform) {
    if (platform === 'tiktok') return 'Abrir TikTok';
    if (platform === 'youtube') return 'Abrir YouTube';
    if (platform === 'facebook') return 'Abrir Facebook';
    return 'Abrir enlace';
  }

  function openVideo(embedUrl, platform, label, originalUrl) {
    if (!frame || !dialog) return;
    platform = platform || 'youtube';
    originalUrl = originalUrl || embedUrl || '';

    dialog.className = 'video-lightbox__dialog video-lightbox__dialog--' + platform;
    lightbox.setAttribute('data-platform', platform);
    lightbox.classList.toggle('video-lightbox--tiktok', platform === 'tiktok');

    if (platformEl) platformEl.textContent = platformLabel(platform);
    if (userEl) {
      var handle = platform === 'tiktok' ? tiktokHandleFrom(originalUrl) : '';
      userEl.textContent = handle;
      userEl.hidden = !handle;
    }
    if (metaEl) metaEl.hidden = false;

    if (external) {
      if (originalUrl) {
        external.href = originalUrl.split('?')[0].indexOf('http') === 0
          ? originalUrl
          : originalUrl;
        external.hidden = false;
      } else {
        external.hidden = true;
      }
    }
    if (externalLabel) externalLabel.textContent = externalLabelFor(platform);

    frame.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.src = embedAutoplay(embedUrl, platform, originalUrl);
    iframe.title = label || platformLabel(platform);
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('loading', 'eager');
    if (platform === 'tiktok') {
      iframe.className = 'video-lightbox__iframe--tiktok';
      iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    } else {
      iframe.setAttribute(
        'allow',
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen'
      );
    }
    frame.appendChild(iframe);

    lightbox.hidden = false;
    lightbox.removeAttribute('hidden');
    document.body.classList.add('video-lightbox-open');
    if (closeBtns.length) closeBtns[0].focus();
  }

  function closeVideo() {
    if (frame) frame.innerHTML = '';
    lightbox.hidden = true;
    lightbox.setAttribute('hidden', '');
    lightbox.classList.remove('video-lightbox--tiktok');
    document.body.classList.remove('video-lightbox-open');
  }

  function toggleFullscreen() {
    var target = glassPanel || dialog;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    if (target.requestFullscreen) {
      target.requestFullscreen().catch(function () {});
    }
  }

  document.querySelectorAll('.video-card[data-embed]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openVideo(
        btn.getAttribute('data-embed'),
        btn.getAttribute('data-platform'),
        btn.getAttribute('data-label'),
        btn.getAttribute('data-original')
      );
    });
  });

  closeBtns.forEach(function (btn) {
    btn.addEventListener('click', closeVideo);
  });
  if (backdrop) backdrop.addEventListener('click', closeVideo);
  if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeVideo();
  });
})();

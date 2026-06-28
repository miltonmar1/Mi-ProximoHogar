/* Mapa interactivo - Mi Proximo Hogar (Google Maps + fallback Leaflet) */
(function (global) {
  'use strict';

  var NEAR_KM = 8;
  var FAR_KM = 25;
  var DEFAULT_CENTER = [-13.5319, -71.9675]; /* Cusco */
  var DEFAULT_ZOOM = 13;

  function fmtPrecio(precio, moneda) {
    if (precio == null) return '-';
    var m = (moneda || 'PEN').toUpperCase();
    var pref = m === 'USD' ? 'US$ ' : 'S/ ';
    return pref + Number(precio).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  }

  function esTerreno(item) {
    var cod = (item.tipo_codigo || '').toLowerCase();
    return cod === 'terreno' || (item.tipo || '').toLowerCase().indexOf('terreno') >= 0;
  }

  function mostrarComoLote(item) {
    if (parsePoligono(item)) return true;
    return esTerreno(item) && item.operacion === 'venta';
  }

  function precioUsd(item) {
    var p = Number(item.precio) || 0;
    return (item.moneda || 'PEN').toUpperCase() === 'USD' ? p : p / 3.75;
  }

  function calcTiers(items) {
    var vals = items.map(precioUsd).filter(function (v) { return v > 0; });
    vals.sort(function (a, b) { return a - b; });
    if (!vals.length) return function () { return 'medio'; };
    var t1 = vals[Math.floor(vals.length / 3)] || vals[0];
    var t2 = vals[Math.floor((vals.length * 2) / 3)] || vals[vals.length - 1];
    return function (item) {
      var v = precioUsd(item);
      if (v <= t1) return 'barato';
      if (v >= t2) return 'caro';
      return 'medio';
    };
  }

  var TIER_COLOR = {
    barato: '#ffc766',
    medio: '#ff7a1a',
    caro: '#e85d04',
  };

  var TERRENO_FILL = '#ff7a1a';

  var MAP_STYLES = [
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ visibility: 'off' }] },
  ];

  var PIN_TERRENO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">' +
    '<path d="M17 0C8.2 0 1.5 6.7 1.5 15.2c0 11.3 15.5 26.8 15.5 26.8S32.5 26.5 32.5 15.2C32.5 6.7 25.8 0 17 0z" fill="#e85d04" stroke="#fff" stroke-width="1.2"/>' +
    '<circle cx="17" cy="14.5" r="8" fill="#fff"/>' +
    '<path d="M12.5 18.5v-6h3.2v6h-3.2zm5.3 0h3.2v-9h-3.2v9z" fill="#e85d04"/>' +
  '</svg>';

  function markersApi() {
    return global.MPHMapMarkers || null;
  }

  function addDesdeTerrenoPin(map, lat, lng, opts, mapObjects) {
    var mk = markersApi();
    if (!mk || !mk.createPricePinOverlay) return null;
    var ov = mk.createPricePinOverlay(
      map,
      function () {
        return { lat: lat, lng: lng };
      },
      {
        precio: opts.precio,
        moneda: opts.moneda,
        variant: 'terreno-desde',
        onClick: opts.onClick,
      }
    );
    if (mapObjects && ov) mapObjects.push(ov);
    return ov;
  }

  function addPricePin(map, lat, lng, item, mapObjects, onClick) {
    var mk = markersApi();
    if (!mk || !mk.createPricePinOverlay) {
      var marker = new google.maps.Marker({
        map: map,
        position: { lat: lat, lng: lng },
        title: item.titulo,
        icon: dotIcon(TIER_COLOR[item._tier] || '#ff6b00'),
        zIndex: 200,
      });
      if (mapObjects) mapObjects.push(marker);
      if (onClick) marker.addListener('click', onClick);
      return marker;
    }
    var ov = mk.createPricePinOverlay(
      map,
      function () {
        return { lat: lat, lng: lng };
      },
      {
        precio: item.precio,
        moneda: item.moneda,
        onClick: onClick,
      }
    );
    if (mapObjects && ov) mapObjects.push(ov);
    return ov;
  }

  function dotIcon(color) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale: 7,
    };
  }

  function pinTerrenoIcon() {
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(PIN_TERRENO_SVG),
      scaledSize: new google.maps.Size(34, 42),
      anchor: new google.maps.Point(17, 42),
    };
  }

  var TIER_LABEL = {
    barato: 'Mas economico',
    medio: 'Precio medio',
    caro: 'Mas premium',
  };

  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLng = ((lng2 - lng1) * Math.PI) / 180;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function buildQueryString(query) {
    var parts = [];
    Object.keys(query || {}).forEach(function (k) {
      if (query[k] !== '' && query[k] != null && k !== 'pagina') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function mapQuery(opts) {
    var q = {};
    Object.keys(opts.query || {}).forEach(function (k) {
      q[k] = opts.query[k];
    });
    if (q.limite == null || q.limite === '') {
      q.limite = 500;
    }
    if (
      opts.autoCiudadFilter &&
      opts.ciudadId != null &&
      opts.ciudadId !== '' &&
      (q.ciudad_id == null || q.ciudad_id === '')
    ) {
      q.ciudad_id = opts.ciudadId;
    }
    return buildQueryString(q);
  }

  function gmapsBounds(opts) {
    if (!opts.maxBounds || opts.maxBounds.length !== 2) return null;
    return {
      north: opts.maxBounds[1][0],
      east: opts.maxBounds[1][1],
      south: opts.maxBounds[0][0],
      west: opts.maxBounds[0][1],
    };
  }

  function pixelToLatLng(map, clientX, clientY) {
    var rect = map.getDiv().getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {};
    overlay.draw = function () {};
    overlay.setMap(map);
    var proj = overlay.getProjection();
    if (!proj) {
      overlay.setMap(null);
      return null;
    }
    var ll = proj.fromContainerPixelToLatLng(new google.maps.Point(x, y));
    overlay.setMap(null);
    return ll;
  }

  function bindLongPressMap(map, onLongPress) {
    var LP_MS = 580;
    var timer = null;
    var suppressClick = false;
    var moved = false;
    var startX = 0;
    var startY = 0;

    function clearPress() {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function startPress(x, y) {
      clearPress();
      moved = false;
      startX = x;
      startY = y;
      timer = window.setTimeout(function () {
        if (moved) return;
        suppressClick = true;
        var ll = pixelToLatLng(map, x, y);
        if (ll && onLongPress) onLongPress(ll);
        if (navigator.vibrate) navigator.vibrate(35);
      }, LP_MS);
    }

    map.addListener('mousedown', function (e) {
      startPress(e.domEvent.clientX, e.domEvent.clientY);
    });
    map.addListener('mousemove', function (e) {
      if (!timer) return;
      var dx = Math.abs(e.domEvent.clientX - startX);
      var dy = Math.abs(e.domEvent.clientY - startY);
      if (dx > 10 || dy > 10) {
        moved = true;
        clearPress();
      }
    });
    map.addListener('mouseup', clearPress);
    map.addListener('dragstart', clearPress);

    google.maps.event.addDomListener(map.getDiv(), 'touchstart', function (e) {
      if (e.touches.length === 1) {
        startPress(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    google.maps.event.addDomListener(map.getDiv(), 'touchmove', function () {
      moved = true;
      clearPress();
    }, { passive: true });
    google.maps.event.addDomListener(map.getDiv(), 'touchend', clearPress);

    map.addListener('click', function () {
      if (suppressClick) {
        suppressClick = false;
      }
    });
  }

  function tryOpenStreetView(map, panorama, latLng, avisoEl) {
    if (!panorama || !latLng) return;
    var sv = new google.maps.StreetViewService();
    sv.getPanorama(
      { location: latLng, radius: 100, source: google.maps.StreetViewSource.OUTDOOR },
      function (data, status) {
        if (status === google.maps.StreetViewStatus.OK) {
          panorama.setVisible(true);
          panorama.setPosition(data.location.latLng);
          panorama.setPov({ heading: 270, pitch: 0 });
          map.panTo(data.location.latLng);
          var vp = document.getElementById('mapaViewport');
          if (vp) vp.classList.add('is-split');
          var btn = document.getElementById('btnCerrarStreetView');
          if (btn) btn.hidden = false;
          setTimeout(function () {
            google.maps.event.trigger(map, 'resize');
          }, 200);
        } else if (avisoEl) {
          avisoEl.hidden = false;
          avisoEl.className = 'mapa-aviso mapa-aviso--warn';
          avisoEl.textContent =
            'No hay Street View en este punto. Prueba en una calle cercana o arrastra el muñeco amarillo.';
          window.setTimeout(function () {
            avisoEl.hidden = true;
          }, 4500);
        }
      }
    );
  }

  function setupStreetViewPanel(map, avisoEl) {
    var svEl = document.getElementById('mapa-streetview');
    if (!svEl) return null;

    var panorama = new google.maps.StreetViewPanorama(svEl, {
      addressControl: true,
      linksControl: true,
      panControl: true,
      zoomControl: true,
      fullscreenControl: true,
      motionTracking: false,
      visible: false,
    });
    map.setStreetView(panorama);

    panorama.addListener('visible_changed', function () {
      var vp = document.getElementById('mapaViewport');
      var btn = document.getElementById('btnCerrarStreetView');
      if (panorama.getVisible()) {
        if (vp) vp.classList.add('is-split');
        if (btn) btn.hidden = false;
      } else {
        if (vp) vp.classList.remove('is-split');
        if (btn) btn.hidden = true;
      }
      setTimeout(function () {
        google.maps.event.trigger(map, 'resize');
      }, 150);
    });

    bindLongPressMap(map, function (latLng) {
      tryOpenStreetView(map, panorama, latLng, avisoEl);
    });

    map.addListener('rightclick', function (e) {
      tryOpenStreetView(map, panorama, e.latLng, avisoEl);
    });

    var btnClose = document.getElementById('btnCerrarStreetView');
    if (btnClose) {
      btnClose.addEventListener('click', function () {
        panorama.setVisible(false);
      });
    }

    return panorama;
  }

  function detalleItemUrl(detalleBase, itemId, shareToken) {
    var base = (detalleBase || '').replace(/\/$/, '');
    var url = base + '/' + itemId;
    if (shareToken) url += '?share=' + encodeURIComponent(shareToken);
    return url;
  }

  function popupHtml(item, detalleBase, shareToken) {
    var img = item.imagen
      ? '<img class="mapa-popup__img" src="' + item.imagen + '" alt="" loading="lazy" />'
      : '';
    var op = item.operacion === 'venta' ? 'Venta' : 'Alquiler';
    var dist = item._distKm != null
      ? '<p class="mapa-popup__dist">' + item._distKm.toFixed(1) + ' km de ti</p>'
      : '';
    var tier = item._tier ? '<span class="mapa-popup__tier">' + TIER_LABEL[item._tier] + '</span>' : '';
    return (
      '<div class="mapa-popup">' +
      img +
      '<span class="mapa-popup__chip mapa-popup__chip--' + item.operacion + '">' + op + '</span>' +
      tier +
      '<strong class="mapa-popup__title">' + item.titulo + '</strong>' +
      '<p class="mapa-popup__loc">' + (item.distrito ? item.distrito + ', ' : '') + item.ciudad + '</p>' +
      '<p class="mapa-popup__price">' + fmtPrecio(item.precio, item.moneda) + '</p>' +
      dist +
      '<a class="btn btn--primary btn--small mapa-popup__btn" href="' + detalleItemUrl(detalleBase, item.id, shareToken) + '">Ver propiedad</a>' +
      '<button type="button" class="btn btn--ghost btn--small mapa-popup__sv" data-lat="' + item.lat + '" data-lng="' + item.lng + '">Ver calle (360°)</button>' +
      '</div>'
    );
  }

  function sidebarHtml(item, detalleBase, shareToken) {
    if (!item) {
      return '<p class="mapa-sidebar__empty">Selecciona una propiedad en el mapa.</p>';
    }
    var img = item.imagen
      ? '<img class="mapa-sidebar__img" src="' + item.imagen + '" alt="" />'
      : '';
    var dist = item._distKm != null
      ? '<p class="mapa-sidebar__dist">' + item._distKm.toFixed(1) + ' km</p>'
      : '';
    return (
      img +
      '<h3>' + item.titulo + '</h3>' +
      '<p class="mapa-sidebar__meta">' + item.tipo + ' &middot; ' + (item.operacion === 'venta' ? 'Venta' : 'Alquiler') + '</p>' +
      '<p class="mapa-sidebar__price">' + fmtPrecio(item.precio, item.moneda) + '</p>' +
      '<p class="mapa-sidebar__loc">' + (item.distrito ? item.distrito + ', ' : '') + item.ciudad + '</p>' +
      dist +
      (item.area_total ? '<p class="mapa-sidebar__area">' + Math.round(item.area_total) + ' m²</p>' : '') +
      '<a class="btn btn--primary btn--block" href="' + detalleItemUrl(detalleBase, item.id, shareToken) + '">Ver detalle</a>'
    );
  }

  function sidebarListHtml(items, detalleBase, shareToken, hideListadoLink) {
    if (!items.length) {
      return '<p class="mapa-sidebar__empty">No hay propiedades en esta zona.</p>';
    }
    var html = '<ul class="mapa-sidebar__list">';
    items.slice(0, 12).forEach(function (item) {
      html +=
        '<li><button type="button" class="mapa-sidebar__item" data-id="' + item.id + '">' +
        '<strong>' + fmtPrecio(item.precio, item.moneda) + '</strong> ' +
        '<span>' + item.titulo + '</span>' +
        (item._distKm != null ? '<em>' + item._distKm.toFixed(1) + ' km</em>' : '') +
        '</button></li>';
    });
    html += '</ul>';
    if (items.length > 12) {
      html += '<p class="mapa-sidebar__hint">+' + (items.length - 12) + ' mas en el mapa.</p>';
    }
    if (!hideListadoLink) {
      html += '<a class="btn btn--ghost btn--block" href="' + detalleBase + '">Ver listado completo</a>';
    }
    return html;
  }

  function terrenoBounds(lat, lng, areaM2) {
    var area = Math.max(80, Number(areaM2) || 250);
    var sideM = Math.sqrt(area);
    var dLat = (sideM / 2) * 0.000009;
    var dLng = (sideM / 2) * 0.000009 / Math.max(0.6, Math.cos((lat * Math.PI) / 180));
    return { dLat: dLat, dLng: dLng };
  }

  function terrenoPolygonPaths(lat, lng, areaM2) {
    var b = terrenoBounds(lat, lng, areaM2);
    return [
      { lat: lat + b.dLat, lng: lng - b.dLng },
      { lat: lat + b.dLat, lng: lng + b.dLng },
      { lat: lat - b.dLat, lng: lng + b.dLng },
      { lat: lat - b.dLat, lng: lng - b.dLng },
    ];
  }

  function parsePoligono(item) {
    if (!item.poligono) return null;
    try {
      var data = typeof item.poligono === 'string' ? JSON.parse(item.poligono) : item.poligono;
      if (!Array.isArray(data) || data.length < 3) return null;
      return data.map(function (p) {
        return { lat: Number(p.lat), lng: Number(p.lng) };
      });
    } catch (e) {
      return null;
    }
  }

  var WGS84_A = 6378137.0;
  var WGS84_E2 = 0.00669437999014;
  var UTM_K0 = 0.9996;

  function utmDeg2rad(d) {
    return (d * Math.PI) / 180;
  }

  function utmRad2deg(r) {
    return (r * 180) / Math.PI;
  }

  function utmToLatLng(zone, hemisphere, easting, northing) {
    var x = Number(easting) - 500000.0;
    var y = Number(northing);
    if ((hemisphere || 'S').toUpperCase() === 'S') y -= 10000000.0;
    var lonOrigin = utmDeg2rad((zone - 1) * 6 - 180 + 3);
    var ep2 = WGS84_E2 / (1 - WGS84_E2);
    var M = y / UTM_K0;
    var mu =
      M /
      (WGS84_A * (1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64));
    var e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
    var phi1 =
      mu +
      ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu) +
      ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu);
    var sin1 = Math.sin(phi1);
    var cos1 = Math.cos(phi1);
    var tan1 = Math.tan(phi1);
    var N1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin1 * sin1);
    var T1 = tan1 * tan1;
    var C1 = ep2 * cos1 * cos1;
    var R1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sin1 * sin1, 1.5);
    var D = x / (N1 * UTM_K0);
    var lat =
      phi1 -
      ((N1 * tan1) / R1) *
        ((D * D) / 2 -
          ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D) / 24);
    var lng =
      lonOrigin +
      (D -
        ((1 + 2 * T1 + C1) * D * D * D) / 6 +
        ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D) /
          120) /
        cos1;
    return { lat: utmRad2deg(lat), lng: utmRad2deg(lng) };
  }

  function buildDetallePlan(opts) {
    if (!global.MPHPlanoImport) return null;
    var hasPlan = null;
    if (opts.planMasterplan) {
      hasPlan = global.MPHPlanoImport.ensureRenderablePlan(
        global.MPHPlanoImport.parsePlan(opts.planMasterplan),
        opts.poligono,
        opts.titulo || ''
      );
    } else if (opts.poligono) {
      hasPlan = global.MPHPlanoImport.planFromPoligono(opts.poligono, opts.titulo || 'Lote');
    }
    if (!hasPlan) return null;
    if (global.MPHPlanoImport.autofillAllLotes) {
      var lotes = (hasPlan.features || []).filter(function (f) {
        return f.tipo !== 'calle' && f.estado !== 'calle';
      });
      var sinNum = lotes.filter(function (f) { return !f.lote; }).length;
      global.MPHPlanoImport.autofillAllLotes(hasPlan, sinNum > 0 && sinNum >= lotes.length * 0.5);
    }
    if (!hasPlan.calibration && opts.utmZona && opts.utmEste != null && opts.utmNorte != null) {
      hasPlan.calibration = {
        utmZone: Number(opts.utmZona),
        utmHem: 'S',
        utmE0: Number(opts.utmEste),
        utmN0: Number(opts.utmNorte),
      };
    }
    return hasPlan;
  }

  function addTerrenoGoogle(map, item, mapObjects, opts) {
    opts = opts || {};
    var lat = item.lat;
    var lng = item.lng;
    if (item.plan_masterplan && global.MPHPlanoImport) {
      if (opts.interactive !== false) {
        var inter = global.MPHPlanoImport.initInteractivePlan(map, item.plan_masterplan, {
          readonly: opts.readonly === true,
          propertyTitle: item.titulo || opts.propertyTitle || '',
          fallbackPoligono: opts.fallbackPoligono || item.poligono,
          utmToLatLng: opts.utmToLatLng || utmToLatLng,
          listingPrecio: item.precio,
          listingMoneda: item.moneda,
          listingAreaTotal: item.area_total,
        });
        if (inter) return inter;
      }
      global.MPHPlanoImport.drawPlanOnMap(map, item.plan_masterplan, mapObjects);
      var minP =
        global.MPHPlanoImport.calcMinLotePrice &&
        global.MPHPlanoImport.calcMinLotePrice(
          item.plan_masterplan,
          item.precio,
          item.area_total,
          item.moneda
        );
      return addDesdeTerrenoPin(
        map,
        lat,
        lng,
        {
          precio: minP != null ? minP : item.precio,
          moneda: item.moneda,
          onClick: opts.onClick,
        },
        mapObjects
      );
    }
    var paths = parsePoligono(item) || terrenoPolygonPaths(lat, lng, item.area_total);
    var poly = new google.maps.Polygon({
      map: map,
      paths: paths,
      fillColor: TERRENO_FILL,
      fillOpacity: 0.4,
      strokeColor: '#ffffff',
      strokeWeight: 2.5,
      strokeOpacity: 0.95,
      clickable: true,
      zIndex: 1,
    });
    mapObjects.push(poly);
    return addDesdeTerrenoPin(
      map,
      lat,
      lng,
      {
        precio: item.precio,
        moneda: item.moneda,
        onClick: opts.onClick,
      },
      mapObjects
    );
  }

  var _mphGmapsCb = null;

  function showMapError(opts, html) {
    if (!opts) return;
    var aviso = opts.avisoId ? document.getElementById(opts.avisoId) : null;
    if (aviso) {
      aviso.hidden = false;
      aviso.className = 'mapa-aviso mapa-aviso--warn';
      aviso.innerHTML = html;
      return;
    }
    var el = document.getElementById(opts.containerId);
    if (el) {
      el.innerHTML = '<div class="mapa-error-msg">' + html + '</div>';
    }
  }

  function loadLeafletAssets(cb) {
    if (global.L) {
      cb();
      return;
    }
    if (!document.querySelector('link[data-mph-leaflet]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-mph-leaflet', '1');
      document.head.appendChild(link);
    }
    var existing = document.querySelector('script[data-mph-leaflet]');
    if (existing) {
      if (global.L) {
        cb();
      } else {
        existing.addEventListener('load', function () { cb(); });
      }
      return;
    }
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.setAttribute('data-mph-leaflet', '1');
    s.onload = function () { cb(); };
    s.onerror = function () { cb(new Error('leaflet')); };
    document.head.appendChild(s);
  }

  function loadLeafletThenInit(opts, note) {
    loadLeafletAssets(function (err) {
      if (err || !global.L) return;
      if (note) {
        showMapError(
          opts,
          note +
            ' <br><small>Mapa de respaldo activo (sin satelite).</small>'
        );
      }
      initLeaflet(opts);
    });
  }

  global.__mphGmapsReady = function () {
    if (_mphGmapsCb) {
      var fn = _mphGmapsCb;
      _mphGmapsCb = null;
      fn();
    }
  };

  global.gm_authFailure = function () {
    var opts = global._mphMapaOpts;
    var origin = global.location ? global.location.origin : 'http://127.0.0.1:5000';
    loadLeafletThenInit(
      opts,
      '<strong>Google Maps bloqueo la clave.</strong> En Google Cloud, clave WEB miproximohogar: ' +
        '1) Agrega <code>Maps JavaScript API</code> a las APIs permitidas (no solo BigQuery). ' +
        '2) Sitios web: <code>' + origin + '/*</code> y <code>http://127.0.0.1:5000/*</code>. ' +
        '3) Activa facturacion del proyecto.'
    );
  };

  function loadGoogleMaps(key, cb) {
    if (global.google && global.google.maps && global.google.maps.Map) {
      cb();
      return;
    }
    var existing = document.querySelector('script[data-mph-gmaps]');
    if (existing) {
      _mphGmapsCb = function () {
        cb(!global.google || !global.google.maps ? new Error('maps') : null);
      };
      if (global.google && global.google.maps) {
        global.__mphGmapsReady();
      }
      return;
    }
    _mphGmapsCb = function () {
      if (!global.google || !global.google.maps || !global.google.maps.Map) {
        cb(new Error('maps'));
        return;
      }
      cb();
    };
    var s = document.createElement('script');
    s.setAttribute('data-mph-gmaps', '1');
    s.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&libraries=drawing,geometry&loading=async&callback=__mphGmapsReady&v=weekly';
    s.async = true;
    s.defer = true;
    s.onerror = function () {
      _mphGmapsCb = null;
      cb(new Error('maps'));
    };
    document.head.appendChild(s);
  }

  function initGoogle(opts) {
    var el = document.getElementById(opts.containerId);
    if (!el) return;

    var sidebar = opts.sidebarId ? document.getElementById(opts.sidebarId) : null;
    var avisoEl = opts.avisoId ? document.getElementById(opts.avisoId) : null;
    var userPos = null;
    var mapObjects = [];
    var itemsCache = [];
    var infoWindow;
    var selectItemCb = null;
    var map;
    var streetPanorama = null;

    try {
      infoWindow = new google.maps.InfoWindow();
      var mapOpts = {
        center: { lat: opts.center[0], lng: opts.center[1] },
        zoom: opts.zoom || DEFAULT_ZOOM,
        mapTypeId: 'hybrid',
        mapTypeControl: false,
        streetViewControl: true,
        streetViewControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        keyboardShortcuts: true,
        styles: [],
      };
      var bnd = gmapsBounds(opts);
      if (bnd) {
        mapOpts.restriction = { latLngBounds: bnd, strictBounds: false };
      }
      map = new google.maps.Map(el, mapOpts);
      streetPanorama = setupStreetViewPanel(map, avisoEl);
    } catch (e) {
      loadLeafletThenInit(
        opts,
        '<strong>No se pudo iniciar Google Maps.</strong> Habilita <code>Maps JavaScript API</code> en tu clave (no solo BigQuery).'
      );
      return;
    }

    setTimeout(function () {
      if (map && google.maps.event) {
        google.maps.event.trigger(map, 'resize');
      }
    }, 300);

    function setMapType(tipo) {
      map.setMapTypeId(tipo);
      map.setOptions({ styles: tipo === 'roadmap' ? MAP_STYLES : [] });
      document.querySelectorAll('.mapa-tipo-btn').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.dataset.tipo === tipo);
      });
    }

    document.querySelectorAll('.mapa-tipo-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMapType(btn.dataset.tipo || 'roadmap');
      });
    });

    var btnLoc = document.getElementById('btnMiUbicacion');
    if (btnLoc) {
      btnLoc.addEventListener('click', function () {
        if (!navigator.geolocation) {
          if (avisoEl) {
            avisoEl.hidden = false;
            avisoEl.textContent = 'Tu navegador no permite ubicacion.';
          }
          return;
        }
        btnLoc.disabled = true;
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            btnLoc.disabled = false;
            userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            map.panTo(userPos);
            map.setZoom(14);
            renderItems(itemsCache, true);
          },
          function () {
            btnLoc.disabled = false;
            if (avisoEl) {
              avisoEl.hidden = false;
              avisoEl.textContent = 'No pudimos obtener tu ubicacion. Activa el GPS o permisos.';
            }
          },
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
    }

    function clearMapObjects() {
      mapObjects.forEach(function (o) {
        if (o.setMap) o.setMap(null);
      });
      mapObjects = [];
    }

    function renderItems(items, fromGeo) {
      clearMapObjects();
      itemsCache = items;

      var tierOf = calcTiers(items);
      items.forEach(function (item) {
        item._tier = tierOf(item);
        if (userPos) {
          item._distKm = haversineKm(userPos.lat, userPos.lng, item.lat, item.lng);
        } else {
          item._distKm = null;
        }
      });

      if (userPos) {
        items.sort(function (a, b) { return (a._distKm || 999) - (b._distKm || 999); });
      }

      var cerca = items.filter(function (i) { return i._distKm == null || i._distKm <= NEAR_KM; });
      var lejos = items.filter(function (i) { return i._distKm != null && i._distKm > NEAR_KM; });
      var muyLejos = items.filter(function (i) { return i._distKm != null && i._distKm > FAR_KM; });

      if (avisoEl) {
        if (fromGeo && lejos.length) {
          avisoEl.hidden = false;
          avisoEl.innerHTML =
            '<strong>Hay ' + lejos.length + ' lote(s) mas lejos de ' + NEAR_KM + ' km.</strong> ' +
            (muyLejos.length
              ? 'Incluye ' + muyLejos.length + ' bastante alejado(s). Acercate o amplia la busqueda.'
              : 'Los mas cercanos aparecen primero en la lista.');
        } else if (fromGeo && !items.length) {
          avisoEl.hidden = false;
          avisoEl.textContent = 'No hay lotes cerca de tu ubicacion con estos filtros.';
        } else {
          avisoEl.hidden = true;
        }
      }

      if (userPos) {
        var circle = new google.maps.Circle({
          map: map,
          center: userPos,
          radius: NEAR_KM * 1000,
          fillColor: '#3b82f6',
          fillOpacity: 0.06,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.35,
          strokeWeight: 1,
        });
        mapObjects.push(circle);
        mapObjects.push(
          new google.maps.Marker({
            map: map,
            position: userPos,
            title: 'Tu ubicacion',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#3b82f6',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
          })
        );
      }

      var bounds = new google.maps.LatLngBounds();
      if (userPos) bounds.extend(userPos);

      items.forEach(function (item) {
        var lat = item.lat;
        var lng = item.lng;
        var color = TIER_COLOR[item._tier] || '#ff6b00';
        var terreno = mostrarComoLote(item);

        bounds.extend({ lat: lat, lng: lng });

        if (terreno) {
          item._marker = addTerrenoGoogle(map, item, mapObjects, {
            interactive: false,
            onClick: function () {
              infoWindow.setContent(popupHtml(item, opts.detalleBase, opts.shareToken));
              infoWindow.setPosition({ lat: lat, lng: lng });
              infoWindow.open(map);
              if (sidebar) sidebar.innerHTML = sidebarHtml(item, opts.detalleBase, opts.shareToken);
            },
          });
        } else {
          item._marker = addPricePin(map, lat, lng, item, mapObjects, function () {
            infoWindow.setContent(popupHtml(item, opts.detalleBase, opts.shareToken));
            infoWindow.setPosition({ lat: lat, lng: lng });
            infoWindow.open(map);
            if (sidebar) sidebar.innerHTML = sidebarHtml(item, opts.detalleBase, opts.shareToken);
            google.maps.event.addListenerOnce(infoWindow, 'domready', function () {
              var svBtn = document.querySelector('.mapa-popup__sv');
              if (svBtn && streetPanorama) {
                svBtn.addEventListener('click', function () {
                  tryOpenStreetView(
                    map,
                    streetPanorama,
                    new google.maps.LatLng(
                      parseFloat(svBtn.dataset.lat),
                      parseFloat(svBtn.dataset.lng)
                    ),
                    avisoEl
                  );
                });
              }
            });
          });
        }
      });

      if (items.length) {
        map.fitBounds(bounds, 56);
      }

      if (opts.destacar) {
        var found = items.find(function (x) {
          return x.id === opts.destacar || x.id === Number(opts.destacar);
        });
        if (found && found._marker) {
          map.panTo({ lat: found.lat, lng: found.lng });
          map.setZoom(17);
          infoWindow.setContent(popupHtml(found, opts.detalleBase, opts.shareToken));
          infoWindow.open(map, found._marker);
          if (sidebar) sidebar.innerHTML = sidebarHtml(found, opts.detalleBase, opts.shareToken);
        }
      }

      if (sidebar) {
        sidebar.innerHTML =
          '<p class="mapa-sidebar__count"><strong>' + items.length + '</strong> en el mapa' +
          (cerca.length !== items.length ? ' · ' + cerca.length + ' cerca' : '') +
          '</p>' +
          sidebarListHtml(items, opts.detalleBase, opts.shareToken, opts.hideListadoLink);
        sidebar.querySelectorAll('.mapa-sidebar__item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = parseInt(btn.dataset.id, 10);
            var found = items.find(function (x) { return x.id === id; });
            if (found) {
              map.panTo({ lat: found.lat, lng: found.lng });
              map.setZoom(16);
              if (selectItemCb) selectItemCb(found);
            }
          });
        });
      }
    }

    selectItemCb = function (item) {
      if (sidebar) sidebar.innerHTML = sidebarHtml(item, opts.detalleBase, opts.shareToken);
    };

    function loadMapItems(fromGeo) {
      var qs = mapQuery(opts);
      fetch((opts.apiUrl || '/api/mapa') + qs)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          renderItems(data.items || [], !!fromGeo);
          if (!fromGeo && opts.autoLocate && navigator.geolocation) {
            setTimeout(function () {
              var btn = document.getElementById('btnMiUbicacion');
              if (btn) btn.click();
            }, 800);
          }
        })
        .catch(function () {
          if (sidebar) sidebar.innerHTML = '<p class="mapa-sidebar__empty">No se pudo cargar el mapa.</p>';
        });
    }

    global._mphMapaReload = function () { loadMapItems(false); };
    loadMapItems(false);
  }

  /* ---------- Leaflet fallback ---------- */
  function initLeaflet(opts) {
    if (!global.L) return;
    var el = document.getElementById(opts.containerId);
    if (!el) return;
    if (el.querySelector('.mapa-error-msg')) {
      el.innerHTML = '';
    }

    var sidebar = opts.sidebarId ? document.getElementById(opts.sidebarId) : null;
    var mapOpts = { zoomControl: true, scrollWheelZoom: true };
    if (opts.maxBounds) {
      mapOpts.maxBounds = L.latLngBounds(opts.maxBounds[0], opts.maxBounds[1]);
    }
    var map = L.map(el, mapOpts).setView(
      opts.center || DEFAULT_CENTER,
      opts.zoom || DEFAULT_ZOOM
    );
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri &copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    var qs = mapQuery(opts);
    fetch((opts.apiUrl || '/api/mapa') + qs)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = data.items || [];
        var bounds = [];
        items.forEach(function (item) {
          var color = TIER_COLOR.medio;
          var terreno = mostrarComoLote(item);
          if (terreno) {
            var paths = parsePoligono(item) || terrenoPolygonPaths(item.lat, item.lng, item.area_total);
            var latlngs = paths.map(function (p) { return [p.lat, p.lng]; });
            L.polygon(latlngs, {
              color: '#ffffff',
              weight: 2,
              fillColor: TERRENO_FILL,
              fillOpacity: 0.4,
            })
              .addTo(map)
              .bindPopup(popupHtml(item, opts.detalleBase, opts.shareToken));
            L.circleMarker([item.lat, item.lng], {
              radius: 6,
              color: '#fff',
              weight: 2,
              fillColor: '#e85d04',
              fillOpacity: 1,
            })
              .addTo(map)
              .bindPopup(popupHtml(item, opts.detalleBase, opts.shareToken));
          } else {
            L.circleMarker([item.lat, item.lng], {
              radius: 7,
              color: '#fff',
              weight: 2,
              fillColor: color,
              fillOpacity: 1,
            })
              .addTo(map)
              .bindPopup(popupHtml(item, opts.detalleBase, opts.shareToken));
          }
          bounds.push([item.lat, item.lng]);
        });
        if (bounds.length) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
        if (sidebar) {
          sidebar.innerHTML =
            '<p class="mapa-sidebar__count"><strong>' + items.length + '</strong> en el mapa</p>' +
            sidebarListHtml(items, opts.detalleBase, opts.shareToken, opts.hideListadoLink);
        }
      });
    setTimeout(function () { map.invalidateSize(); }, 200);
    setTimeout(function () { map.invalidateSize(); }, 800);
  }

  function initDetalleGoogle(opts) {
    loadGoogleMaps(opts.googleKey, function (err) {
      if (err) return;
      var el = document.getElementById(opts.containerId);
      if (!el) return;
      var lat = opts.lat;
      var lng = opts.lng;
      var hasPlan = buildDetallePlan(opts);
      var item = {
        lat: lat,
        lng: lng,
        area_total: opts.areaTotal,
        titulo: opts.titulo || '',
        poligono: opts.poligono,
        plan_masterplan: hasPlan || opts.planMasterplan,
        precio: opts.precio,
        moneda: opts.moneda,
      };
      var paths = parsePoligono(item);
      var mostrarLote = hasPlan || paths || opts.mostrarLote || opts.esTerreno;

      var map = new google.maps.Map(el, {
        center: { lat: lat, lng: lng },
        zoom: 17,
        mapTypeId: 'hybrid',
        streetViewControl: true,
        streetViewControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        gestureHandling: 'greedy',
        zoomControl: true,
        fullscreenControl: true,
        clickableIcons: false,
        styles: [],
      });

      if (mostrarLote) {
        var planApi = addTerrenoGoogle(map, item, [], {
          interactive: true,
          readonly: true,
          propertyTitle: opts.titulo || '',
          fallbackPoligono: opts.poligono,
          utmToLatLng: utmToLatLng,
        });
        global._mphDetallePlan = planApi || null;
        var bounds = new google.maps.LatLngBounds();
        var hasBounds = false;
        var planForBounds =
          hasPlan ||
          (global.MPHPlanoImport && global.MPHPlanoImport.getPlan
            ? global.MPHPlanoImport.getPlan()
            : null);
        if (planForBounds && planForBounds.features) {
          planForBounds.features.forEach(function (f) {
            (f.path || []).forEach(function (p) {
              bounds.extend(p);
              hasBounds = true;
            });
          });
        } else if (paths && paths.length >= 3) {
          paths.forEach(function (p) {
            bounds.extend(p);
            hasBounds = true;
          });
        }
        if (hasBounds) {
          map.fitBounds(bounds, 36);
        }
        var hint = document.getElementById('loteMapHint');
        if (hint && planApi) hint.hidden = false;
      } else {
        addPricePin(map, lat, lng, item, null, null);
      }

      setTimeout(function () {
        google.maps.event.trigger(map, 'resize');
      }, 350);
      setTimeout(function () {
        google.maps.event.trigger(map, 'resize');
      }, 800);
    });
  }

  function initDetalleLeaflet(opts) {
    if (!global.L) return;
    var el = document.getElementById(opts.containerId);
    if (!el) return;
    var item = {
      lat: opts.lat,
      lng: opts.lng,
      area_total: opts.areaTotal,
      poligono: opts.poligono,
    };
    var paths = parsePoligono(item);
    var mostrarLote = paths || opts.mostrarLote || opts.esTerreno;

    var map = L.map(el).setView([opts.lat, opts.lng], 16);
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    ).addTo(map);

    if (mostrarLote) {
      var latlngs = (paths || terrenoPolygonPaths(item.lat, item.lng, item.area_total)).map(function (p) {
        return [p.lat, p.lng];
      });
      L.polygon(latlngs, {
        color: '#ffffff',
        weight: 2,
        fillColor: TERRENO_FILL,
        fillOpacity: 0.42,
      }).addTo(map);
      L.circleMarker([opts.lat, opts.lng], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#e85d04',
        fillOpacity: 1,
      }).addTo(map);
      map.fitBounds(latlngs, { padding: [24, 24] });
    } else {
      L.circleMarker([opts.lat, opts.lng], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: TIER_COLOR.medio,
        fillOpacity: 1,
      }).addTo(map);
    }
    setTimeout(function () { map.invalidateSize(); }, 200);
    setTimeout(function () { map.invalidateSize(); }, 600);
  }

  function init(opts) {
    global._mphMapaOpts = opts;
    if (!opts.googleKey) {
      loadLeafletThenInit(
        opts,
        '<strong>Sin clave de Google.</strong> Agrega <code>GOOGLE_MAPS_API_KEY</code> en <code>.env</code> y reinicia Flask.'
      );
      return;
    }
    loadGoogleMaps(opts.googleKey, function (err) {
      if (err || !global.google || !global.google.maps) {
        loadLeafletThenInit(
          opts,
          '<strong>No cargo Google Maps.</strong> Habilita <code>Maps JavaScript API</code> y agregala a las APIs de tu clave.'
        );
        return;
      }
      initGoogle(opts);
    });
  }

  function initDetalle(opts) {
    global._mphMapaOpts = opts;
    if (!opts.googleKey) {
      loadLeafletAssets(function () { initDetalleLeaflet(opts); });
      return;
    }
    loadGoogleMaps(opts.googleKey, function (err) {
      if (err) {
        loadLeafletAssets(function () { initDetalleLeaflet(opts); });
        return;
      }
      initDetalleGoogle(opts);
    });
  }

  global.MPHMapa = {
    init: init,
    initDetalle: initDetalle,
    reloadQuery: function (queryPatch) {
      var opts = global._mphMapaOpts;
      if (!opts) return;
      opts.query = Object.assign({}, opts.query || {}, queryPatch || {});
      if (typeof global._mphMapaReload === 'function') {
        global._mphMapaReload();
      }
    },
  };
})(typeof window !== 'undefined' ? window : this);

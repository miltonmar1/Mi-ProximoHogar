/* Publicar: Google Maps profesional — poligono + coordenadas UTM */
(function (global) {
  'use strict';

  var CUSCO = { lat: -13.5319, lng: -71.9675 };
  var FILL = '#ff7a1a';
  var WGS84_A = 6378137.0;
  var WGS84_E2 = 0.00669438;
  var UTM_K0 = 0.9996;

  function $(id) {
    return document.getElementById(id);
  }

  function fmtN(n, dec) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-PE', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function roundGps(n) {
    if (n == null || isNaN(n)) return null;
    return Math.round(Number(n) * 1e6) / 1e6;
  }

  function roundUtm(n) {
    if (n == null || isNaN(n)) return null;
    return Math.round(Number(n) * 1e3) / 1e3;
  }

  function syncCoordInputs(lat, lng, utm) {
    var rLat = roundGps(lat);
    var rLng = roundGps(lng);
    var gpsLat = $('inputGpsLat');
    var gpsLng = $('inputGpsLng');
    var utmE = $('inputUtmE');
    var utmN = $('inputUtmN');
    var utmZ = $('inputUtmZona');
    var hem = $('selectUtmHem');
    if (gpsLat) gpsLat.value = rLat != null ? rLat.toFixed(6) : '';
    if (gpsLng) gpsLng.value = rLng != null ? rLng.toFixed(6) : '';
    if (utm) {
      if (utmE) utmE.value = roundUtm(utm.easting).toFixed(3);
      if (utmN) utmN.value = roundUtm(utm.northing).toFixed(3);
      if (utmZ) utmZ.value = String(utm.zone);
      if (hem) hem.value = utm.hemisphere || 'S';
    } else {
      if (utmE) utmE.value = '';
      if (utmN) utmN.value = '';
    }
  }

  function normalizeCoordFields() {
    var gpsLat = $('inputGpsLat');
    var gpsLng = $('inputGpsLng');
    var utmE = $('inputUtmE');
    var utmN = $('inputUtmN');
    var latEl = $('latitud');
    var lngEl = $('longitud');
    if (gpsLat && gpsLat.value !== '') {
      var la = roundGps(parseFloat(gpsLat.value));
      if (la != null) gpsLat.value = la.toFixed(6);
    }
    if (gpsLng && gpsLng.value !== '') {
      var lo = roundGps(parseFloat(gpsLng.value));
      if (lo != null) gpsLng.value = lo.toFixed(6);
    }
    if (utmE && utmE.value !== '') {
      var ue = roundUtm(parseFloat(utmE.value));
      if (ue != null) utmE.value = ue.toFixed(3);
    }
    if (utmN && utmN.value !== '') {
      var un = roundUtm(parseFloat(utmN.value));
      if (un != null) utmN.value = un.toFixed(3);
    }
    if (latEl && latEl.value !== '') {
      var hla = roundGps(parseFloat(latEl.value));
      if (hla != null) latEl.value = String(hla);
    }
    if (lngEl && lngEl.value !== '') {
      var hlo = roundGps(parseFloat(lngEl.value));
      if (hlo != null) lngEl.value = String(hlo);
    }
  }

  function syncPlanAnchorFields() {
    if (!global.MPHPlanoImport || !global.MPHPlanoImport.getPlanAnchorLatLng) return;
    var anchor = global.MPHPlanoImport.getPlanAnchorLatLng();
    if (!anchor) return;
    var utm = latLngToUtm(anchor.lat, anchor.lng);
    if (!utm) return;
    var pe = $('inputPlanoUtmE');
    var pn = $('inputPlanoUtmN');
    if (pe) pe.value = roundUtm(utm.easting).toFixed(3);
    if (pn) pn.value = roundUtm(utm.northing).toFixed(3);
    var utmZ = $('utm_zona');
    var utmE = $('utm_este');
    var utmN = $('utm_norte');
    if (utmZ) utmZ.value = utm.label;
    if (utmE) utmE.value = roundUtm(utm.easting).toFixed(3);
    if (utmN) utmN.value = roundUtm(utm.northing).toFixed(3);
  }

  /* ---------- UTM WGS84 (Peru: zonas 17S–19S) ---------- */
  function latLngToUtm(lat, lng) {
    var zone = Math.floor((lng + 180) / 6) + 1;
    var lonOrigin = deg2rad((zone - 1) * 6 - 180 + 3);
    var latRad = deg2rad(lat);
    var lngRad = deg2rad(lng);
    var ep2 = WGS84_E2 / (1 - WGS84_E2);
    var sinLat = Math.sin(latRad);
    var cosLat = Math.cos(latRad);
    var tanLat = Math.tan(latRad);
    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    var T = tanLat * tanLat;
    var C = ep2 * cosLat * cosLat;
    var A = cosLat * (lngRad - lonOrigin);
    var M =
      WGS84_A *
      ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64) * latRad -
        ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32) * Math.sin(2 * latRad) +
        ((15 * WGS84_E2 * WGS84_E2) / 256) * Math.sin(4 * latRad));
    var easting =
      UTM_K0 *
        N *
        (A +
          ((1 - T + C) * A * A * A) / 6 +
          ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A) / 120) +
      500000.0;
    var northing =
      UTM_K0 *
      (M +
        N *
          tanLat *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A * A * A * A) / 24));
    if (lat < 0) northing += 10000000.0;
    var hem = lat < 0 ? 'S' : 'N';
    return {
      zone: zone,
      hemisphere: hem,
      easting: easting,
      northing: northing,
      label: zone + hem,
    };
  }

  function utmToLatLng(zone, hemisphere, easting, northing) {
    var x = Number(easting) - 500000.0;
    var y = Number(northing);
    if ((hemisphere || 'S').toUpperCase() === 'S') y -= 10000000.0;
    var lonOrigin = deg2rad((zone - 1) * 6 - 180 + 3);
    var ep2 = WGS84_E2 / (1 - WGS84_E2);
    var M = y / UTM_K0;
    var mu =
      M /
      (WGS84_A *
        (1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64));
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
    return { lat: rad2deg(lat), lng: rad2deg(lng) };
  }

  function deg2rad(d) {
    return (d * Math.PI) / 180;
  }
  function rad2deg(r) {
    return (r * 180) / Math.PI;
  }

  function polygonAreaM2(paths) {
    if (!paths || paths.length < 3 || !global.google || !google.maps.geometry) return null;
    var ring = paths.map(function (p) {
      return new google.maps.LatLng(p.lat, p.lng);
    });
    return google.maps.geometry.spherical.computeArea(ring);
  }

  /* ---------- UI / estado ---------- */
  var _pendingOpts = null;
  var _mapReady = false;
  var _mapApi = null;
  var _geoMode = 'punto';
  var _stopDrawFn = null;
  var _syncFromPlanRef = null;
  var _pricePinOverlay = null;
  var _publishMarker = null;

  var GEO_STATUS = {
    punto:
      'Marca un <strong>punto</strong> en el mapa o usa UTM / GPS en el panel derecho.',
    poligono:
      'Pulsa <strong>Agregar poligono</strong> y marca las esquinas del lote en el mapa.',
    plano:
      'Elige un archivo <strong>SVG o DXF</strong> y ubica el plano con coordenadas UTM.',
  };

  var GEO_HINT = {
    punto: 'Punto: solo ubicacion en el mapa. Ideal para casas, departamentos u oficinas.',
    poligono: 'Poligono: delimita el terreno. El area se calcula automaticamente.',
    plano:
      'SVG/DXF: importa muchos lotes. Colores: verde disponible, azul reservado, rojo vendido.',
  };

  function mapFeatureCount() {
    if (!global.MPHPlanoImport || !global.MPHPlanoImport.getPlan) return 0;
    var plan = global.MPHPlanoImport.getPlan();
    if (!plan || !plan.features) return 0;
    return plan.features.filter(function (f) {
      return f.path && f.path.length >= 3;
    }).length;
  }

  function detectInitialGeoMode(mapData) {
    if (!mapData) return null;
    var planRaw = mapData.plan_masterplan;
    if (planRaw && planHasLotes(planRaw)) {
      try {
        var pl = typeof planRaw === 'string' ? JSON.parse(planRaw) : planRaw;
        var src = (pl.source || '').toLowerCase();
        var feats = pl.features || [];
        var hasLocal = feats.some(function (f) {
          return f.localPath && f.localPath.length;
        });
        var pathCount = feats.filter(function (f) {
          return f.path && f.path.length >= 3;
        }).length;
        if (src === 'file' || src === 'svg' || src === 'dxf' || hasLocal || pathCount > 1) {
          return 'plano';
        }
      } catch (errPlan) {
        return 'plano';
      }
      return 'poligono';
    }
    var poly = mapData.poligono_lote;
    if (poly && String(poly).length > 10) {
      try {
        var paths = JSON.parse(poly);
        if (paths && paths.length >= 3) return 'poligono';
      } catch (errPoly) {
        /* ignore */
      }
    }
    if (mapData.latitud != null && mapData.longitud != null) {
      if (!planRaw && (!poly || String(poly).length <= 10)) return 'punto';
    }
    return null;
  }

  function suggestDefaultGeoMode() {
    var tipoId = parseInt((($('tipo_id') || {}).value || ''), 10);
    var tipos = (_pendingOpts && _pendingOpts.tipos) || [];
    var codigo = '';
    tipos.forEach(function (t) {
      if (t.TipoId === tipoId) codigo = (t.Codigo || '').toLowerCase();
    });
    return 'punto';
  }

  function hasGeoDataForMode(mode) {
    if (mode === 'punto') {
      return !!(($('latitud') || {}).value && ($('longitud') || {}).value);
    }
    if (mode === 'poligono') {
      var poly = ($('poligono_lote') || {}).value;
      if (poly && poly.length > 10) return true;
      return mapFeatureCount() > 0;
    }
    if (mode === 'plano') {
      var plan = ($('plan_masterplan') || {}).value;
      return !!(plan && plan.length > 10 && planHasLotes(plan));
    }
    return false;
  }

  function clearGeoDataOnModeSwitch(fromMode) {
    if (_stopDrawFn) _stopDrawFn();
    if (fromMode === 'poligono' || fromMode === 'plano') {
      if (global.MPHPlanoImport && global.MPHPlanoImport.clearAll) {
        global.MPHPlanoImport.clearAll(false);
      }
    }
    var polyEl = $('poligono_lote');
    var planEl = $('plan_masterplan');
    var vertsEl = $('utm_vertices');
    var areaEl = $('area_mapa_m2');
    if (polyEl) polyEl.value = '';
    if (planEl) planEl.value = '';
    if (vertsEl) vertsEl.value = '';
    if (areaEl) areaEl.value = '';
  }

  function refreshPlanoPanelVisibility() {
    var panel = $('panelPlanoImport');
    if (!panel) return;
    if (_geoMode === 'punto') {
      panel.hidden = true;
      return;
    }
    if (_geoMode === 'plano') {
      panel.hidden = false;
      return;
    }
    panel.hidden = mapFeatureCount() === 0;
  }

  function applyGeoModeUi(mode) {
    _geoMode = mode;
    var section = document.querySelector('.publicar-mapa--pro');
    if (section) section.setAttribute('data-geo-mode', mode);

    var hidden = $('geo_modo');
    if (hidden) hidden.value = mode;

    document.querySelectorAll('.geo-mode__btn').forEach(function (btn) {
      var m = btn.getAttribute('data-geo-mode');
      var active = m === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    document.querySelectorAll('.geo-mode-panel').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-geo-panel') !== mode;
    });

    refreshPlanoPanelVisibility();

    var st = $('publicarMapaStatus');
    if (st && GEO_STATUS[mode]) {
      st.innerHTML = GEO_STATUS[mode];
      st.className = 'publicar-mapa__status';
    }

    var hint = $('publicarMapaHint');
    if (hint && GEO_HINT[mode]) {
      hint.innerHTML = '<i class="mapa-legend__lote"></i><span>' + GEO_HINT[mode] + '</span>';
    }

    var loteHint = $('loteMapHint');
    if (loteHint && mode === 'punto') loteHint.hidden = true;
  }

  function setGeoMode(mode, opts) {
    opts = opts || {};
    if (mode !== 'punto' && mode !== 'poligono' && mode !== 'plano') mode = 'punto';
    if (!opts.skipConfirm && mode !== _geoMode && hasGeoDataForMode(_geoMode)) {
      if (
        !confirm(
          'Cambiar de metodo borrara la ubicacion o los poligonos del modo actual. ¿Deseas continuar?'
        )
      ) {
        return false;
      }
      clearGeoDataOnModeSwitch(_geoMode);
      var lat = parseFloat(($('latitud') || {}).value);
      var lng = parseFloat(($('longitud') || {}).value);
      if (mode === 'punto' && !isNaN(lat) && !isNaN(lng)) {
        syncHiddenAndPanel(null, lat, lng);
      } else if (mode === 'punto') {
        syncHiddenAndPanel(null, null, null);
      }
    }
    applyGeoModeUi(mode);
    if (_publishMarker && _publishMarker.getMap && _publishMarker.getMap()) {
      refreshPricePin(_publishMarker, _publishMarker.getMap());
    }
    pushListingPricingToPlan();
    if (mode === 'plano' && mapFeatureCount() > 0) {
      var st = $('publicarMapaStatus');
      if (st) {
        st.innerHTML = '<strong>Plano cargado</strong> — puedes ajustar UTM y lotes abajo.';
        st.className = 'publicar-mapa__status publicar-mapa__status--ok';
      }
    }
    return true;
  }

  function bindGeoMode() {
    document.querySelectorAll('.geo-mode__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setGeoMode(btn.getAttribute('data-geo-mode'));
      });
    });
    var tipoSel = $('tipo_id');
    if (tipoSel && _pendingOpts && !_pendingOpts.modoEdicion) {
      tipoSel.addEventListener('change', function () {
        if (!hasGeoDataForMode(_geoMode)) {
          setGeoMode(suggestDefaultGeoMode(), { skipConfirm: true });
        }
      });
    }
  }

  function readFormPricing() {
    var precio = parseFloat((document.querySelector('[name="precio"]') || {}).value);
    var moneda = (document.querySelector('[name="moneda"]') || {}).value || 'PEN';
    var area = parseFloat((document.querySelector('[name="area_total"]') || {}).value);
    return {
      precio: isNaN(precio) ? null : precio,
      moneda: moneda,
      area_total: isNaN(area) ? null : area,
    };
  }

  function pushListingPricingToPlan() {
    var p = readFormPricing();
    if (global.MPHPlanoImport && global.MPHPlanoImport.setListingPricing) {
      global.MPHPlanoImport.setListingPricing(p.precio, p.moneda, p.area_total);
    }
  }

  function refreshPricePin(marker, map) {
    var mk = global.MPHMapMarkers;
    if (!mk || !marker || !map) return;
    if (_geoMode !== 'punto') {
      if (_pricePinOverlay) {
        _pricePinOverlay.setMap(null);
        _pricePinOverlay = null;
      }
      marker.setVisible(false);
      return;
    }
    marker.setVisible(true);
    marker.setOpacity(0);
    marker.setOptions({ clickable: true, optimized: false });
    var pricing = readFormPricing();
    if (_pricePinOverlay) {
      _pricePinOverlay.setMap(null);
      _pricePinOverlay = null;
    }
    if (!mk.createPricePinOverlay) return;
    _pricePinOverlay = mk.createPricePinOverlay(
      map,
      function () {
        var pos = marker.getPosition();
        return { lat: pos.lat(), lng: pos.lng() };
      },
      {
        precio: pricing.precio,
        moneda: pricing.moneda,
      }
    );
  }

  function bindPricingFields(marker, map) {
    ['precio', 'moneda', 'area_total'].forEach(function (name) {
      var el = document.querySelector('[name="' + name + '"]');
      if (!el) return;
      el.addEventListener('input', function () {
        refreshPricePin(marker, map);
        pushListingPricingToPlan();
      });
      el.addEventListener('change', function () {
        refreshPricePin(marker, map);
        pushListingPricingToPlan();
      });
    });
  }

  function syncPositionFromMap(lat, lng) {
    if (_geoMode === 'punto') {
      syncHiddenAndPanel(null, lat, lng);
      if (_publishMarker && _publishMarker.getMap && _publishMarker.getMap()) {
        refreshPricePin(_publishMarker, _publishMarker.getMap());
      }
      return;
    }
    var plan =
      global.MPHPlanoImport && global.MPHPlanoImport.getPlan
        ? global.MPHPlanoImport.getPlan()
        : null;
    if (plan && plan.features && plan.features.length && _syncFromPlanRef) {
      _syncFromPlanRef(plan);
    } else {
      syncHiddenAndPanel(null, lat, lng);
    }
  }

  function scrollToPublishMap() {
    var wrap = document.querySelector('.publicar-mapa__map-wrap') || $('mapa-publicar');
    if (wrap && wrap.scrollIntoView) {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setDrawToolbarActive(active) {
    var btnDraw = $('btnDibujarLote');
    var btnOtro = $('btnDibujarOtro');
    var btnFin = $('btnFinalizarPoligono');
    if (btnDraw) btnDraw.classList.toggle('is-drawing', active);
    if (btnOtro) btnOtro.classList.toggle('is-drawing', active);
    if (btnFin) btnFin.hidden = !active;
    var wrap = document.querySelector('.publicar-mapa__map-wrap');
    if (wrap) wrap.classList.toggle('is-drawing-mode', active);
  }

  function bindDrawToolbar() {
    function onDrawClick() {
      scrollToPublishMap();
      if (!_mapApi) {
        var st = $('publicarMapaStatus');
        if (st) {
          st.textContent = 'Cargando Google Maps… espera un momento e intenta de nuevo.';
          st.className = 'publicar-mapa__status publicar-mapa__status--active';
        }
        return;
      }
      _mapApi.startDraw();
    }
    var btnDraw = $('btnDibujarLote');
    var btnOtro = $('btnDibujarOtro');
    var btnFin = $('btnFinalizarPoligono');
    if (btnDraw) btnDraw.addEventListener('click', onDrawClick);
    if (btnOtro) btnOtro.addEventListener('click', onDrawClick);
    if (btnFin) btnFin.addEventListener('click', function () {
      if (_mapApi && _mapApi.finishDraw) _mapApi.finishDraw();
    });
  }

  function hideLoading() {
    var loading = $('mapaPublicarLoading');
    if (loading) loading.parentNode.removeChild(loading);
  }

  function showMapError(msg) {
    hideLoading();
    var el = $('mapa-publicar');
    if (el) {
      el.innerHTML =
        '<div class="mapa-error-msg"><strong>Google Maps requerido.</strong> ' + msg + '</div>';
    }
  }

  function fixMapSize(map, el) {
    el.style.width = '100%';
    el.style.height = '520px';
    el.style.minHeight = '520px';
    function resize() {
      if (map && google.maps.event) {
        google.maps.event.trigger(map, 'resize');
      }
    }
    resize();
    setTimeout(resize, 150);
    setTimeout(resize, 600);
    setTimeout(resize, 1200);
    if (global.ResizeObserver) {
      new ResizeObserver(resize).observe(el);
    }
  }

  function pathsFromGooglePolygon(poly) {
    var path = poly.getPath();
    var out = [];
    for (var i = 0; i < path.getLength(); i++) {
      var p = path.getAt(i);
      out.push({ lat: p.lat(), lng: p.lng() });
    }
    return out;
  }

  function centroid(paths) {
    if (!paths || !paths.length) return null;
    var lat = 0;
    var lng = 0;
    paths.forEach(function (p) {
      lat += p.lat;
      lng += p.lng;
    });
    return { lat: lat / paths.length, lng: lng / paths.length };
  }

  function syncHiddenAndPanel(paths, lat, lng) {
    var latEl = $('latitud');
    var lngEl = $('longitud');
    var polyEl = $('poligono_lote');
    var utmZ = $('utm_zona');
    var utmE = $('utm_este');
    var utmN = $('utm_norte');
    var areaEl = $('area_mapa_m2');
    var utmVerts = $('utm_vertices');

    if (latEl) latEl.value = lat != null ? String(roundGps(lat)) : '';
    if (lngEl) lngEl.value = lng != null ? String(roundGps(lng)) : '';
    if (polyEl) polyEl.value = paths && paths.length >= 3 ? JSON.stringify(paths) : '';

    var area = paths && paths.length >= 3 ? polygonAreaM2(paths) : null;
    if (areaEl) areaEl.value = area != null ? String(Math.round(area * 100) / 100) : '';

    var utm = lat != null && lng != null ? latLngToUtm(lat, lng) : null;
    if (utm) {
      if (utmZ) utmZ.value = utm.label;
      if (utmE) utmE.value = utm.easting.toFixed(3);
      if (utmN) utmN.value = utm.northing.toFixed(3);
    } else {
      if (utmZ) utmZ.value = '';
      if (utmE) utmE.value = '';
      if (utmN) utmN.value = '';
    }

    var vertUtm = [];
    if (paths) {
      paths.forEach(function (p, i) {
        var u = latLngToUtm(p.lat, p.lng);
        vertUtm.push({
          v: i + 1,
          lat: p.lat,
          lng: p.lng,
          este: u.easting,
          norte: u.northing,
          zona: u.label,
        });
      });
    }
    if (utmVerts) utmVerts.value = vertUtm.length ? JSON.stringify(vertUtm) : '';

    syncCoordInputs(lat, lng, utm);
    syncPlanAnchorFields();
    updatePanel(paths, lat, lng, utm, area, vertUtm);
    updateStatus(paths, lat, lng, area);
    suggestAreaTotal(area);
  }

  function updatePanel(paths, lat, lng, utm, areaM2, vertUtm) {
    var latDisp = $('coordLatDisp');
    var lngDisp = $('coordLngDisp');
    var utmDisp = $('coordUtmDisp');
    var areaDisp = $('coordAreaDisp');
    var haDisp = $('coordHaDisp');
    var vertList = $('coordVerticesList');

    if (latDisp) latDisp.textContent = lat != null ? roundGps(lat).toFixed(6) : '—';
    if (lngDisp) lngDisp.textContent = lng != null ? roundGps(lng).toFixed(6) : '—';
    if (utmDisp) {
      utmDisp.textContent =
        utm != null
          ? 'Zona ' + utm.label + ' · E ' + fmtN(utm.easting, 2) + ' · N ' + fmtN(utm.northing, 2)
          : '—';
    }
    if (areaDisp) areaDisp.textContent = areaM2 != null ? fmtN(areaM2, 1) + ' m²' : '—';
    if (haDisp) haDisp.textContent = areaM2 != null ? fmtN(areaM2 / 10000, 4) + ' ha' : '—';

    if (vertList) {
      if (!vertUtm.length) {
        vertList.innerHTML = '<tr><td colspan="4" class="pub-coords__empty">Dibuja el poligono para ver vertices UTM</td></tr>';
        return;
      }
      var html = '';
      vertUtm.forEach(function (v) {
        html +=
          '<tr><td>V' +
          v.v +
          '</td><td>' +
          fmtN(v.este, 2) +
          '</td><td>' +
          fmtN(v.norte, 2) +
          '</td><td>' +
          v.zona +
          '</td></tr>';
      });
      vertList.innerHTML = html;
    }
  }

  function updateStatus(paths, lat, lng, areaM2) {
    var st = $('publicarMapaStatus');
    if (!st) return;
    if (paths && paths.length >= 3) {
      st.innerHTML =
        '<strong>Poligono listo</strong> — ' +
        paths.length +
        ' vertices · ' +
        (areaM2 != null ? fmtN(areaM2, 0) + ' m² calculados' : '') +
        '. Se guardara en el mapa del portal.';
      st.className = 'publicar-mapa__status publicar-mapa__status--ok';
    } else if (lat != null) {
      if (_geoMode === 'punto') {
        st.textContent = 'Pin ubicado. Con modo punto no necesitas dibujar poligono.';
      } else {
        st.textContent = 'Pin ubicado. Puedes dibujar el poligono del lote si lo necesitas.';
      }
      st.className = 'publicar-mapa__status publicar-mapa__status--ok';
    } else {
      st.textContent = 'Dibuja el poligono o ingresa coordenadas UTM / GPS abajo.';
      st.className = 'publicar-mapa__status';
    }
  }

  function suggestAreaTotal(areaM2) {
    if (areaM2 == null || areaM2 <= 0) return;
    var inp = document.querySelector('[name="area_total"]');
    if (inp && (!inp.value || Number(inp.value) === 0)) {
      inp.value = String(Math.round(areaM2));
    }
  }

  function mapsReady() {
    return !!(global.google && global.google.maps && global.google.maps.Map && global.google.maps.geometry);
  }

  function loadGoogle(key, cb) {
    if (mapsReady()) {
      cb(null);
      return;
    }
    global.__mphGmapsWaiters = global.__mphGmapsWaiters || [];
    global.__mphGmapsWaiters.push(cb);

    if (!global.__mphGmapsReady) {
      global.__mphGmapsReady = function () {
        var waiters = global.__mphGmapsWaiters || [];
        global.__mphGmapsWaiters = [];
        var err = mapsReady() ? null : new Error('maps');
        waiters.forEach(function (w) {
          try {
            w(err);
          } catch (eWait) {
            /* ignore */
          }
        });
      };
    }

    if (document.querySelector('script[data-mph-gmaps]')) {
      var n = 0;
      var t = setInterval(function () {
        n += 1;
        if (mapsReady()) {
          clearInterval(t);
          global.__mphGmapsReady();
        } else if (n > 60) {
          clearInterval(t);
          cb(new Error('maps'));
        }
      }, 200);
      return;
    }

    var s = document.createElement('script');
    s.setAttribute('data-mph-gmaps', '1');
    s.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&libraries=drawing,geometry&loading=async&callback=__mphGmapsReady&v=weekly';
    s.async = true;
    s.defer = true;
    s.onerror = function () {
      cb(new Error('maps'));
    };
    document.head.appendChild(s);
  }

  function deriveLatLngFromPlanRaw(planRaw) {
    if (!planRaw) return null;
    try {
      var pl = JSON.parse(planRaw);
      var feats = (pl && pl.features) || [];
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        if (f.path && f.path.length >= 3) {
          return centroid(f.path);
        }
      }
    } catch (errPlan) {
      return null;
    }
    return null;
  }

  function planHasLotes(planRaw) {
    if (!planRaw) return false;
    try {
      var pl = JSON.parse(planRaw);
      return !!(
        pl &&
        pl.features &&
        pl.features.some(function (f) {
          return (
            (f.tipo === 'lote' || !f.tipo) &&
            ((f.path && f.path.length >= 3) || (f.localPath && f.localPath.length >= 3))
          );
        })
      );
    } catch (errPlan2) {
      return false;
    }
  }

  function initGoogle(opts) {
    var el = $(opts.containerId);
    if (!el) return;

    hideLoading();
    el.innerHTML = '';

    var map;
    try {
      map = new google.maps.Map(el, {
      center: CUSCO,
      zoom: 16,
      mapTypeId: 'hybrid',
      gestureHandling: 'greedy',
      streetViewControl: true,
      streetViewControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
      mapTypeControl: false,
      fullscreenControl: true,
      zoomControl: true,
      clickableIcons: false,
    });
    } catch (err) {
      showMapError('Error al iniciar el mapa: ' + (err.message || 'revisa la API key'));
      return;
    }

    fixMapSize(map, el);

    var marker = new google.maps.Marker({
      map: map,
      position: CUSCO,
      draggable: true,
      title: 'Ubicacion de la propiedad',
      visible: false,
      zIndex: 500,
    });
    _publishMarker = marker;

    function drawingStyleFromEstado() {
      var estado = 'disponible';
      if (global.MPHPlanoImport && global.MPHPlanoImport.getDrawEstado) {
        estado = global.MPHPlanoImport.getDrawEstado();
      } else {
        var sel = $('selectDibujoEstado');
        if (sel) estado = sel.value;
      }
      var colors = {
        disponible: { fill: '#22c55e', stroke: '#ffffff' },
        reservado: { fill: '#3b82f6', stroke: '#ffffff' },
        vendido: { fill: '#ef4444', stroke: '#ffffff' },
        calle: { fill: '#64748b', stroke: '#e2e8f0' },
      };
      var c = colors[estado] || colors.disponible;
      return {
        fillColor: c.fill,
        fillOpacity: estado === 'calle' ? 0.35 : 0.55,
        strokeColor: c.stroke,
        strokeWeight: 2.5,
        editable: true,
        draggable: true,
        zIndex: 2,
      };
    }

    var drawingManager = null;
    if (google.maps.drawing && google.maps.drawing.DrawingManager) {
      try {
        drawingManager = new google.maps.drawing.DrawingManager({
          drawingMode: null,
          drawingControl: false,
          polygonOptions: drawingStyleFromEstado(),
        });
        drawingManager.setMap(map);
      } catch (errDraw) {
        drawingManager = null;
      }
    }

    var manualDraw = null;

    function clearManualDrawPreview() {
      if (!manualDraw) return;
      if (manualDraw.polyline) manualDraw.polyline.setMap(null);
      if (manualDraw.polygon) manualDraw.polygon.setMap(null);
      (manualDraw.markers || []).forEach(function (m) { m.setMap(null); });
      if (manualDraw.clickListener) google.maps.event.removeListener(manualDraw.clickListener);
      manualDraw = null;
    }

    function stopDrawMode() {
      if (drawingManager) drawingManager.setDrawingMode(null);
      clearManualDrawPreview();
      setDrawToolbarActive(false);
      map.setOptions({ draggableCursor: null, draggingCursor: null });
      var hint = $('drawMapHint');
      if (hint) hint.hidden = true;
    }

    function commitDrawnPaths(paths) {
      stopDrawMode();
      if (!paths || paths.length < 3) return;
      if (global.MPHPlanoImport && global.MPHPlanoImport.addDrawnFeature) {
        global.MPHPlanoImport.addDrawnFeature(paths, { fit: false });
        if (global.MPHPlanoImport.getPlan) {
          syncFromPlan(global.MPHPlanoImport.getPlan());
        }
      } else {
        var c = centroid(paths);
        syncHiddenAndPanel(paths, c.lat, c.lng);
      }
      var hint = $('loteMapHint');
      if (hint) hint.hidden = false;
    }

    function updateManualPreview() {
      if (!manualDraw || !manualDraw.points.length) return;
      var path = manualDraw.points;
      var style = drawingStyleFromEstado();
      if (manualDraw.polyline) manualDraw.polyline.setMap(null);
      manualDraw.polyline = new google.maps.Polyline({
        map: map,
        path: path,
        strokeColor: style.strokeColor,
        strokeWeight: 2.5,
        strokeOpacity: 0.95,
        zIndex: 999,
      });
      if (path.length >= 3) {
        if (!manualDraw.polygon) {
          manualDraw.polygon = new google.maps.Polygon({
            map: map,
            paths: path,
            fillColor: style.fillColor,
            fillOpacity: style.fillOpacity,
            strokeColor: style.strokeColor,
            strokeWeight: 2,
            strokeOpacity: 0.9,
            clickable: false,
            zIndex: 998,
          });
        } else {
          manualDraw.polygon.setPaths(path);
        }
      }
    }

    function finishManualDraw() {
      if (!manualDraw || manualDraw.points.length < 3) {
        alert('Marca al menos 3 esquinas en el mapa antes de finalizar.');
        return;
      }
      var paths = manualDraw.points.map(function (ll) {
        return { lat: ll.lat(), lng: ll.lng() };
      });
      commitDrawnPaths(paths);
    }

    function onManualMapClick(e) {
      if (!manualDraw || !manualDraw.active) return;
      var latLng = e.latLng;
      if (manualDraw.points.length >= 3) {
        var first = manualDraw.points[0];
        var near =
          google.maps.geometry &&
          google.maps.geometry.spherical.computeDistanceBetween(first, latLng) < 12;
        if (near) {
          finishManualDraw();
          return;
        }
      }
      manualDraw.points.push(latLng);
      manualDraw.markers.push(
        new google.maps.Marker({
          map: map,
          position: latLng,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#e85d04',
            strokeWeight: 2,
          },
          zIndex: 1000,
        })
      );
      updateManualPreview();
      var st = $('publicarMapaStatus');
      if (st) {
        st.innerHTML =
          '<strong>Esquina ' +
          manualDraw.points.length +
          '</strong> — sigue marcando puntos. Clic cerca del primero o pulsa <strong>Finalizar poligono</strong>.';
        st.className = 'publicar-mapa__status publicar-mapa__status--active';
      }
    }

    function startDrawMode() {
      stopDrawMode();
      scrollToPublishMap();
      setDrawToolbarActive(true);
      map.setOptions({ draggableCursor: 'crosshair', draggingCursor: 'crosshair' });

      manualDraw = { active: true, points: [], markers: [] };
      manualDraw.clickListener = map.addListener('click', onManualMapClick);

      var st = $('publicarMapaStatus');
      if (st) {
        st.innerHTML =
          '<strong>Modo dibujo activo</strong> — haz clic en el mapa en cada esquina del lote. ' +
          'Cierra en la primera esquina o pulsa <strong>Finalizar poligono</strong>.';
        st.className = 'publicar-mapa__status publicar-mapa__status--active';
      }
      var hint = $('drawMapHint');
      if (hint) hint.hidden = false;
    }

    if (drawingManager) {
      google.maps.event.addListener(drawingManager, 'polygoncomplete', function (poly) {
        drawingManager.setDrawingMode(null);
        var paths = pathsFromGooglePolygon(poly);
        poly.setMap(null);
        clearManualDrawPreview();
        commitDrawnPaths(paths);
      });
    }

    _mapApi = {
      startDraw: startDrawMode,
      finishDraw: finishManualDraw,
      stopDraw: stopDrawMode,
    };
    function syncFromPlan(plan) {
      if (!plan || !plan.features || !plan.features.length) {
        syncHiddenAndPanel(null, null, null);
        return;
      }
      var lotes = plan.features.filter(function (f) {
        return f.path && f.path.length >= 3;
      });
      var selectedId =
        global.MPHPlanoImport && global.MPHPlanoImport.getSelectedId
          ? global.MPHPlanoImport.getSelectedId()
          : null;
      var primary = null;
      if (selectedId) {
        primary = lotes.find(function (f) {
          return f.id === selectedId;
        });
      }
      if (!primary) {
        primary =
          lotes.find(function (f) {
            return f.tipo === 'lote';
          }) || lotes[0];
      }
      if (!primary) return;
      var c = centroid(primary.path);
      if (c) {
        marker.setPosition(c);
        syncHiddenAndPanel(primary.path, c.lat, c.lng);
      }
      var st = $('publicarMapaStatus');
      if (st) {
        if (_geoMode === 'plano') {
          st.innerHTML =
            '<strong>Plano cargado</strong> — clic en cada lote para cambiar estado (disponible, reservado, vendido).';
        } else {
          st.innerHTML =
            '<strong>' +
            plan.features.length +
            ' poligono(s)</strong> en el mapa. Puedes seguir dibujando con &quot;+ Otro poligono&quot;.';
        }
        st.className = 'publicar-mapa__status publicar-mapa__status--ok';
      }
    }

    _syncFromPlanRef = syncFromPlan;
    _stopDrawFn = stopDrawMode;

    marker.addListener('drag', function () {
      if (_pricePinOverlay && _pricePinOverlay.refresh) _pricePinOverlay.refresh();
    });
    marker.addListener('dragend', function () {
      var p = marker.getPosition();
      syncPositionFromMap(p.lat(), p.lng());
      if (_pricePinOverlay && _pricePinOverlay.refresh) _pricePinOverlay.refresh();
    });

    map.addListener('click', function (e) {
      if (manualDraw && manualDraw.active) return;
      if (drawingManager && drawingManager.getDrawingMode()) return;
      marker.setPosition(e.latLng);
      syncPositionFromMap(e.latLng.lat(), e.latLng.lng());
      if (_pricePinOverlay && _pricePinOverlay.refresh) _pricePinOverlay.refresh();
    });

    function goToLatLng(lat, lng, zoom) {
      var ll = new google.maps.LatLng(lat, lng);
      map.panTo(ll);
      map.setZoom(zoom || 18);
      marker.setPosition(ll);
      syncPositionFromMap(lat, lng);
    }

    var btnClear = $('btnBorrarLote');
    var btnSat = $('btnMapaSatelite');
    var btnHyb = $('btnMapaHibrido');
    var btnMap = $('btnMapaPlano');
    var btnGoUtm = $('btnIrUtm');
    var btnGoGps = $('btnIrGps');

    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (_mapApi && _mapApi.stopDraw) _mapApi.stopDraw();
        if (global.MPHPlanoImport && global.MPHPlanoImport.clearAll) {
          global.MPHPlanoImport.clearAll(true);
        }
        syncHiddenAndPanel(null, null, null);
        var st = $('publicarMapaStatus');
        if (st) {
          st.textContent = 'Agrega uno o mas poligonos (lotes/calles) o importa un plano SVG/DXF.';
          st.className = 'publicar-mapa__status';
        }
      });
    }

    function setViewBtn(active) {
      [btnSat, btnHyb, btnMap].forEach(function (b) {
        if (b) b.classList.toggle('is-active', b === active);
      });
    }

    if (btnSat) {
      btnSat.addEventListener('click', function () {
        map.setMapTypeId('satellite');
        setViewBtn(btnSat);
      });
    }
    if (btnHyb) {
      btnHyb.addEventListener('click', function () {
        map.setMapTypeId('hybrid');
        setViewBtn(btnHyb);
      });
    }
    if (btnMap) {
      btnMap.addEventListener('click', function () {
        map.setMapTypeId('roadmap');
        setViewBtn(btnMap);
      });
    }

    if (btnGoUtm) {
      btnGoUtm.addEventListener('click', function () {
        var zone = parseInt(($('inputUtmZona') || {}).value, 10);
        var hem = (($('selectUtmHem') || {}).value || 'S').toUpperCase();
        var e = parseFloat(($('inputUtmE') || {}).value);
        var n = parseFloat(($('inputUtmN') || {}).value);
        if (!zone || isNaN(e) || isNaN(n)) {
          alert('Ingresa zona UTM, Este (E) y Norte (N) validos.');
          return;
        }
        var ll = utmToLatLng(zone, hem, e, n);
        goToLatLng(ll.lat, ll.lng, 18);
      });
    }

    if (btnGoGps) {
      btnGoGps.addEventListener('click', function () {
        var lat = parseFloat(($('inputGpsLat') || {}).value);
        var lng = parseFloat(($('inputGpsLng') || {}).value);
        if (isNaN(lat) || isNaN(lng)) {
          alert('Ingresa latitud y longitud validas.');
          return;
        }
        goToLatLng(lat, lng, 18);
      });
    }

    function bootstrapPlanFromPoligono() {
      if (!global.MPHPlanoImport) return;
      var planEl = $('plan_masterplan');
      var polyEl = $('poligono_lote');
      if (!planEl || !polyEl) return;
      var hasPlan = planEl.value && planEl.value.length > 5;
      if (!hasPlan && polyEl.value && polyEl.value.length > 10) {
        var boot = global.MPHPlanoImport.planFromPoligono(polyEl.value, 'Lote');
        if (boot) planEl.value = JSON.stringify(boot);
      }
    }

    function restoreInitialState() {
      var lat = parseFloat(($('latitud') || {}).value);
      var lng = parseFloat(($('longitud') || {}).value);
      var plan =
        global.MPHPlanoImport && global.MPHPlanoImport.getPlan
          ? global.MPHPlanoImport.getPlan()
          : null;

      if (plan && plan.features && plan.features.length) {
        syncFromPlan(plan);
        if (!isNaN(lat) && !isNaN(lng)) {
          map.setCenter({ lat: lat, lng: lng });
          map.setZoom(17);
        }
        var st = $('publicarMapaStatus');
        if (st && opts.modoEdicion) {
          st.innerHTML =
            '<strong>Plano cargado</strong> — clic en cada lote para cambiar estado (disponible, reservado, vendido).';
          st.className = 'publicar-mapa__status publicar-mapa__status--ok';
        }
        return;
      }

      var polyRaw = ($('poligono_lote') || {}).value;
      if (polyRaw && polyRaw.length > 10) {
        try {
          var paths = JSON.parse(polyRaw);
          if (paths && paths.length >= 3) {
            var c = centroid(paths);
            if (c) {
              marker.setPosition(c);
              map.setCenter(c);
              map.setZoom(18);
              syncHiddenAndPanel(paths, c.lat, c.lng);
              return;
            }
          }
        } catch (errPoly) {
          /* ignore */
        }
      }

      if (!isNaN(lat) && !isNaN(lng)) {
        marker.setPosition({ lat: lat, lng: lng });
        map.setCenter({ lat: lat, lng: lng });
        map.setZoom(17);
        syncHiddenAndPanel(null, lat, lng);
        return;
      }

      syncHiddenAndPanel(null, null, null);
    }

    bootstrapPlanFromPoligono();

    var initLat = parseFloat(($('latitud') || {}).value);
    var initLng = parseFloat(($('longitud') || {}).value);
    if (!isNaN(initLat) && !isNaN(initLng)) {
      var initPos = { lat: initLat, lng: initLng };
      map.setCenter(initPos);
      marker.setPosition(initPos);
      map.setZoom(17);
    }

    google.maps.event.addListenerOnce(map, 'tilesloaded', function () {
      fixMapSize(map, el);
    });

    if (global.MPHPlanoImport) {
      var formPricing = readFormPricing();
      global.MPHPlanoImport.attach({
        map: map,
        utmToLatLng: utmToLatLng,
        latLngToUtm: latLngToUtm,
        listingPrecio: formPricing.precio,
        listingMoneda: formPricing.moneda,
        listingAreaTotal: formPricing.area_total,
        showLotePrices: false,
        getMapCenter: function () {
          var p = marker.getPosition();
          return { lat: p.lat(), lng: p.lng() };
        },
        onPlanChange: function (plan) {
          syncFromPlan(plan);
          refreshPlanoPanelVisibility();
        },
        onPlanCleared: function () {
          syncHiddenAndPanel(null, null, null);
        },
        autoFit: !!opts.modoEdicion,
      });
      var planRaw = ($('plan_masterplan') || {}).value;
      if (planRaw && planRaw.length > 10 && global.MPHPlanoImport.loadPlan) {
        global.MPHPlanoImport.loadPlan(planRaw);
      }
    }

    restoreInitialState();
    restorePanelFromHidden();
    refreshPricePin(marker, map);
    bindPricingFields(marker, map);

    setTimeout(function () {
      if (map && google.maps.event) {
        google.maps.event.trigger(map, 'resize');
        var planNow =
          global.MPHPlanoImport && global.MPHPlanoImport.getPlan
            ? global.MPHPlanoImport.getPlan()
            : null;
        if (planNow && planNow.features && planNow.features.length) {
          var b = new google.maps.LatLngBounds();
          planNow.features.forEach(function (f) {
            (f.path || []).forEach(function (p) {
              b.extend(p);
            });
          });
          if (!b.isEmpty()) map.fitBounds(b, 48);
        }
      }
    }, 400);
  }

  function syncBeforeSubmit() {
    normalizeCoordFields();
    if (_geoMode === 'punto') {
      var polyClear = $('poligono_lote');
      var planClear = $('plan_masterplan');
      var vertsClear = $('utm_vertices');
      if (polyClear) polyClear.value = '';
      if (planClear) planClear.value = '';
      if (vertsClear) vertsClear.value = '';
    }
    if (global.MPHPlanoImport && global.MPHPlanoImport.flushAllLoteFields) {
      global.MPHPlanoImport.flushAllLoteFields();
    }
    if (global.MPHPlanoImport && global.MPHPlanoImport.syncBeforeSubmit) {
      global.MPHPlanoImport.syncBeforeSubmit();
    }
    var planRaw = ($('plan_masterplan') || {}).value;
    var latEl = $('latitud');
    var lngEl = $('longitud');
    if (latEl && lngEl && (!latEl.value || !lngEl.value)) {
      var c = deriveLatLngFromPlanRaw(planRaw);
      if (c) {
        latEl.value = String(c.lat);
        lngEl.value = String(c.lng);
      }
    }
  }

  function bindFormValidation(tipos) {
    var form = document.querySelector('form.form--card');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      syncBeforeSubmit();

      var modoEdicion = !!(_pendingOpts && _pendingOpts.modoEdicion);
      var planRaw = ($('plan_masterplan') || {}).value;
      var hasPlan = planHasLotes(planRaw);
      var latEl = $('latitud');
      var lngEl = $('longitud');
      var lat = latEl ? latEl.value : '';
      var lng = lngEl ? lngEl.value : '';

      if ((!lat || !lng) && hasPlan) {
        var c = deriveLatLngFromPlanRaw(planRaw);
        if (c && latEl && lngEl) {
          latEl.value = String(c.lat);
          lngEl.value = String(c.lng);
          lat = latEl.value;
          lng = lngEl.value;
        }
      }

      if (modoEdicion) {
        return true;
      }

      var tipoId = parseInt((form.querySelector('[name="tipo_id"]') || {}).value, 10);
      var codigo = '';
      (tipos || []).forEach(function (t) {
        if (t.TipoId === tipoId) codigo = (t.Codigo || '').toLowerCase();
      });
      var poly = ($('poligono_lote') || {}).value;
      var geoMode = ($('geo_modo') || {}).value || 'punto';

      if (geoMode === 'plano' && !hasPlan) {
        e.preventDefault();
        alert('En modo SVG/DXF debes cargar un plano con poligonos de lotes.');
        $('mapa-publicar') && $('mapa-publicar').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
      if (geoMode === 'poligono' && (!poly || poly.length < 10) && !hasPlan) {
        e.preventDefault();
        alert('En modo poligono dibuja al menos un lote en el mapa.');
        $('mapa-publicar') && $('mapa-publicar').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
      if (geoMode === 'punto') {
        if (!lat || !lng) {
          e.preventDefault();
          alert('Marca la ubicacion en el mapa o usa coordenadas UTM/GPS.');
          $('mapa-publicar') && $('mapa-publicar').scrollIntoView({ behavior: 'smooth', block: 'center' });
          return false;
        }
        return true;
      }
      if (!lat || !lng) {
        e.preventDefault();
        alert('Marca la ubicacion en el mapa o usa coordenadas UTM/GPS.');
        return false;
      }
    });
  }

  function tryStartMap() {
    if (!_pendingOpts || _mapReady) return;
    if (!global.google || !global.google.maps) return;
    if (!global.google.maps.geometry) {
      showMapError(
        'Falta la libreria <strong>geometry</strong>. Habilita Maps JavaScript API y recarga (Ctrl+F5).'
      );
      return;
    }
    _mapReady = true;
    initGoogle(_pendingOpts);
  }

  function restorePanelFromHidden() {
    var lat = parseFloat(($('latitud') || {}).value);
    var lng = parseFloat(($('longitud') || {}).value);
    var polyRaw = ($('poligono_lote') || {}).value;
    var paths = null;
    if (polyRaw && polyRaw.length > 10) {
      try {
        paths = JSON.parse(polyRaw);
      } catch (errPoly) {
        paths = null;
      }
    }
    var vertUtm = [];
    var vertRaw = ($('utm_vertices') || {}).value;
    if (vertRaw && vertRaw.length > 5) {
      try {
        vertUtm = JSON.parse(vertRaw);
      } catch (errVert) {
        vertUtm = [];
      }
    }
    if (isNaN(lat) || isNaN(lng)) return;
    var rLat = roundGps(lat);
    var rLng = roundGps(lng);
    var utm = latLngToUtm(rLat, rLng);
    var area = paths && paths.length >= 3 ? polygonAreaM2(paths) : null;
    if (area == null) {
      var areaStored = parseFloat(($('area_mapa_m2') || {}).value);
      if (!isNaN(areaStored)) area = areaStored;
    }
    syncCoordInputs(rLat, rLng, utm);
    updatePanel(paths, rLat, rLng, utm, area, vertUtm);
  }

  function applyInitialMapData(mapData) {
    if (!mapData) return;
    Object.keys(mapData).forEach(function (key) {
      var el = document.getElementById(key);
      if (!el || mapData[key] == null) return;
      el.value = typeof mapData[key] === 'object' ? JSON.stringify(mapData[key]) : String(mapData[key]);
    });
    var gpsLat = $('inputGpsLat');
    var gpsLng = $('inputGpsLng');
    if (gpsLat && mapData.latitud != null) {
      var la = roundGps(mapData.latitud);
      if (la != null) gpsLat.value = la.toFixed(6);
    }
    if (gpsLng && mapData.longitud != null) {
      var lo = roundGps(mapData.longitud);
      if (lo != null) gpsLng.value = lo.toFixed(6);
    }
    var utmE = $('inputUtmE');
    var utmN = $('inputUtmN');
    if (utmE && mapData.utm_este != null) {
      var ue = roundUtm(mapData.utm_este);
      if (ue != null) utmE.value = ue.toFixed(3);
    }
    if (utmN && mapData.utm_norte != null) {
      var un = roundUtm(mapData.utm_norte);
      if (un != null) utmN.value = un.toFixed(3);
    }
    if (mapData.plan_masterplan && global.MPHPlanoImport && global.MPHPlanoImport.loadPlan) {
      global.MPHPlanoImport.loadPlan(mapData.plan_masterplan);
    }
    normalizeCoordFields();
    restorePanelFromHidden();
  }

  function bindEditSubmit() {
    var form = document.getElementById('formPublicar');
    if (!form) return;
    form.addEventListener('submit', function () {
      syncBeforeSubmit();
      var btn = document.getElementById('btnGuardarEdicion');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Guardando...';
      }
    });
  }

  function configure(opts) {
    _pendingOpts = opts;
    applyInitialMapData(opts.initialMap || null);
    bindGeoMode();
    var initialMode = detectInitialGeoMode(opts.initialMap || null) || suggestDefaultGeoMode();
    setGeoMode(initialMode, { skipConfirm: true });
    if (!opts.modoEdicion) {
      bindFormValidation(opts.tipos || []);
    } else {
      bindEditSubmit();
    }
    bindDrawToolbar();
    if (!opts.googleKey) {
      showMapError(
        'Configura <code>GOOGLE_MAPS_API_KEY</code> en .env con <strong>Maps JavaScript API</strong>.'
      );
      return;
    }
    global.gm_authFailure = function () {
      showAuthError();
      var wrap = document.querySelector('.publicar-mapa__map-wrap');
      if (wrap && !wrap.querySelector('.mapa-aviso--auth')) {
        var aviso = document.createElement('div');
        aviso.className = 'mapa-aviso mapa-aviso--warn mapa-aviso--auth';
        aviso.innerHTML =
          '<strong>Google Maps no cargo el fondo del mapa.</strong> Los lotes siguen editables. ' +
          'Revisa en Google Cloud: <code>Maps JavaScript API</code>, facturacion y restriccion ' +
          '<code>http://127.0.0.1:5000/*</code>.';
        wrap.insertBefore(aviso, wrap.firstChild);
      }
    };
    loadGoogle(opts.googleKey, function (err) {
      if (err) {
        showMapError(
          'No se pudo cargar Google Maps. Revisa la API key y que <code>127.0.0.1:5000</code> este permitido.'
        );
        return;
      }
      tryStartMap();
    });
  }

  function startMap() {
    tryStartMap();
  }

  function showAuthError() {
    showMapError(
      'Google rechazo la clave. En Google Cloud: activa <strong>Maps JavaScript API</strong>, facturacion, y restringe <code>http://127.0.0.1:5000/*</code>.'
    );
  }

  global.MPHPublicarMapa = {
    configure: configure,
    startMap: startMap,
    showAuthError: showAuthError,
    init: configure,
    syncBeforeSubmit: syncBeforeSubmit,
    setGeoMode: setGeoMode,
    latLngToUtm: latLngToUtm,
    utmToLatLng: utmToLatLng,
  };
})(typeof window !== 'undefined' ? window : this);

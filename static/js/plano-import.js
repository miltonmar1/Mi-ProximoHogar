/* Importacion de planos SVG/DXF — mapa interactivo con etiquetas y panel de lote */
(function (global) {
  'use strict';

  var ESTADOS = {
    disponible: { label: 'Disponible', fill: '#22c55e', stroke: '#ffffff', opacity: 0.55, z: 3 },
    reservado: { label: 'Reservado', fill: '#3b82f6', stroke: '#ffffff', opacity: 0.55, z: 3 },
    vendido: { label: 'Vendido', fill: '#ef4444', stroke: '#ffffff', opacity: 0.55, z: 3 },
    calle: { label: 'Calle / via', fill: '#64748b', stroke: '#e2e8f0', opacity: 0.35, z: 1 },
  };

  var _map = null;
  var _hooks = null;
  var _plan = null;
  var _mapPolys = [];
  var _mapLabels = [];
  var _selectedId = null;
  var _pendingRender = false;
  var _readonly = false;
  var _propertyTitle = '';
  var _listingPrecio = null;
  var _listingMoneda = 'PEN';
  var _listingAreaTotal = null;
  var _showLotePrices = false;
  var _panelBound = false;
  var _infoWindow = null;
  var _zoomListener = null;
  var _zoomDebounce = null;
  var _moveProjectActive = false;
  var _anchorMarker = null;
  var _moveDragSnapshot = null;
  var _scaleModeActive = false;
  var _rotateModeActive = false;
  var _transformSnapshot = null;
  var _scalePickActive = false;
  var _scaleMeasurePoints = [];
  var _scaleMeasureMarkers = [];
  var _scaleMeasureLine = null;
  var _mapClickListener = null;

  /* Niveles de zoom (estilo Google Maps: mas cerca = mas detalle) */
  var ZOOM_POLYS_FAINT = 12;
  var ZOOM_LABELS_NUM = 14;
  var ZOOM_LABELS_FULL = 17;
  var ZOOM_PANEL = 18;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function fmtM(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  }

  function roundGpsCoord(n) {
    if (n == null || isNaN(n)) return null;
    return Math.round(Number(n) * 1e6) / 1e6;
  }

  function roundUtmCoord(n) {
    if (n == null || isNaN(n)) return null;
    return Math.round(Number(n) * 1e3) / 1e3;
  }

  function normalizeFeature(f) {
    if (!f) return f;
    if (f.etapa == null) f.etapa = '';
    if (f.manzana == null) f.manzana = '';
    if (f.lote == null) f.lote = '';
    if (f.tipologia == null) f.tipologia = '';
    return f;
  }

  function parsePlanRaw(raw) {
    if (!raw) return null;
    try {
      var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || !Array.isArray(data.features)) return null;
      data.features = data.features.map(normalizeFeature);
      return data;
    } catch (e) {
      return null;
    }
  }

  function parsePoligonoPaths(raw) {
    if (!raw) return null;
    try {
      var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(data) || data.length < 3) return null;
      return data.map(function (p) {
        return { lat: Number(p.lat), lng: Number(p.lng) };
      });
    } catch (e) {
      return null;
    }
  }

  function planFromPoligono(poligonoRaw, label) {
    var path = parsePoligonoPaths(poligonoRaw);
    if (!path) return null;
    return {
      version: 1,
      source: 'poligono',
      features: [
        normalizeFeature({
          id: 'poligono-1',
          label: label || 'Lote',
          tipo: 'lote',
          estado: 'disponible',
          etapa: '',
          manzana: '',
          lote: '1',
          tipologia: '',
          path: path,
        }),
      ],
    };
  }

  function ensureRenderablePlan(plan, fallbackPoligono, label) {
    if (!plan || !plan.features || !plan.features.length) {
      return planFromPoligono(fallbackPoligono, label);
    }
    var hasPath = plan.features.some(function (f) {
      return f.path && f.path.length >= 3;
    });
    if (hasPath) return plan;
    var fb = planFromPoligono(fallbackPoligono, label);
    if (fb) return fb;
    return plan;
  }

  function centroid(path) {
    if (!path || !path.length) return null;
    var lat = 0;
    var lng = 0;
    path.forEach(function (p) {
      lat += Number(p.lat);
      lng += Number(p.lng);
    });
    return { lat: lat / path.length, lng: lng / path.length };
  }

  function polygonAreaM2(paths) {
    if (!paths || paths.length < 3 || !global.google || !google.maps.geometry) return null;
    var ring = paths.map(function (p) {
      return new google.maps.LatLng(p.lat, p.lng);
    });
    return google.maps.geometry.spherical.computeArea(ring);
  }

  function edgeLengthM(a, b) {
    if (global.google && google.maps && google.maps.geometry) {
      return google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(a.lat, a.lng),
        new google.maps.LatLng(b.lat, b.lng)
      );
    }
    var R = 6371000;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function computeFeatureMetrics(feat) {
    if (!feat || !feat.path || feat.path.length < 3) return feat;
    var path = feat.path;
    var area = polygonAreaM2(path);
    var edges = [];
    for (var i = 0; i < path.length; i++) {
      var a = path[i];
      var b = path[(i + 1) % path.length];
      edges.push(edgeLengthM(a, b));
    }
    var perimetro = edges.reduce(function (s, m) { return s + m; }, 0);
    edges.sort(function (a, b) { return b - a; });
    feat.area_m2 = area != null ? Math.round(area * 100) / 100 : null;
    feat.perimetro_m = Math.round(perimetro * 100) / 100;
    feat.lados = {
      frente: edges[0] != null ? Math.round(edges[0] * 100) / 100 : null,
      fondo: edges[1] != null ? Math.round(edges[1] * 100) / 100 : null,
      izquierda: edges[2] != null ? Math.round(edges[2] * 100) / 100 : null,
      derecha: edges[3] != null ? Math.round(edges[3] * 100) / 100 : null,
    };
    return feat;
  }

  function refreshAllMetrics() {
    if (!_plan) return;
    (_plan.features || []).forEach(function (f) {
      if (f.tipo !== 'calle' && f.path && f.path.length >= 3) computeFeatureMetrics(f);
    });
  }

  function getDefaultLoteMeta() {
    var etapa = (($('inputDefEtapa') || {}).value || '').trim();
    var manzana = (($('inputDefManzana') || {}).value || '').trim();
    if (!etapa) etapa = '1';
    if (!manzana) manzana = 'A';
    return { etapa: etapa, manzana: String(manzana).toUpperCase() };
  }

  function parseLoteNum(s) {
    if (!s) return null;
    var m = String(s).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function padLote(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function maxLoteInGroup(features, etapa, manzana) {
    var max = 0;
    (features || []).forEach(function (f) {
      if (f.tipo === 'calle' || f.estado === 'calle') return;
      if (String(f.etapa || '') !== String(etapa)) return;
      if (String(f.manzana || '').toUpperCase() !== String(manzana).toUpperCase()) return;
      var n = parseLoteNum(f.lote);
      if (n != null && n > max) max = n;
    });
    return max;
  }

  function featureCentroid(feat) {
    if (!feat) return null;
    if (feat.path && feat.path.length) return centroid(feat.path);
    var path = feat.localPath;
    if (!path || !path.length) return null;
    var x = 0;
    var y = 0;
    path.forEach(function (p) {
      x += Number(p.x != null ? p.x : p.lng);
      y += Number(p.y != null ? p.y : p.lat);
    });
    return { lat: y / path.length, lng: x / path.length };
  }

  function buildAutoLabel(feat) {
    return 'Lote ' + (parseLoteNum(feat.lote) || feat.lote || '');
  }

  function needsAutoLabel(label) {
    if (!label) return true;
    return /^Pol[ií]gono\s+\d+$/i.test(label) || /^Lote\s+\d+$/i.test(label);
  }

  function autofillFeature(feat, plan) {
    if (!feat || feat.tipo === 'calle' || feat.estado === 'calle') return feat;
    var defaults = getDefaultLoteMeta();
    normalizeFeature(feat);
    if (!feat.etapa) feat.etapa = defaults.etapa;
    if (!feat.manzana) feat.manzana = defaults.manzana;
    feat.manzana = String(feat.manzana).toUpperCase();
    if (!feat.lote) {
      var next = maxLoteInGroup((plan && plan.features) || [], feat.etapa, feat.manzana) + 1;
      feat.lote = padLote(next);
    }
    if (needsAutoLabel(feat.label)) feat.label = buildAutoLabel(feat);
    if (!feat.estado) feat.estado = getDrawEstado();
    return feat;
  }

  function sortLotesByPosition(list) {
    return list.slice().sort(function (a, b) {
      var ca = featureCentroid(a);
      var cb = featureCentroid(b);
      if (!ca && !cb) return 0;
      if (!ca) return 1;
      if (!cb) return -1;
      if (Math.abs(ca.lat - cb.lat) > 1e-6) return cb.lat - ca.lat;
      return ca.lng - cb.lng;
    });
  }

  function autofillAllLotes(plan, forceAll) {
    if (!plan || !Array.isArray(plan.features)) return plan;
    var defaults = getDefaultLoteMeta();
    var lotes = plan.features.filter(function (f) {
      return f.tipo !== 'calle' && f.estado !== 'calle';
    });

    lotes.forEach(function (feat) {
      normalizeFeature(feat);
      if (!feat.etapa || forceAll) feat.etapa = defaults.etapa;
      if (!feat.manzana || forceAll) feat.manzana = defaults.manzana;
      feat.manzana = String(feat.manzana).toUpperCase();
      if (!feat.estado) feat.estado = 'disponible';
      if (!feat.tipo) feat.tipo = 'lote';
    });

    var groups = {};
    lotes.forEach(function (feat) {
      var key = feat.etapa + '|' + feat.manzana;
      if (!groups[key]) groups[key] = [];
      groups[key].push(feat);
    });

    Object.keys(groups).forEach(function (key) {
      var parts = key.split('|');
      var etapa = parts[0];
      var manzana = parts[1];
      var group = groups[key];
      var pending = forceAll
        ? sortLotesByPosition(group)
        : sortLotesByPosition(group.filter(function (f) { return !f.lote; }));
      var maxNum = forceAll ? 0 : maxLoteInGroup(plan.features, etapa, manzana);
      pending.forEach(function (feat) {
        maxNum += 1;
        feat.lote = padLote(maxNum);
        feat.label = buildAutoLabel(feat);
      });
      group.forEach(function (feat) {
        if (needsAutoLabel(feat.label) || feat.label === feat.layer) {
          feat.label = buildAutoLabel(feat);
        }
      });
    });

    return plan;
  }

  function numerarTodosLotes() {
    if (!_plan) {
      alert('Primero dibuja o importa poligonos en el mapa.');
      return;
    }
    autofillAllLotes(_plan, true);
    syncHidden();
    renderOnMap({ fit: false, keepSelection: true });
    var n = (_plan.features || []).filter(function (f) {
      return f.tipo !== 'calle' && f.estado !== 'calle';
    }).length;
    var st = $('publicarMapaStatus');
    if (st) {
      st.innerHTML =
        '<strong>Listo:</strong> ' + n + ' lotes numerados (etapa, manzana, lote y nombre).';
      st.className = 'publicar-mapa__status publicar-mapa__status--ok';
    }
  }

  function fmtPrecioLoteLabel(val) {
    var mk = global.MPHMapMarkers;
    if (mk && mk.fmtPrecioCompact) return mk.fmtPrecioCompact(val, _listingMoneda);
    if (val == null || isNaN(val)) return '';
    var sym = _listingMoneda === 'USD' ? 'US$' : 'S/';
    return sym + Number(val).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  }

  function fmtPrecioLote(val) {
    return fmtPrecioLoteLabel(val);
  }

  function loteFeaturesFromPlan(plan) {
    return (plan.features || []).filter(function (f) {
      return (
        f.tipo !== 'calle' &&
        f.estado !== 'calle' &&
        f.path &&
        f.path.length >= 3
      );
    });
  }

  function precioEstimadoLote(feat, totalAreaLotes) {
    if (!feat) return null;
    if (feat.precio != null && Number(feat.precio) > 0) return Number(feat.precio);
    if (_listingPrecio == null || isNaN(_listingPrecio) || _listingPrecio <= 0) return null;
    if (!feat.area_m2 || feat.area_m2 <= 0) return null;
    if (totalAreaLotes > 0) return _listingPrecio * (feat.area_m2 / totalAreaLotes);
    if (_listingAreaTotal > 0) return _listingPrecio * (feat.area_m2 / _listingAreaTotal);
    return _listingPrecio;
  }

  function computeLotePreciosOnPlan(plan) {
    if (!plan) return [];
    var lotes = loteFeaturesFromPlan(plan);
    var totalArea = 0;
    lotes.forEach(function (f) {
      computeFeatureMetrics(f);
      totalArea += f.area_m2 || 0;
    });
    return lotes.map(function (f) {
      return {
        id: f.id,
        estado: f.estado || 'disponible',
        precio: precioEstimadoLote(f, totalArea),
      };
    });
  }

  function calcMinLotePrice(planRaw, listingPrecio, listingAreaTotal, listingMoneda) {
    var plan = typeof planRaw === 'object' && planRaw && planRaw.features ? planRaw : parsePlanRaw(planRaw);
    if (!plan) return listingPrecio != null ? Number(listingPrecio) : null;
    var savedPrecio = _listingPrecio;
    var savedArea = _listingAreaTotal;
    var savedMon = _listingMoneda;
    _listingPrecio = listingPrecio != null ? Number(listingPrecio) : null;
    _listingAreaTotal = listingAreaTotal != null ? Number(listingAreaTotal) : null;
    _listingMoneda = listingMoneda || 'PEN';
    var rows = computeLotePreciosOnPlan(plan);
    _listingPrecio = savedPrecio;
    _listingAreaTotal = savedArea;
    _listingMoneda = savedMon;
    var vendibles = rows.filter(function (r) {
      return r.estado === 'disponible' || r.estado === 'reservado';
    });
    var pool = vendibles.length ? vendibles : rows;
    var prices = pool.map(function (r) { return r.precio; }).filter(function (p) { return p > 0; });
    if (prices.length) return Math.min.apply(null, prices);
    return listingPrecio != null ? Number(listingPrecio) : null;
  }

  function featLotPrice(feat) {
    if (!feat) return null;
    if (feat.precio != null && Number(feat.precio) > 0) return Number(feat.precio);
    if (_listingPrecio == null || isNaN(_listingPrecio) || _listingPrecio <= 0) return null;
    computeFeatureMetrics(feat);
    var lotes = _plan ? loteFeaturesFromPlan(_plan) : [];
    var totalArea = 0;
    lotes.forEach(function (f) {
      computeFeatureMetrics(f);
      totalArea += f.area_m2 || 0;
    });
    return precioEstimadoLote(feat, totalArea);
  }

  function applyListingPricing(hooks) {
    hooks = hooks || {};
    _listingPrecio =
      hooks.listingPrecio != null && hooks.listingPrecio !== ''
        ? Number(hooks.listingPrecio)
        : null;
    _listingMoneda = hooks.listingMoneda || 'PEN';
    _listingAreaTotal =
      hooks.listingAreaTotal != null && hooks.listingAreaTotal !== ''
        ? Number(hooks.listingAreaTotal)
        : null;
    if (isNaN(_listingPrecio)) _listingPrecio = null;
    if (isNaN(_listingAreaTotal)) _listingAreaTotal = null;
    if (hooks.showLotePrices != null) _showLotePrices = !!hooks.showLotePrices;
  }

  function setListingPricing(precio, moneda, areaTotal) {
    applyListingPricing({
      listingPrecio: precio,
      listingMoneda: moneda,
      listingAreaTotal: areaTotal,
    });
    if (_map && _plan) {
      renderOnMap({ fit: false, keepSelection: true });
    }
  }

  function loteDisplayCode(feat) {
    if (feat.lote) return String(feat.lote);
    var m = (feat.label || '').match(/\b(\d{1,3})\b/);
    return m ? m[1] : '';
  }

  function loteTitle(feat) {
    var parts = [];
    if (feat.etapa) parts.push('Etapa ' + feat.etapa);
    if (feat.manzana) parts.push('Mz ' + feat.manzana);
    if (feat.lote) parts.push('Lt ' + feat.lote);
    else if (loteDisplayCode(feat)) parts.push('Lt ' + loteDisplayCode(feat));
    if (!parts.length) return feat.label || 'Lote';
    return parts.join(', ');
  }

  function labelModeForZoom(zoom) {
    if (zoom < ZOOM_LABELS_NUM) return 'none';
    return 'num';
  }

  function buildLabelHtml(feat, selected, mode) {
    if (feat.tipo === 'calle' || feat.estado === 'calle') return '';
    mode = mode || 'num';
    if (mode === 'none') return '';
    var num = loteDisplayCode(feat);
    var priceHtml = '';
    if (_showLotePrices) {
      var lotP = featLotPrice(feat);
      if (lotP != null && lotP > 0) {
        priceHtml =
          '<span class="map-price-badge map-price-badge--lot">' +
          esc(fmtPrecioLoteLabel(lotP)) +
          '</span>';
      }
    }
    if (!num && !priceHtml) return '';
    var cls = 'lote-map-label' + (selected ? ' lote-map-label--active' : '');
    return (
      '<div class="' + cls + '">' +
      priceHtml +
      (num ? '<span class="lote-map-label__num">' + esc(num) + '</span>' : '') +
      '</div>'
    );
  }

  function refreshLabelsForZoom() {
    if (!_map || !_plan) return;
    var zoom = _map.getZoom();
    var mode = labelModeForZoom(zoom);
    clearMapLabels();
    (_plan.features || []).forEach(function (feat) {
      if (feat.tipo === 'calle' || !feat.path || feat.path.length < 3) return;
      var c = centroid(feat.path);
      var html = buildLabelHtml(feat, feat.id === _selectedId, mode);
      var ov = createLabelOverlay(_map, c, html);
      if (ov) {
        ov.__featId = feat.id;
        _mapLabels.push(ov);
      }
    });
  }

  function updatePolyOpacityForZoom(zoom) {
    if (!_readonly || !_mapPolys.length) return;
    _mapPolys.forEach(function (poly) {
      var pf = (_plan.features || []).find(function (f) { return f.id === poly.__featId; });
      if (!pf) return;
      var st = estadoStyle(pf.estado);
      var active = pf.id === _selectedId;
      var base = active ? Math.min(st.opacity + 0.15, 0.75) : st.opacity;
      var op = base;
      if (zoom < ZOOM_POLYS_FAINT) op = Math.min(base, 0.3);
      else if (zoom < ZOOM_LABELS_NUM) op = Math.min(base, 0.42);
      poly.setOptions({ fillOpacity: op });
    });
  }

  function updateHintForZoom(zoom) {
    var hint = $('loteMapHint');
    var txt = $('loteMapHintText');
    if (!hint || !_readonly) return;
    hint.hidden = false;
    var msg = 'Clic en un lote — los detalles aparecen en el panel de la derecha';
    if (zoom < ZOOM_LABELS_NUM) {
      msg = 'Acerca el mapa (zoom +) para ver los numeros de lote';
    }
    if (txt) txt.textContent = msg;
    else {
      var span = hint.querySelector('span');
      if (span) span.textContent = msg;
    }
  }

  function onZoomLevelChange() {
    if (!_map || !_readonly) return;
    var z = _map.getZoom();
    refreshLabelsForZoom();
    updatePolyOpacityForZoom(z);
    updateHintForZoom(z);
    if (_selectedId) {
      var featSel = (_plan.features || []).find(function (f) { return f.id === _selectedId; });
      if (featSel) showLotePanel(featSel);
    }
  }

  function bindReadonlyMapBehavior(map) {
    if (!_readonly || !map) return;
    if (_zoomListener) google.maps.event.removeListener(_zoomListener);
    _zoomListener = google.maps.event.addListener(map, 'zoom_changed', function () {
      clearTimeout(_zoomDebounce);
      _zoomDebounce = setTimeout(onZoomLevelChange, 100);
    });
    google.maps.event.addListenerOnce(map, 'idle', function () {
      onZoomLevelChange();
    });
  }

  function buildInfoWindowHtml(feat, zoom) {
    computeFeatureMetrics(feat);
    var st = estadoStyle(feat.estado);
    var more =
      zoom < ZOOM_PANEL
        ? '<p class="lote-iw__more">Acerca un poco mas el mapa para ver perimetro y datos completos.</p>'
        : '';
    return (
      '<div class="lote-iw">' +
      '<p class="lote-iw__title">' + esc(loteTitle(feat)) + '</p>' +
      '<dl class="lote-iw__dl">' +
      '<div><dt>Area</dt><dd>' + (feat.area_m2 != null ? fmtM(feat.area_m2) + ' m²' : '—') + '</dd></div>' +
      '<div><dt>Estado</dt><dd><span class="lote-iw__badge" style="background:' + st.fill + '">' + esc(st.label) + '</span></dd></div>' +
      (feat.tipologia ? '<div><dt>Tipologia</dt><dd>' + esc(feat.tipologia) + '</dd></div>' : '') +
      '</dl>' +
      more +
      '</div>'
    );
  }

  function showInfoWindowForFeat(feat) {
    if (!_map || !feat || !feat.path || !global.google || !google.maps) return;
    if (!_infoWindow) _infoWindow = new google.maps.InfoWindow({ maxWidth: 280 });
    var c = centroid(feat.path);
    if (!c) return;
    _infoWindow.setContent(buildInfoWindowHtml(feat, _map.getZoom()));
    _infoWindow.setPosition(c);
    _infoWindow.open(_map);
  }

  function zoomToFeature(feat, cb) {
    if (!_map || !feat || !feat.path) return;
    var b = new google.maps.LatLngBounds();
    feat.path.forEach(function (p) { b.extend(p); });
    _map.fitBounds(b, { top: 56, bottom: 56, left: 56, right: 320 });
    google.maps.event.addListenerOnce(_map, 'idle', function () {
      if (_map.getZoom() > 20) _map.setZoom(20);
      if (cb) cb();
    });
  }

  function highlightFeature(id) {
    if (!id) {
      _selectedId = null;
      _mapPolys.forEach(function (poly) {
        var pf = (_plan.features || []).find(function (f) { return f.id === poly.__featId; });
        var st = estadoStyle(pf ? pf.estado : 'disponible');
        poly.setOptions({
          strokeWeight: pf && pf.tipo === 'calle' ? 1.5 : 2,
          strokeColor: st.stroke,
          fillOpacity: st.opacity,
          zIndex: st.z,
        });
      });
      _mapLabels.forEach(function (ov) {
        if (!ov.div) return;
        var inner = ov.div.querySelector('.lote-map-label');
        if (inner) inner.classList.remove('lote-map-label--active');
      });
      return;
    }
    _selectedId = id;
    _mapPolys.forEach(function (poly) {
      var active = poly.__featId === id;
      var pf = (_plan.features || []).find(function (f) { return f.id === poly.__featId; });
      var st = estadoStyle(pf ? pf.estado : 'disponible');
      poly.setOptions({
        strokeWeight: active ? 3.5 : pf && pf.tipo === 'calle' ? 1.5 : 2,
        strokeColor: active ? '#ff6b00' : st.stroke,
        fillOpacity: active ? 0.72 : st.opacity,
        zIndex: active ? 5 : st.z,
      });
    });
    _mapLabels.forEach(function (ov) {
      if (!ov.div) return;
      var inner = ov.div.querySelector('.lote-map-label');
      if (inner) inner.classList.toggle('lote-map-label--active', ov.__featId === id);
    });
    var sel = $('selectPlanoEstado');
    var feat = (_plan.features || []).find(function (f) { return f.id === id; });
    if (sel && feat) sel.value = feat.estado || 'disponible';
  }

  function handleLoteClick(id) {
    var feat = (_plan.features || []).find(function (f) { return f.id === id; });
    if (!feat || !feat.path || feat.path.length < 3) return;
    computeFeatureMetrics(feat);

    if (_readonly) {
      highlightFeature(id);
      if (_infoWindow) _infoWindow.close();
      zoomToFeature(feat, function () {
        refreshLabelsForZoom();
        updateHintForZoom(_map.getZoom());
        showLotePanel(feat);
      });
      return;
    }
    selectFeature(id);
  }

  function createLabelOverlay(map, position, html) {
    if (!html) return null;
    var overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {
      var div = document.createElement('div');
      div.className = 'lote-map-label-wrap';
      div.innerHTML = html;
      this.div = div;
      var panes = this.getPanes();
      if (panes && panes.overlayMouseTarget) panes.overlayMouseTarget.appendChild(div);
    };
    overlay.draw = function () {
      if (!this.div) return;
      var proj = this.getProjection();
      if (!proj) return;
      var pos = proj.fromLatLngToDivPixel(new google.maps.LatLng(position.lat, position.lng));
      this.div.style.left = pos.x + 'px';
      this.div.style.top = pos.y + 'px';
    };
    overlay.onRemove = function () {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    };
    overlay.setMap(map);
    return overlay;
  }

  function boundsFromLocal(features) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    (features || []).forEach(function (f) {
      (f.localPath || []).forEach(function (p) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });
    if (!isFinite(minX)) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  function readCalibration() {
    var stored = _plan && _plan.calibration ? _plan.calibration : null;
    var zona =
      parseInt(($('inputUtmZona') || {}).value, 10) ||
      (stored && stored.utmZone) ||
      18;
    var hem = (($('selectUtmHem') || {}).value || (stored && stored.utmHem) || 'S').toUpperCase();
    var utmE0 = parseFloat(($('inputPlanoUtmE') || {}).value);
    var utmN0 = parseFloat(($('inputPlanoUtmN') || {}).value);
    if (isNaN(utmE0)) utmE0 = parseFloat(($('inputUtmE') || {}).value);
    if (isNaN(utmN0)) utmN0 = parseFloat(($('inputUtmN') || {}).value);
    if (isNaN(utmE0) && stored && stored.utmE0 != null) utmE0 = Number(stored.utmE0);
    if (isNaN(utmN0) && stored && stored.utmN0 != null) utmN0 = Number(stored.utmN0);
    var anchoM = parseFloat(($('inputPlanoAnchoM') || {}).value);
    var rot = parseFloat(($('inputPlanoRotacion') || {}).value);
    if (isNaN(rot) && stored && stored.rotationDeg != null) rot = Number(stored.rotationDeg);
    if (isNaN(rot)) rot = 0;
    var bounds =
      (_plan && _plan.bounds) ||
      (stored && stored.bounds) ||
      boundsFromLocal(_plan ? _plan.features : []);
    var scale = 1;
    if (bounds && anchoM > 0 && bounds.width > 0) {
      scale = anchoM / bounds.width;
    } else if (stored && stored.scaleMetersPerUnit > 0) {
      scale = Number(stored.scaleMetersPerUnit);
    } else if (($('inputPlanoEscala') || {}).value) {
      scale = parseFloat($('inputPlanoEscala').value) || 1;
    } else if (bounds && bounds.width > 0 && bounds.width < 500) {
      scale = 1;
    }
    var anchorLat = null;
    var anchorLng = null;
    if ((isNaN(utmE0) || isNaN(utmN0)) && _hooks && _hooks.getMapCenter) {
      var mc = _hooks.getMapCenter();
      anchorLat = mc.lat;
      anchorLng = mc.lng;
    }
    return {
      version: 1,
      utmZone: zona,
      utmHem: hem,
      utmE0: isNaN(utmE0) ? null : utmE0,
      utmN0: isNaN(utmN0) ? null : utmN0,
      originX: bounds ? bounds.minX : 0,
      originY: bounds ? bounds.maxY : 0,
      scaleMetersPerUnit: scale,
      rotationDeg: rot,
      bounds: bounds,
      anchorLat: anchorLat,
      anchorLng: anchorLng,
    };
  }

  function prefillCalibrationFromSidebar() {
    var pe = $('inputPlanoUtmE');
    var pn = $('inputPlanoUtmN');
    var e = $('inputUtmE');
    var n = $('inputUtmN');
    if (pe && e && e.value && !pe.value) pe.value = e.value;
    if (pn && n && n.value && !pn.value) pn.value = n.value;
  }

  function restoreCalibrationUi(plan) {
    if (!plan || !plan.calibration) return;
    var cal = plan.calibration;
    var uz = $('inputUtmZona');
    var hem = $('selectUtmHem');
    if (uz && cal.utmZone) uz.value = String(cal.utmZone);
    if (hem && cal.utmHem) hem.value = String(cal.utmHem);
    var pe = $('inputPlanoUtmE');
    var pn = $('inputPlanoUtmN');
    var rot = $('inputPlanoRotacion');
    var esc = $('inputPlanoEscala');
    var ancho = $('inputPlanoAnchoM');
    if (pe && cal.utmE0 != null) pe.value = String(cal.utmE0);
    if (pn && cal.utmN0 != null) pn.value = String(cal.utmN0);
    if (rot && cal.rotationDeg != null) rot.value = String(cal.rotationDeg);
    if (esc && cal.scaleMetersPerUnit > 0) esc.value = String(cal.scaleMetersPerUnit);
    if (ancho && cal.bounds && cal.bounds.width > 0 && cal.scaleMetersPerUnit > 0) {
      var w = cal.bounds.width * cal.scaleMetersPerUnit;
      if (w > 0) ancho.value = String(Math.round(w * 10) / 10);
    }
  }

  function planHasPaths(plan) {
    return !!(
      plan &&
      plan.features &&
      plan.features.some(function (f) {
        return f.path && f.path.length >= 3;
      })
    );
  }

  function showCalibAviso(html, tipo) {
    var el = $('planoCalibAviso');
    if (!el) return;
    el.hidden = false;
    el.className = 'plano-calib-aviso plano-calib-aviso--' + (tipo || 'info');
    el.innerHTML = html;
  }

  function hideCalibAviso() {
    var el = $('planoCalibAviso');
    if (el) el.hidden = true;
  }

  function localToLatLng(x, y, cal, utmToLatLng) {
    var dx = x - (cal.originX || 0);
    var dy = y - (cal.originY || 0);
    var yn = -dy;
    var rad = ((cal.rotationDeg || 0) * Math.PI) / 180;
    var xr = dx * Math.cos(rad) - yn * Math.sin(rad);
    var yr = dx * Math.sin(rad) + yn * Math.cos(rad);
    var eastM = xr * (cal.scaleMetersPerUnit || 1);
    var northM = yr * (cal.scaleMetersPerUnit || 1);
    if (cal.utmE0 != null && cal.utmN0 != null && utmToLatLng) {
      var ll = utmToLatLng(cal.utmZone, cal.utmHem, cal.utmE0 + eastM, cal.utmN0 + northM);
      return { lat: ll.lat, lng: ll.lng };
    }
    if (cal.anchorLat != null && cal.anchorLng != null) {
      var lat = cal.anchorLat + northM / 111320;
      var lng = cal.anchorLng + eastM / (111320 * Math.cos((cal.anchorLat * Math.PI) / 180));
      return { lat: lat, lng: lng };
    }
    return null;
  }

  function applyCalibrationToFeatures(features, cal, utmToLatLng, forceRecalibrate) {
    return (features || []).map(function (f) {
      if (!forceRecalibrate && f.path && f.path.length >= 3) {
        return f;
      }
      if (!f.localPath || !f.localPath.length) {
        return f;
      }
      var path = f.localPath.map(function (p) {
        return localToLatLng(p.x, p.y, cal, utmToLatLng);
      });
      if (path.some(function (pt) { return !pt; })) {
        path = [];
      }
      return Object.assign({}, f, { path: path });
    });
  }

  function pathsFromGooglePolygon(poly) {
    var path = poly.getPath();
    var out = [];
    for (var i = 0; i < path.getLength(); i++) {
      var ll = path.getAt(i);
      out.push({ lat: ll.lat(), lng: ll.lng() });
    }
    return out;
  }

  function monedaSymbol() {
    return _listingMoneda === 'USD' ? 'US$' : 'S/';
  }

  function isProjectTransformActive() {
    return _moveProjectActive || _scaleModeActive || _rotateModeActive;
  }

  function latLngToMeters(anchorLat, anchorLng, lat, lng) {
    var cosLat = Math.cos((anchorLat * Math.PI) / 180);
    return {
      x: (lng - anchorLng) * 111320 * cosLat,
      y: (lat - anchorLat) * 111320,
    };
  }

  function metersToLatLng(anchorLat, anchorLng, x, y) {
    var cosLat = Math.cos((anchorLat * Math.PI) / 180);
    return {
      lat: anchorLat + y / 111320,
      lng: anchorLng + x / (111320 * cosLat),
    };
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var midLat = (lat1 + lat2) / 2;
    var midLng = (lng1 + lng2) / 2;
    var m1 = latLngToMeters(midLat, midLng, lat1, lng1);
    var m2 = latLngToMeters(midLat, midLng, lat2, lng2);
    return Math.hypot(m2.x - m1.x, m2.y - m1.y);
  }

  function captureTransformSnapshot() {
    var anchor = getPlanAnchorLatLng();
    if (!anchor) return null;
    var rotInp = $('inputPlanoRotacion');
    var baseRot =
      (_plan && _plan.calibration && _plan.calibration.rotationDeg != null)
        ? Number(_plan.calibration.rotationDeg)
        : rotInp && rotInp.value
          ? parseFloat(rotInp.value)
          : 0;
    if (isNaN(baseRot)) baseRot = 0;
    return {
      anchorLat: anchor.lat,
      anchorLng: anchor.lng,
      baseRotation: baseRot,
      features: (_plan.features || []).map(function (f) {
        return { id: f.id, path: JSON.parse(JSON.stringify(f.path || [])) };
      }),
    };
  }

  function applyTransformFromSnapshot(scale, rotationDeg) {
    if (!_transformSnapshot) return;
    var anchorLat = _transformSnapshot.anchorLat;
    var anchorLng = _transformSnapshot.anchorLng;
    var rot = ((rotationDeg || 0) * Math.PI) / 180;
    var cosR = Math.cos(rot);
    var sinR = Math.sin(rot);
    var s = scale > 0 ? scale : 1;

    _transformSnapshot.features.forEach(function (snap) {
      var feat = (_plan.features || []).find(function (f) {
        return f.id === snap.id;
      });
      if (!feat || !snap.path || !snap.path.length) return;
      feat.path = snap.path.map(function (p) {
        var m = latLngToMeters(anchorLat, anchorLng, p.lat, p.lng);
        var sx = m.x * s;
        var sy = m.y * s;
        var rx = sx * cosR - sy * sinR;
        var ry = sx * sinR + sy * cosR;
        return metersToLatLng(anchorLat, anchorLng, rx, ry);
      });
      computeFeatureMetrics(feat);
    });
    updatePolygonsInPlace();
    renderList();
  }

  function clearScaleMeasureUi() {
    _scaleMeasurePoints = [];
    _scaleMeasureMarkers.forEach(function (mk) {
      if (mk) mk.setMap(null);
    });
    _scaleMeasureMarkers = [];
    if (_scaleMeasureLine) {
      _scaleMeasureLine.setMap(null);
      _scaleMeasureLine = null;
    }
    var info = $('scaleMeasureInfo');
    if (info) info.textContent = '—';
    var distInp = $('inputScaleDistReal');
    var btnApply = $('btnApplyScaleMeasure');
    if (distInp) {
      distInp.value = '';
      distInp.disabled = true;
    }
    if (btnApply) btnApply.disabled = true;
  }

  function removeMapClickListener() {
    if (_mapClickListener && _map) {
      google.maps.event.removeListener(_mapClickListener);
      _mapClickListener = null;
    }
  }

  function setTransformPanelVisible(mode) {
    var panel = $('planoTransformPanel');
    var scaleCtrl = $('planoScaleControls');
    var rotateCtrl = $('planoRotateControls');
    if (panel) panel.hidden = !mode;
    if (scaleCtrl) scaleCtrl.hidden = mode !== 'scale';
    if (rotateCtrl) rotateCtrl.hidden = mode !== 'rotate';
  }

  function setTransformButtonsActive(mode) {
    var map = {
      scale: ['btnEscalarProyecto', 'btnEscalarProyectoPoligono'],
      rotate: ['btnRotarProyecto', 'btnRotarProyectoPoligono'],
      move: ['btnMoverProyecto', 'btnMoverProyectoPoligono'],
    };
    Object.keys(map).forEach(function (key) {
      map[key].forEach(function (id) {
        var btn = $(id);
        if (!btn) return;
        var on = mode === key;
        btn.classList.toggle('is-active', on);
        if (key === 'move') btn.textContent = on ? 'Finalizar mover' : 'Mover todo el proyecto';
        if (key === 'scale') btn.textContent = on ? 'Finalizar escalar' : 'Escalar proyecto';
        if (key === 'rotate') btn.textContent = on ? 'Finalizar rotar' : 'Rotar proyecto';
      });
    });
  }

  function exitScaleProjectMode(save) {
    if (!_scaleModeActive) return;
    _scaleModeActive = false;
    _scalePickActive = false;
    _transformSnapshot = null;
    removeMapClickListener();
    clearScaleMeasureUi();
    setTransformPanelVisible(null);
    setPolygonsEditable(true);
    setTransformButtonsActive(null);
    var hint = $('lotePanelHintEdit');
    if (hint) hint.textContent = 'Arrastra los vertices del poligono en el mapa para ajustar el lote.';
    if (save && _plan) syncHidden();
  }

  function exitRotateProjectMode(save) {
    if (!_rotateModeActive) return;
    _rotateModeActive = false;
    _transformSnapshot = null;
    setTransformPanelVisible(null);
    setPolygonsEditable(true);
    setTransformButtonsActive(null);
    var hint = $('lotePanelHintEdit');
    if (hint) hint.textContent = 'Arrastra los vertices del poligono en el mapa para ajustar el lote.';
    var rotSlider = $('inputTransformRotate');
    var rotOut = $('transformRotateDeg');
    if (rotSlider) rotSlider.value = '0';
    if (rotOut) rotOut.textContent = '0°';
    if (save && _plan) syncHidden();
  }

  function exitAllProjectTransforms(save) {
    if (_moveProjectActive) {
      exitMoveProjectMode();
      if (save && _plan) syncHidden();
    }
    exitScaleProjectMode(false);
    exitRotateProjectMode(false);
  }

  function requirePlanForTransform() {
    if (!_plan || !planHasPaths(_plan)) {
      showCalibAviso(
        'Primero dibuja o importa poligonos y ubicalos en el mapa.',
        'warn'
      );
      return false;
    }
    return true;
  }

  function onScaleSliderInput() {
    var slider = $('inputTransformScale');
    var out = $('transformScalePct');
    if (!slider || !_transformSnapshot) return;
    var pct = parseInt(slider.value, 10) || 100;
    if (out) out.textContent = pct + '%';
    applyTransformFromSnapshot(pct / 100, 0);
  }

  function onRotateSliderInput() {
    var slider = $('inputTransformRotate');
    var out = $('transformRotateDeg');
    if (!slider || !_transformSnapshot) return;
    var deg = parseFloat(slider.value) || 0;
    if (out) out.textContent = deg.toFixed(1) + '°';
    applyTransformFromSnapshot(1, deg);
  }

  function startScalePickPoints() {
    if (!_map || !_scaleModeActive) return;
    _scalePickActive = true;
    clearScaleMeasureUi();
    showCalibAviso(
      'Clic en <strong>dos puntos</strong> del mapa (por ejemplo dos vertices de un lote). Luego ingresa la distancia real en metros.',
      'info'
    );
    removeMapClickListener();
    _mapClickListener = _map.addListener('click', function (e) {
      if (!_scalePickActive || !e || !e.latLng) return;
      var lat = e.latLng.lat();
      var lng = e.latLng.lng();
      _scaleMeasurePoints.push({ lat: lat, lng: lng });
      var mk = new google.maps.Marker({
        map: _map,
        position: { lat: lat, lng: lng },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
          scale: 7,
        },
        zIndex: 9998,
      });
      _scaleMeasureMarkers.push(mk);
      if (_scaleMeasurePoints.length >= 2) {
        _scalePickActive = false;
        var p1 = _scaleMeasurePoints[0];
        var p2 = _scaleMeasurePoints[1];
        if (_scaleMeasureLine) _scaleMeasureLine.setMap(null);
        _scaleMeasureLine = new google.maps.Polyline({
          map: _map,
          path: [p1, p2],
          strokeColor: '#3b82f6',
          strokeWeight: 3,
          strokeOpacity: 0.9,
        });
        var dist = distanceMeters(p1.lat, p1.lng, p2.lat, p2.lng);
        var info = $('scaleMeasureInfo');
        if (info) info.textContent = 'Medido: ' + dist.toFixed(2) + ' m';
        var distInp = $('inputScaleDistReal');
        var btnApply = $('btnApplyScaleMeasure');
        if (distInp) {
          distInp.disabled = false;
          distInp.focus();
        }
        if (btnApply) btnApply.disabled = false;
        _scaleMeasurePoints._distM = dist;
        showCalibAviso(
          'Distancia medida: <strong>' + dist.toFixed(2) + ' m</strong>. Ingresa la distancia real y pulsa <strong>Aplicar</strong>.',
          'info'
        );
      }
    });
  }

  function applyScaleFromMeasure() {
    if (!_transformSnapshot || !_scaleMeasurePoints._distM) return;
    var real = parseFloat(($('inputScaleDistReal') || {}).value);
    if (isNaN(real) || real <= 0) {
      showCalibAviso('Ingresa una distancia real valida en metros.', 'warn');
      return;
    }
    var scale = real / _scaleMeasurePoints._distM;
    applyTransformFromSnapshot(scale, 0);
    _transformSnapshot = captureTransformSnapshot();
    var slider = $('inputTransformScale');
    var out = $('transformScalePct');
    if (slider) slider.value = '100';
    if (out) out.textContent = '100%';
    clearScaleMeasureUi();
    showCalibAviso(
      'Escala aplicada (' + Math.round(scale * 1000) / 10 + '%). Puedes seguir ajustando con el control o finalizar.',
      'info'
    );
  }

  function toggleScaleProjectMode() {
    if (_readonly) return;
    if (!requirePlanForTransform()) return;
    if (_scaleModeActive) {
      exitScaleProjectMode(true);
      hideCalibAviso();
      return;
    }
    exitAllProjectTransforms(false);
    _scaleModeActive = true;
    _transformSnapshot = captureTransformSnapshot();
    setPolygonsEditable(false);
    setTransformPanelVisible('scale');
    setTransformButtonsActive('scale');
    var hint = $('lotePanelHintEdit');
    if (hint) hint.textContent = 'Modo escalar: ajusta el control o marca 2 puntos con distancia conocida.';
    var slider = $('inputTransformScale');
    var out = $('transformScalePct');
    if (slider) slider.value = '100';
    if (out) out.textContent = '100%';
    showCalibAviso(
      'Modo <strong>escalar</strong>: usa el control o marca <strong>2 puntos</strong> con una distancia conocida. Ancla: esquina inferior izquierda.',
      'info'
    );
  }

  function toggleRotateProjectMode() {
    if (_readonly) return;
    if (!requirePlanForTransform()) return;
    if (_rotateModeActive) {
      var slider = $('inputTransformRotate');
      var finalRot = slider ? parseFloat(slider.value) || 0 : 0;
      if (_plan) {
        if (!_plan.calibration) _plan.calibration = {};
        _plan.calibration.rotationDeg = (_transformSnapshot ? _transformSnapshot.baseRotation : 0) + finalRot;
        var rotInp = $('inputPlanoRotacion');
        if (rotInp) rotInp.value = String(Math.round(_plan.calibration.rotationDeg * 10) / 10);
      }
      exitRotateProjectMode(true);
      hideCalibAviso();
      return;
    }
    exitAllProjectTransforms(false);
    _rotateModeActive = true;
    _transformSnapshot = captureTransformSnapshot();
    setPolygonsEditable(false);
    setTransformPanelVisible('rotate');
    setTransformButtonsActive('rotate');
    var hint = $('lotePanelHintEdit');
    if (hint) hint.textContent = 'Modo rotar: usa el control de grados. Pivote en esquina inferior izquierda.';
    var rotSlider = $('inputTransformRotate');
    var rotOut = $('transformRotateDeg');
    if (rotSlider) rotSlider.value = '0';
    if (rotOut) rotOut.textContent = '0°';
    showCalibAviso(
      'Modo <strong>rotar</strong>: arrastra el control de grados. El pivote es la <strong>esquina inferior izquierda</strong>.',
      'info'
    );
  }

  function getPlanAnchorLatLng() {
    if (!_plan) return null;
    var minLat = Infinity;
    var minLng = Infinity;
    var has = false;
    (_plan.features || []).forEach(function (f) {
      (f.path || []).forEach(function (p) {
        has = true;
        if (p.lat < minLat) minLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
      });
    });
    if (!has) return null;
    return { lat: minLat, lng: minLng };
  }

  function captureMoveSnapshot() {
    var anchor = getPlanAnchorLatLng();
    if (!anchor) return null;
    return {
      anchorLat: anchor.lat,
      anchorLng: anchor.lng,
      features: (_plan.features || []).map(function (f) {
        return { id: f.id, path: JSON.parse(JSON.stringify(f.path || [])) };
      }),
    };
  }

  function applyMoveDelta(dLat, dLng) {
    if (!_moveDragSnapshot) return;
    if (dLat === 0 && dLng === 0) return;
    _moveDragSnapshot.features.forEach(function (snap) {
      var feat = (_plan.features || []).find(function (f) {
        return f.id === snap.id;
      });
      if (!feat || !snap.path || !snap.path.length) return;
      feat.path = snap.path.map(function (p) {
        return { lat: p.lat + dLat, lng: p.lng + dLng };
      });
    });
    updatePolygonsInPlace();
  }

  function updatePolygonsInPlace() {
    _mapPolys.forEach(function (poly) {
      var feat = (_plan.features || []).find(function (f) {
        return f.id === poly.__featId;
      });
      if (feat && feat.path && feat.path.length >= 3) {
        poly.setPaths(feat.path);
      }
    });
    (_plan.features || []).forEach(function (f) {
      if (f.tipo !== 'calle' && f.path && f.path.length >= 3) {
        repositionLabel(f.id);
      }
    });
  }

  function syncAnchorCoords(lat, lng) {
    var utmFn = _hooks && _hooks.latLngToUtm;
    if (!utmFn || lat == null || lng == null) return;
    var utm = utmFn(lat, lng);
    if (!utm) return;

    var pe = $('inputPlanoUtmE');
    var pn = $('inputPlanoUtmN');
    var e = $('inputUtmE');
    var n = $('inputUtmN');
    var z = $('inputUtmZona');
    var hem = $('selectUtmHem');
    var gpsLat = $('inputGpsLat');
    var gpsLng = $('inputGpsLng');
    var utmZ = $('utm_zona');
    var utmE = $('utm_este');
    var utmN = $('utm_norte');

    var eStr = roundUtmCoord(utm.easting).toFixed(3);
    var nStr = roundUtmCoord(utm.northing).toFixed(3);
    var rLat = roundGpsCoord(lat);
    var rLng = roundGpsCoord(lng);
    if (pe) pe.value = eStr;
    if (pn) pn.value = nStr;
    if (e) e.value = eStr;
    if (n) n.value = nStr;
    if (z) z.value = String(utm.zone);
    if (hem) hem.value = utm.hemisphere || 'S';
    if (gpsLat) gpsLat.value = rLat != null ? rLat.toFixed(6) : '';
    if (gpsLng) gpsLng.value = rLng != null ? rLng.toFixed(6) : '';
    if (utmZ) utmZ.value = utm.label;
    if (utmE) utmE.value = eStr;
    if (utmN) utmN.value = nStr;

    if (_plan) {
      if (!_plan.calibration) _plan.calibration = {};
      _plan.calibration.utmE0 = utm.easting;
      _plan.calibration.utmN0 = utm.northing;
      _plan.calibration.utmZone = utm.zone;
      _plan.calibration.utmHem = utm.hemisphere || 'S';
      _plan.calibration.anchorLat = lat;
      _plan.calibration.anchorLng = lng;
    }

    var gpsEl = $('planoMoveGps');
    var utmEl = $('planoMoveUtm');
    var rLat = roundGpsCoord(lat);
    var rLng = roundGpsCoord(lng);
    if (gpsEl) gpsEl.textContent = (rLat != null ? rLat.toFixed(6) : '—') + ', ' + (rLng != null ? rLng.toFixed(6) : '—');
    if (utmEl) {
      utmEl.textContent =
        'Zona ' + utm.label + ' · E ' + Number(utm.easting).toLocaleString('es-PE', { maximumFractionDigits: 2 }) +
        ' · N ' + Number(utm.northing).toLocaleString('es-PE', { maximumFractionDigits: 2 });
    }

    var latDisp = $('coordLatDisp');
    var lngDisp = $('coordLngDisp');
    var utmDisp = $('coordUtmDisp');
    if (_moveProjectActive) {
      if (latDisp) latDisp.textContent = rLat != null ? rLat.toFixed(6) : '—';
      if (lngDisp) lngDisp.textContent = rLng != null ? rLng.toFixed(6) : '—';
      if (utmDisp) {
        utmDisp.textContent =
          'Zona ' + utm.label + ' · E ' + Number(utm.easting).toLocaleString('es-PE', { maximumFractionDigits: 2 }) +
          ' · N ' + Number(utm.northing).toLocaleString('es-PE', { maximumFractionDigits: 2 });
      }
    }
  }

  function removeAnchorMarker() {
    if (_anchorMarker) {
      google.maps.event.clearInstanceListeners(_anchorMarker);
      _anchorMarker.setMap(null);
      _anchorMarker = null;
    }
  }

  function onAnchorDrag(lat, lng) {
    if (!_moveDragSnapshot) return;
    var dLat = lat - _moveDragSnapshot.anchorLat;
    var dLng = lng - _moveDragSnapshot.anchorLng;
    applyMoveDelta(dLat, dLng);
    syncAnchorCoords(lat, lng);
  }

  function onAnchorDragEnd(lat, lng) {
    onAnchorDrag(lat, lng);
    refreshAllMetrics();
    var el = $('plan_masterplan');
    if (el && _plan) el.value = JSON.stringify(_plan);
    var lotes = (_plan.features || []).filter(function (f) {
      return f.tipo === 'lote' && f.path && f.path.length >= 3;
    });
    var primary = lotes[0];
    var polyEl = $('poligono_lote');
    if (polyEl && primary) polyEl.value = JSON.stringify(primary.path);
  }

  function ensureAnchorMarker() {
    if (!_map || !_moveProjectActive || _readonly) return;
    var anchor = getPlanAnchorLatLng();
    if (!anchor) return;

    if (!_anchorMarker) {
      _anchorMarker = new google.maps.Marker({
        map: _map,
        position: anchor,
        draggable: true,
        title: 'Esquina inferior izquierda — arrastra para mover todo el proyecto',
        icon: {
          path: 'M 0,0 L 16,0 L 16,16 L 0,16 Z',
          fillColor: '#ff6b00',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 1.1,
          anchor: new google.maps.Point(0, 16),
        },
        zIndex: 9999,
      });
      _anchorMarker.addListener('drag', function () {
        var pos = _anchorMarker.getPosition();
        onAnchorDrag(pos.lat(), pos.lng());
      });
      _anchorMarker.addListener('dragend', function () {
        var pos = _anchorMarker.getPosition();
        onAnchorDragEnd(pos.lat(), pos.lng());
      });
    } else {
      _anchorMarker.setPosition(anchor);
    }
  }

  function setPolygonsEditable(editable) {
    _mapPolys.forEach(function (poly) {
      if (poly && poly.setEditable) poly.setEditable(editable);
    });
  }

  function setMoveProjectUiActive(active) {
    var section = document.querySelector('.publicar-mapa--pro');
    if (section) section.classList.toggle('publicar-mapa--move-project', active);
    var live = $('planoMoveLive');
    if (live) live.hidden = !active;
    var hint = $('lotePanelHintEdit');
    if (hint) {
      hint.textContent = active
        ? 'Modo mover: arrastra el marcador naranja en la esquina inferior izquierda del proyecto.'
        : 'Arrastra los vertices del poligono en el mapa para ajustar el lote.';
    }
  }

  function exitMoveProjectMode() {
    if (!_moveProjectActive) return;
    _moveProjectActive = false;
    _moveDragSnapshot = null;
    removeAnchorMarker();
    setPolygonsEditable(true);
    setMoveProjectUiActive(false);
    setTransformButtonsActive(null);
  }

  function toggleMoveProjectMode() {
    if (_readonly) return;
    if (!_plan || !planHasPaths(_plan)) {
      showCalibAviso(
        'Primero dibuja o importa poligonos y ubicalos en el mapa antes de mover el proyecto.',
        'warn'
      );
      return;
    }
    if (!_hooks || !_hooks.latLngToUtm) {
      showCalibAviso('No se puede calcular UTM en este mapa. Recarga la pagina e intenta de nuevo.', 'warn');
      return;
    }

    if (_moveProjectActive) {
      exitMoveProjectMode();
      hideCalibAviso();
      if (_plan) syncHidden();
      return;
    }

    exitAllProjectTransforms(false);

    _moveProjectActive = true;
    _moveDragSnapshot = captureMoveSnapshot();
    setPolygonsEditable(false);
    setTransformButtonsActive('move');
    setMoveProjectUiActive(true);

    var anchor = getPlanAnchorLatLng();
    if (anchor) syncAnchorCoords(anchor.lat, anchor.lng);

    ensureAnchorMarker();

    showCalibAviso(
      'Modo <strong>mover proyecto</strong>: arrastra el marcador <strong>naranja</strong> en la ' +
        '<strong>esquina inferior izquierda</strong>. Las coordenadas UTM y GPS se actualizan al instante.',
      'info'
    );
  }

  function attachPathListeners(poly, feat) {
    if (_readonly || isProjectTransformActive() || !poly || !feat) return;
    var gpath = poly.getPath();
    function onPathChange() {
      feat.path = pathsFromGooglePolygon(poly);
      computeFeatureMetrics(feat);
      syncHidden();
      updateLotePanel(feat);
      repositionLabel(feat.id);
      if (_hooks && _hooks.onPlanChange) _hooks.onPlanChange(_plan);
    }
    google.maps.event.addListener(gpath, 'set_at', onPathChange);
    google.maps.event.addListener(gpath, 'insert_at', onPathChange);
    google.maps.event.addListener(gpath, 'remove_at', onPathChange);
  }

  function clearMapLabels() {
    _mapLabels.forEach(function (o) {
      if (o && o.setMap) o.setMap(null);
    });
    _mapLabels = [];
  }

  function clearMapPolys() {
    _mapPolys.forEach(function (p) {
      if (p && p.setMap) p.setMap(null);
    });
    _mapPolys = [];
    clearMapLabels();
    if (!_moveProjectActive) removeAnchorMarker();
  }

  function repositionLabel(featId) {
    if (!_plan || !_map) return;
    var feat = (_plan.features || []).find(function (f) { return f.id === featId; });
    if (!feat || !feat.path) return;
    var idx = _mapLabels.findIndex(function (o) { return o.__featId === featId; });
    if (idx >= 0) {
      _mapLabels[idx].setMap(null);
      _mapLabels.splice(idx, 1);
    }
    var c = centroid(feat.path);
    if (!c) return;
    var mode = _map ? labelModeForZoom(_map.getZoom()) : 'num';
    var html = buildLabelHtml(feat, featId === _selectedId, mode);
    var ov = createLabelOverlay(_map, c, html);
    if (ov) {
      ov.__featId = featId;
      _mapLabels.push(ov);
    }
  }

  function estadoStyle(estado) {
    return ESTADOS[estado] || ESTADOS.disponible;
  }

  function hideLotePanel() {
    var panel = $('loteInfoPanel');
    if (panel) panel.hidden = true;
  }

  function updateLotePanel(feat) {
    if (!feat) return;
    computeFeatureMetrics(feat);
    var panel = $('loteInfoPanel');
    if (!panel) return;

    var st = estadoStyle(feat.estado);
    var title = $('lotePanelTitle');
    var subtitle = $('lotePanelSubtitle');
    var etapaEl = $('lotePanelEtapa');
    var areaEl = $('lotePanelArea');
    var perEl = $('lotePanelPerimetro');
    var estadoEl = $('lotePanelEstado');
    var tipEl = $('lotePanelTipologia');

    if (title) title.textContent = _propertyTitle || 'Master plan';
    if (subtitle) subtitle.textContent = loteTitle(feat);
    if (etapaEl) {
      etapaEl.textContent = feat.etapa ? 'Etapa ' + feat.etapa : '';
      etapaEl.hidden = !feat.etapa;
    }
    if (areaEl) areaEl.textContent = feat.area_m2 != null ? fmtM(feat.area_m2) + ' m²' : '—';
    if (perEl && feat.lados) {
      perEl.innerHTML =
        '<span>Izq. <strong>' + fmtM(feat.lados.izquierda) + ' m</strong></span>' +
        '<span>Der. <strong>' + fmtM(feat.lados.derecha) + ' m</strong></span>' +
        '<span>Frente <strong>' + fmtM(feat.lados.frente) + ' m</strong></span>' +
        '<span>Fondo <strong>' + fmtM(feat.lados.fondo) + ' m</strong></span>';
    }
    if (estadoEl) {
      estadoEl.textContent = st.label;
      estadoEl.style.background = st.fill;
    }
    if (tipEl) tipEl.textContent = feat.tipologia || '—';

    var precioEl = $('lotePanelPrecio');
    if (precioEl) {
      var lp = featLotPrice(feat);
      var precioTxt = lp != null && lp > 0 ? fmtPrecioLote(lp) : '';
      precioEl.textContent = precioTxt || '—';
    }

    var viewEtapa = $('loteViewEtapa');
    var viewMz = $('loteViewManzana');
    var viewLt = $('loteViewLote');
    if (viewEtapa) viewEtapa.textContent = feat.etapa || '—';
    if (viewMz) viewMz.textContent = feat.manzana || '—';
    if (viewLt) viewLt.textContent = feat.lote || '—';

    var inpEtapa = $('loteInpEtapa');
    var inpMz = $('loteInpManzana');
    var inpLt = $('loteInpLote');
    var inpTip = $('loteInpTipologia');
    var inpPrecio = $('loteInpPrecio');
    var selEst = $('loteInpEstado');
    if (inpEtapa && document.activeElement !== inpEtapa) inpEtapa.value = feat.etapa || '';
    if (inpMz && document.activeElement !== inpMz) inpMz.value = feat.manzana || '';
    if (inpLt && document.activeElement !== inpLt) inpLt.value = feat.lote || '';
    if (inpTip && document.activeElement !== inpTip) inpTip.value = feat.tipologia || '';
    if (inpPrecio && document.activeElement !== inpPrecio) {
      inpPrecio.value =
        feat.precio != null && Number(feat.precio) > 0 ? String(feat.precio) : '';
    }
    if (selEst && document.activeElement !== selEst) selEst.value = feat.estado || 'disponible';

    panel.hidden = false;
    panel.classList.toggle('lote-panel--view', _readonly);
    panel.classList.toggle('lote-panel--edit', !_readonly);
  }

  function showLotePanel(feat) {
    updateLotePanel(feat);
    if (_readonly && feat) {
      try {
        window.dispatchEvent(new CustomEvent('mph:lote-view', { detail: { feat: feat } }));
      } catch (e) { /* ignore */ }
    }
  }

  function bindLotePanel() {
    if (_panelBound) return;
    _panelBound = true;
    var closeBtn = $('lotePanelClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        hideLotePanel();
        if (_infoWindow) _infoWindow.close();
        _selectedId = null;
        highlightFeature('');
      });
    }

    function onFieldEdit(key, value) {
      if (!_selectedId || !_plan) return;
      var feat = _plan.features.find(function (f) { return f.id === _selectedId; });
      if (!feat) return;
      if (key === 'precio') {
        var n = value === '' || value == null ? null : Number(value);
        feat.precio = n != null && !isNaN(n) && n > 0 ? n : null;
      } else {
        feat[key] = value;
      }
      if (key === 'lote' || key === 'manzana' || key === 'etapa') {
        repositionLabel(feat.id);
        renderList();
      }
      if (key === 'precio') renderList();
      syncHidden();
      updateLotePanel(feat);
    }

    function bindField(id, key, isNumber) {
      var el = $(id);
      if (!el) return;
      function apply() {
        var val = isNumber ? el.value : el.value.trim();
        onFieldEdit(key, val);
      }
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    }
    bindField('loteInpEtapa', 'etapa');
    bindField('loteInpManzana', 'manzana');
    bindField('loteInpLote', 'lote');
    bindField('loteInpTipologia', 'tipologia');
    bindField('loteInpPrecio', 'precio', true);

    var selEst = $('loteInpEstado');
    if (selEst) {
      selEst.addEventListener('change', function () {
        if (!_selectedId || !_plan) return;
        var feat = _plan.features.find(function (f) { return f.id === _selectedId; });
        if (!feat) return;
        feat.estado = selEst.value;
        if (selEst.value === 'calle') feat.tipo = 'calle';
        else feat.tipo = 'lote';
        renderOnMap({ fit: false, keepSelection: true });
      });
    }
  }

  function renderOnMap(renderOpts) {
    renderOpts = renderOpts || {};
    if (!_plan) return;
    if (!_map) {
      _pendingRender = true;
      return;
    }
    _pendingRender = false;
    clearMapPolys();
    var cal = readCalibration();
    _plan.calibration = cal;
    var utmFn = _hooks && _hooks.utmToLatLng;
    _plan.features = applyCalibrationToFeatures(_plan.features, cal, utmFn, !!renderOpts.forceRecalibrate);
    refreshAllMetrics();

    var bounds = new google.maps.LatLngBounds();
    var hasPath = false;
    var rendered = 0;
    var skipped = 0;

    _plan.features.forEach(function (feat) {
      normalizeFeature(feat);
      if (!feat.path || feat.path.length < 3) {
        skipped += 1;
        return;
      }
      rendered += 1;
      var st = estadoStyle(feat.estado);
      var active = feat.id === _selectedId;
      var poly = new google.maps.Polygon({
        map: _map,
        paths: feat.path,
        fillColor: st.fill,
        fillOpacity: active ? Math.min(st.opacity + 0.15, 0.75) : st.opacity,
        strokeColor: active ? '#ff6b00' : st.stroke,
        strokeWeight: active ? 3.5 : feat.tipo === 'calle' ? 1.5 : 2,
        strokeOpacity: 0.95,
        clickable: true,
        editable: !_readonly && !isProjectTransformActive() && feat.tipo !== 'calle',
        draggable: false,
        zIndex: active ? st.z + 2 : st.z,
      });
      poly.__featId = feat.id;
      attachPathListeners(poly, feat);
      feat.path.forEach(function (p) {
        bounds.extend(p);
        hasPath = true;
      });
      google.maps.event.addListener(poly, 'click', function (e) {
        if (e && e.stop) e.stop();
        handleLoteClick(feat.id);
      });
      _mapPolys.push(poly);

      if (feat.tipo !== 'calle') {
        var c = centroid(feat.path);
        var labelMode = _map ? labelModeForZoom(_map.getZoom()) : 'num';
        var html = buildLabelHtml(feat, active, labelMode);
        var ov = createLabelOverlay(_map, c, html);
        if (ov) {
          ov.__featId = feat.id;
          _mapLabels.push(ov);
        }
      }
    });

    if (hasPath && renderOpts.fit !== false) {
      _map.fitBounds(bounds, 48);
    }
    if (_hooks && _hooks.onPlanChange) _hooks.onPlanChange(_plan);

    if (rendered === 0 && _plan.features.length > 0) {
      showCalibAviso(
        '<strong>Faltan datos de ubicacion.</strong> Ingresa UTM Este/Norte de la esquina inferior izquierda, ancho real en metros y pulsa <strong>Aplicar al mapa</strong>.',
        'warn'
      );
    } else if (skipped > 0) {
      showCalibAviso(rendered + ' poligono(s) en el mapa. ' + skipped + ' sin ubicar (revisa UTM y escala).', 'info');
    } else {
      hideCalibAviso();
    }

    syncHidden();
    renderList();
    updateCounts();

    if (renderOpts.keepSelection && _selectedId) {
      var sel = (_plan.features || []).find(function (f) { return f.id === _selectedId; });
      if (sel) showLotePanel(sel);
    }

    var hint = $('loteMapHint');
    if (hint) hint.hidden = rendered === 0;
    if (_readonly && _map && rendered > 0) {
      updatePolyOpacityForZoom(_map.getZoom());
      updateHintForZoom(_map.getZoom());
    }
    if (_moveProjectActive && !_readonly) {
      ensureAnchorMarker();
    }
  }

  function ensurePlan(source) {
    if (!_plan) {
      _plan = { version: 1, features: [], source: source || 'draw' };
    }
    return _plan;
  }

  function getDrawEstado() {
    var sel = $('selectDibujoEstado') || $('selectPlanoEstado');
    return (sel && sel.value) || 'disponible';
  }

  function addDrawnFeature(paths, opts) {
    if (!paths || paths.length < 3) return null;
    opts = opts || {};
    var plan = ensurePlan('draw');
    var estado = opts.estado || getDrawEstado();
    var id = 'draw-' + Date.now() + '-' + (plan.features.length + 1);
    var feat = normalizeFeature({
      id: id,
      label: opts.label || '',
      tipo: estado === 'calle' ? 'calle' : 'lote',
      estado: estado,
      etapa: opts.etapa || '',
      manzana: opts.manzana || '',
      lote: opts.lote || '',
      tipologia: opts.tipologia || '',
      path: paths.map(function (p) {
        return { lat: Number(p.lat), lng: Number(p.lng) };
      }),
    });
    if (feat.tipo !== 'calle') autofillFeature(feat, plan);
    computeFeatureMetrics(feat);
    plan.features.push(feat);
    setDetalleVisible(true);
    renderOnMap({ fit: opts.fit });
    selectFeature(id);
    return id;
  }

  function removeFeature(id) {
    if (!_plan || !id) return;
    _plan.features = (_plan.features || []).filter(function (f) {
      return f.id !== id;
    });
    if (_selectedId === id) {
      _selectedId = null;
      hideLotePanel();
    }
    if (!_plan.features.length) {
      clearAll(false);
      return;
    }
    renderOnMap({ fit: false });
  }

  function removeSelectedFeature() {
    if (_selectedId) removeFeature(_selectedId);
  }

  function clearAll(confirmMsg) {
    if (confirmMsg !== false) {
      if (!confirm('Quitar todos los poligonos del mapa?')) return;
    }
    exitAllProjectTransforms(false);
    _plan = null;
    _selectedId = null;
    clearMapPolys();
    hideLotePanel();
    var el = $('plan_masterplan');
    if (el) el.value = '';
    var input = $('inputPlanoArchivo');
    if (input) input.value = '';
    renderList();
    updateCounts();
    setDetalleVisible(false);
    var status = $('planoImportStatus');
    if (status) status.textContent = '';
    var hint = $('loteMapHint');
    if (hint) hint.hidden = true;
    if (_hooks && _hooks.onPlanCleared) _hooks.onPlanCleared();
  }

  function countLotes() {
    if (!_plan) return 0;
    return (_plan.features || []).filter(function (f) {
      return f.tipo === 'lote' && f.path && f.path.length >= 3;
    }).length;
  }

  function syncHidden() {
    var el = $('plan_masterplan');
    if (!el || !_plan) return;
    refreshAllMetrics();
    el.value = JSON.stringify(_plan);
    if (_hooks && _hooks.onPlanChange) {
      _hooks.onPlanChange(_plan);
    }
  }

  function flushAllLoteFields() {
    if (!_plan) return;
    var fields = [
      ['loteInpEtapa', 'etapa'],
      ['loteInpManzana', 'manzana'],
      ['loteInpLote', 'lote'],
      ['loteInpTipologia', 'tipologia'],
      ['loteInpPrecio', 'precio'],
    ];
    fields.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el || !_selectedId) return;
      var feat = (_plan.features || []).find(function (f) { return f.id === _selectedId; });
      if (!feat) return;
      if (pair[1] === 'precio') {
        var n = el.value === '' ? null : parseFloat(el.value);
        feat.precio = n != null && !isNaN(n) && n > 0 ? n : null;
      } else {
        feat[pair[1]] = el.value.trim();
      }
    });
    var selEst = $('loteInpEstado');
    if (selEst && _selectedId) {
      var featSel = (_plan.features || []).find(function (f) { return f.id === _selectedId; });
      if (featSel) {
        featSel.estado = selEst.value;
        if (selEst.value === 'calle') featSel.tipo = 'calle';
        else if (featSel.tipo === 'calle') featSel.tipo = 'lote';
      }
    }
    var tbody = $('planoLotesList');
    if (tbody) {
      tbody.querySelectorAll('.plano-meta-inp, .plano-label-inp, .plano-precio-inp').forEach(function (inp) {
        var id = inp.getAttribute('data-id');
        var key = inp.getAttribute('data-key') || 'label';
        var feat = (_plan.features || []).find(function (f) { return f.id === id; });
        if (!feat) return;
        if (key === 'precio') {
          var n = inp.value === '' ? null : parseFloat(inp.value);
          feat.precio = n != null && !isNaN(n) && n > 0 ? n : null;
        } else {
          feat[key] = inp.value.trim();
        }
      });
      tbody.querySelectorAll('.plano-estado-sel').forEach(function (sel) {
        var id = sel.getAttribute('data-id');
        var feat = (_plan.features || []).find(function (f) { return f.id === id; });
        if (!feat) return;
        feat.estado = sel.value;
        if (sel.value === 'calle') feat.tipo = 'calle';
        else if (feat.tipo === 'calle' && sel.value !== 'calle') feat.tipo = 'lote';
      });
    }
  }

  function syncBeforeSubmit() {
    flushAllLoteFields();
    var priorRaw = ($('plan_masterplan') || {}).value;
    var priorPlan = parsePlanRaw(priorRaw);
    if (!_plan) {
      if (priorPlan && planHasPaths(priorPlan)) return;
      return;
    }
    refreshAllMetrics();
    syncHidden();
    if (!planHasPaths(_plan) && priorPlan && planHasPaths(priorPlan)) {
      _plan = priorPlan;
      var elKeep = $('plan_masterplan');
      if (elKeep) elKeep.value = priorRaw;
    }
    var polyEl = $('poligono_lote');
    if (polyEl) {
      var lotes = (_plan.features || []).filter(function (f) {
        return f.tipo === 'lote' && f.path && f.path.length >= 3;
      });
      var primary = lotes[0];
      if (primary) {
        polyEl.value = JSON.stringify(primary.path);
      }
    }
    var latEl = $('latitud');
    var lngEl = $('longitud');
    if (latEl && lngEl && (!latEl.value || !lngEl.value)) {
      var withPath = (_plan.features || []).filter(function (f) {
        return f.path && f.path.length >= 3;
      });
      var feat = withPath.find(function (f) { return f.tipo === 'lote'; }) || withPath[0];
      if (feat) {
        var c = centroid(feat.path);
        if (c) {
          latEl.value = String(roundGpsCoord(c.lat));
          lngEl.value = String(roundGpsCoord(c.lng));
        }
      }
    }
  }

  function selectFeature(id) {
    _selectedId = id;
    renderList();
    _mapPolys.forEach(function (poly) {
      var active = poly.__featId === id;
      var pf = (_plan.features || []).find(function (f) { return f.id === poly.__featId; });
      var st = estadoStyle(pf ? pf.estado : 'disponible');
      poly.setOptions({
        strokeWeight: active ? 3.5 : 2,
        strokeColor: active ? '#ff6b00' : st.stroke,
        fillOpacity: active ? 0.7 : st.opacity,
        zIndex: active ? 5 : st.z,
      });
    });
    _mapLabels.forEach(function (ov) {
      if (!ov.div) return;
      var inner = ov.div.querySelector('.lote-map-label');
      if (inner) inner.classList.toggle('lote-map-label--active', ov.__featId === id);
    });
    var sel = $('selectPlanoEstado');
    var feat = (_plan.features || []).find(function (f) { return f.id === id; });
    if (sel && feat) sel.value = feat.estado || 'disponible';
    if (feat) {
      showLotePanel(feat);
      if (_hooks && _hooks.onPlanChange) _hooks.onPlanChange(_plan);
      if (_map && feat.path && feat.path.length >= 3) {
        var b = new google.maps.LatLngBounds();
        feat.path.forEach(function (p) { b.extend(p); });
        _map.panTo(centroid(feat.path));
      }
    }
  }

  function renderList() {
    var tbody = $('planoLotesList');
    if (!tbody || !_plan) return;
    var feats = _plan.features || [];
    if (!feats.length) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="pub-coords__empty">Dibuja o importa poligonos: etapa, mz, lote, nombre y area se llenan solos.</td></tr>';
      return;
    }
    var lotes = loteFeaturesFromPlan(_plan);
    var totalArea = 0;
    lotes.forEach(function (f) {
      totalArea += f.area_m2 || 0;
    });
    var sym = monedaSymbol();
    var html = '';
    feats.forEach(function (f, i) {
      normalizeFeature(f);
      computeFeatureMetrics(f);
      var st = estadoStyle(f.estado);
      html +=
        '<tr class="plano-row' +
        (f.id === _selectedId ? ' is-selected' : '') +
        '" data-id="' +
        f.id +
        '">' +
        '<td><span class="plano-swatch" style="background:' +
        st.fill +
        '"></span></td>' +
        '<td><input type="text" class="plano-meta-inp plano-meta-inp--xs" data-id="' +
        f.id +
        '" data-key="etapa" value="' +
        esc(f.etapa) +
        '" placeholder="Etapa" title="Etapa" /></td>' +
        '<td><input type="text" class="plano-meta-inp plano-meta-inp--xs" data-id="' +
        f.id +
        '" data-key="manzana" value="' +
        esc(f.manzana) +
        '" placeholder="Mz" title="Manzana" /></td>' +
        '<td><input type="text" class="plano-meta-inp plano-meta-inp--xs" data-id="' +
        f.id +
        '" data-key="lote" value="' +
        esc(f.lote) +
        '" placeholder="Lt" title="Lote" /></td>' +
        '<td><input type="text" class="plano-label-inp" data-id="' +
        f.id +
        '" value="' +
        esc(f.label || 'Lote ' + (i + 1)) +
        '" /></td>' +
        '<td>' +
        (f.area_m2 != null ? fmtM(f.area_m2) + ' m²' : '—') +
        '</td>' +
        '<td>' +
        (f.tipo === 'calle'
          ? '—'
          : '<input type="number" class="plano-meta-inp plano-precio-inp" data-id="' +
            f.id +
            '" data-key="precio" value="' +
            (f.precio != null && Number(f.precio) > 0 ? esc(String(f.precio)) : '') +
            '" placeholder="' +
            esc(
              precioEstimadoLote(f, totalArea)
                ? sym + ' ' + Math.round(precioEstimadoLote(f, totalArea))
                : 'Auto'
            ) +
            '" min="0" step="100" title="Precio del lote (vacío = proporcional al precio total)" />') +
        '</td>' +
        '<td><select class="plano-estado-sel" data-id="' +
        f.id +
        '">' +
        optionEstados(f.estado, f.tipo) +
        '</select></td>' +
        '<td><button type="button" class="btn btn--ghost btn--small plano-del-btn" data-id="' +
        f.id +
        '" title="Eliminar">×</button></td></tr>';
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('.plano-estado-sel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.getAttribute('data-id');
        var feat = feats.find(function (x) { return x.id === id; });
        if (!feat) return;
        feat.estado = sel.value;
        if (sel.value === 'calle') feat.tipo = 'calle';
        else if (feat.tipo === 'calle' && sel.value !== 'calle') feat.tipo = 'lote';
        renderOnMap({ fit: false, keepSelection: true });
      });
    });

    tbody.querySelectorAll('.plano-label-inp, .plano-meta-inp, .plano-precio-inp').forEach(function (inp) {
      function applyMeta() {
        var id = inp.getAttribute('data-id');
        var key = inp.getAttribute('data-key') || 'label';
        var feat = (_plan.features || []).find(function (x) { return x.id === id; });
        if (!feat) return;
        if (key === 'precio') {
          var n = inp.value === '' ? null : parseFloat(inp.value);
          feat.precio = n != null && !isNaN(n) && n > 0 ? n : null;
        } else {
          feat[key] = inp.value.trim();
        }
        syncHidden();
        if (key !== 'label' && key !== 'precio') repositionLabel(id);
        if (id === _selectedId) updateLotePanel(feat);
      }
      inp.addEventListener('input', applyMeta);
      inp.addEventListener('change', applyMeta);
    });

    tbody.querySelectorAll('.plano-row').forEach(function (row) {
      row.addEventListener('click', function (ev) {
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'BUTTON') return;
        selectFeature(row.getAttribute('data-id'));
      });
    });

    tbody.querySelectorAll('.plano-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeFeature(btn.getAttribute('data-id'));
      });
    });
  }

  function optionEstados(current, tipo) {
    var keys = tipo === 'calle' ? ['calle', 'disponible', 'reservado', 'vendido'] : ['disponible', 'reservado', 'vendido', 'calle'];
    return keys
      .map(function (k) {
        var e = ESTADOS[k];
        return (
          '<option value="' +
          k +
          '"' +
          (current === k ? ' selected' : '') +
          '>' +
          e.label +
          '</option>'
        );
      })
      .join('');
  }

  function updateCounts() {
    var el = $('planoResumen');
    if (!el || !_plan) return;
    var c = { disponible: 0, reservado: 0, vendido: 0, calle: 0 };
    (_plan.features || []).forEach(function (f) {
      var k = f.estado in c ? f.estado : 'disponible';
      if (f.tipo === 'calle' || f.estado === 'calle') c.calle += 1;
      else c[k] += 1;
    });
    el.innerHTML =
      '<span class="plano-pill plano-pill--disp">' +
      c.disponible +
      ' disp.</span> ' +
      '<span class="plano-pill plano-pill--res">' +
      c.reservado +
      ' res.</span> ' +
      '<span class="plano-pill plano-pill--vend">' +
      c.vendido +
      ' vend.</span> ' +
      '<span class="plano-pill plano-pill--calle">' +
      c.calle +
      ' calles</span>';
  }

  function setDetalleVisible(show) {
    var panel = $('panelPlanoDetalle');
    if (panel) panel.hidden = !show;
    var calib = document.querySelector('.plano-import__calib');
    if (calib && _plan) {
      var needsCalib = (_plan.features || []).some(function (f) {
        return f.localPath && f.localPath.length;
      });
      calib.hidden = !needsCalib;
    }
  }

  function openFilePicker() {
    var input = $('inputPlanoArchivo');
    if (input) input.click();
  }

  function centerMapOnCalibration() {
    var cal = readCalibration();
    if (cal.utmE0 == null || cal.utmN0 == null || !_hooks || !_hooks.utmToLatLng || !_map) return;
    var ll = utmToLatLngViaHooks(cal.utmZone, cal.utmHem, cal.utmE0, cal.utmN0);
    if (!ll) return;
    _map.panTo({ lat: ll.lat, lng: ll.lng });
    _map.setZoom(18);
  }

  function utmToLatLngViaHooks(zone, hem, e, n) {
    if (_hooks && _hooks.utmToLatLng) return _hooks.utmToLatLng(zone, hem, e, n);
    return null;
  }

  function ingestServerResult(result) {
    if (!result.features || !result.features.length) {
      alert('No se encontraron poligonos en el archivo. Usa poligonos cerrados o rutas (path).');
      return;
    }
    _plan = {
      version: 1,
      features: (result.features || []).map(normalizeFeature),
      bounds: result.bounds || boundsFromLocal(result.features),
      source: result.format || 'file',
    };
    autofillAllLotes(_plan, true);
    setDetalleVisible(true);
    prefillCalibrationFromSidebar();
    var bounds = _plan.bounds;
    var anchoInp = $('inputPlanoAnchoM');
    if (bounds && anchoInp) {
      anchoInp.placeholder = 'Ancho real del plano en m (dibujo: ' + Math.round(bounds.width * 10) / 10 + ' u)';
      if (!anchoInp.value && bounds.width > 0 && bounds.width < 2000) {
        anchoInp.value = String(Math.round(bounds.width));
      }
    }
    renderOnMap({ fit: true });
    centerMapOnCalibration();
    var st = $('publicarMapaStatus');
    if (st) {
      st.innerHTML =
        '<strong>Plano importado:</strong> ' +
        _plan.features.length +
        ' poligonos con etapa, manzana y lote asignados automaticamente. Ajusta los valores por defecto arriba si necesitas otro criterio.';
      st.className = 'publicar-mapa__status publicar-mapa__status--ok';
    }
    showCalibAviso(
      'Confirma UTM (esquina inferior izquierda), ancho real y pulsa <strong>Aplicar al mapa</strong>. Los lotes ya tienen numeracion automatica.',
      'info'
    );
  }

  function importFile(file) {
    if (!file) return;
    var fd = new FormData();
    fd.append('archivo', file);
    var csrfInp = document.querySelector('#formPublicar input[name="csrf_token"]');
    if (csrfInp) fd.append('csrf_token', csrfInp.value);

    var status = $('planoImportStatus');
    if (status) status.textContent = 'Leyendo ' + file.name + '…';

    fetch('/publicar/api/importar-plano', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, body: j };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.body.ok) {
          throw new Error((res.body && res.body.error) || 'Error al importar');
        }
        ingestServerResult(res.body);
        if (global.MPHPublicarMapa && global.MPHPublicarMapa.setGeoMode) {
          global.MPHPublicarMapa.setGeoMode('plano', { skipConfirm: true });
        }
        if (status) status.textContent = file.name + ' — ' + res.body.features.length + ' poligonos';
      })
      .catch(function (err) {
        if (status) status.textContent = '';
        alert(err.message || 'No se pudo importar el plano.');
      });
  }

  function applyEstadoToSelected() {
    if (!_selectedId || !_plan) return;
    var estado = ($('selectPlanoEstado') || {}).value;
    var feat = _plan.features.find(function (f) { return f.id === _selectedId; });
    if (!feat) return;
    feat.estado = estado;
    if (estado === 'calle') feat.tipo = 'calle';
    else feat.tipo = 'lote';
    renderOnMap({ fit: false, keepSelection: true });
  }

  function bindUi() {
    bindLotePanel();
    var input = $('inputPlanoArchivo');
    if (input) {
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) importFile(input.files[0]);
      });
    }
    ['btnCargarPlanoBar'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener('click', openFilePicker);
    });
    var btnApply = $('btnPlanoAplicar');
    if (btnApply) {
      btnApply.addEventListener('click', function () {
        prefillCalibrationFromSidebar();
        renderOnMap({ fit: true, forceRecalibrate: true });
        centerMapOnCalibration();
      });
    }
    var btnCopyUtm = $('btnPlanoCopiarUtm');
    if (btnCopyUtm) {
      btnCopyUtm.addEventListener('click', function () {
        prefillCalibrationFromSidebar();
        showCalibAviso('UTM copiado del panel lateral. Pulsa <strong>Aplicar al mapa</strong>.', 'info');
      });
    }
    var btnEstado = $('btnPlanoEstadoSel');
    if (btnEstado) btnEstado.addEventListener('click', applyEstadoToSelected);
    var btnClear = $('btnPlanoLimpiar');
    if (btnClear) btnClear.addEventListener('click', function () { clearAll(true); });
    var btnDelSel = $('btnEliminarPoligono');
    if (btnDelSel) btnDelSel.addEventListener('click', removeSelectedFeature);
    var btnNumerar = $('btnNumerarTodos');
    if (btnNumerar) btnNumerar.addEventListener('click', numerarTodosLotes);
    ['btnMoverProyecto', 'btnMoverProyectoPoligono'].forEach(function (id) {
      var btnMove = $(id);
      if (btnMove) btnMove.addEventListener('click', toggleMoveProjectMode);
    });
    ['btnEscalarProyecto', 'btnEscalarProyectoPoligono'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener('click', toggleScaleProjectMode);
    });
    ['btnRotarProyecto', 'btnRotarProyectoPoligono'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener('click', toggleRotateProjectMode);
    });
    var scaleSlider = $('inputTransformScale');
    if (scaleSlider) scaleSlider.addEventListener('input', onScaleSliderInput);
    var rotSlider = $('inputTransformRotate');
    if (rotSlider) rotSlider.addEventListener('input', onRotateSliderInput);
    var btnFinishScale = $('btnFinishScale');
    if (btnFinishScale) {
      btnFinishScale.addEventListener('click', function () {
        if (_scaleModeActive) toggleScaleProjectMode();
      });
    }
    var btnFinishRotate = $('btnFinishRotate');
    if (btnFinishRotate) {
      btnFinishRotate.addEventListener('click', function () {
        if (_rotateModeActive) toggleRotateProjectMode();
      });
    }
    var btnPick = $('btnScalePickPoints');
    if (btnPick) btnPick.addEventListener('click', startScalePickPoints);
    var btnApplyMeasure = $('btnApplyScaleMeasure');
    if (btnApplyMeasure) btnApplyMeasure.addEventListener('click', applyScaleFromMeasure);
    ['inputPlanoUtmE', 'inputPlanoUtmN', 'inputPlanoAnchoM', 'inputPlanoRotacion', 'inputPlanoEscala'].forEach(
      function (id) {
        var node = $(id);
        if (node) node.addEventListener('change', function () {
          if (_plan) renderOnMap({ fit: false, keepSelection: true });
        });
      }
    );
  }

  function loadPlan(raw) {
    var parsed = parsePlanRaw(raw);
    if (!parsed) return false;
    autofillAllLotes(parsed);
    _plan = parsed;
    restoreCalibrationUi(_plan);
    prefillCalibrationFromSidebar();
    var el = $('plan_masterplan');
    if (el) el.value = JSON.stringify(_plan);
    setDetalleVisible(true);
    renderList();
    updateCounts();
    if (_map) {
      renderOnMap({ fit: true });
    } else {
      _pendingRender = true;
    }
    var st = $('publicarMapaStatus');
    if (st) {
      var n = (_plan.features || []).length;
      st.innerHTML =
        '<strong>Plano cargado:</strong> ' +
        n +
        ' poligono(s). Etapa, manzana, lote y area se completan automaticamente al dibujar o importar.';
      st.className = 'publicar-mapa__status publicar-mapa__status--ok';
    }
    if (_hooks && _hooks.onPlanChange) _hooks.onPlanChange(_plan);
    return true;
  }

  function attach(hooks) {
    hooks = hooks || {};
    _hooks = hooks;
    _map = hooks.map;
    _readonly = !!hooks.readonly;
    _propertyTitle = hooks.propertyTitle || '';
    applyListingPricing(hooks);
    if (!_plan) {
      var existing = parsePlanRaw(($('plan_masterplan') || {}).value);
      if (existing) {
        _plan = existing;
        setDetalleVisible(true);
      }
    }
    if (_plan && _map) {
      renderOnMap({
        fit: hooks.autoFit !== false,
        keepSelection: !!hooks.keepSelection,
      });
    } else if (_plan && !_map) {
      _pendingRender = true;
    }
  }

  function initInteractivePlan(map, planRaw, opts) {
    opts = opts || {};
    _readonly = opts.readonly === true;
    _propertyTitle = opts.propertyTitle || '';
    applyListingPricing({
      listingPrecio: opts.listingPrecio,
      listingMoneda: opts.listingMoneda,
      listingAreaTotal: opts.listingAreaTotal,
      showLotePrices: opts.readonly === true,
    });
    _plan = ensureRenderablePlan(
      parsePlanRaw(planRaw),
      opts.fallbackPoligono,
      opts.propertyTitle || 'Lote'
    );
    if (!_plan || !_plan.features || !_plan.features.length) return null;
    autofillAllLotes(_plan);

    bindLotePanel();
    bindReadonlyMapBehavior(map);

    attach({
      map: map,
      readonly: _readonly,
      propertyTitle: _propertyTitle,
      autoFit: false,
      utmToLatLng: opts.utmToLatLng,
    });

    var bounds = new google.maps.LatLngBounds();
    var has = false;
    (_plan.features || []).forEach(function (f) {
      (f.path || []).forEach(function (p) {
        bounds.extend(p);
        has = true;
      });
    });
    if (has) {
      map.fitBounds(bounds, 40);
      google.maps.event.addListenerOnce(map, 'idle', function () {
        if (map.getZoom() > 17) map.setZoom(17);
        onZoomLevelChange();
      });
    }

    var hint = $('loteMapHint');
    if (hint) hint.hidden = false;

    return {
      select: handleLoteClick,
      selectFeature: selectFeature,
      getPlan: function () { return _plan; },
    };
  }

  function drawPlanOnMap(map, planRaw, mapObjects, opts) {
    opts = opts || {};
    if (opts.interactive) {
      return initInteractivePlan(map, planRaw, opts);
    }
    var plan = parsePlanRaw(planRaw);
    if (!plan || !map) return;
    (plan.features || []).forEach(function (feat) {
      if (!feat.path || feat.path.length < 3) return;
      var st = estadoStyle(feat.estado);
      var poly = new google.maps.Polygon({
        map: map,
        paths: feat.path,
        fillColor: st.fill,
        fillOpacity: st.opacity,
        strokeColor: st.stroke,
        strokeWeight: 2,
        zIndex: st.z,
      });
      if (mapObjects) mapObjects.push(poly);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }

  global.MPHPlanoImport = {
    ESTADOS: ESTADOS,
    attach: attach,
    openFilePicker: openFilePicker,
    addDrawnFeature: addDrawnFeature,
    removeFeature: removeFeature,
    removeSelectedFeature: removeSelectedFeature,
    clearAll: clearAll,
    countLotes: countLotes,
    getDrawEstado: getDrawEstado,
    drawPlanOnMap: drawPlanOnMap,
    initInteractivePlan: initInteractivePlan,
    parsePlan: parsePlanRaw,
    planFromPoligono: planFromPoligono,
    ensureRenderablePlan: ensureRenderablePlan,
    estadoStyle: estadoStyle,
    syncBeforeSubmit: syncBeforeSubmit,
    flushAllLoteFields: flushAllLoteFields,
    loadPlan: loadPlan,
    autofillAllLotes: autofillAllLotes,
    numerarTodosLotes: numerarTodosLotes,
    setListingPricing: setListingPricing,
    calcMinLotePrice: calcMinLotePrice,
    getPlan: function () { return _plan; },
    getSelectedId: function () { return _selectedId; },
    getPlanAnchorLatLng: getPlanAnchorLatLng,
    toggleMoveProjectMode: toggleMoveProjectMode,
    toggleScaleProjectMode: toggleScaleProjectMode,
    toggleRotateProjectMode: toggleRotateProjectMode,
    isMoveProjectActive: function () { return _moveProjectActive; },
    isProjectTransformActive: isProjectTransformActive,
  };
})(typeof window !== 'undefined' ? window : this);

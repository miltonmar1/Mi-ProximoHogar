/* Marcadores con precio — pin + etiqueta (estilo portal inmobiliario) */
(function (global) {
  'use strict';

  var PIN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">' +
    '<path d="M17 0C8.2 0 1.5 6.7 1.5 15.2c0 11.3 15.5 26.8 15.5 26.8S32.5 26.5 32.5 15.2C32.5 6.7 25.8 0 17 0z" fill="#e85d04" stroke="#fff" stroke-width="1.2"/>' +
    '<circle cx="17" cy="14.5" r="8" fill="#fff"/>' +
    '<path d="M11.5 16.5h3.2v-5.5h2.2v5.5h3.2v-7.5h-3.2v-1.2h-2.2v1.2h-3.2v7.5zm5.5-7.5h3.2v7.5h-3.2v-7.5z" fill="#e85d04"/>' +
    '</svg>';

  /* Pin terreno: casa + camino (mapa general) */
  var PIN_TERRENO_DESDE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">' +
    '<path d="M17 0C8.2 0 1.5 6.7 1.5 15.2c0 11.3 15.5 26.8 15.5 26.8S32.5 26.5 32.5 15.2C32.5 6.7 25.8 0 17 0z" fill="#e85d04" stroke="#fff" stroke-width="1.2"/>' +
    '<circle cx="17" cy="14.5" r="8" fill="#fff"/>' +
    '<path d="M12.5 16.2 L17 11.8 L21.5 16.2 V18.8 H12.5 Z" fill="#e85d04"/>' +
    '<rect x="15.6" y="14.8" width="2.8" height="2.8" fill="#fff"/>' +
    '<path d="M9.5 19.2 H24.5" stroke="#64748b" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M11 21.2 H23" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round"/>' +
    '</svg>';

  function pinSvgForVariant(variant) {
    return variant === 'terreno-desde' ? PIN_TERRENO_DESDE_SVG : PIN_SVG;
  }

  function labelForOpts(opts) {
    if (opts.precioM2 != null) return fmtPrecioM2(opts.precioM2, opts.moneda);
    var compact = fmtPrecioCompact(opts.precio, opts.moneda);
    if (!compact) return '';
    if (opts.variant === 'terreno-desde') return 'Desde ' + compact;
    return compact;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function fmtPrecioCompact(precio, moneda) {
    if (precio == null || isNaN(precio) || Number(precio) <= 0) return '';
    var m = (moneda || 'PEN').toUpperCase();
    var pref = m === 'USD' ? 'US$' : 'S/';
    var n = Number(precio);
    if (n >= 1000000) {
      return pref + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (n >= 1000) {
      return pref + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return pref + n.toLocaleString('es-PE', { maximumFractionDigits: 0 });
  }

  function fmtPrecioM2(val, moneda) {
    if (val == null || isNaN(val) || Number(val) <= 0) return '';
    var m = (moneda || 'PEN').toUpperCase();
    var pref = m === 'USD' ? 'US$' : 'S/';
    return (
      pref +
      ' ' +
      Number(val).toLocaleString('es-PE', { maximumFractionDigits: 0 }) +
      '/m²'
    );
  }

  function pinIcon() {
    if (!global.google || !google.maps) return null;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(PIN_SVG),
      scaledSize: new google.maps.Size(34, 42),
      anchor: new google.maps.Point(17, 42),
    };
  }

  function toLatLng(pos) {
    if (!pos || !global.google) return null;
    if (typeof pos.lat === 'function') return pos;
    return new google.maps.LatLng(pos.lat, pos.lng);
  }

  function createPricePinOverlay(map, getPosition, opts) {
    if (!map || !getPosition || !global.google) return null;
    opts = opts || {};
    var overlay = new google.maps.OverlayView();

    overlay.onAdd = function () {
      var div = document.createElement('div');
      div.className =
        'map-price-pin' + (opts.variant === 'terreno-desde' ? ' map-price-pin--terreno' : '');
      var label = labelForOpts(opts);
      var pinSvg = pinSvgForVariant(opts.variant);
      div.innerHTML =
        (label ? '<div class="map-price-pin__label">' + esc(label) + '</div>' : '') +
        '<div class="map-price-pin__icon" aria-hidden="true">' +
        pinSvg +
        '</div>';
      this.div = div;
      if (opts.onClick) {
        div.style.pointerEvents = 'auto';
        div.style.cursor = 'pointer';
        div.addEventListener('click', function (e) {
          e.stopPropagation();
          opts.onClick(e);
        });
      }
      var panes = this.getPanes();
      if (panes && panes.overlayMouseTarget) {
        panes.overlayMouseTarget.appendChild(div);
      }
    };

    overlay.draw = function () {
      if (!this.div) return;
      var proj = this.getProjection();
      if (!proj) return;
      var latLng = toLatLng(getPosition());
      if (!latLng) return;
      var p = proj.fromLatLngToDivPixel(latLng);
      if (!p) return;
      this.div.style.left = p.x + 'px';
      this.div.style.top = p.y + 'px';
    };

    overlay.onRemove = function () {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    };

    overlay.refresh = function () {
      if (!this.div) return;
      var label = labelForOpts(opts);
      var labelEl = this.div.querySelector('.map-price-pin__label');
      if (label && labelEl) {
        labelEl.textContent = label;
        labelEl.style.display = '';
      } else if (labelEl) {
        labelEl.style.display = 'none';
      }
      overlay.draw();
    };

    overlay.setMap(map);
    return overlay;
  }

  function createLotPriceLabelOverlay(map, position, text) {
    if (!map || !text || !global.google) return null;
    var overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {
      var div = document.createElement('div');
      div.className = 'map-lot-price-wrap';
      div.innerHTML = '<span class="map-price-badge map-price-badge--lot">' + esc(text) + '</span>';
      this.div = div;
      var panes = this.getPanes();
      if (panes && panes.floatPane) panes.floatPane.appendChild(div);
    };
    overlay.draw = function () {
      if (!this.div) return;
      var proj = this.getProjection();
      if (!proj) return;
      var latLng = toLatLng(position);
      if (!latLng) return;
      var p = proj.fromLatLngToDivPixel(latLng);
      if (!p) return;
      this.div.style.left = p.x + 'px';
      this.div.style.top = p.y + 'px';
    };
    overlay.onRemove = function () {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    };
    overlay.setMap(map);
    return overlay;
  }

  global.MPHMapMarkers = {
    fmtPrecioCompact: fmtPrecioCompact,
    fmtPrecioM2: fmtPrecioM2,
    pinIcon: pinIcon,
    createPricePinOverlay: createPricePinOverlay,
    createLotPriceLabelOverlay: createLotPriceLabelOverlay,
  };
})(typeof window !== 'undefined' ? window : this);

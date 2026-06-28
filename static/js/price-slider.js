/* Slider dual de precio en filtros de busqueda y mapa. */
(function (global) {
  'use strict';

  function fmtSoles(n) {
    return 'S/ ' + Number(n).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function parseNum(value, fallback) {
    if (value === '' || value == null) return fallback;
    var n = Number(value);
    return isNaN(n) ? fallback : n;
  }

  function initSlider(root) {
    var floor = Number(root.dataset.floor) || 0;
    var ceiling = Number(root.dataset.ceiling) || 1000000;
    var step = Number(root.dataset.step) || 10000;
    var rangeMin = root.querySelector('.price-slider__range--min');
    var rangeMax = root.querySelector('.price-slider__range--max');
    var numMin = root.querySelector('.price-slider__num--min');
    var numMax = root.querySelector('.price-slider__num--max');
    var outMin = root.querySelector('.price-slider__out--min');
    var outMax = root.querySelector('.price-slider__out--max');
    var fill = root.querySelector('.price-slider__fill');
    if (!rangeMin || !rangeMax || !numMin || !numMax) return;

    var minVal = clamp(parseNum(root.dataset.min, floor), floor, ceiling);
    var maxVal = clamp(parseNum(root.dataset.max, ceiling), floor, ceiling);
    if (minVal > maxVal) minVal = maxVal;

    function syncFill() {
      var lo = Number(rangeMin.value);
      var hi = Number(rangeMax.value);
      var span = ceiling - floor || 1;
      var left = ((lo - floor) / span) * 100;
      var width = ((hi - lo) / span) * 100;
      if (fill) {
        fill.style.left = left + '%';
        fill.style.width = width + '%';
      }
      if (outMin) outMin.textContent = fmtSoles(lo);
      if (outMax) outMax.textContent = fmtSoles(hi);
      numMin.value = lo <= floor ? '' : lo;
      numMax.value = hi >= ceiling ? '' : hi;
    }

    function setFromRanges() {
      var lo = Number(rangeMin.value);
      var hi = Number(rangeMax.value);
      if (lo > hi) {
        if (global.event && global.event.target === rangeMin) {
          lo = hi;
          rangeMin.value = lo;
        } else {
          hi = lo;
          rangeMax.value = hi;
        }
      }
      syncFill();
    }

    function setFromNumbers(changed) {
      var lo = parseNum(numMin.value, floor);
      var hi = parseNum(numMax.value, ceiling);
      if (numMin.value === '') lo = floor;
      if (numMax.value === '') hi = ceiling;
      lo = clamp(Math.round(lo / step) * step, floor, ceiling);
      hi = clamp(Math.round(hi / step) * step, floor, ceiling);
      if (lo > hi) {
        if (changed === 'min') hi = lo;
        else lo = hi;
      }
      rangeMin.value = lo;
      rangeMax.value = hi;
      syncFill();
    }

    rangeMin.addEventListener('input', setFromRanges);
    rangeMax.addEventListener('input', setFromRanges);
    numMin.addEventListener('change', function () { setFromNumbers('min'); });
    numMax.addEventListener('change', function () { setFromNumbers('max'); });

    var form = root.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        var lo = Number(rangeMin.value);
        var hi = Number(rangeMax.value);
        if (lo <= floor) numMin.removeAttribute('name');
        else numMin.name = 'precio_min';
        if (hi >= ceiling) numMax.removeAttribute('name');
        else numMax.name = 'precio_max';
      });
    }

    rangeMin.value = minVal;
    rangeMax.value = maxVal;
    syncFill();
  }

  function initAll() {
    document.querySelectorAll('.price-slider').forEach(initSlider);
  }

  global.MPHPriceSlider = { initAll: initAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})(typeof window !== 'undefined' ? window : this);

/* Autocompletado — desplegable por regiones, sin taparse en el hero. */
(function () {
  'use strict';

  var debounceMs = 200;
  var openLists = [];

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function labelFor(item) {
    if (item.tipo === 'ciudad') {
      var n = item.total != null ? ' (' + item.total + ' prop.)' : '';
      return item.texto + n;
    }
    if (item.tipo === 'distrito') {
      return item.texto + (item.ciudad ? ' · ' + item.ciudad : '');
    }
    if (item.tipo === 'direccion') return item.texto;
    if (item.tipo === 'propiedad') {
      return item.texto + (item.ciudad ? ' · ' + item.ciudad : '');
    }
    return item.texto;
  }

  function tipoLabel(tipo) {
    if (tipo === 'ciudad') return 'Ciudad';
    if (tipo === 'distrito') return 'Distrito';
    if (tipo === 'direccion') return 'Direccion';
    if (tipo === 'propiedad') return 'Propiedad';
    return '';
  }

  function setCiudadId(form, ciudadId) {
    var hidden = form.querySelector('input[name="ciudad_id"]');
    if (ciudadId) {
      if (!hidden) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'ciudad_id';
        form.appendChild(hidden);
      }
      hidden.value = String(ciudadId);
    } else if (hidden) {
      hidden.remove();
    }
  }

  function applyItem(input, item) {
    if (item.tipo === 'propiedad' && item.propiedad_id) {
      window.location.href = '/propiedad/' + item.propiedad_id;
      return;
    }
    input.value = item.q || item.texto || '';
    var form = input.closest('form');
    if (!form) return;
    if (item.ciudad_id) {
      setCiudadId(form, item.ciudad_id);
    } else {
      setCiudadId(form, null);
    }
    form.submit();
  }

  function positionList(input, list) {
    var r = input.getBoundingClientRect();
    list.style.position = 'fixed';
    list.style.left = Math.round(r.left) + 'px';
    list.style.top = Math.round(r.bottom + 6) + 'px';
    list.style.width = Math.round(r.width) + 'px';
    list.style.zIndex = '10080';
    list.style.maxHeight = Math.min(360, window.innerHeight - r.bottom - 16) + 'px';
  }

  function attach(input) {
    if (!input || input.dataset.acInit === '1') return;
    input.dataset.acInit = '1';
    var apiUrl = input.getAttribute('data-autocomplete-url') || '/api/autocomplete';
    var wrap = document.createElement('div');
    wrap.className = 'mph-ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var list = document.createElement('ul');
    list.className = 'mph-ac-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    document.body.appendChild(list);
    openLists.push({ input: input, list: list, wrap: wrap });

    function hideList() {
      list.hidden = true;
      list.innerHTML = '';
      list.classList.remove('is-open');
    }

    function renderGrupos(grupos) {
      list.innerHTML = '';
      if (!grupos || !grupos.length) {
        hideList();
        return;
      }
      grupos.forEach(function (grupo) {
        if (!grupo.items || !grupo.items.length) return;
        var head = document.createElement('li');
        head.className = 'mph-ac-group__title';
        head.textContent = grupo.region || 'Peru';
        head.setAttribute('aria-hidden', 'true');
        list.appendChild(head);

        grupo.items.forEach(function (item) {
          var li = document.createElement('li');
          li.className = 'mph-ac-item mph-ac-item--' + (item.tipo || 'texto');
          li.setAttribute('role', 'option');
          var main = document.createElement('span');
          main.className = 'mph-ac-item__main';
          main.textContent = labelFor(item);
          li.appendChild(main);
          var tag = document.createElement('span');
          tag.className = 'mph-ac-item__tag';
          tag.textContent = tipoLabel(item.tipo);
          li.appendChild(tag);
          li.addEventListener('mousedown', function (e) {
            e.preventDefault();
            applyItem(input, item);
          });
          list.appendChild(li);
        });
      });
      positionList(input, list);
      list.hidden = false;
      list.classList.add('is-open');
    }

    var fetchSuggestions = debounce(function () {
      var q = (input.value || '').trim();
      var url = apiUrl + '?limit=20';
      if (q) url += '&q=' + encodeURIComponent(q);
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.grupos && data.grupos.length) {
            renderGrupos(data.grupos);
          } else if (data.items && data.items.length) {
            renderGrupos([{ region: 'Resultados', items: data.items }]);
          } else {
            hideList();
          }
        })
        .catch(hideList);
    }, debounceMs);

    input.addEventListener('input', fetchSuggestions);
    input.addEventListener('focus', fetchSuggestions);
    input.addEventListener('blur', function () {
      setTimeout(hideList, 180);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideList();
    });

    window.addEventListener('scroll', function () {
      if (!list.hidden) positionList(input, list);
    }, true);
    window.addEventListener('resize', function () {
      if (!list.hidden) positionList(input, list);
    });
  }

  document.querySelectorAll('.mph-autocomplete, [data-autocomplete-url]').forEach(attach);
})();

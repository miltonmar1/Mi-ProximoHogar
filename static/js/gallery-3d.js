/* =========================================================================
   Galeria 3D de fotos inmobiliarias - Mi Proximo Hogar
   - Carousel cilindrico de planos texturados
   - Frame de neon + halo aditivo
   - Auto-rotacion + arrastre + parallax + hover zoom
   - Click sobre una foto navega al listado filtrado por tipo
   - Tooltip HTML al pasar el cursor con label + tipo + cta
   - Fotos royalty-free de Unsplash; reemplazables editando PHOTOS
   ========================================================================= */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.THREE) return;

  var canvas = document.getElementById('gallery-3d');
  if (!canvas) return;

  var tooltip = document.getElementById('gallery3dTooltip');
  var wrap = canvas.parentElement;

  // PHOTOS: cada item lleva label, tipo y link al listado correspondiente.
  // Reemplaza por tus propias URLs (con licencia) y links cuando lo necesites.
  var PHOTOS = [
    { url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=900&q=80',
      label: 'Edificio residencial moderno', tipo: 'Departamento', link: '/propiedades?tipo=departamento' },
    { url: 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=900&q=80',
      label: 'Casa con piscina',             tipo: 'Casa',         link: '/propiedades?tipo=casa' },
    { url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=900&q=80',
      label: 'Residencial premium',          tipo: 'Departamento', link: '/propiedades?tipo=departamento' },
    { url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=900&q=80',
      label: 'Casa con jardin',              tipo: 'Casa',         link: '/propiedades?tipo=casa' },
    { url: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=900&q=80',
      label: 'Loft contemporaneo',           tipo: 'Departamento', link: '/propiedades?tipo=departamento' },
    { url: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=900&q=80',
      label: 'Departamento de lujo',         tipo: 'Departamento', link: '/propiedades?tipo=departamento' },
    { url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80',
      label: 'Casa moderna',                 tipo: 'Casa',         link: '/propiedades?tipo=casa' },
    { url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=900&q=80',
      label: 'Torre residencial',            tipo: 'Departamento', link: '/propiedades?tipo=departamento' },
  ];

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 1.4, 10.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xfff0d0, 0.9));
  var dl = new THREE.DirectionalLight(0xffe1a3, 0.65);
  dl.position.set(0, 5, 6);
  scene.add(dl);

  var loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  function placeholderTexture() {
    var c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    var ctx = c.getContext('2d');
    var grd = ctx.createLinearGradient(0, 0, 8, 8);
    grd.addColorStop(0, '#1a0a26');
    grd.addColorStop(1, '#331340');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 8, 8);
    return new THREE.CanvasTexture(c);
  }

  function buildPhotoCard(photo, index) {
    var group = new THREE.Group();

    var W = 2.6, H = 1.7;
    var frameColors = [0xff7a1a, 0xff2d8a, 0xffd57a, 0xff4d00, 0xffb347, 0xff5566];
    var frameColor = frameColors[index % frameColors.length];

    var halo = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.12, H + 0.12),
      new THREE.MeshBasicMaterial({
        color: frameColor, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    halo.position.z = -0.06;
    group.add(halo);

    var frame = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.028, H + 0.028),
      new THREE.MeshBasicMaterial({ color: frameColor, transparent: true, opacity: 0.75 })
    );
    frame.position.z = -0.02;
    group.add(frame);

    var photoMat = new THREE.MeshBasicMaterial({
      map: placeholderTexture(), transparent: true, opacity: 1,
    });
    var photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), photoMat);
    photoMesh.userData._cardIndex = index;
    group.add(photoMesh);

    loader.load(
      photo.url,
      function (tex) {
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        tex.minFilter = THREE.LinearFilter;
        photoMat.map = tex;
        photoMat.needsUpdate = true;
      }
    );

    group.userData = { _cardIndex: index, photo: photo };
    return { group: group, photoMat: photoMat, frame: frame, halo: halo, photoMesh: photoMesh };
  }

  var cards = [];
  var radius = 5.0;
  PHOTOS.forEach(function (p, i) {
    var built = buildPhotoCard(p, i);
    var angle = (i / PHOTOS.length) * Math.PI * 2;
    cards.push({
      group: built.group,
      photoMat: built.photoMat,
      frame: built.frame,
      halo: built.halo,
      photoMesh: built.photoMesh,
      photo: p,
      angle: angle,
      hover: 0,
    });
    scene.add(built.group);
  });

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width);
    var h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  var hoverIdx = -1;
  var mx = 0, my = 0, tx = 0, ty = 0;
  var dragging = false, dragLastX = 0, manualRot = 0, dragMoved = 0;

  function setPointer(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    tx = pointer.x;
    ty = pointer.y;
  }

  function findCardIndex(object) {
    var node = object;
    while (node) {
      if (node.userData && typeof node.userData._cardIndex === 'number') {
        return node.userData._cardIndex;
      }
      node = node.parent;
    }
    return -1;
  }

  function updateTooltip(idx) {
    if (!tooltip) return;
    if (idx < 0) {
      tooltip.innerHTML = '';
      tooltip.classList.remove('is-visible');
      return;
    }
    var card = cards[idx];
    tooltip.innerHTML =
      '<strong>' + card.photo.label + '</strong>' +
      '<span>' + card.photo.tipo + '</span>' +
      '<em>Click para ver propiedades &rarr;</em>';
    tooltip.classList.add('is-visible');
  }

  canvas.addEventListener('mousemove', function (e) {
    setPointer(e);

    if (dragging) {
      var dx = e.clientX - dragLastX;
      manualRot += dx * 0.005;
      dragLastX = e.clientX;
      dragMoved += Math.abs(dx);
      tooltip && tooltip.classList.remove('is-visible');
      canvas.style.cursor = 'grabbing';
      hoverIdx = -1;
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    var meshes = cards.map(function (c) { return c.photoMesh; });
    var hits = raycaster.intersectObjects(meshes, false);
    var idx = hits.length > 0 ? findCardIndex(hits[0].object) : -1;
    hoverIdx = idx;
    canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    updateTooltip(idx);
  });

  canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    dragLastX = e.clientX;
    dragMoved = 0;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mouseup', function () {
    dragging = false;
    canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('mouseleave', function () {
    hoverIdx = -1; tx = 0; ty = 0;
    updateTooltip(-1);
  });

  // Click: si no fue un drag y hay una foto debajo del cursor, navega
  canvas.addEventListener('click', function (e) {
    if (dragMoved > 5) return; // estaba arrastrando, no es click real
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    var meshes = cards.map(function (c) { return c.photoMesh; });
    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      var idx = findCardIndex(hits[0].object);
      if (idx >= 0 && cards[idx].photo.link) {
        window.location.href = cards[idx].photo.link;
      }
    }
  });

  // Soporte touch basico
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length > 0) {
      dragging = true;
      dragLastX = e.touches[0].clientX;
      dragMoved = 0;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    if (dragging && e.touches.length > 0) {
      var dx = e.touches[0].clientX - dragLastX;
      manualRot += dx * 0.005;
      dragLastX = e.touches[0].clientX;
      dragMoved += Math.abs(dx);
    }
  }, { passive: true });
  canvas.addEventListener('touchend', function () { dragging = false; });

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var visible = true;
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; });

  var globalRot = 0;
  var t0 = performance.now();
  function tick(now) {
    if (!visible) { requestAnimationFrame(tick); return; }
    var dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;

    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;

    var autoSpeed = reduceMotion ? 0 : 0.10;
    if (hoverIdx >= 0) autoSpeed = 0.015;
    if (dragging) autoSpeed = 0;
    globalRot += dt * autoSpeed;

    cards.forEach(function (c, i) {
      var a = c.angle + globalRot + manualRot;
      var x = Math.cos(a) * radius;
      var z = Math.sin(a) * radius;
      var y = Math.sin(now * 0.0008 + i * 0.6) * 0.2;

      c.group.position.set(x, y, z);
      // Orientacion limpia: el frente (+Z local) apunta hacia AFUERA del cilindro.
      // Sin lookAt + flip 180 -> evita el espejo horizontal de la textura.
      c.group.rotation.set(0, Math.atan2(x, z), Math.sin(now * 0.0009 + i) * 0.025);

      // Hover: zoom suave y halo mas brillante
      var targetHover = (hoverIdx === i) ? 1 : 0;
      c.hover += (targetHover - c.hover) * 0.12;
      var s = 1 + c.hover * 0.22;
      c.group.scale.set(s, s, s);

      // Fade: cards detras del cilindro se atenuan progresivamente
      var vis = (z + radius * 0.55) / (radius * 1.55);
      vis = Math.max(0.12, Math.min(1, vis));
      c.photoMat.opacity = vis;
      c.frame.material.opacity = 0.75 * vis;
      c.halo.material.opacity = (0.08 + c.hover * 0.2) * vis;
    });

    camera.position.x = mx * 0.7;
    camera.position.y = 1.4 - my * 0.4;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

/* =========================================================================
   Escena 3D del hero - Mi Proximo Hogar
   - Edificio moderno con "cuartos" que aparecen por dentro
   - Rotación controlada por mouse (más sensible)
   - Compatible con three.js cargado por CDN
   ========================================================================= */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.THREE) return;

  var canvas = document.getElementById('hero-3d');
  if (!canvas) return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 2.5, 13);
  camera.lookAt(0, 0, 0);

  // ---------- Luces ----------
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  var key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(6, 9, 6);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0xffb380, 0.55);
  rim.position.set(-6, 3, -5);
  scene.add(rim);
  var fill = new THREE.DirectionalLight(0xfff2e6, 0.6);
  fill.position.set(0, -3, 4);
  scene.add(fill);

  // Si existe un modelo exacto (.glb), lo cargamos aquí (esto permite 100% igual).
  // Coloca tu archivo en: static/models/edificio.glb
  var modelRoot = null;
  var hasExternalModel = false;
  if (THREE.GLTFLoader) {
    try {
      var loader = new THREE.GLTFLoader();
      loader.load(
        '/static/models/edificio.glb',
        function (gltf) {
          hasExternalModel = true;
          modelRoot = gltf.scene;
          modelRoot.traverse(function (obj) {
            if (obj && obj.isMesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });
          // Ajustes iniciales (escala/posición) — se puede afinar luego.
          modelRoot.scale.set(1.25, 1.25, 1.25);
          modelRoot.position.set(0, -1.9, 0);
          scene.add(modelRoot);
        },
        undefined,
        function () {
          // Si no existe el archivo, seguimos con el modelo procedural.
          hasExternalModel = false;
        }
      );
    } catch (e) {
      // no-op
    }
  }

  // ---------- Edificio moderno (piezas separables, estilo referencia) ----------
  function matStandard(hex, rough, metal) {
    return new THREE.MeshStandardMaterial({
      color: hex,
      roughness: typeof rough === 'number' ? rough : 0.7,
      metalness: typeof metal === 'number' ? metal : 0.0,
    });
  }

  var buildingGroup = new THREE.Group();
  scene.add(buildingGroup);

  var parts = [];
  function addPart(mesh, basePos, explodeDir, explodeDist, baseRot) {
    mesh.position.copy(basePos);
    if (baseRot) mesh.rotation.set(baseRot.x || 0, baseRot.y || 0, baseRot.z || 0);
    buildingGroup.add(mesh);
    parts.push({
      mesh: mesh,
      basePos: basePos.clone(),
      baseRot: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      explodeDir: explodeDir.clone().normalize(),
      explodeDist: explodeDist,
      rotJitter: new THREE.Vector3(
        (Math.random() * 2 - 1) * 0.25,
        (Math.random() * 2 - 1) * 0.35,
        (Math.random() * 2 - 1) * 0.25
      ),
    });
  }

  // Proporciones aproximadas del edificio de referencia (volúmenes + balcones)
  var W = 4.9;   // ancho
  var D = 3.6;   // profundidad
  var floorH = 0.72;
  var slabT = 0.10;
  var floors = 7; // similar a la referencia
  var y0 = -1.85;

  var wallMat = matStandard(0xffffff, 0.95, 0.0);
  var lightMat = matStandard(0xf3f4f6, 0.92, 0.0);
  var brickMat = matStandard(0xc65a3a, 0.85, 0.0);
  var darkMat = matStandard(0x111827, 0.85, 0.2);
  var metalMat = matStandard(0x374151, 0.35, 0.55);
  var glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0.0,
    transmission: 1.0,
    thickness: 0.25,
    transparent: true,
    opacity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.15,
  });

  // Base / primer nivel (comercio o lobby)
  var podium = new THREE.Group();
  var podiumH = floorH * 1.35;
  var podiumBox = new THREE.Mesh(new THREE.BoxGeometry(W * 1.04, podiumH, D * 1.04), lightMat);
  podiumBox.position.set(0, y0 - 0.10, 0);
  podium.add(podiumBox);
  // Ventanas oscuras del lobby
  var lobbyGlass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, podiumH * 0.62, 0.06), darkMat);
  lobbyGlass.position.set(0, y0 - 0.18, D * 0.52);
  podium.add(lobbyGlass);
  addPart(podium, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0), 0.55);

  // Núcleo vertical (elevadores/escalera) con “ladrillo”
  var core = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, (floors * floorH) + podiumH * 0.55, D * 0.55), brickMat);
  addPart(core, new THREE.Vector3(0, y0 + (floors * floorH) / 2, -D * 0.08), new THREE.Vector3(0, 0, -1), 0.95);

  // Funciones auxiliares para pisos
  function makeBalcony(width, depth) {
    var g = new THREE.Group();
    var slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), lightMat);
    g.add(slab);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.34, 0.05), glassMat);
    rail.position.set(0, 0.20, depth / 2 - 0.03);
    g.add(rail);
    var hand = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.05), metalMat);
    hand.position.set(0, 0.38, depth / 2 - 0.03);
    g.add(hand);
    return g;
  }

  function makeWindow(w, h) {
    var g = new THREE.Group();
    var frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), darkMat);
    g.add(frame);
    var pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, h - 0.12, 0.04), glassMat);
    pane.position.z = 0.02;
    g.add(pane);
    return g;
  }

  // Pisos repetidos con balcones alternados (como referencia)
  // Guardamos el centro de cada piso para mostrar "cuartos" por dentro
  var floorCenters = [];
  for (var fi = 0; fi < floors; fi++) {
    var y = y0 + podiumH / 2 + (fi + 0.5) * floorH;
    var floorGroup = new THREE.Group();

    // Cuerpo del piso (blanco)
    var shell = new THREE.Mesh(new THREE.BoxGeometry(W, floorH, D), wallMat);
    floorGroup.add(shell);

    // “Bandas” horizontales (volumen tipo marco)
    var band = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, slabT, D * 1.02), lightMat);
    band.position.y = floorH / 2 + slabT / 2;
    floorGroup.add(band);

    // Ventanas (frente)
    var winA = makeWindow(W * 0.32, floorH * 0.62);
    winA.position.set(-W * 0.28, 0, D / 2 + 0.02);
    floorGroup.add(winA);
    var winB = makeWindow(W * 0.32, floorH * 0.62);
    winB.position.set(W * 0.28, 0, D / 2 + 0.02);
    floorGroup.add(winB);

    // Balcones: alternar izquierda/derecha, y 1 central en algunos niveles
    var balcDepth = D * 0.32;
    if (fi % 2 === 0) {
      var bL = makeBalcony(W * 0.44, balcDepth);
      bL.position.set(-W * 0.30, -floorH * 0.22, D / 2 + balcDepth / 2 + 0.02);
      floorGroup.add(bL);
    } else {
      var bR = makeBalcony(W * 0.44, balcDepth);
      bR.position.set(W * 0.30, -floorH * 0.22, D / 2 + balcDepth / 2 + 0.02);
      floorGroup.add(bR);
    }

    // Acento “ladrillo” en laterales (simula pilares naranjas)
    var pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.22, floorH * 1.02, D * 0.92), brickMat);
    pillarL.position.set(-W / 2 + 0.18, 0, 0);
    floorGroup.add(pillarL);
    var pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.22, floorH * 1.02, D * 0.92), brickMat);
    pillarR.position.set(W / 2 - 0.18, 0, 0);
    floorGroup.add(pillarR);

    // Colocar el piso en el mundo
    addPart(
      floorGroup,
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3((fi % 2 === 0) ? -0.35 : 0.35, 0.15, 1),
      0.95 + fi * 0.18
    );
    floorCenters.push(new THREE.Vector3(0, y, 0));
  }

  // Azotea
  var roofGroup = new THREE.Group();
  var roof = new THREE.Mesh(new THREE.BoxGeometry(W * 1.05, 0.18, D * 1.05), lightMat);
  roofGroup.add(roof);
  var pent = new THREE.Mesh(new THREE.BoxGeometry(W * 0.42, floorH * 0.85, D * 0.42), darkMat);
  pent.position.set(W * 0.18, floorH * 0.50, -D * 0.05);
  roofGroup.add(pent);
  addPart(roofGroup, new THREE.Vector3(0, y0 + podiumH / 2 + floors * floorH + 0.25, 0), new THREE.Vector3(0, 1, 0), 1.25);

  // Ventanas (piezas)
  function buildWindow(w, h) {
    var g = new THREE.Group();
    var frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), matStandard(0x111827, 0.7, 0.2));
    g.add(frame);
    var pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, h - 0.12, 0.04), glassMat);
    pane.position.z = 0.02;
    g.add(pane);
    var mullX = new THREE.Mesh(new THREE.BoxGeometry(0.04, h - 0.14, 0.07), matStandard(0x111827, 0.7, 0.2));
    g.add(mullX);
    var mullY = new THREE.Mesh(new THREE.BoxGeometry(w - 0.14, 0.04, 0.07), matStandard(0x111827, 0.7, 0.2));
    g.add(mullY);
    return g;
  }

  // Detalle frontal (acceso) como pieza pequeña
  var entry = new THREE.Mesh(new THREE.BoxGeometry(W * 0.22, podiumH * 0.40, 0.08), metalMat);
  addPart(entry, new THREE.Vector3(-W * 0.22, y0 - 0.22, D * 0.52), new THREE.Vector3(-0.2, 0.1, 1), 0.9);

  // ---------- "Cuartos" interiores (aparecen por dentro) ----------
  var roomsGroup = new THREE.Group();
  buildingGroup.add(roomsGroup);

  function roomMat(hex) {
    var m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.85,
      metalness: 0.0,
      transparent: true,
      opacity: 0.0,
    });
    return m;
  }

  var roomMats = [
    roomMat(0xffd166), // sala
    roomMat(0x60a5fa), // dormitorio
    roomMat(0x34d399), // cocina/estudio
    roomMat(0xf472b6), // baño/extra
  ];

  var roomMeshes = [];
  function addRoomBox(center, w, h, d, mat) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.copy(center);
    roomsGroup.add(mesh);
    roomMeshes.push(mesh);
    return mesh;
  }

  // Ponemos cuartos en algunos pisos (no todos) para que se vea limpio
  var pick = [1, 2, 4, 5].filter(function (i) { return i >= 0 && i < floorCenters.length; });
  pick.forEach(function (idx, k) {
    var c = floorCenters[idx].clone();
    // Un poco hacia adentro y con variación lateral
    c.z = -0.15;
    c.x = (k % 2 === 0) ? -0.55 : 0.55;
    addRoomBox(c, 1.15, 0.42, 1.25, roomMats[k % roomMats.length]);
  });

  // Partículas suaves (sin "espacio" oscuro)
  var sparkGeo = new THREE.BufferGeometry();
  var sparkCount = 80;
  var sparkPos = new Float32Array(sparkCount * 3);
  for (var sp = 0; sp < sparkCount; sp++) {
    sparkPos[sp * 3] = (Math.random() * 2 - 1) * 4.5;
    sparkPos[sp * 3 + 1] = (Math.random() * 2 - 1) * 2.2;
    sparkPos[sp * 3 + 2] = (Math.random() * 2 - 1) * 4.0;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  var sparks = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({
      color: 0xffb380,
      size: 0.05,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  scene.add(sparks);

  // ---------- Resize ----------
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

  // ---------- Mouse parallax ----------
  var mx = 0, my = 0, tx = 0, ty = 0;
  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ty = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  });
  canvas.addEventListener('mouseleave', function () { tx = 0; ty = 0; });

  // ---------- Loop ----------
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t0 = performance.now();
  var visible = true;
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; });

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function easeInOutCubic(x) {
    x = clamp01(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function tick(now) {
    if (!visible) { requestAnimationFrame(tick); return; }
    var dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;

    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;

    if (!reduceMotion) {
      // Mantener todo ensamblado (sin desarme)
      parts.forEach(function (pt) {
        pt.mesh.position.copy(pt.basePos);
        pt.mesh.rotation.set(pt.baseRot.x, pt.baseRot.y, pt.baseRot.z);
      });

      // Rotación con mouse (más fuerte)
      var targetRy = mx * 1.25;
      var targetRx = -my * 0.35;
      if (hasExternalModel && modelRoot) {
        modelRoot.rotation.y += (targetRy - modelRoot.rotation.y) * 0.14;
        modelRoot.rotation.x += (targetRx - modelRoot.rotation.x) * 0.12;
        modelRoot.position.y = -1.9 + Math.sin(now * 0.0006) * 0.03;
      } else {
        buildingGroup.rotation.y += (targetRy - buildingGroup.rotation.y) * 0.12;
        buildingGroup.rotation.x += (targetRx - buildingGroup.rotation.x) * 0.10;
        buildingGroup.position.y = Math.sin(now * 0.0006) * 0.03;
      }

      // "Cuartos" aparecen por dentro (secuencial en loop)
      var cycle = 7.0;
      var t = (now * 0.001) % cycle;
      var step = cycle / Math.max(1, roomMats.length);
      roomMats.forEach(function (m, i) {
        var start = i * step;
        var local = (t - start) / step; // ~0..1
        var vis = easeInOutCubic(clamp01(local));
        // se apaga antes de terminar la ventana para que pase al siguiente
        vis *= (1 - easeInOutCubic(clamp01((local - 0.75) / 0.25)));
        m.opacity = 0.78 * vis;
      });

      // Partículas (muy suaves)
      sparks.rotation.y += dt * 0.04;
    }

    // Cámara más estable; el giro lo hace el modelo
    camera.position.x = 0;
    camera.position.y = 2.5;
    camera.lookAt(0, 0.6, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

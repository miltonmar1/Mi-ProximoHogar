/* =========================================================================
   Fondo 3D animado para Mi Proximo Hogar
   - Particulas / "estrellas" naranjas
   - Nube de poligonos abstractos flotando
   - Compatible con three r158 (cargado via CDN)
   - Degrada elegantemente si WebGL no esta disponible
   ========================================================================= */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (!window.THREE) return;

  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  // Respetar preferencia de movimiento reducido
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    });
  } catch (e) {
    return; // sin WebGL: dejar solo CSS de fondo
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf5f6f8, 0.0012);

  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 120);

  // -------- Particulas tipo "starfield" naranja --------
  var particleCount = window.innerWidth < 760 ? 900 : 1800;
  var pGeo = new THREE.BufferGeometry();
  var positions = new Float32Array(particleCount * 3);
  var colors = new Float32Array(particleCount * 3);
  var sizes = new Float32Array(particleCount);

  var colorA = new THREE.Color(0xff7a1a);
  var colorB = new THREE.Color(0xff8534);
  var colorC = new THREE.Color(0xffb347);

  for (var i = 0; i < particleCount; i++) {
    var i3 = i * 3;
    var radius = 30 + Math.random() * 180;
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos(2 * Math.random() - 1);
    positions[i3]     = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.55;
    positions[i3 + 2] = radius * Math.cos(phi) - 50;

    var t = Math.random();
    var c = t < 0.4 ? colorA : (t < 0.75 ? colorC : colorB);
    colors[i3]     = c.r;
    colors[i3 + 1] = c.g;
    colors[i3 + 2] = c.b;

    sizes[i] = 0.6 + Math.random() * 2.4;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  pGeo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

  var pMat = new THREE.PointsMaterial({
    size: 1.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  var particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  // -------- Poligonos "casa" flotantes (low-poly) --------
  var shapes = new THREE.Group();
  var shapeCount = window.innerWidth < 760 ? 6 : 12;
  var housesData = [];

  function makeHouseGeometry() {
    // Compuesto sencillo: cubo + piramide
    var geos = [];
    var base = new THREE.BoxGeometry(2, 1.6, 2);
    geos.push(base);
    var roof = new THREE.ConeGeometry(1.6, 1.2, 4);
    roof.translate(0, 1.4, 0);
    roof.rotateY(Math.PI / 4);
    geos.push(roof);
    return mergeBufferGeometries(geos);
  }

  // Implementacion local de merge para evitar dependencia de BufferGeometryUtils
  function mergeBufferGeometries(geos) {
    var totalVerts = 0;
    for (var i = 0; i < geos.length; i++) {
      var attr = geos[i].attributes.position;
      totalVerts += attr.count;
    }
    var merged = new Float32Array(totalVerts * 3);
    var offset = 0;
    for (var j = 0; j < geos.length; j++) {
      var pos = geos[j].attributes.position.array;
      merged.set(pos, offset);
      offset += pos.length;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    out.computeVertexNormals();
    return out;
  }

  var sharedGeo = makeHouseGeometry();

  for (var k = 0; k < shapeCount; k++) {
    var mat = new THREE.MeshBasicMaterial({
      color: k % 3 === 0 ? 0xff8534 : (k % 3 === 1 ? 0xff7a1a : 0xffb347),
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    var mesh = new THREE.Mesh(sharedGeo, mat);
    var spread = 90;
    mesh.position.set(
      (Math.random() - 0.5) * spread * 2,
      (Math.random() - 0.5) * spread,
      -20 - Math.random() * 120
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    var s = 0.8 + Math.random() * 1.8;
    mesh.scale.setScalar(s);
    shapes.add(mesh);
    housesData.push({
      mesh: mesh,
      rotSpeed: (Math.random() - 0.5) * 0.004,
      floatSpeed: 0.2 + Math.random() * 0.5,
      floatOffset: Math.random() * Math.PI * 2,
      baseY: mesh.position.y,
    });
  }
  scene.add(shapes);

  // -------- Interaccion: parallax con mouse --------
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('mousemove', function (e) {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // Resize
  function onResize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);

  // Pausar cuando la pestana no es visible
  var visible = true;
  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
  });

  // Loop
  var t0 = performance.now();
  function tick(now) {
    var dt = (now - t0) / 1000;
    t0 = now;

    if (!visible) {
      requestAnimationFrame(tick);
      return;
    }

    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;

    if (!reduceMotion) {
      particles.rotation.y += dt * 0.025;
      particles.rotation.x += dt * 0.008;

      for (var i = 0; i < housesData.length; i++) {
        var h = housesData[i];
        h.mesh.rotation.x += h.rotSpeed;
        h.mesh.rotation.y += h.rotSpeed * 0.8;
        h.mesh.position.y = h.baseY + Math.sin(now * 0.0005 * h.floatSpeed + h.floatOffset) * 2.5;
      }
    }

    camera.position.x += (mouse.x * 8 - camera.position.x) * 0.04;
    camera.position.y += (-mouse.y * 5 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

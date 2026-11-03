import * as THREE from 'three';

// ============================================================================
// Config & scratch
// ============================================================================
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const CONFIG = {
  moveSpeed: 5.0,
  runSpeed: 9.0,
  snapAngle: THREE.MathUtils.degToRad(30),
  snapCooldown: 0.35,
  interactDistance: 6.0,
  carDriveSpeed: 20.0,
  carTurnSpeed: 110.0,
  worldRadius: 400,
  tornadoCount: 6,
  carCount: 4,
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _local = new THREE.Vector3();

// ============================================================================
// DOM
// ============================================================================
const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const enterVrBtn = document.getElementById('enterVr');
const desktopBtn = document.getElementById('desktop');
const note = document.getElementById('note');
const loading = document.getElementById('loading');
const crosshair = document.getElementById('crosshair');

// ============================================================================
// Audio (synthesised, no assets)
// ============================================================================
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
  }
  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  get ok() { return !!this.ctx; }
  tone(opts = {}) {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.15;
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq || 440, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    const gain = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain || 0.2);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  noise(opts = {}) {
    if (!this.ok) return;
    const ctx = this.ctx;
    if (!this.noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    const t0 = ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq || 900;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain || 0.2);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }
  windGust() { this.noise({ dur: 0.5, gain: 0.12, freq: 350 }); }
  enterCar() { this.tone({ type: 'square', freq: 300, to: 600, dur: 0.12, gain: 0.15 }); }
  exitCar() { this.tone({ type: 'square', freq: 600, to: 250, dur: 0.12, gain: 0.15 }); }
}
const sfx = new Sfx();

// ============================================================================
// Renderer, scene, camera, lights
// ============================================================================
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  loading.innerHTML = '<span>WebGL is unavailable in this browser.</span>';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2233);
scene.fog = new THREE.FogExp2(0x1a2233, 0.0015);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
camera.position.set(0, 1.6, 0);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = new THREE.Group();
scene.add(world);

const sky = new THREE.Group();
scene.add(sky);

scene.add(new THREE.HemisphereLight(0x6b7c99, 0x161b29, 1.0));

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(50, 80, 30);
scene.add(sun);

// ============================================================================
// Tornado types
// ============================================================================
const TornadoType = { WEDGE: 'wedge', MULTI: 'multi', ROPE: 'rope', CONE: 'cone' };
const TYPE_PRESETS = {
  [TornadoType.WEDGE]:   { radius: 30, height: 160, baseMph: 85, maxMph: 210, moveSpeed: 5, color: 0x7a828a, segments: 28, rings: 20 },
  [TornadoType.MULTI]:   { radius: 16, height: 120, baseMph: 95, maxMph: 260, moveSpeed: 9, color: 0x6b7580, segments: 20, rings: 16, subCount: 5 },
  [TornadoType.ROPE]:    { radius: 5,  height: 100, baseMph: 65, maxMph: 150, moveSpeed: 14, color: 0x9a8a7a, segments: 16, rings: 14 },
  [TornadoType.CONE]:    { radius: 14, height: 130, baseMph: 80, maxMph: 185, moveSpeed: 7, color: 0xb8c0cc, segments: 24, rings: 18 },
};

// ============================================================================
// WindManager — central wind system
// ============================================================================
class WindManager {
  constructor() { this.tornadoes = []; }
  register(t) { if (!this.tornadoes.includes(t)) this.tornadoes.push(t); }
  unregister(t) { const i = this.tornadoes.indexOf(t); if (i >= 0) this.tornadoes.splice(i, 1); }

  // Returns combined wind vector at point, and closest tornado + distance.
  getWindAt(point) {
    let closest = null;
    let closestDist = Infinity;
    let total = new THREE.Vector3();

    for (const t of this.tornadoes) {
      if (!t.active) continue;
      _v1.subVectors(point, t.position);
      _v1.y = 0;
      const dist = _v1.length();
      if (dist < closestDist) { closestDist = dist; closest = t; }

      if (dist <= t.radius && dist > 0.05) {
        const tangent = new THREE.Vector3(-_v1.z, 0, _v1.x).normalize();
        const strength = 1 - dist / t.radius;
        const swirl = t.baseMph * strength * 0.035;
        total.addScaledVector(tangent, swirl);
        total.addScaledVector(_v1.clone().normalize(), -strength * t.baseMph * 0.018); // inflow
        total.y += strength * t.baseMph * 0.012; // updraft
      }
    }
    return { vector: total, closest, dist: closestDist };
  }

  // Wind speed in MPH at point (based on closest tornado).
  getWindSpeedMph(point) {
    const { vector, closest, dist } = this.getWindAt(point);
    if (!closest) return 0;
    if (dist < closest.radius) {
      const s = 1 - dist / closest.radius;
      return THREE.MathUtils.lerp(closest.baseMph * 0.2, closest.maxMph, s * s);
    }
    return closest.baseMph * 0.15;
  }
}

const wind = new WindManager();

// ============================================================================
// Tornado class
// ============================================================================
class Tornado {
  constructor(type) {
    this.type = type;
    const p = TYPE_PRESETS[type];
    this.radius = p.radius;
    this.height = p.height;
    this.baseMph = p.baseMph;
    this.maxMph = p.maxMph;
    this.moveSpeed = p.moveSpeed;
    this.color = p.color;
    this.segments = p.segments;
    this.rings = p.rings;
    this.subCount = p.subCount || 0;
    this.active = true;

    this.group = new THREE.Group();
    world.add(this.group);

    this.position = this.group.position;
    this.spin = 0;
    this.wander = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0,
      (Math.random() - 0.5) * 2
    ).normalize();
    this.wanderTimer = 0;
    this.subTornadoes = [];

    this.buildFunnel();
    this.buildDust();
    this.spawnSubTornadoes();

    wind.register(this);
  }

  buildFunnel() {
    const count = this.segments * this.rings;
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, count);

    const mat = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });

    this.line = new THREE.Line(geo, mat);
    this.line.frustumCulled = false;
    this.group.add(this.line);
    this.positions = positions;
  }

  buildDust() {
    const count = 120;
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: this.color,
      size: 1.2,
      transparent: true,
      opacity: 0.45,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this.dustPositions = positions;
    this.dustOffsets = [];
    for (let i = 0; i < count; i++) {
      this.dustOffsets.push({
        angle: Math.random() * TAU,
        radius: Math.random() * this.radius,
        height: Math.random() * this.height,
        speed: 0.5 + Math.random() * 1.5,
        rise: 0.2 + Math.random() * 0.8,
      });
    }
  }

  spawnSubTornadoes() {
    if (this.type !== TornadoType.MULTI) return;
    for (let i = 0; i < this.subCount; i++) {
      const a = (i / this.subCount) * TAU;
      const r = 4 + Math.random() * 3;
      const sub = new THREE.Group();
      sub.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.group.add(sub);

      const geo = new THREE.CylinderGeometry(0.6, 1.4, 60, 10, 1, true);
      geo.translate(0, 30, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4a525a, transparent: true, opacity: 0.5, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      sub.add(mesh);

      this.subTornadoes.push({ group: sub, mesh, angle: a, radius: r, speed: 0.02 + Math.random() * 0.02 });
    }
  }

  place(x, z) {
    this.group.position.set(x, 0, z);
  }

  update(dt, now) {
    // Movement
    this.wanderTimer += dt;
    if (this.wanderTimer > 2.5) {
      this.wanderTimer = 0;
      this.wander.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize();
    }
    _v1.copy(this.wander).multiplyScalar(this.moveSpeed * dt);
    this.group.position.add(_v1);
    this.group.position.x = Math.max(-CONFIG.worldRadius, Math.min(CONFIG.worldRadius, this.group.position.x));
    this.group.position.z = Math.max(-CONFIG.worldRadius, Math.min(CONFIG.worldRadius, this.group.position.z));

    // Spin
    this.spin += dt * 60;
    this.group.rotation.y = this.spin;

    // Sub tornadoes orbit
    for (const sub of this.subTornadoes) {
      sub.angle += sub.speed * dt;
      sub.group.position.x = Math.cos(sub.angle) * sub.radius;
      sub.group.position.z = Math.sin(sub.angle) * sub.radius;
      sub.group.rotation.y += dt * 40;
      sub.group.position.y = Math.sin(now * 0.003 + sub.angle) * 4;
    }

    this.updateFunnel(now);
    this.updateDust(now);
  }

  updateFunnel(now) {
    const { positions, segments, rings, radius, height } = this;
    let idx = 0;
    const lean = Math.sin(now * 0.002) * radius * 0.12;
    for (let r = 0; r < rings; r++) {
      const y = (r / Math.max(1, rings - 1)) * height;
      const profile = 1 - (y / height) * 0.5;
      const rad = radius * profile;
      const leanX = lean * (1 - y / height);
      for (let s = 0; s < segments; s++) {
        const ang = (s / segments) * TAU + now * 0.0015 + y * 0.04;
        positions[idx++] = Math.cos(ang) * rad + leanX;
        positions[idx++] = y;
        positions[idx++] = Math.sin(ang) * rad;
      }
    }
    positions = null; // BufferAttribute already bound
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  updateDust(now) {
    const { positions: pos, dustPositions } = this;
    for (let i = 0; i < this.dustOffsets.length; i++) {
      const o = this.dustOffsets[i];
      o.angle += o.speed * dtGlobal;
      const y = (o.height + now * 0.001 * o.rise) % this.height;
      const x = Math.cos(o.angle) * o.radius;
      const z = Math.sin(o.angle) * o.radius;
      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = z;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    wind.unregister(this);
    world.remove(this.group);
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    for (const sub of this.subTornadoes) {
      sub.group.remove(sub.mesh);
      sub.mesh.geometry.dispose();
      sub.mesh.material.dispose();
      this.group.remove(sub.group);
    }
  }
}

// ============================================================================
// Car class
// ============================================================================
class Car {
  constructor(index) {
    this.index = index;
    this.group = new THREE.Group();
    world.add(this.group);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, metalness: 0.3, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x8aa0b8, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.65 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.6 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 3.0), bodyMat);
    body.position.y = 0.55;
    this.group.add(body);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 1.25), bodyMat);
    cabin.position.set(0, 1.25, 0.2);
    this.group.add(cabin);

    // Windows
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.1), glassMat);
    win.position.set(0, 1.25, 0.2);
    this.group.add(win);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.55, 16);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelPos = [
      [-0.95, 0.4, -1.15], [0.95, 0.4, -1.15],
      [-0.95, 0.4, 1.15], [0.95, 0.4, 1.15],
    ];
    for (const p of wheelPos) {
      const w = new THREE.Mesh(wheelGeo, blackMat);
      w.position.set(...p);
      this.group.add(w);
    }

    // Driver seat marker (invisible)
    this.seat = new THREE.Object3D();
    this.seat.position.set(0, 0.95, 0.65);
    this.seat.rotation.y = 0;
    this.group.add(this.seat);

    // Dashboard computer mount
    this.compMount = new THREE.Object3D();
    this.compMount.position.set(0.42, 1.05, 0.62);
    this.compMount.rotation.y = Math.PI;
    this.group.add(this.compMount);

    this.occupied = false;
    this.driver = null;
    this.throttle = 0;
    this.steer = 0;
  }

  setInput(t, s) { this.throttle = t; this.steer = s; }

  enter(driverObj) {
    if (this.occupied) return false;
    this.occupied = true;
    this.driver = driverObj;
    sfx.enterCar();
    return true;
  }

  exit() {
    if (!this.occupied) return;
    this.occupied = false;
    const p = this.group.localToWorld(_v1.set(0, 1.2, -2.3));
    if (this.driver) {
      this.driver.position.copy(p);
      this.driver.rotation.copy(this.group.rotation);
      this.driver.rotation.x = 0;
      this.driver.rotation.z = 0;
    }
    this.driver = null;
    sfx.exitCar();
  }

  update(dt) {
    if (!this.occupied) {
      // Wind pushes unoccupied cars slightly
      const w = wind.getWindAt(this.group.position);
      if (w.closest && w.dist < w.closest.radius) {
        const push = _v1.copy(w.vector).multiplyScalar(dt * 0.5);
        this.group.position.add(push);
      }
      return;
    }

    // Driving
    const speed = this.throttle * CONFIG.carDriveSpeed;
    _v1.set(0, 0, -speed).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(_v1, dt);
    this.group.rotation.y += this.steer * CONFIG.carTurnSpeed * dt * THREE.MathUtils.degToRad(1);

    // Clamp to world
    this.group.position.x = Math.max(-CONFIG.worldRadius, Math.min(CONFIG.worldRadius, this.group.position.x));
    this.group.position.z = Math.max(-CONFIG.worldRadius, Math.min(CONFIG.worldRadius, this.group.position.z));

    // Wind also affects car
    const w = wind.getWindAt(this.group.position);
    if (w.closest && w.dist < w.closest.radius) {
      const push = _v1.copy(w.vector).multiplyScalar(dt * 1.2);
      this.group.position.add(push);
    }
  }

  getWorldSeat(out) {
    return this.group.localToWorld(out.set(0, 0.95, 0.65));
  }
}

// ============================================================================
// CarComputer — dashboard showing live wind MPH
// ============================================================================
class CarComputer {
  constructor(car) {
    this.car = car;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 432;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), this.material);
    this.mesh.renderOrder = 950;
    car.compMount.add(this.mesh);
    this.mesh.position.set(0, 0, 0.02);

    this.draw({ mph: 0, type: '--', dist: 0 });
  }

  update() {
    if (!this.car.occupied) return;
    const mph = wind.getWindSpeedMph(this.car.group.position);
    const { closest, dist } = wind.getWindAt(this.car.group.position);
    const type = closest ? closest.type.toUpperCase() : '--';
    const d = closest ? Math.max(0, dist - closest.radius) : 0;
    this.draw({ mph, type, dist: d });
  }

  draw({ mph, type, dist }) {
    const c = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);

    // Panel bg
    c.fillStyle = '#0b1220';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#36e0ff';
    c.lineWidth = 5;
    c.strokeRect(12, 12, w - 24, h - 24);

    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // MPH big
    c.fillStyle = '#eaf6ff';
    c.font = '800 110px "Segoe UI", system-ui, sans-serif';
    c.fillText(Math.max(0, Math.floor(mph)) + ' MPH', w / 2, h / 2 - 10);

    // Type
    c.fillStyle = '#ffb347';
    c.font = '800 34px "Segoe UI", system-ui, sans-serif';
    c.fillText('TARGET: ' + type, w / 2, h / 2 + 70);

    // Distance
    c.fillStyle = '#8fa6c8';
    c.font = '700 26px "Segoe UI", system-ui, sans-serif';
    c.fillText(dist.toFixed(0) + ' m', w / 2, h / 2 + 118);

    this.texture.needsUpdate = true;
  }
}

// ============================================================================
// HUD (head-locked, canvas textures)
// ============================================================================
class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.345), this.material);
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.draw({ mph: 0, type: '--' });
  }

  draw({ mph, type }) {
    const c = this.ctx;
    c.clearRect(0, 0, 1024, 320);
    c.fillStyle = 'rgba(4, 8, 16, 0.75)';
    c.fillRect(0, 0, 1024, 320);
    c.strokeStyle = 'rgba(54, 224, 255, 0.45)';
    c.lineWidth = 3;
    c.strokeRect(20, 20, 984, 280);

    c.fillStyle = '#36e0ff';
    c.font = '800 42px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText('WIND: ' + Math.max(0, Math.floor(mph)) + ' MPH', 60, 100);

    c.fillStyle = '#eaf6ff';
    c.font = '700 30px "Segoe UI", system-ui, sans-serif';
    c.fillText('TARGET: ' + type, 60, 160);

    c.fillStyle = '#8fa6c8';
    c.font = '700 20px "Segoe UI", system-ui, sans-serif';
    c.fillText('Enter a car to read live wind on your dashboard', 60, 230);
    c.fillText('VR: Left stick move • Right stick snap turn • Trigger enter car', 60, 265);
    c.fillText('Desktop: WASD move • E enter car', 60, 300);

    this.texture.needsUpdate = true;
  }

  update({ mph, type }) {
    this.draw({ mph, type });
    this.mesh.visible = true;
  }

  follow(cam) {
    _v3.set(0, -0.3, -1.5);
    cam.getWorldPosition(_v1);
    cam.getWorldQuaternion(_q1);
    this.mesh.position.copy(_v3).applyQuaternion(_q1).add(_v1);
    this.mesh.quaternion.copy(_q1);
  }
}

const hud = new Hud();

// ============================================================================
// World (ground, sky, cars, tornadoes)
// ============================================================================
function buildWorld() {
  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: 0x2d4a3a })
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);

  // Grid lines for scale reference
  const grid = new THREE.GridHelper(900, 36, 0x4a6270, 0x2a3a4a);
  grid.position.y = 0.02;
  world.add(grid);

  // Cars with dashboard computers
  const cars = [];
  for (let i = 0; i < CONFIG.carCount; i++) {
    const c = new Car(i);
    c.place(-7 + i * 3.6, 8);
    c.userData = c.userData || {};
    c.userData.computer = new CarComputer(c);
    cars.push(c);
  }

  // Tornadoes in a circle
  const types = Object.values(TornadoType);
  const tornadoes = [];
  for (let i = 0; i < CONFIG.tornadoCount; i++) {
    const t = new Tornado(types[i % types.length]);
    const ang = (i / CONFIG.tornadoCount) * TAU;
    const dist = 130 + i * 55;
    t.place(Math.cos(ang) * dist, Math.sin(ang) * dist);
    tornadoes.push(t);
  }

  return { cars, tornadoes };
}

// ============================================================================
// Input & state
// ============================================================================
let isVR = false;
let desktopActive = false;
let yaw = 0, pitch = 0;
let snapReady = true;
let snapTimer = 0;
const keys = new Set();

const carsState = [];
const cars = [];

let currentCar = null;
let inCar = false;

function startGame() {
  const built = buildWorld();
  carsState.cars = built.cars;
  carsState.tornadoes = built.tornadoes;

  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  world.position.set(0, 0, 0);
  world.rotation.set(0, 0, 0);

  gamePlaying = true;
  inCar = false;
  currentCar = null;

  overlay.classList.add('hidden');
  crosshair.hidden = desktopActive;

  hud.update({ mph: 0, type: '--' });
}

// Locomotion
function movePlayer(dt, x, y, speed) {
  const forward = camera.getWorldDirection(_v1);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
  forward.normalize();
  const right = _v2.crossVectors(forward, UP).normalize();
  world.position.addScaledVector(forward, -y * speed * dt);
  world.position.addScaledVector(right, -x * speed * dt);
}

function turnPlayer(angle) {
  const pivot = camera.getWorldPosition(_v3);
  pivot.y = 0;
  world.position.sub(pivot).applyAxisAngle(UP, angle).add(pivot);
  world.rotation.y += angle;
}

function clampPlayer() {
  const p = camera.getWorldPosition(_v1);
  const d = Math.hypot(p.x, p.z);
  const maxR = CONFIG.worldRadius - 1;
  if (d > maxR && d > 0.001) {
    const push = d - maxR;
    world.position.x += (p.x / d) * push;
    world.position.z += (p.z / d) * push;
  }
}

function readGamepadStick(slot) {
  if (!slot || !slot.inputSource || !slot.inputSource.gamepad) return { x: 0, y: 0 };
  const axes = slot.inputSource.gamepad.axes;
  const dead = 0.15;
  const x = Math.abs(axes[2] || 0) > dead ? axes[2] : 0;
  const y = Math.abs(axes[3] || 0) > dead ? axes[3] : 0;
  return { x, y };
}

function findController(handedness) {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    if (c.userData && c.userData.handedness === handedness) return c;
  }
  return null;
}

function updateVRInput(dt, now) {
  const left = findController('left');
  const right = findController('right');
  const l = readGamepadStick(left);
  const r = readGamepadStick(right);

  if (inCar && currentCar) {
    currentCar.setInput(l.y, l.x); // drive with left stick, steer
    // right stick steer as well (combine)
    currentCar.steer += r.x * 0.6;
    return;
  }

  if (gamePlaying) {
    if (l.x !== 0 || l.y !== 0) movePlayer(dt, l.x, l.y, CONFIG.moveSpeed);
    if (r.x > 0.7 && snapReady) { turnPlayer(CONFIG.snapAngle); snapReady = false; snapTimer = 0; }
    if (r.x < -0.7 && snapReady) { turnPlayer(-CONFIG.snapAngle); snapReady = false; snapTimer = 0; }
    if (Math.abs(r.x) < 0.25) snapReady = true;
  }
}

function updateDesktopInput(dt) {
  if (!desktopActive || isVR) return;
  if (inCar && currentCar) {
    let t = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) t += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) t -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    currentCar.setInput(t, s);
    return;
  }
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprint ? CONFIG.runSpeed : CONFIG.moveSpeed;
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (f !== 0 || s !== 0) {
    const len = Math.hypot(f, s);
    movePlayer(dt, s / len, f / len, speed);
  }
}

function attemptInteract() {
  if (inCar) {
    exitCar();
    return;
  }

  if (!carsState || !carsState.cars || carsState.cars.length === 0) return;

  // Raycast from camera to find nearby car
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = CONFIG.interactDistance;
  const hits = raycaster.intersectObjects(carsState.cars.map((c) => c.group), true);
  const hitObj = hits.length > 0 ? hits[0].object : null;
  const targetCar = hitObj ? carsState.cars.find((c) => c.group === hitObj) : null;

  if (targetCar) {
    enterCar(targetCar);
    return;
  }

  // Proximity fallback
  for (const c of carsState.cars) {
    const cp = c.group.getWorldPosition(_v1);
    const camP = camera.getWorldPosition(_v2);
    if (camP.distanceTo(cp) < CONFIG.interactDistance) {
      enterCar(c);
      return;
    }
  }
}

function enterCar(car) {
  if (!car.enter(camera)) return;
  currentCar = car;
  inCar = true;
  sfx.enterCar();

  // Parent camera to seat
  const seatWorld = car.getWorldSeat(_v3);
  camera.position.copy(seatWorld);
  camera.rotation.copy(car.group.rotation);
  camera.rotation.x = 0;
  camera.rotation.z = 0;
  car.group.attach(camera);

  crosshair.hidden = true;
  note.textContent = 'In car — drive into the storm!';
}

function exitCar() {
  if (!currentCar) return;
  currentCar.exit();
  currentCar.group.detach(camera);
  // Place camera just outside car
  const out = _v1.set(0, 1.6, -2.5);
  car.group.localToWorld(out);
  camera.position.copy(out);
  camera.rotation.set(0, car.group.rotation.y, 0);
  currentCar = null;
  inCar = false;
  sfx.exitCar();
  crosshair.hidden = desktopActive;
  note.textContent = 'Exited car.';
}

// ============================================================================
// XR session
// ============================================================================
async function enterVR() {
  if (enterVrBtn.disabled) return;
  enterVrBtn.disabled = true;
  note.textContent = 'Starting VR session…';
  sfx.resume();

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    session.addEventListener('end', onSessionEnd, { once: true });

    isVR = true;
    desktopActive = false;
    overlay.classList.add('hidden');
    crosshair.hidden = true;
    startGame();
  } catch (err) {
    enterVrBtn.disabled = false;
    note.textContent = 'Could not start VR: ' + (err && err.message ? err.message : String(err));
  }
}

async function checkXR() {
  if (!window.isSecureContext) {
    enterVrBtn.disabled = true;
    note.textContent = 'VR needs HTTPS or localhost. Desktop mode works now.';
    return;
  }
  if (!navigator.xr) {
    enterVrBtn.disabled = true;
    note.textContent = 'WebXR not available in this browser. Desktop mode works now.';
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!supported) {
      enterVrBtn.disabled = true;
      note.textContent = 'No VR headset detected. Desktop mode works now.';
    } else {
      note.textContent = 'Headset detected — put it on, then Enter VR.';
    }
  } catch (err) {
    enterVrBtn.disabled = true;
    note.textContent = 'Could not query WebXR. Desktop mode works now.';
  }
}

function onSessionEnd() {
  isVR = false;
  desktopActive = false;
  if (inCar) exitCar();
  overlay.classList.remove('hidden');
  crosshair.hidden = true;
  note.textContent = 'VR session ended — jump back in.';
  enterVrBtn.disabled = false;
  hud.mesh.visible = false;
}

// ============================================================================
// Desktop input wiring
// ============================================================================
function startDesktop() {
  sfx.resume();
  isVR = false;
  desktopActive = true;
  overlay.classList.add('hidden');
  crosshair.hidden = false;
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  world.position.set(0, 0, 0);
  world.rotation.set(0, 0, 0);
  startGame();
  try { canvas.requestPointerLock(); } catch (e) {}
}

window.addEventListener('keydown', (e) => {
  if (!desktopActive) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) attemptInteract();
  if (e.code === 'Enter' && gameState === 'gameover') startGame();
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let gamePlaying = false;
let gameState = 'menu';

document.addEventListener('mousemove', (e) => {
  if (!desktopActive || isVR) return;
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.002;
  pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY * 0.002));
  camera.rotation.x = pitch;
  camera.rotation.y = yaw;
});

canvas.addEventListener('mousedown', (e) => {
  if (!desktopActive || isVR || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  attemptInteract();
});

document.addEventListener('pointerlockchange', () => {
  crosshair.hidden = !(desktopActive && document.pointerLockElement === canvas);
});

window.addEventListener('pointerdown', () => sfx.resume(), { passive: true });

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// VR controller button handling
function setupXRControllers() {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData = { handedness: i === 0 ? 'left' : 'right' };
    c.visible = false;
    scene.add(c);

    c.addEventListener('connected', () => {
      c.visible = true;
    });
    c.addEventListener('disconnected', () => {
      c.visible = false;
    });

    // Select (trigger) = interact
    c.addEventListener('selectstart', () => {
      if (!isVR) return;
      attemptInteract();
    });
    // Squeeze (grip) also interact
    c.addEventListener('squeezestart', () => {
      if (!isVR) return;
      attemptInteract();
    });
  }
}

// ============================================================================
// Main loop
// ============================================================================
let dtGlobal = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  dtGlobal = dt;
  const now = performance.now();

  updateVRInput(dt, now);
  updateDesktopInput(dt);

  if (!renderer.xr.isPresenting) {
    world.updateMatrixWorld(true);
    clampPlayer();
  }

  // Update tornadoes
  for (const t of carsState.tornadoes || []) t.update(dt, now);

  // Update cars
  for (const c of carsState.cars || []) c.update(dt);

  // HUD wind at player (if not in car, show player wind; if in car show car wind)
  let mph = 0, type = '--';
  if (inCar && currentCar) {
    mph = wind.getWindSpeedMph(currentCar.group.position);
    const c = wind.getWindAt(currentCar.group.position);
    type = c.closest ? c.closest.type.toUpperCase() : '--';
    // Update dashboard
    const comp = currentCar.userData && currentCar.userData.computer;
    if (comp) comp.update();
  } else {
    const camP = camera.getWorldPosition(_v1);
    mph = wind.getWindSpeedMph(camP);
    const c = wind.getWindAt(camP);
    type = c.closest ? c.closest.type.toUpperCase() : '--';
  }
  hud.update({ mph, type });
  hud.follow(camera);

  renderer.render(scene, camera);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(tick);

// ============================================================================
// Init
// ============================================================================
loading.classList.add('hidden');
renderer.render(scene, camera);
setupXRControllers();
checkXR();

enterVrBtn.addEventListener('click', enterVR);
desktopBtn.addEventListener('click', startDesktop);

// Expose for debugging
window.__stormchaser = { scene, camera, world, renderer, wind, cars: carsState.cars, hud };

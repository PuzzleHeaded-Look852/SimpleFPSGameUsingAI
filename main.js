/**
 * DEADZONE FPS — main.js
 * Fully rewritten for performance and gameplay quality
 */

'use strict';

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const ARENA         = 45;
const PLAYER_H      = 1.65;
const PLAYER_R      = 0.45;
const GRAVITY       = -22;
const BULLET_SPEED  = 80;       // units/sec
const BULLET_RANGE  = 120;
const SPAWN_BASE    = 2200;     // ms
const MAX_ENEMIES   = 15;
const BASE_SPEED    = 5.8;
const SPRINT_MULT   = 1.85;
const CROUCH_MULT   = 0.5;
const CROUCH_H      = 1.0;
const JUMP_V        = 9.5;
const MAX_AMMO      = 12;
const RESERVE_AMMO  = 60;
const RELOAD_TIME   = 1.5;      // seconds
const KNOCKBACK_STR = 3.5;
const KNOCKBACK_DEC = 7;

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let scene, camera, renderer, controls;
let clock, lastTime = 0;

let enemies   = [];
let bullets   = [];
let particles = [];
let decals    = [];

let score     = 0;
let kills     = 0;
let health    = 100;
let wave      = 1;
let ammo      = MAX_AMMO;
let reserve   = RESERVE_AMMO;

let gameStarted  = false;
let gameOver     = false;
let isReloading  = false;
let reloadTimer  = 0;
let lastSpawn    = 0;
let spawnInterval= SPAWN_BASE;
let waveKills    = 0;
let waveTarget   = 10;

// Movement
const keys = { w:false, a:false, s:false, d:false, shift:false, c:false };
let velocityY = 0;
let isCrouching = false;
let knockbackVel = new THREE.Vector3();
let targetPlayerH = PLAYER_H;

// Weapon
let pistol = null;
let isAiming = false;

const sway = {
    pos:       new THREE.Vector3(0.22, -0.18, -0.45),
    target:    new THREE.Vector3(0.22, -0.18, -0.45),
    base:      new THREE.Vector3(0.22, -0.18, -0.45),
    aim:       new THREE.Vector3(0.02, -0.12, -0.35),
    time:      0,
    lastMoveT: 0
};

const recoil = {
    active:      false,
    kickBack:    0,
    rotX:        0,
    rotTarget:   0,
    lastShot:    0,
    camRotX:     0,
};

// Lighting refs
let pointLights = [];
let muzzleFlashLight = null;

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0f);
    scene.fog = new THREE.FogExp2(0x0d0d0f, 0.018);

    // Camera
    camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 300);
    camera.position.set(0, PLAYER_H, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new THREE.PointerLockControls(camera, document.body);
    controls.addEventListener('unlock', onUnlock);

    buildScene();
    buildLights();
    createPistol();
    setupEvents();

    requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
//  SCENE BUILDING
// ─────────────────────────────────────────────
function buildScene() {
    // Floor — tiled pattern via vertex colors
    const floorGeo = new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 40, 40);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x1a1410,
        roughness: 0.9,
        metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid lines on floor
    const gridHelper = new THREE.GridHelper(ARENA * 2, 30, 0x2a2020, 0x1e1616);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Ceiling (atmospheric)
    const ceilGeo = new THREE.PlaneGeometry(ARENA * 2, ARENA * 2);
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1, side: THREE.BackSide });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.y = 12;
    scene.add(ceil);

    // Walls
    buildWalls();

    // Environment props
    buildProps();
}

function buildWalls() {
    const texLoader = new THREE.TextureLoader();
    const brickTex = texLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg', (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(18, 2);
    });

    const wallMat = new THREE.MeshStandardMaterial({
        map: brickTex,
        color: 0x553322,
        roughness: 0.85,
        metalness: 0.1,
    });

    const wallDefs = [
        [0,      5, -ARENA, 0],
        [0,      5,  ARENA, Math.PI],
        [-ARENA, 5,  0,     Math.PI / 2],
        [ ARENA, 5,  0,    -Math.PI / 2],
    ];

    wallDefs.forEach(([x, y, z, ry]) => {
        const geo = new THREE.BoxGeometry(ARENA * 2, 12, 1.2);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(x, y, z);
        mesh.rotation.y = ry;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        scene.add(mesh);

        // Wall trim lights
        const lightColor = 0xff2200;
        const l = new THREE.PointLight(lightColor, 0.6, 30);
        l.position.set(x * 0.85, 1.5, z * 0.85);
        scene.add(l);
    });
}

function buildProps() {
    // Scattered crates for cover
    const cratePositions = [
        [8, 0, -12], [-10, 0, 8], [15, 0, 5], [-5, 0, -20],
        [20, 0, -8], [-18, 0, 15], [6, 0, 18], [-22, 0, -5],
        [0, 0, -30], [30, 0, 0], [-30, 0, 0], [0, 0, 30],
    ];

    cratePositions.forEach(([x, , z]) => {
        const h = 0.8 + Math.random() * 1.2;
        const w = 0.8 + Math.random() * 0.8;
        const geo = new THREE.BoxGeometry(w, h, w);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0.08, 0.4, 0.12 + Math.random() * 0.08),
            roughness: 0.8,
            metalness: 0.3,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x + (Math.random() - 0.5) * 3, h / 2, z + (Math.random() - 0.5) * 3);
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
    });

    // Hazard lights on ceiling
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const r = 25;
        const lx = Math.cos(angle) * r;
        const lz = Math.sin(angle) * r;

        const bulbGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xff3000 });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(lx, 10, lz);
        scene.add(bulb);

        const pl = new THREE.PointLight(0xff2200, 0.4, 20);
        pl.position.set(lx, 9.5, lz);
        scene.add(pl);
        pointLights.push({ light: pl, base: 0.4, time: i * 1.3 });
    }
}

function buildLights() {
    // Minimal ambient
    scene.add(new THREE.AmbientLight(0x100c0a, 1.5));

    // Main overhead
    const sun = new THREE.DirectionalLight(0xffa060, 0.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -ARENA;
    sun.shadow.camera.right = ARENA;
    sun.shadow.camera.top = ARENA;
    sun.shadow.camera.bottom = -ARENA;
    scene.add(sun);

    // Muzzle flash light (hidden by default)
    muzzleFlashLight = new THREE.PointLight(0xffdd88, 0, 6);
    camera.add(muzzleFlashLight);
    muzzleFlashLight.position.set(0, 0, -1);
}

// ─────────────────────────────────────────────
//  PISTOL
// ─────────────────────────────────────────────
function createPistol() {
    const loader = new THREE.GLTFLoader();
    loader.load('pistol.glb',
        (gltf) => {
            pistol = gltf.scene;
            pistol.scale.setScalar(0.3);
            pistol.rotation.set(0, Math.PI / 2, 0);
            pistol.position.copy(sway.pos);
            pistol.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
            camera.add(pistol);
            scene.add(camera);
        },
        undefined,
        () => {
            // Fallback — simple gun shape if GLB fails
            pistol = buildFallbackGun();
            camera.add(pistol);
            scene.add(camera);
        }
    );
}

function buildFallbackGun() {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.06, 0.1, 0.28);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.8 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);

    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8);
    const barrel = new THREE.Mesh(barrelGeo, bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.2);

    group.add(body, barrel);
    group.position.copy(sway.pos);
    return group;
}

// ─────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────
function setupEvents() {
    // Start button
    document.getElementById('startBtn').addEventListener('click', startGame);

    // Restart button
    document.getElementById('restartBtn').addEventListener('click', () => location.reload());

    // Click = lock pointer (when started)
    document.addEventListener('click', () => {
        if (gameStarted && !gameOver && !controls.isLocked) {
            controls.lock();
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked || gameOver || !gameStarted) return;
        if (e.button === 0) shoot();
        if (e.button === 2) startAim();
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) stopAim();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
}

function startGame() {
    gameStarted = true;
    document.getElementById('start-screen').classList.add('hidden');
    controls.lock();
    announceWave(1);
}

function onUnlock() {
    if (gameOver || !gameStarted) return;
    document.getElementById('pause-screen').classList.remove('hidden');
    document.body.style.cursor = 'default';
}

function onKeyDown(e) {
    if (!gameStarted || gameOver) return;
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = true;
    if (k === 'a') keys.a = true;
    if (k === 's') keys.s = true;
    if (k === 'd') keys.d = true;
    if (e.key === 'Shift') { keys.shift = true; document.getElementById('sprint-indicator').classList.add('active'); }
    if (k === 'c' || k === 'control') toggleCrouch();
    if (k === 'r' && !isReloading && ammo < MAX_AMMO && reserve > 0) startReload();
    if (e.code === 'Space' && camera.position.y <= PLAYER_H + 0.05) {
        velocityY = JUMP_V + (keys.shift ? 2 : 0);
        if (keys.shift) {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            dir.y = 0; dir.normalize().multiplyScalar(3);
            knockbackVel.add(dir);
        }
    }
    if (!controls.isLocked && gameStarted && !gameOver) controls.lock();
}

function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = false;
    if (k === 'a') keys.a = false;
    if (k === 's') keys.s = false;
    if (k === 'd') keys.d = false;
    if (e.key === 'Shift') { keys.shift = false; document.getElementById('sprint-indicator').classList.remove('active'); }
}

function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
}

// ─────────────────────────────────────────────
//  AIMING
// ─────────────────────────────────────────────
function startAim() {
    if (!pistol || gameOver) return;
    isAiming = true;
    camera.fov = 55;
    camera.updateProjectionMatrix();
    sway.target.copy(sway.aim);
    document.getElementById('crosshair').classList.add('aiming');
}

function stopAim() {
    if (!pistol) return;
    isAiming = false;
    camera.fov = 80;
    camera.updateProjectionMatrix();
    sway.target.copy(sway.base);
    document.getElementById('crosshair').classList.remove('aiming');
}

// ─────────────────────────────────────────────
//  SHOOTING
// ─────────────────────────────────────────────
function shoot() {
    if (!controls.isLocked || !pistol || gameOver || isReloading) return;
    if (ammo <= 0) {
        if (reserve > 0) startReload();
        else playDryFire();
        return;
    }

    ammo--;
    updateAmmoHUD();

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // Spread when not aiming
    if (!isAiming) {
        dir.x += (Math.random() - 0.5) * 0.018;
        dir.y += (Math.random() - 0.5) * 0.012;
        dir.z += (Math.random() - 0.5) * 0.018;
        dir.normalize();
    }

    spawnBullet(camera.position.clone(), dir);
    applyRecoil();
    triggerMuzzleFlash();
    spawnMuzzleParticles(camera.position.clone(), dir);
    crosshairShoot();

    if (ammo === 0 && reserve > 0) {
        setTimeout(startReload, 400);
    }
}

function spawnBullet(origin, dir) {
    const geo = new THREE.SphereGeometry(0.06, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe060 });
    const mesh = new THREE.Mesh(geo, mat);

    // Offset slightly forward so it doesn't spawn inside gun
    mesh.position.copy(origin).addScaledVector(dir, 0.6);

    mesh.userData = { dir: dir.clone(), speed: BULLET_SPEED, dist: 0 };
    scene.add(mesh);
    bullets.push(mesh);
}

function applyRecoil() {
    recoil.kickBack = 0.04;
    recoil.rotTarget = -0.025;
    recoil.active = true;
    recoil.lastShot = performance.now();
    sway.target.z = (isAiming ? sway.aim.z : sway.base.z) + 0.08;
}

function triggerMuzzleFlash() {
    muzzleFlashLight.intensity = 3.5;
    setTimeout(() => { muzzleFlashLight.intensity = 0; }, 60);
}

function crosshairShoot() {
    const ch = document.getElementById('crosshair');
    ch.classList.add('shooting');
    setTimeout(() => ch.classList.remove('shooting'), 90);
}

function startReload() {
    if (isReloading || reserve === 0 || ammo === MAX_AMMO) return;
    isReloading = true;
    reloadTimer = RELOAD_TIME;

    const wrap = document.getElementById('reloading-bar-wrap');
    wrap.style.setProperty('--reload-duration', RELOAD_TIME + 's');
    wrap.classList.remove('hidden');
    // Restart animation
    const bar = document.getElementById('reloading-bar');
    bar.style.animation = 'none';
    bar.offsetHeight; // reflow
    bar.style.animation = '';
}

function finishReload() {
    isReloading = false;
    const needed = MAX_AMMO - ammo;
    const take = Math.min(needed, reserve);
    ammo += take;
    reserve -= take;
    updateAmmoHUD();
    document.getElementById('reloading-bar-wrap').classList.add('hidden');
}

function playDryFire() {
    // visual cue only
    const ch = document.getElementById('crosshair');
    ch.style.opacity = '0.2';
    setTimeout(() => ch.style.opacity = '', 120);
}

function toggleCrouch() {
    isCrouching = !isCrouching;
    targetPlayerH = isCrouching ? CROUCH_H : PLAYER_H;
}

// ─────────────────────────────────────────────
//  PARTICLES
// ─────────────────────────────────────────────
function spawnMuzzleParticles(origin, dir) {
    for (let i = 0; i < 6; i++) {
        const geo = new THREE.SphereGeometry(0.03 + Math.random() * 0.03, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.12 - Math.random() * 0.05, 1, 0.6) });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(origin).addScaledVector(dir, 0.7);
        const spread = new THREE.Vector3((Math.random()-0.5)*8, (Math.random()-0.5)*8, (Math.random()-0.5)*8);
        spread.add(dir.clone().multiplyScalar(6));
        p.userData = { vel: spread, life: 0.12 + Math.random() * 0.1, age: 0 };
        scene.add(p);
        particles.push(p);
    }
}

function spawnBloodParticles(pos) {
    for (let i = 0; i < 10; i++) {
        const geo = new THREE.SphereGeometry(0.05 + Math.random() * 0.06, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0, 0.9, 0.25 + Math.random() * 0.15) });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        p.userData = {
            vel: new THREE.Vector3((Math.random()-0.5)*6, Math.random()*5+2, (Math.random()-0.5)*6),
            life: 0.4 + Math.random() * 0.4,
            age: 0,
            gravity: true
        };
        scene.add(p);
        particles.push(p);
    }
}

function spawnDeathExplosion(pos) {
    for (let i = 0; i < 20; i++) {
        const size = 0.08 + Math.random() * 0.12;
        const geo = new THREE.BoxGeometry(size, size, size);
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(Math.random() < 0.5 ? 0 : 0.08, 1, 0.4 + Math.random() * 0.3)
        });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        const spd = 4 + Math.random() * 8;
        p.userData = {
            vel: new THREE.Vector3((Math.random()-0.5)*spd, Math.random()*spd, (Math.random()-0.5)*spd),
            life: 0.5 + Math.random() * 0.5,
            age: 0,
            gravity: true,
            rot: new THREE.Vector3(Math.random()*10, Math.random()*10, Math.random()*10)
        };
        scene.add(p);
        particles.push(p);
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const d = p.userData;
        d.age += dt;
        if (d.age >= d.life) {
            scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
            particles.splice(i, 1);
            continue;
        }
        p.position.addScaledVector(d.vel, dt);
        if (d.gravity) d.vel.y += GRAVITY * 0.4 * dt;
        if (d.rot) { p.rotation.x += d.rot.x * dt; p.rotation.y += d.rot.y * dt; }
        const t = 1 - (d.age / d.life);
        p.material.opacity = t;
        p.material.transparent = true;
        p.scale.setScalar(t * 0.8 + 0.2);
    }
}

// ─────────────────────────────────────────────
//  ENEMIES
// ─────────────────────────────────────────────
const ENEMY_TYPES = [
    { name: 'Grunt',   hp: 3, speed: 0.035, size: 1.1, color: 0xcc3300, score: 10 },
    { name: 'Brute',   hp: 8, speed: 0.018, size: 1.8, color: 0x880000, score: 25 },
    { name: 'Runner',  hp: 2, speed: 0.065, size: 0.8, color: 0xff6600, score: 15 },
    { name: 'Elite',   hp: 5, speed: 0.045, size: 1.2, color: 0x9900cc, score: 30 },
];

function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES || gameOver) return;

    // Pick type weighted by wave
    let pool = [0];
    if (wave >= 2) pool.push(2);
    if (wave >= 3) pool.push(1);
    if (wave >= 4) pool.push(3);
    const type = ENEMY_TYPES[pool[Math.floor(Math.random() * pool.length)]];

    const geo = new THREE.BoxGeometry(type.size, type.size * 1.4, type.size);
    const mat = new THREE.MeshStandardMaterial({
        color: type.color,
        roughness: 0.4,
        metalness: 0.6,
        emissive: new THREE.Color(type.color).multiplyScalar(0.3),
    });

    // Eye glow
    const eyeGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.15, 0.2, -type.size * 0.52);
    eyeR.position.set( 0.15, 0.2, -type.size * 0.52);

    const enemy = new THREE.Mesh(geo, mat);
    enemy.add(eyeL, eyeR);
    enemy.castShadow = true;

    // Spawn outside player view, near walls
    const side = Math.floor(Math.random() * 4);
    const range = ARENA - 3;
    let x, z;
    switch (side) {
        case 0: x = (Math.random() * 2 - 1) * range; z = -(ARENA - 2); break;
        case 1: x = (Math.random() * 2 - 1) * range; z =  (ARENA - 2); break;
        case 2: x = -(ARENA - 2); z = (Math.random() * 2 - 1) * range; break;
        default: x =  (ARENA - 2); z = (Math.random() * 2 - 1) * range;
    }

    enemy.position.set(x, type.size * 0.7, z);
    enemy.userData = {
        hp: type.hp,
        maxHp: type.hp,
        speed: type.speed * (1 + (wave - 1) * 0.12),
        size: type.size,
        type: type,
        spawnTime: performance.now(),
    };

    scene.add(enemy);
    enemies.push(enemy);
    updateEnemiesHUD();
}

function updateEnemies(dt) {
    const playerPos = camera.position;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const d = e.userData;

        // Move toward player
        const toPlayer = new THREE.Vector3().subVectors(playerPos, e.position);
        toPlayer.y = 0;
        const dist = toPlayer.length();
        if (dist > 0.01) {
            toPlayer.normalize().multiplyScalar(d.speed * 60 * dt);
            e.position.add(toPlayer);
        }

        // Look at player
        const lookTarget = playerPos.clone();
        lookTarget.y = e.position.y;
        e.lookAt(lookTarget);

        // Clamp to arena
        e.position.x = THREE.MathUtils.clamp(e.position.x, -(ARENA - d.size), ARENA - d.size);
        e.position.z = THREE.MathUtils.clamp(e.position.z, -(ARENA - d.size), ARENA - d.size);

        // HP bar above enemy
        updateEnemyHPBar(e);

        // Damage player on contact
        if (dist < d.size / 2 + PLAYER_R + 0.1) {
            damagePlayer(5, e.position);
        }
    }
}

// Thin HP bar using a scaled line
function updateEnemyHPBar(e) {
    const d = e.userData;
    if (!d.hpBar) {
        const geo = new THREE.PlaneGeometry(d.size * 0.9, 0.1);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, depthTest: false });
        d.hpBar = new THREE.Mesh(geo, mat);
        d.hpBg = new THREE.Mesh(
            new THREE.PlaneGeometry(d.size * 0.9, 0.1),
            new THREE.MeshBasicMaterial({ color: 0x333333, depthTest: false })
        );
        e.add(d.hpBg);
        e.add(d.hpBar);
        d.hpBar.position.set(0, d.size * 0.75, -(d.size / 2 + 0.05));
        d.hpBg.position.copy(d.hpBar.position);
    }
    const pct = d.hp / d.maxHp;
    d.hpBar.scale.x = pct;
    d.hpBar.position.x = -(d.size * 0.9 * (1 - pct)) / 2;
    d.hpBar.material.color.setHSL(pct * 0.33, 1, 0.5);
}

// ─────────────────────────────────────────────
//  BULLETS
// ─────────────────────────────────────────────
function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const d = b.userData;
        const step = d.dir.clone().multiplyScalar(d.speed * dt);
        b.position.add(step);
        d.dist += d.speed * dt;

        // Remove if out of range or arena
        if (d.dist > BULLET_RANGE ||
            Math.abs(b.position.x) > ARENA ||
            Math.abs(b.position.z) > ARENA) {
            scene.remove(b);
            b.geometry.dispose();
            b.material.dispose();
            bullets.splice(i, 1);
            continue;
        }

        // Check enemy hits
        let hit = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (b.position.distanceTo(e.position) < e.userData.size * 0.7) {
                e.userData.hp--;
                showHitMarker();
                spawnBloodParticles(b.position.clone());

                // Flash enemy
                const origEmissive = e.material.emissive.clone();
                e.material.emissive.set(0xffffff);
                setTimeout(() => e.material.emissive.copy(origEmissive), 60);

                if (e.userData.hp <= 0) {
                    spawnDeathExplosion(e.position.clone());
                    addKillFeedEntry(e.userData.type.name);
                    score += e.userData.type.score * wave;
                    kills++;
                    waveKills++;
                    scene.remove(e);
                    enemies.splice(j, 1);
                    updateScoreHUD();
                    updateKillsHUD();
                    updateEnemiesHUD();
                    checkWaveProgress();
                }

                scene.remove(b);
                b.geometry.dispose();
                b.material.dispose();
                bullets.splice(i, 1);
                hit = true;
                break;
            }
        }
    }
}

// ─────────────────────────────────────────────
//  PLAYER
// ─────────────────────────────────────────────
function handleMovement(dt) {
    if (!controls.isLocked || gameOver) return;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();

    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();

    const vel = new THREE.Vector3();
    if (keys.w) vel.add(dir);
    if (keys.s) vel.sub(dir);
    if (keys.a) vel.add(right);
    if (keys.d) vel.sub(right);

    if (vel.lengthSq() > 0) {
        vel.normalize();
        sway.lastMoveT = performance.now();
    }

    let speed = BASE_SPEED;
    if (keys.shift && !isCrouching) speed *= SPRINT_MULT;
    if (isCrouching) speed *= CROUCH_MULT;

    vel.multiplyScalar(speed * dt);
    vel.add(knockbackVel.clone().multiplyScalar(dt));

    const np = camera.position.clone().add(vel);
    const wall = 0.8;
    np.x = THREE.MathUtils.clamp(np.x, -(ARENA - wall), ARENA - wall);
    np.z = THREE.MathUtils.clamp(np.z, -(ARENA - wall), ARENA - wall);
    camera.position.set(np.x, camera.position.y, np.z);

    // Knockback decay
    knockbackVel.multiplyScalar(Math.max(0, 1 - KNOCKBACK_DEC * dt));
    if (knockbackVel.lengthSq() < 0.001) knockbackVel.set(0, 0, 0);
}

function handleGravity(dt) {
    const targetH = isCrouching ? CROUCH_H : PLAYER_H;
    targetPlayerH = targetH;

    if (camera.position.y > targetH || velocityY !== 0) {
        velocityY += GRAVITY * dt;
        camera.position.y += velocityY * dt;
        if (camera.position.y <= targetH) {
            camera.position.y = targetH;
            velocityY = 0;
        }
    } else {
        // Smooth crouch
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetH, 12 * dt);
    }
}

function damagePlayer(dmg, fromPos) {
    if (gameOver) return;
    health = Math.max(0, health - dmg);
    updateHealthHUD();

    // Damage flash
    const dv = document.getElementById('damage-vignette');
    dv.classList.remove('flash');
    void dv.offsetWidth;
    dv.classList.add('flash');

    // Knockback away from enemy
    if (fromPos) {
        const push = new THREE.Vector3().subVectors(camera.position, fromPos);
        push.y = 0; push.normalize().multiplyScalar(KNOCKBACK_STR);
        knockbackVel.add(push);
    }

    // Low health
    document.body.classList.toggle('low-health', health <= 30);

    if (health <= 0) triggerGameOver();
}

// ─────────────────────────────────────────────
//  WEAPON SWAY
// ─────────────────────────────────────────────
function updateWeaponSway(dt) {
    if (!pistol) return;

    sway.time += dt;
    const moving = performance.now() - sway.lastMoveT < 120;
    const intens = keys.shift ? 0.018 : 0.01;

    if (moving) {
        sway.target.x = sway.base.x + Math.sin(sway.time * 6) * intens;
        sway.target.y = sway.base.y + Math.abs(Math.sin(sway.time * 12)) * intens * 0.6 - intens * 0.3;
    } else if (!isAiming) {
        sway.target.x = sway.base.x + Math.sin(sway.time * 0.6) * 0.001;
        sway.target.y = sway.base.y + Math.sin(sway.time * 0.9) * 0.001;
    }

    // Recoil recovery
    if (recoil.active) {
        const age = performance.now() - recoil.lastShot;
        if (age > 120) recoil.active = false;
        else {
            sway.target.z = THREE.MathUtils.lerp(sway.target.z, isAiming ? sway.aim.z : sway.base.z, dt * 14);
        }
    }

    // Camera recoil
    recoil.rotX = THREE.MathUtils.lerp(recoil.rotX, 0, dt * 14);

    const lf = 12 * dt;
    sway.pos.lerp(sway.target, lf);
    sway.pos.z = Math.max(sway.pos.z, isAiming ? sway.aim.z - 0.05 : sway.base.z - 0.12);
    pistol.position.copy(sway.pos);
}

// ─────────────────────────────────────────────
//  WAVES
// ─────────────────────────────────────────────
function checkWaveProgress() {
    if (waveKills >= waveTarget) {
        waveKills = 0;
        wave++;
        waveTarget = 8 + wave * 4;
        spawnInterval = Math.max(600, SPAWN_BASE - wave * 150);
        announceWave(wave);
        updateWaveHUD();
    }
}

function announceWave(n) {
    const el = document.getElementById('wave-announce');
    el.textContent = `WAVE ${String(n).padStart(2, '0')}`;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.add('hidden'), 2600);
}

// ─────────────────────────────────────────────
//  GAME OVER
// ─────────────────────────────────────────────
function triggerGameOver() {
    gameOver = true;
    controls.unlock();
    controls.enabled = false;
    document.body.style.cursor = 'default';
    document.body.classList.remove('low-health');

    setTimeout(() => {
        const go = document.getElementById('game-over-screen');
        go.classList.remove('hidden');
        document.getElementById('go-score').textContent = score;
        document.getElementById('go-wave').textContent = wave;
        document.getElementById('go-kills').textContent = kills;
    }, 800);
}

// ─────────────────────────────────────────────
//  HUD UPDATES
// ─────────────────────────────────────────────
function updateScoreHUD() {
    document.getElementById('score').textContent = String(score).padStart(6, '0');
}

function updateHealthHUD() {
    const pct = (health / 100) * 100;
    document.getElementById('health-bar').style.width = pct + '%';
    document.getElementById('health-num').textContent = health;
}

function updateAmmoHUD() {
    document.getElementById('ammo-count').textContent = ammo;
    document.getElementById('ammo-reserve').textContent = reserve;
}

function updateEnemiesHUD() {
    // not shown in new HUD — replaced by kill feed
}

function updateKillsHUD() {
    document.getElementById('kills').textContent = String(kills).padStart(2, '0');
}

function updateWaveHUD() {
    document.getElementById('wave').textContent = String(wave).padStart(2, '0');
}

function showHitMarker() {
    const hm = document.getElementById('hit-marker');
    hm.classList.remove('show');
    void hm.offsetWidth;
    hm.classList.add('show');
}

function addKillFeedEntry(typeName) {
    const feed = document.getElementById('kill-feed');
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.textContent = `✕ ${typeName} eliminated`;
    feed.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

// ─────────────────────────────────────────────
//  AMBIENT LIGHT FLICKER
// ─────────────────────────────────────────────
function updateLights(t) {
    pointLights.forEach(({ light, base, time: offset }) => {
        light.intensity = base + Math.sin((t + offset) * 2.1) * 0.08 + Math.sin((t + offset) * 7.3) * 0.04;
    });
}

// ─────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────
function loop(timestamp) {
    requestAnimationFrame(loop);

    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (!gameStarted) { renderer.render(scene, camera); return; }

    const t = timestamp / 1000;

    // Spawn
    if (!gameOver && timestamp - lastSpawn > spawnInterval && enemies.length < MAX_ENEMIES) {
        spawnEnemy();
        lastSpawn = timestamp;
    }

    handleMovement(dt);
    handleGravity(dt);

    if (!gameOver) {
        updateEnemies(dt);
        updateBullets(dt);
    }

    updateParticles(dt);
    updateWeaponSway(dt);
    updateLights(t);

    // Reload countdown
    if (isReloading) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) finishReload();
    }

    // Pause screen
    if (!controls.isLocked && gameStarted && !gameOver) {
        document.getElementById('pause-screen').classList.remove('hidden');
    } else {
        document.getElementById('pause-screen').classList.add('hidden');
    }

    renderer.render(scene, camera);
}

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
init();

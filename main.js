// Game variables
let scene, camera, renderer, controls;
let enemies = [];
let bullets = [];
let score = 0;
let health = 100;
let lastSpawnTime = 0;
const spawnInterval = 2000; // 2 seconds
let pistol = null;
let isAiming = false;
let gameOver = false;
let gameOverTime = 0;
const gameOverDelay = 1000; // 1 second delay before showing game over screen

// Movement variables
const baseMoveSpeed = 5;
let moveSpeed = baseMoveSpeed; // Dynamic speed for sprint
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false // For sprint
};

// Jumping variables
let velocityY = 0;
const gravity = -20;
let jumpStrength = 8; // Dynamic jump strength for sprint
const sprintJumpBoost = 2; // Horizontal boost for long jump

// Game boundaries
const arenaSize = 45; // Half of arena size (total size is arenaSize*2)
const playerHeight = 1.6;
const playerRadius = 0.5;
let lastTime = performance.now();

// Weapon physics variables
let weaponSway = {
    position: new THREE.Vector3(0.2, -0.15, -0.5),
    targetPosition: new THREE.Vector3(0.2, -0.15, -0.5),
    rotation: new THREE.Euler(0, Math.PI / 2, 0), // Rotated 180 degrees horizontally
    targetRotation: new THREE.Euler(0, Math.PI / 2, 0),
    time: 0,
    lastMovementTime: 0,
    basePosition: new THREE.Vector3(0.2, -0.15, -0.5),
    aimPosition: new THREE.Vector3(0.1, -0.1, -0.4)
};

let recoil = {
    isRecoiling: false,
    amount: 0,
    rotationAmount: 0,
    recoverySpeed: 12,
    kickBack: 0.02,
    kickUp: 0,        // No vertical rotation
    kickSide: 0,      // No horizontal rotation
    lastShotTime: 0,
    maxRecoil: 0.1,
    positionRecoverySpeed: 15
};

let breathing = {
    amplitude: 0.001,
    frequency: 0.1
};

// Knockback variables
let knockbackVelocity = new THREE.Vector3(0, 0, 0);
const knockbackStrength = 2; // Initial push strength
const knockbackDecay = 5;    // Decay rate (units/second)

// Initialize the game
init();

function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = playerHeight;

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Add pointer lock controls
    controls = new THREE.PointerLockControls(camera, document.body);

    // Add event listeners
    document.addEventListener('click', () => {
        if (!controls.isLocked && !gameOver) {
            controls.lock();
            document.getElementById('instructions').style.display = 'none';
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!controls.isLocked || gameOver) return;
        if (event.button === 0) shoot();
        if (event.button === 2) startAiming();
    });

    document.addEventListener('mouseup', (event) => {
        if (event.button === 2) stopAiming();
    });

    document.addEventListener('contextmenu', (event) => event.preventDefault());
    
    // Keyboard event listeners
    document.addEventListener('keydown', (e) => onKeyDown(e));
    document.addEventListener('keyup', (e) => onKeyUp(e));

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(arenaSize*2, arenaSize*2);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x4a3728,
        roughness: 0.8,
        metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Create 3D grass from GLB
    createGrass();

    // Create pistol
    createPistol();

    // Create walls with brick texture
    const textureLoader = new THREE.TextureLoader();
    const brickTexture = textureLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
    brickTexture.wrapS = brickTexture.wrapT = THREE.RepeatWrapping;
    brickTexture.repeat.set(20, 2);
    createWall(0, 5, -arenaSize, 0, brickTexture);
    createWall(0, 5, arenaSize, Math.PI, brickTexture);
    createWall(-arenaSize, 5, 0, Math.PI / 2, brickTexture);
    createWall(arenaSize, 5, 0, -Math.PI / 2, brickTexture);

    // Restart button event listener
    document.getElementById('restartButton').addEventListener('click', () => {
        document.location.reload();
    });

    // Start game loop
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function createGrass() {
    const loader = new THREE.GLTFLoader();
    loader.load('grass.glb', (gltf) => {
        const grassModel = gltf.scene;
        let grassGeometry = null;
        let grassMaterial = null;

        grassModel.traverse((child) => {
            if (child.isMesh) {
                grassGeometry = child.geometry.clone();
                grassMaterial = child.material.clone();
                if (grassMaterial.transparent) {
                    grassMaterial.alphaTest = grassMaterial.alphaTest || 0.5;
                }
                grassMaterial.side = THREE.DoubleSide;
            }
        });

        if (!grassGeometry || !grassMaterial) {
            console.error('No mesh found in grass.glb');
            return;
        }

        const grassCount = 3000;
        const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
        const dummy = new THREE.Object3D();
        const wallBuffer = playerRadius + 0.5;

        for (let i = 0; i < grassCount; i++) {
            const x = (Math.random() * (arenaSize*2 - wallBuffer*2)) - (arenaSize - wallBuffer);
            const z = (Math.random() * (arenaSize*2 - wallBuffer*2)) - (arenaSize - wallBuffer);
            dummy.position.set(x, 0, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        scene.add(grassMesh);
    }, undefined, (error) => {
        console.error('Error loading grass.glb:', error);
    });
}

function createPistol() {
    const loader = new THREE.GLTFLoader();
    loader.load('pistol.glb', (gltf) => {
        pistol = gltf.scene;
        pistol.scale.set(0.3, 0.3, 0.3);
        pistol.rotation.set(0, Math.PI / 2, 0); // 180-degree rotation
        pistol.position.copy(weaponSway.position);
        camera.add(pistol);
        scene.add(camera);
    }, undefined, (error) => {
        console.error('Error loading pistol.glb:', error);
    });
}

function startAiming() {
    if (!controls.isLocked || !pistol || gameOver) return;
    isAiming = true;
    camera.fov = 60;
    camera.updateProjectionMatrix();
    weaponSway.targetPosition.copy(weaponSway.aimPosition);
}

function stopAiming() {
    if (!pistol || gameOver) return;
    isAiming = false;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    weaponSway.targetPosition.copy(weaponSway.basePosition);
}

function createWall(x, y, z, rotationY, brickTexture) {
    const wallGeometry = new THREE.BoxGeometry(arenaSize*2, 10, 1);
    const wallMaterial = new THREE.MeshStandardMaterial({ 
        map: brickTexture,
        roughness: 0.7,
        metalness: 0.3
    });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(x, y, z);
    wall.rotation.y = rotationY;
    scene.add(wall);
}

function onKeyDown(event) {
    if (gameOver) return;
    
    switch (event.key.toLowerCase()) {
        case 'w': keys.w = true; break;
        case 'a': keys.a = true; break;
        case 's': keys.s = true; break;
        case 'd': keys.d = true; break;
        case ' ':
            if (camera.position.y <= playerHeight) {
                jumpStrength = keys.shift ? 12 : 8; // Higher jump when sprinting
                velocityY = jumpStrength;
                if (keys.shift) {
                    const direction = new THREE.Vector3();
                    camera.getWorldDirection(direction);
                    direction.y = 0;
                    direction.normalize().multiplyScalar(sprintJumpBoost);
                    knockbackVelocity.add(direction); // Add horizontal boost
                }
            }
            break;
        case 'shift':
            keys.shift = true;
            moveSpeed = baseMoveSpeed * 2; // Double speed when sprinting
            break;
    }
}

function onKeyUp(event) {
    switch (event.key.toLowerCase()) {
        case 'w': keys.w = false; break;
        case 'a': keys.a = false; break;
        case 's': keys.s = false; break;
        case 'd': keys.d = false; break;
        case 'shift':
            keys.shift = false;
            moveSpeed = baseMoveSpeed; // Revert to normal speed
            break;
    }
}

function handleMovement(deltaTime) {
    if (!controls.isLocked || gameOver) return;

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();

    const forward = direction.clone();
    const right = new THREE.Vector3();
    right.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

    const velocity = new THREE.Vector3();
    if (keys.w) velocity.add(forward);
    if (keys.s) velocity.sub(forward);
    if (keys.a) velocity.add(right);
    if (keys.d) velocity.sub(right);

    if (velocity.length() > 0) {
        velocity.normalize().multiplyScalar(moveSpeed * deltaTime);
        weaponSway.lastMovementTime = performance.now();
    }

    const newPosition = camera.position.clone().add(velocity).add(knockbackVelocity.clone().multiplyScalar(deltaTime));

    const wallThickness = 0.5;
    let adjustedPosition = newPosition.clone();

    if (newPosition.z - playerRadius < -arenaSize + wallThickness) {
        adjustedPosition.z = -arenaSize + wallThickness + playerRadius;
        knockbackVelocity.z = 0; // Stop knockback against wall
    }
    if (newPosition.z + playerRadius > arenaSize - wallThickness) {
        adjustedPosition.z = arenaSize - wallThickness - playerRadius;
        knockbackVelocity.z = 0;
    }
    if (newPosition.x - playerRadius < -arenaSize + wallThickness) {
        adjustedPosition.x = -arenaSize + wallThickness + playerRadius;
        knockbackVelocity.x = 0;
    }
    if (newPosition.x + playerRadius > arenaSize - wallThickness) {
        adjustedPosition.x = arenaSize - wallThickness - playerRadius;
        knockbackVelocity.x = 0;
    }

    camera.position.copy(adjustedPosition);
}

function shoot() {
    if (!controls.isLocked || !pistol || gameOver) return;
    applyRecoil();

    const bulletGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    
    bullet.position.copy(camera.position);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    bullet.userData.direction = direction.clone();
    bullet.userData.speed = 0.5;
    bullet.userData.distance = 0;
    
    scene.add(bullet);
    bullets.push(bullet);
}

function applyRecoil() {
    recoil.isRecoiling = true;
    recoil.lastShotTime = performance.now();
    weaponSway.targetPosition.z += recoil.kickBack;
    
    if (weaponSway.targetPosition.z < -0.7) {
        weaponSway.targetPosition.z = -0.7;
    }
}

function updateWeaponPhysics(deltaTime) {
    if (!pistol || gameOver) return;

    weaponSway.time += deltaTime;
    const isMoving = performance.now() - weaponSway.lastMovementTime < 100;
    const movementIntensity = isMoving ? 0.01 : 0.005;

    if (isMoving) {
        const swayX = Math.sin(weaponSway.time * 5) * movementIntensity;
        const swayY = Math.sin(weaponSway.time * 10) * movementIntensity * 0.5;
        weaponSway.targetPosition.x = weaponSway.basePosition.x + swayX;
        weaponSway.targetPosition.y = weaponSway.basePosition.y + swayY;
    }

    if (!isMoving && isAiming) {
        const breathX = Math.sin(weaponSway.time * breathing.frequency) * breathing.amplitude;
        const breathY = Math.sin(weaponSway.time * breathing.frequency * 1.5) * breathing.amplitude;
        weaponSway.targetPosition.x += breathX;
        weaponSway.targetPosition.y += breathY;
    }

    if (recoil.isRecoiling) {
        const timeSinceShot = performance.now() - recoil.lastShotTime;
        const recoveryProgress = Math.min(timeSinceShot / 150, 1);
        
        if (recoveryProgress >= 1) {
            recoil.isRecoiling = false;
        } else {
            weaponSway.targetPosition.z = THREE.MathUtils.lerp(
                weaponSway.targetPosition.z,
                isAiming ? weaponSway.aimPosition.z : weaponSway.basePosition.z,
                deltaTime * recoil.positionRecoverySpeed
            );
        }
    }

    const lerpFactor = 10 * deltaTime;
    weaponSway.position.lerp(weaponSway.targetPosition, lerpFactor);
    
    if (weaponSway.position.z < -0.7) {
        weaponSway.position.z = -0.7;
    }
    
    weaponSway.rotation.set(0, Math.PI / 2, 0); // Fixed rotation
    pistol.position.copy(weaponSway.position);
    pistol.rotation.copy(weaponSway.rotation);
}

function updateEnemyCount() {
    document.getElementById('enemies').textContent = enemies.length;
}

function updateScore() {
    document.getElementById('score').textContent = score;
}

function updateHealth() {
    document.getElementById('health').textContent = health;
}

function checkCollisions() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            if (bullet.position.distanceTo(enemy.position) < enemy.size / 2 + 0.1) {
                enemy.health--;
                if (enemy.health <= 0) {
                    scene.remove(enemy);
                    enemies.splice(j, 1);
                    score += 10;
                    updateScore();
                    updateEnemyCount();
                }
                scene.remove(bullet);
                bullets.splice(i, 1);
                break;
            }
        }
    }
    
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (camera.position.distanceTo(enemy.position) < enemy.size / 2 + playerRadius) {
            health -= 5; // Increased damage from 1 to 5
            updateHealth();
            if (health <= 0 && !gameOver) {
                gameOver = true;
                gameOverTime = performance.now();
                document.getElementById('finalScore').textContent = score;
                
                // Disable controls
                controls.unlock();
                controls.enabled = false;
                
                // Show cursor
                document.body.style.cursor = 'default';
            }
            // Apply knockback
            const pushDirection = new THREE.Vector3()
                .subVectors(camera.position, enemy.position)
                .normalize()
                .multiplyScalar(knockbackStrength);
            knockbackVelocity.add(pushDirection);
        }
    }

    enemies.forEach(enemy => {
        enemy.position.x = Math.max(-arenaSize + enemy.size/2, Math.min(arenaSize - enemy.size/2, enemy.position.x));
        enemy.position.z = Math.max(-arenaSize + enemy.size/2, Math.min(arenaSize - enemy.size/2, enemy.position.z));
    });
}

function handleGameOverState(currentTime) {
    if (!gameOver) return 1;
    
    // Calculate time since game over
    const timeSinceGameOver = currentTime - gameOverTime;
    
    // Show game over screen after delay
    if (timeSinceGameOver >= gameOverDelay) {
        document.getElementById('gameOver').classList.add('show');
    }
    
    // Slow down time for smooth transition
    const timeScale = Math.max(0, 1 - (timeSinceGameOver / 500));
    return timeScale;
}

function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    let deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    
    // Handle game over state
    if (gameOver) {
        const timeScale = handleGameOverState(currentTime);
        deltaTime *= timeScale; // Slow down time for smooth transition
        if (timeScale <= 0) return; // Pause completely when transition is done
    }
    
    lastTime = currentTime;

    handleMovement(deltaTime);

    if (camera.position.y > playerHeight || velocityY > 0) {
        velocityY += gravity * deltaTime;
        camera.position.y += velocityY * deltaTime;
        if (camera.position.y < playerHeight) {
            camera.position.y = playerHeight;
            velocityY = 0;
        }
    }

    // Apply and decay knockback
    if (knockbackVelocity.length() > 0) {
        camera.position.add(knockbackVelocity.clone().multiplyScalar(deltaTime));
        knockbackVelocity.multiplyScalar(1 - knockbackDecay * deltaTime);
        if (knockbackVelocity.length() < 0.01) {
            knockbackVelocity.set(0, 0, 0); // Stop when negligible
        }
    }

    const currentGameTime = Date.now();
    if (currentGameTime - lastSpawnTime > spawnInterval && enemies.length < 10 && !gameOver) {
        spawnEnemy();
        lastSpawnTime = currentGameTime;
    }

    enemies.forEach(enemy => {
        const direction = new THREE.Vector3();
        direction.subVectors(camera.position, enemy.position).normalize();
        enemy.position.addScaledVector(direction, enemy.speed);
        enemy.lookAt(camera.position);
    });

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.position.addScaledVector(bullet.userData.direction, bullet.userData.speed);
        bullet.userData.distance += bullet.userData.speed;
        
        if (bullet.userData.distance > 50 || 
            Math.abs(bullet.position.x) > arenaSize || 
            Math.abs(bullet.position.z) > arenaSize) {
            scene.remove(bullet);
            bullets.splice(i, 1);
        }
    }

    updateWeaponPhysics(deltaTime);
    checkCollisions();
    renderer.render(scene, camera);
}

function spawnEnemy() {
    const size = 1 + Math.random() * 2;
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({ 
        color: Math.random() * 0xffffff,
        roughness: 0.5,
        metalness: 0.5
    });
    const enemy = new THREE.Mesh(geometry, material);

    const side = Math.floor(Math.random() * 4);
    let x, z;
    switch (side) {
        case 0: x = Math.random() * (arenaSize*2 - 10) - (arenaSize - 5); z = -arenaSize + 2; break;
        case 1: x = Math.random() * (arenaSize*2 - 10) - (arenaSize - 5); z = arenaSize - 2; break;
        case 2: x = -arenaSize + 2; z = Math.random() * (arenaSize*2 - 10) - (arenaSize - 5); break;
        case 3: x = arenaSize - 2; z = Math.random() * (arenaSize*2 - 10) - (arenaSize - 5); break;
    }

    enemy.position.set(x, size / 2, z);
    enemy.speed = 0.02 + Math.random() * 0.03;
    enemy.health = 3;
    enemy.size = size;

    scene.add(enemy);
    enemies.push(enemy);
    updateEnemyCount();
}
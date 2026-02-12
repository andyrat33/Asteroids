// ============================================================
// ASTEROIDS - Classic Atari-style vector game
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- Dynamic sizing ---
let WIDTH, HEIGHT;

function resizeCanvas() {
    WIDTH = window.innerWidth;
    HEIGHT = window.innerHeight;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const SHIP_SIZE = 15;
const SHIP_THRUST = 0.12;
const SHIP_FRICTION = 0.99;
const SHIP_TURN_SPEED = 0.07;
const SHIP_INVINCIBLE_TIME = 3000;
const SHIP_BLINK_RATE = 100;
const BULLET_SPEED = 7;
const BULLET_LIFETIME = 60;
const MAX_BULLETS = 4;
const HYPERSPACE_COOLDOWN = 3000;
const ASTEROID_SPEED = 1.5;
const ASTEROID_VERTICES_MIN = 7;
const ASTEROID_VERTICES_MAX = 12;
const ASTEROID_JAGGEDNESS = 0.4;
const ASTEROID_SIZES = { large: 40, medium: 20, small: 10 };
const ASTEROID_SCORES = { large: 20, medium: 50, small: 100 };
const UFO_SPEED = 2;
const UFO_SHOOT_INTERVAL = 2000;
const UFO_SPAWN_INTERVAL = 15000;
const UFO_SIZES = { large: 20, small: 10 };
const UFO_SCORES = { large: 200, small: 1000 };
const STARTING_LIVES = 3;
const EXTRA_LIFE_SCORE = 10000;
const STARTING_ASTEROIDS = 4;

// --- Audio (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let soundEnabled = true;
let fireSoundEnabled = true;

// Unlock audio on first user interaction
function unlockAudio() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('click', unlockAudio);
}
document.addEventListener('keydown', unlockAudio);
document.addEventListener('click', unlockAudio);

const Sound = {
    // Heartbeat thump — two alternating low tones, the iconic Asteroids pulse
    _beatToggle: false,
    _beatInterval: null,
    _beatRate: 800, // ms between beats (slows/speeds with asteroid count)

    startBeat() {
        this.stopBeat();
        this._beatToggle = false;
        this._updateBeat();
    },

    stopBeat() {
        if (this._beatInterval) clearTimeout(this._beatInterval);
        this._beatInterval = null;
    },

    _updateBeat() {
        if (gameOver || paused || startScreen) {
            this.stopBeat();
            return;
        }
        this._playBeatNote();
        this._beatToggle = !this._beatToggle;

        // Speed up as fewer asteroids remain
        const total = asteroids ? asteroids.length : 10;
        this._beatRate = Math.max(150, 200 + total * 40);

        this._beatInterval = setTimeout(() => this._updateBeat(), this._beatRate);
    },

    _playBeatNote() {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.value = this._beatToggle ? 55 : 46.25; // A1 and ~F#1
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
    },

    // Fire sound — short high-pitched blip
    fire() {
        if (!soundEnabled || !fireSoundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(900, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
    },

    // Thrust — continuous white noise rumble
    _thrustNode: null,
    _thrustGain: null,

    startThrust() {
        if (!soundEnabled) return;
        if (this._thrustNode) return;
        const bufferSize = 2 * audioCtx.sampleRate;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._thrustNode = audioCtx.createBufferSource();
        this._thrustNode.buffer = buffer;
        this._thrustNode.loop = true;

        // Bandpass filter to make it rumbly
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 200;
        filter.Q.value = 0.5;

        this._thrustGain = audioCtx.createGain();
        this._thrustGain.gain.value = 0.15;

        this._thrustNode.connect(filter);
        filter.connect(this._thrustGain);
        this._thrustGain.connect(audioCtx.destination);
        this._thrustNode.start();
    },

    stopThrust() {
        if (this._thrustNode) {
            this._thrustNode.stop();
            this._thrustNode.disconnect();
            this._thrustNode = null;
            this._thrustGain = null;
        }
    },

    // Asteroid explosion — different pitch for each size
    asteroidExplosion(size) {
        if (!soundEnabled) return;
        const freq = size === 'large' ? 60 : size === 'medium' ? 90 : 130;
        const duration = size === 'large' ? 0.4 : size === 'medium' ? 0.3 : 0.2;

        // Noise burst
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 4, audioCtx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(freq, audioCtx.currentTime + duration);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(audioCtx.currentTime);
        noise.stop(audioCtx.currentTime + duration);
    },

    // Ship explosion — longer, deeper rumble
    shipExplosion() {
        if (!soundEnabled) return;
        const duration = 0.8;
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, audioCtx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + duration);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(audioCtx.currentTime);
        noise.stop(audioCtx.currentTime + duration);
    },

    // UFO warble — alternating tone siren
    _ufoNode: null,
    _ufoGain: null,

    startUfo(size) {
        if (!soundEnabled) { this.stopUfo(); return; }
        this.stopUfo();
        const osc = audioCtx.createOscillator();
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        this._ufoGain = audioCtx.createGain();

        const baseFreq = size === 'small' ? 800 : 400;
        const warbleSpeed = size === 'small' ? 12 : 6;
        const warbleDepth = size === 'small' ? 200 : 100;

        osc.type = 'sawtooth';
        osc.frequency.value = baseFreq;

        lfo.type = 'sine';
        lfo.frequency.value = warbleSpeed;
        lfoGain.gain.value = warbleDepth;

        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        this._ufoGain.gain.value = 0.08;
        osc.connect(this._ufoGain);
        this._ufoGain.connect(audioCtx.destination);

        osc.start();
        lfo.start();
        this._ufoNode = { osc, lfo };
    },

    stopUfo() {
        if (this._ufoNode) {
            this._ufoNode.osc.stop();
            this._ufoNode.lfo.stop();
            this._ufoNode.osc.disconnect();
            this._ufoNode.lfo.disconnect();
            this._ufoNode = null;
            if (this._ufoGain) {
                this._ufoGain.disconnect();
                this._ufoGain = null;
            }
        }
    },

    // Extra life ding
    extraLife() {
        if (!soundEnabled) return;
        const notes = [880, 1100, 1320];
        notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'square';
            osc.frequency.value = freq;
            const t = audioCtx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc.start(t);
            osc.stop(t + 0.15);
        });
    },

    // UFO fire
    ufoFire() {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(500, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
    }
};

// --- Game State ---
let ship, bullets, asteroids, ufos, ufoBullets, particles;
let score, highScore, lives, level, gameOver, paused, startScreen;
let keys = {};
let lastUfoSpawn = 0;
let nextExtraLife;
let shipInvincibleUntil = 0;
let lastHyperspace = 0;

// Load high score from localStorage
highScore = parseInt(localStorage.getItem('asteroids_highscore')) || 0;

// --- Input ---
document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
    }
    if (startScreen && e.code === 'Enter') {
        startScreen = false;
        initGame();
    }
    if (gameOver && e.code === 'Enter') {
        startScreen = true;
    }
    if (e.code === 'KeyP' && !startScreen && !gameOver) {
        paused = !paused;
        if (paused) {
            Sound.stopBeat();
            Sound.stopThrust();
            Sound.stopUfo();
        } else {
            Sound.startBeat();
            if (ufos.length > 0) Sound.startUfo(ufos[0].size);
        }
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        activateHyperspace();
    }
    if (e.code === 'KeyF') {
        fireSoundEnabled = !fireSoundEnabled;
    }
    if (e.code === 'KeyS') {
        soundEnabled = !soundEnabled;
        if (!soundEnabled) {
            Sound.stopBeat();
            Sound.stopThrust();
            Sound.stopUfo();
        } else if (!gameOver && !startScreen && !paused) {
            Sound.startBeat();
            if (ufos && ufos.length > 0) Sound.startUfo(ufos[0].size);
        }
    }
});

document.addEventListener('keyup', e => {
    keys[e.code] = false;
});

// --- Utility ---
function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function wrap(obj) {
    if (obj.x < -obj.radius) obj.x = WIDTH + obj.radius;
    if (obj.x > WIDTH + obj.radius) obj.x = -obj.radius;
    if (obj.y < -obj.radius) obj.y = HEIGHT + obj.radius;
    if (obj.y > HEIGHT + obj.radius) obj.y = -obj.radius;
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Ship ---
function createShip() {
    return {
        x: WIDTH / 2,
        y: HEIGHT / 2,
        angle: -Math.PI / 2,
        vx: 0,
        vy: 0,
        radius: SHIP_SIZE,
        thrusting: false,
        dead: false,
        respawnTimer: 0
    };
}

function drawShip() {
    if (ship.dead) return;

    // Blink while invincible
    const now = Date.now();
    if (now < shipInvincibleUntil) {
        if (Math.floor(now / SHIP_BLINK_RATE) % 2 === 0) return;
    }

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle + Math.PI / 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -SHIP_SIZE);
    ctx.lineTo(SHIP_SIZE * 0.7, SHIP_SIZE * 0.7);
    ctx.lineTo(SHIP_SIZE * 0.3, SHIP_SIZE * 0.4);
    ctx.lineTo(-SHIP_SIZE * 0.3, SHIP_SIZE * 0.4);
    ctx.lineTo(-SHIP_SIZE * 0.7, SHIP_SIZE * 0.7);
    ctx.closePath();
    ctx.stroke();

    // Thrust flame
    if (ship.thrusting) {
        ctx.strokeStyle = '#ff0';
        ctx.beginPath();
        ctx.moveTo(-SHIP_SIZE * 0.25, SHIP_SIZE * 0.5);
        ctx.lineTo(0, SHIP_SIZE * 0.7 + rand(3, 10));
        ctx.lineTo(SHIP_SIZE * 0.25, SHIP_SIZE * 0.5);
        ctx.stroke();
    }
    ctx.restore();
}

function updateShip() {
    if (ship.dead) {
        ship.respawnTimer--;
        if (ship.respawnTimer <= 0) {
            respawnShip();
        }
        return;
    }

    // Rotation
    if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= SHIP_TURN_SPEED;
    if (keys['ArrowRight'] || keys['KeyD']) ship.angle += SHIP_TURN_SPEED;

    // Thrust
    const wasThrusting = ship.thrusting;
    ship.thrusting = keys['ArrowUp'] || keys['KeyW'];
    if (ship.thrusting) {
        ship.vx += Math.cos(ship.angle) * SHIP_THRUST;
        ship.vy += Math.sin(ship.angle) * SHIP_THRUST;
        if (!wasThrusting) Sound.startThrust();
    } else if (wasThrusting) {
        Sound.stopThrust();
    }

    // Friction
    ship.vx *= SHIP_FRICTION;
    ship.vy *= SHIP_FRICTION;

    // Movement
    ship.x += ship.vx;
    ship.y += ship.vy;
    wrap(ship);
}

function respawnShip() {
    ship.x = WIDTH / 2;
    ship.y = HEIGHT / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.angle = -Math.PI / 2;
    ship.dead = false;
    shipInvincibleUntil = Date.now() + SHIP_INVINCIBLE_TIME;
}

function destroyShip() {
    if (ship.dead) return;
    ship.dead = true;
    ship.respawnTimer = 120;
    Sound.stopThrust();
    Sound.shipExplosion();

    // Explosion particles
    for (let i = 0; i < 15; i++) {
        particles.push(createParticle(ship.x, ship.y));
    }

    lives--;
    if (lives <= 0) {
        endGame();
    }
}

function activateHyperspace() {
    if (ship.dead || gameOver || startScreen) return;
    const now = Date.now();
    if (now - lastHyperspace < HYPERSPACE_COOLDOWN) return;
    lastHyperspace = now;

    // Random position — small chance of dying
    ship.x = rand(50, WIDTH - 50);
    ship.y = rand(50, HEIGHT - 50);
    ship.vx = 0;
    ship.vy = 0;

    // 1 in 8 chance of blowing up on re-entry
    if (Math.random() < 0.125) {
        destroyShip();
    }
}

// --- Bullets ---
function shoot() {
    if (ship.dead) return;
    if (bullets.length >= MAX_BULLETS) return;

    Sound.fire();
    bullets.push({
        x: ship.x + Math.cos(ship.angle) * SHIP_SIZE,
        y: ship.y + Math.sin(ship.angle) * SHIP_SIZE,
        vx: Math.cos(ship.angle) * BULLET_SPEED + ship.vx * 0.5,
        vy: Math.sin(ship.angle) * BULLET_SPEED + ship.vy * 0.5,
        life: BULLET_LIFETIME,
        radius: 2
    });
}

let shootCooldown = 0;
function handleShooting() {
    if (keys['Space']) {
        if (shootCooldown <= 0) {
            shoot();
            shootCooldown = 8;
        }
    }
    if (shootCooldown > 0) shootCooldown--;
}

function drawBullets(bulletArray) {
    ctx.fillStyle = '#fff';
    bulletArray.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

function updateBullets(bulletArray) {
    for (let i = bulletArray.length - 1; i >= 0; i--) {
        const b = bulletArray[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        // Wrap bullets
        if (b.x < 0) b.x = WIDTH;
        if (b.x > WIDTH) b.x = 0;
        if (b.y < 0) b.y = HEIGHT;
        if (b.y > HEIGHT) b.y = 0;

        if (b.life <= 0) {
            bulletArray.splice(i, 1);
        }
    }
}

// --- Asteroids ---
function createAsteroid(x, y, size) {
    const numVertices = Math.floor(rand(ASTEROID_VERTICES_MIN, ASTEROID_VERTICES_MAX));
    const vertices = [];
    for (let i = 0; i < numVertices; i++) {
        const angle = (i / numVertices) * Math.PI * 2;
        const r = 1 + rand(-ASTEROID_JAGGEDNESS, ASTEROID_JAGGEDNESS);
        vertices.push({ angle, r });
    }

    const speed = ASTEROID_SPEED * (1 + (level - 1) * 0.1);
    const direction = rand(0, Math.PI * 2);

    return {
        x, y,
        vx: Math.cos(direction) * speed * rand(0.5, 1.5),
        vy: Math.sin(direction) * speed * rand(0.5, 1.5),
        radius: ASTEROID_SIZES[size],
        size,
        vertices,
        rotAngle: 0,
        rotSpeed: rand(-0.02, 0.02)
    };
}

function drawAsteroid(a) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rotAngle);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < a.vertices.length; i++) {
        const v = a.vertices[i];
        const px = Math.cos(v.angle) * a.radius * v.r;
        const py = Math.sin(v.angle) * a.radius * v.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

function splitAsteroid(asteroid) {
    const nextSize = asteroid.size === 'large' ? 'medium' : asteroid.size === 'medium' ? 'small' : null;
    if (nextSize) {
        asteroids.push(createAsteroid(asteroid.x, asteroid.y, nextSize));
        asteroids.push(createAsteroid(asteroid.x, asteroid.y, nextSize));
    }
    // Explosion particles
    for (let i = 0; i < 6; i++) {
        particles.push(createParticle(asteroid.x, asteroid.y));
    }
    Sound.asteroidExplosion(asteroid.size);
    score += ASTEROID_SCORES[asteroid.size];
    checkExtraLife();
}

function spawnAsteroids() {
    const count = STARTING_ASTEROIDS + (level - 1);
    for (let i = 0; i < count; i++) {
        let x, y;
        // Spawn away from ship
        do {
            x = rand(0, WIDTH);
            y = rand(0, HEIGHT);
        } while (dist({ x, y }, ship) < 150);
        asteroids.push(createAsteroid(x, y, 'large'));
    }
}

// --- UFO / Saucer ---
function createUfo() {
    const isSmall = score > 10000 && Math.random() > 0.5;
    const size = isSmall ? 'small' : 'large';
    const fromLeft = Math.random() > 0.5;
    return {
        x: fromLeft ? -20 : WIDTH + 20,
        y: rand(50, HEIGHT - 50),
        vx: (fromLeft ? 1 : -1) * UFO_SPEED,
        vy: 0,
        radius: UFO_SIZES[size],
        size,
        lastShot: Date.now(),
        dirChangeTimer: 0
    };
}

function drawUfo(ufo) {
    const r = ufo.radius;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    // Top dome
    ctx.moveTo(ufo.x - r * 0.4, ufo.y - r * 0.3);
    ctx.lineTo(ufo.x - r * 0.15, ufo.y - r * 0.7);
    ctx.lineTo(ufo.x + r * 0.15, ufo.y - r * 0.7);
    ctx.lineTo(ufo.x + r * 0.4, ufo.y - r * 0.3);
    // Middle body
    ctx.lineTo(ufo.x + r, ufo.y);
    ctx.lineTo(ufo.x + r * 0.5, ufo.y + r * 0.4);
    ctx.lineTo(ufo.x - r * 0.5, ufo.y + r * 0.4);
    ctx.lineTo(ufo.x - r, ufo.y);
    ctx.closePath();
    ctx.stroke();
    // Middle line
    ctx.beginPath();
    ctx.moveTo(ufo.x - r, ufo.y);
    ctx.lineTo(ufo.x + r, ufo.y);
    ctx.stroke();
}

function updateUfo(ufo) {
    ufo.x += ufo.vx;
    ufo.y += ufo.vy;

    // Random vertical direction change
    ufo.dirChangeTimer--;
    if (ufo.dirChangeTimer <= 0) {
        ufo.vy = rand(-1.5, 1.5);
        ufo.dirChangeTimer = Math.floor(rand(60, 150));
    }

    // Keep in vertical bounds
    if (ufo.y < 30) ufo.vy = Math.abs(ufo.vy);
    if (ufo.y > HEIGHT - 30) ufo.vy = -Math.abs(ufo.vy);

    // Shoot
    const now = Date.now();
    if (now - ufo.lastShot > UFO_SHOOT_INTERVAL && !ship.dead) {
        ufo.lastShot = now;
        let angle;
        if (ufo.size === 'small') {
            // Aimed shot
            angle = Math.atan2(ship.y - ufo.y, ship.x - ufo.x);
            angle += rand(-0.15, 0.15); // slight inaccuracy
        } else {
            // Random shot
            angle = rand(0, Math.PI * 2);
        }
        Sound.ufoFire();
        ufoBullets.push({
            x: ufo.x,
            y: ufo.y,
            vx: Math.cos(angle) * BULLET_SPEED * 0.8,
            vy: Math.sin(angle) * BULLET_SPEED * 0.8,
            life: BULLET_LIFETIME,
            radius: 2
        });
    }
}

function spawnUfo() {
    if (ufos.length > 0) return;
    const now = Date.now();
    if (now - lastUfoSpawn < UFO_SPAWN_INTERVAL) return;
    lastUfoSpawn = now;
    const newUfo = createUfo();
    Sound.startUfo(newUfo.size);
    ufos.push(newUfo);
}

// --- Particles ---
function createParticle(x, y) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(1, 4);
    return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(20, 50),
        maxLife: 50
    };
}

function drawParticles() {
    particles.forEach(p => {
        const alpha = p.life / p.maxLife;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(p.x, p.y, 1.5, 1.5);
    });
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// --- Collisions ---
function checkCollisions() {
    const now = Date.now();
    const shipVulnerable = !ship.dead && now >= shipInvincibleUntil;

    // Bullets vs Asteroids
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = asteroids.length - 1; j >= 0; j--) {
            if (dist(bullets[i], asteroids[j]) < asteroids[j].radius) {
                splitAsteroid(asteroids[j]);
                asteroids.splice(j, 1);
                bullets.splice(i, 1);
                break;
            }
        }
    }

    // Ship vs Asteroids
    if (shipVulnerable) {
        for (let i = asteroids.length - 1; i >= 0; i--) {
            if (dist(ship, asteroids[i]) < ship.radius + asteroids[i].radius * 0.7) {
                destroyShip();
                break;
            }
        }
    }

    // Bullets vs UFOs
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = ufos.length - 1; j >= 0; j--) {
            if (dist(bullets[i], ufos[j]) < ufos[j].radius) {
                score += UFO_SCORES[ufos[j].size];
                checkExtraLife();
                for (let k = 0; k < 10; k++) {
                    particles.push(createParticle(ufos[j].x, ufos[j].y));
                }
                Sound.stopUfo();
                Sound.asteroidExplosion('large');
                ufos.splice(j, 1);
                bullets.splice(i, 1);
                break;
            }
        }
    }

    // UFO bullets vs Ship
    if (shipVulnerable) {
        for (let i = ufoBullets.length - 1; i >= 0; i--) {
            if (dist(ufoBullets[i], ship) < ship.radius) {
                destroyShip();
                ufoBullets.splice(i, 1);
                break;
            }
        }
    }

    // Ship vs UFOs
    if (shipVulnerable) {
        for (let j = ufos.length - 1; j >= 0; j--) {
            if (dist(ship, ufos[j]) < ship.radius + ufos[j].radius) {
                score += UFO_SCORES[ufos[j].size];
                checkExtraLife();
                for (let k = 0; k < 10; k++) {
                    particles.push(createParticle(ufos[j].x, ufos[j].y));
                }
                Sound.stopUfo();
                ufos.splice(j, 1);
                destroyShip();
                break;
            }
        }
    }
}

// --- Scoring ---
function checkExtraLife() {
    if (score >= nextExtraLife) {
        lives++;
        nextExtraLife += EXTRA_LIFE_SCORE;
        Sound.extraLife();
    }
}

// --- Level Management ---
function nextLevel() {
    level++;
    spawnAsteroids();
}

// --- HUD ---
function drawHUD() {
    // Score
    ctx.fillStyle = '#fff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(score.toString().padStart(6, '0'), 20, 35);

    // High Score
    ctx.textAlign = 'center';
    ctx.font = '14px monospace';
    ctx.fillText(highScore.toString().padStart(6, '0'), WIDTH / 2, 25);

    // Lives (draw small ships)
    for (let i = 0; i < lives; i++) {
        const lx = 30 + i * 25;
        const ly = 60;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5, 6);
        ctx.lineTo(2, 4);
        ctx.lineTo(-2, 4);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
}

// --- Screens ---
function drawStartScreen() {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';

    ctx.font = '48px monospace';
    ctx.fillText('ASTEROIDS', WIDTH / 2, HEIGHT / 2 - 80);

    ctx.font = '16px monospace';
    ctx.fillText('ARROW KEYS / WASD - MOVE & ROTATE', WIDTH / 2, HEIGHT / 2 - 10);
    ctx.fillText('SPACE - FIRE', WIDTH / 2, HEIGHT / 2 + 20);
    ctx.fillText('SHIFT - HYPERSPACE', WIDTH / 2, HEIGHT / 2 + 50);
    ctx.fillText('P - PAUSE', WIDTH / 2, HEIGHT / 2 + 80);

    ctx.font = '20px monospace';
    const blink = Math.floor(Date.now() / 500) % 2;
    if (blink) {
        ctx.fillText('PRESS ENTER TO START', WIDTH / 2, HEIGHT / 2 + 140);
    }
}

function drawGameOver() {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '48px monospace';
    ctx.fillText('GAME OVER', WIDTH / 2, HEIGHT / 2 - 30);
    ctx.font = '20px monospace';
    ctx.fillText('SCORE: ' + score, WIDTH / 2, HEIGHT / 2 + 20);
    if (score >= highScore) {
        ctx.fillText('NEW HIGH SCORE!', WIDTH / 2, HEIGHT / 2 + 55);
    }
    const blink = Math.floor(Date.now() / 500) % 2;
    if (blink) {
        ctx.font = '16px monospace';
        ctx.fillText('PRESS ENTER FOR TITLE SCREEN', WIDTH / 2, HEIGHT / 2 + 100);
    }
}

function drawPaused() {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '32px monospace';
    ctx.fillText('PAUSED', WIDTH / 2, HEIGHT / 2);
}

// --- Game Init ---
function initGame() {
    ship = createShip();
    bullets = [];
    asteroids = [];
    ufos = [];
    ufoBullets = [];
    particles = [];
    score = 0;
    lives = STARTING_LIVES;
    level = 0;
    gameOver = false;
    paused = false;
    shipInvincibleUntil = Date.now() + SHIP_INVINCIBLE_TIME;
    lastUfoSpawn = Date.now();
    nextExtraLife = EXTRA_LIFE_SCORE;
    nextLevel();
    Sound.startBeat();
}

function endGame() {
    gameOver = true;
    Sound.stopBeat();
    Sound.stopThrust();
    Sound.stopUfo();
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('asteroids_highscore', highScore);
    }
}

// --- Main Loop ---
startScreen = true;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (startScreen) {
        drawStartScreen();
        return;
    }

    if (gameOver) {
        drawHUD();
        drawGameOver();
        return;
    }

    if (paused) {
        // Draw everything frozen
        asteroids.forEach(drawAsteroid);
        ufos.forEach(drawUfo);
        drawBullets(bullets);
        drawBullets(ufoBullets);
        drawShip();
        drawParticles();
        drawHUD();
        drawPaused();
        return;
    }

    // --- Update ---
    updateShip();
    handleShooting();
    updateBullets(bullets);
    updateBullets(ufoBullets);

    // Update asteroids
    asteroids.forEach(a => {
        a.x += a.vx;
        a.y += a.vy;
        a.rotAngle += a.rotSpeed;
        wrap(a);
    });

    // Update UFOs
    for (let i = ufos.length - 1; i >= 0; i--) {
        updateUfo(ufos[i]);
        // Remove if off screen
        if (ufos[i].x < -50 || ufos[i].x > WIDTH + 50) {
            Sound.stopUfo();
            ufos.splice(i, 1);
        }
    }

    updateParticles();
    checkCollisions();

    // Next level when all asteroids destroyed
    if (asteroids.length === 0 && ufos.length === 0) {
        nextLevel();
    }

    // Spawn UFO periodically
    spawnUfo();

    // --- Draw ---
    asteroids.forEach(drawAsteroid);
    ufos.forEach(drawUfo);
    drawBullets(bullets);
    drawBullets(ufoBullets);
    drawShip();
    drawParticles();
    drawHUD();
}

gameLoop();

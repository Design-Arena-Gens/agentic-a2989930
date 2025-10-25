(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  const hudScoreEl = document.getElementById('score');
  const hudHiEl = document.getElementById('hiscore');
  const startScreen = document.getElementById('start-screen');
  const gameOverScreen = document.getElementById('gameover-screen');
  const startBtn = document.getElementById('start-btn');
  const retryBtn = document.getElementById('retry-btn');
  const finalScoreEl = document.getElementById('final-score');
  const bestScoreEl = document.getElementById('best-score');

  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnUp = document.getElementById('btn-up');
  const btnDown = document.getElementById('btn-down');

  const GAME = {
    state: 'menu', // 'menu' | 'playing' | 'gameover'
    width: 0,
    height: 0,
    lastTime: 0,
    speed: 320, // px/sec baseline
    speedMultiplier: 1,
    distance: 0,
    rngSeed: Math.floor(Math.random() * 1e9),
  };

  const LANES = 3;
  const COLORS = {
    bg1: '#0b1020',
    bg2: '#121a35',
    laneDark: '#0e1630',
    lane: '#162143',
    accent: '#77f5a8',
    accent2: '#66d1ff',
    danger: '#ff7a7a',
    text: '#e9edf5',
    shadow: 'rgba(0,0,0,.35)'
  };

  const PLAYER = {
    laneIndex: 1,
    x: 0,
    y: 0,
    size: 44,
    color: COLORS.accent,
    vy: 0,
    yOffset: 0,
    isJumping: false,
    isSliding: false,
    slideTimer: 0,
  };

  const PHYSICS = {
    gravity: 1800,
    jumpVelocity: -850,
    slideDuration: 420,
  };

  const WORLD = {
    obstacles: [],
    spawnTimer: 0,
    spawnInterval: 750, // ms
    minInterval: 380,
  };

  function setCanvasSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    GAME.width = w;
    GAME.height = h;
  }

  window.addEventListener('resize', setCanvasSize);
  setCanvasSize();

  function rng() {
    // xorshift32
    let x = GAME.rngSeed || 123456789;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    GAME.rngSeed = x >>> 0;
    return (GAME.rngSeed % 1_000_000) / 1_000_000;
  }

  function laneCenterX(index) {
    const trackWidth = Math.min(GAME.width * 0.75, 540);
    const laneWidth = trackWidth / LANES;
    const left = (GAME.width - trackWidth) / 2;
    return Math.floor(left + laneWidth * index + laneWidth / 2);
  }

  function resetGame() {
    GAME.state = 'playing';
    GAME.speed = 340;
    GAME.speedMultiplier = 1;
    GAME.distance = 0;
    WORLD.obstacles = [];
    WORLD.spawnTimer = 0;
    WORLD.spawnInterval = 750;

    PLAYER.laneIndex = 1;
    PLAYER.vy = 0;
    PLAYER.yOffset = 0;
    PLAYER.isJumping = false;
    PLAYER.isSliding = false;
    PLAYER.slideTimer = 0;
  }

  function endGame() {
    GAME.state = 'gameover';
    const score = Math.floor(GAME.distance);
    finalScoreEl.textContent = String(score);
    const best = Math.max(score, Number(localStorage.getItem('maze_runner_hi') || '0'));
    localStorage.setItem('maze_runner_hi', String(best));
    bestScoreEl.textContent = String(best);

    gameOverScreen.classList.add('show');
    startScreen.classList.remove('show');
  }

  function getHiScore() {
    return Number(localStorage.getItem('maze_runner_hi') || '0');
  }

  function updateHiHud() {
    hudHiEl.textContent = String(getHiScore());
  }

  function spawnObstacle() {
    const pick = rng();
    const lane = Math.floor(rng() * LANES); // 0..2
    const type = pick < 0.65 ? 'rock' : (pick < 0.88 ? 'bar' : 'wall2');
    const y = -60; // start just above screen

    if (type === 'wall2') {
      // Spawn a wide wall blocking two lanes, leaving one lane free
      const blocked = Math.floor(rng() * LANES);
      const blocked2 = (blocked + (rng() < 0.5 ? 1 : 2)) % LANES;
      WORLD.obstacles.push({ type: 'wall', lane: blocked, y, w: 2 });
      WORLD.obstacles.push({ type: 'wall', lane: blocked2, y, w: 2 });
      return;
    }

    WORLD.obstacles.push({ type, lane, y });
  }

  function update(dt) {
    if (GAME.state !== 'playing') return;

    // Speed scaling
    GAME.speedMultiplier += dt * 0.035; // gradually accelerate
    const speed = GAME.speed * GAME.speedMultiplier;
    GAME.distance += (speed * dt) / 6; // scale to a nice score

    hudScoreEl.textContent = String(Math.floor(GAME.distance));

    // Player physics
    if (PLAYER.isJumping) {
      PLAYER.vy += PHYSICS.gravity * dt;
      PLAYER.yOffset += PLAYER.vy * dt;
      if (PLAYER.yOffset >= 0) {
        PLAYER.yOffset = 0;
        PLAYER.vy = 0;
        PLAYER.isJumping = false;
      }
    }
    if (PLAYER.isSliding) {
      PLAYER.slideTimer -= dt * 1000;
      if (PLAYER.slideTimer <= 0) {
        PLAYER.isSliding = false;
      }
    }

    // Spawn obstacles
    WORLD.spawnTimer += dt * 1000;
    const targetInterval = Math.max(WORLD.minInterval, WORLD.spawnInterval - (GAME.distance * 0.5));
    if (WORLD.spawnTimer >= targetInterval) {
      WORLD.spawnTimer = 0;
      spawnObstacle();
    }

    // Move obstacles and detect collisions
    const playerGroundY = GAME.height * 0.78;
    const playerX = laneCenterX(PLAYER.laneIndex);

    for (let i = WORLD.obstacles.length - 1; i >= 0; i--) {
      const o = WORLD.obstacles[i];
      o.y += speed * dt;

      // Remove if off-screen
      if (o.y - 20 > GAME.height) {
        WORLD.obstacles.splice(i, 1);
        continue;
      }

      // Collision checks when near player Y range
      if (Math.abs(o.y - playerGroundY) < 40) {
        if (o.type === 'rock') {
          // Ground obstacle in a single lane
          if (o.lane === PLAYER.laneIndex) {
            const jumped = PLAYER.yOffset < -20; // above small threshold
            if (!jumped) return endGame();
          }
        } else if (o.type === 'bar') {
          // Overhead bar: requires slide
          if (o.lane === PLAYER.laneIndex) {
            const sliding = PLAYER.isSliding;
            if (!sliding) return endGame();
          }
        } else if (o.type === 'wall') {
          // Solid wall occupying a lane column; if in same lane -> hit
          if (o.lane === PLAYER.laneIndex) return endGame();
        }
      }
    }

    // Difficulty: occasionally tighten wall spacing by nudging y positions
    // (purely cosmetic jitter)
  }

  function draw() {
    // Background
    const w = GAME.width, h = GAME.height;
    ctx.clearRect(0, 0, w, h);

    // Gradient road background
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, COLORS.bg2);
    g.addColorStop(1, COLORS.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Draw lanes
    const trackWidth = Math.min(w * 0.75, 540);
    const left = (w - trackWidth) / 2;
    ctx.save();
    ctx.fillStyle = COLORS.laneDark;
    roundRect(ctx, left - 18, 0, trackWidth + 36, h, 22, true, false);

    // Lane columns and perspective stripes
    const laneWidth = trackWidth / LANES;
    for (let i = 0; i < LANES; i++) {
      const x = left + i * laneWidth;
      ctx.fillStyle = i % 2 === 0 ? COLORS.lane : COLORS.laneDark;
      ctx.fillRect(x, 0, laneWidth, h);
    }

    // Moving dashed center lines to imply motion
    const dashH = 36;
    const dashGap = 28;
    const offset = (performance.now() / 8) % (dashH + dashGap);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 1; i < LANES; i++) {
      const cx = left + i * laneWidth;
      for (let y = -offset; y < h; y += dashH + dashGap) {
        ctx.fillRect(cx - 1, y, 2, dashH);
      }
    }

    // Draw obstacles
    for (const o of WORLD.obstacles) {
      if (o.type === 'rock') {
        drawRock(o.lane, o.y);
      } else if (o.type === 'bar') {
        drawBar(o.lane, o.y);
      } else if (o.type === 'wall') {
        drawWall(o.lane, o.y);
      }
    }

    // Draw player
    drawPlayer();

    ctx.restore();
  }

  function drawPlayer() {
    const x = laneCenterX(PLAYER.laneIndex);
    const y = GAME.height * 0.78 + PLAYER.yOffset;
    const size = PLAYER.isSliding ? PLAYER.size * 0.6 : PLAYER.size;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, size * 0.7, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const gradient = ctx.createLinearGradient(x, y - size, x, y + size);
    gradient.addColorStop(0, COLORS.accent);
    gradient.addColorStop(1, COLORS.accent2);
    ctx.fillStyle = gradient;
    roundRect(ctx, x - size / 2, y - size, size, size, 10, true, false);

    // Face highlight
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    roundRect(ctx, x - size / 4, y - size * 0.8, size * 0.18, size * 0.22, 6, true, false);
  }

  function drawRock(lane, y) {
    const x = laneCenterX(lane);
    const w = 52, h = 36;
    ctx.fillStyle = '#b9c7ff';
    roundRect(ctx, x - w / 2, y - h, w, h, 8, true, false);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.fillRect(x - w / 2, y - 6, w, 3);
  }

  function drawBar(lane, y) {
    const x = laneCenterX(lane);
    const w = 62, h = 10;
    ctx.fillStyle = '#ffd966';
    roundRect(ctx, x - w / 2, y - 68, w, h, 4, true, false);
    ctx.fillStyle = '#f7b731';
    roundRect(ctx, x - w / 2 + 10, y - 68 - 16, w - 20, 6, 3, true, false);
  }

  function drawWall(lane, y) {
    const x = laneCenterX(lane);
    const w = Math.min(GAME.width * 0.75, 540) / LANES - 8;
    const h = 80;
    ctx.fillStyle = COLORS.danger;
    roundRect(ctx, x - w / 2, y - h, w, h, 10, true, false);
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (typeof r === 'number') r = {tl:r, tr:r, br:r, bl:r};
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    ctx.lineTo(x + r.bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function changeLane(dir) {
    PLAYER.laneIndex = Math.max(0, Math.min(LANES - 1, PLAYER.laneIndex + dir));
  }

  function jump() {
    if (PLAYER.isJumping || PLAYER.isSliding) return;
    PLAYER.isJumping = true;
    PLAYER.vy = PHYSICS.jumpVelocity;
    PLAYER.yOffset = -1; // lift off
  }

  function slide() {
    if (PLAYER.isJumping || PLAYER.isSliding) return;
    PLAYER.isSliding = true;
    PLAYER.slideTimer = PHYSICS.slideDuration;
  }

  // Input: keyboard
  window.addEventListener('keydown', (e) => {
    if (GAME.state === 'menu') return;
    if (e.key === 'ArrowLeft' || e.key === 'a') changeLane(-1);
    else if (e.key === 'ArrowRight' || e.key === 'd') changeLane(1);
    else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') jump();
    else if (e.key === 'ArrowDown' || e.key === 's') slide();
  });

  // Input: on-screen buttons
  btnLeft.addEventListener('click', () => changeLane(-1));
  btnRight.addEventListener('click', () => changeLane(1));
  btnUp.addEventListener('click', () => jump());
  btnDown.addEventListener('click', () => slide());

  // Input: swipe gestures
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
  const TOUCH_THRESHOLD = 24; // px
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartX = t.clientX; touchStartY = t.clientY; touchStartTime = performance.now();
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (GAME.state !== 'playing') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX; const dy = t.clientY - touchStartY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const dt = performance.now() - touchStartTime;
    if (Math.max(adx, ady) < TOUCH_THRESHOLD && dt < 250) {
      // tap -> jump
      return jump();
    }
    if (adx > ady) {
      if (dx > 0) changeLane(1); else changeLane(-1);
    } else {
      if (dy > 0) slide(); else jump();
    }
  }, { passive: true });

  // Start and retry
  startBtn.addEventListener('click', () => {
    startScreen.classList.remove('show');
    gameOverScreen.classList.remove('show');
    resetGame();
  });
  retryBtn.addEventListener('click', () => {
    gameOverScreen.classList.remove('show');
    resetGame();
  });

  // Show initial hi-score
  updateHiHud();

  function loop(ts) {
    if (!GAME.lastTime) GAME.lastTime = ts;
    const dt = Math.min(0.033, (ts - GAME.lastTime) / 1000);
    GAME.lastTime = ts;

    if (GAME.state === 'playing') update(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

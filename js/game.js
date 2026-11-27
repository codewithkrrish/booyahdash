/* booyahdash — the game itself.
 *
 * Canvas 2D, no dependencies, no build step. The pure rules live in
 * engine.js; this file owns input, rendering, the loop and the HUD.
 * Open index.html and it just plays.
 */
(function () {
  'use strict';

  var E = window.BooyahEngine;
  var Audio = window.BooyahAudio;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  /* ---------- DOM ---------- */
  function $(id) { return document.getElementById(id); }
  var hud = {
    hpFill: $('hp-fill'), hpText: $('hp-text'),
    armorFill: $('armor-fill'), armorRow: $('armor-row'),
    weaponName: $('weapon-name'), ammoText: $('ammo-text'),
    waveText: $('wave-text'), enemiesText: $('enemies-text'),
    scoreText: $('score-text'), killsText: $('kills-text'),
    timerText: $('timer-text'), zoneText: $('zone-text'),
    dashFill: $('dash-fill')
  };
  var overlays = {
    menu: $('menu-screen'), pause: $('pause-screen'),
    gameover: $('gameover-screen'), victory: $('victory-screen')
  };
  var banner = $('banner');
  var vignette = $('damage-vignette');
  var muteBtn = $('mute-btn');
  var touchUI = $('touch-ui');
  var joyBase = $('joy-base'), joyKnob = $('joy-knob');
  var fireBtn = $('fire-btn'), dashBtn = $('dash-btn');

  /* ---------- constants ---------- */
  var PLAYER_SPEED = 235;
  var PLAYER_RADIUS = 16;
  var PLAYER_MAX_HP = 100;
  var DASH_SPEED = 620;
  var DASH_TIME = 0.16;
  var DASH_COOLDOWN = 2.4;
  var CONTACT_DAMAGE_COOLDOWN = 0.7;
  var SPAWN_STAGGER = 0.45;
  var PICKUP_RADIUS = 16;
  var PICKUP_LIFETIME = 25;

  // Crates and rocks: they block movement and bullets, and give the
  // arena somewhere to hide. Fixed layout so the map is learnable.
  var OBSTACLES = [
    { x: 380, y: 300, w: 90, h: 90, kind: 'crate' },
    { x: 1130, y: 260, w: 90, h: 90, kind: 'crate' },
    { x: 700, y: 620, w: 120, h: 70, kind: 'crate' },
    { x: 1050, y: 780, w: 70, h: 120, kind: 'crate' },
    { x: 300, y: 850, w: 110, h: 70, kind: 'rock' },
    { x: 1250, y: 950, w: 100, h: 100, kind: 'rock' },
    { x: 800, y: 180, w: 70, h: 70, kind: 'rock' },
    { x: 620, y: 980, w: 90, h: 90, kind: 'crate' }
  ];

  /* ---------- state ---------- */
  var state = 'menu'; // menu | playing | paused | gameover | victory
  var endless = false;
  var view = { w: 960, h: 600, dpr: 1 };
  var camera = { x: 0, y: 0 };
  var shake = 0;

  var player, enemies, bullets, ebullets, pickups, particles, floaters;
  var spawnQueue, spawnTimer;
  var wave, waveActive, enemiesLeft, runTime, score, kills;
  var zoneCenters = [];
  var zoneWarned = false;
  var lastTime = 0;
  var bannerTimer = null;

  var keys = {};
  var mouse = { x: 0, y: 0, down: false };
  var joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  var touchFiring = false;
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  /* ---------- helpers ---------- */
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function showOverlay(name) {
    Object.keys(overlays).forEach(function (key) {
      overlays[key].classList.toggle('hidden', key !== name);
    });
    if (!name) {
      Object.keys(overlays).forEach(function (key) {
        overlays[key].classList.add('hidden');
      });
    }
  }

  function showBanner(text, subtext, ms) {
    banner.querySelector('.banner-title').textContent = text;
    banner.querySelector('.banner-sub').textContent = subtext || '';
    banner.classList.remove('hidden');
    banner.classList.remove('banner-pop');
    void banner.offsetWidth; // restart the pop animation
    banner.classList.add('banner-pop');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { banner.classList.add('hidden'); }, ms || 2200);
  }

  function flashDamage() {
    vignette.classList.remove('hidden');
    vignette.classList.remove('flash');
    void vignette.offsetWidth;
    vignette.classList.add('flash');
    setTimeout(function () { vignette.classList.add('hidden'); }, 350);
  }

  /* Zone centre drifts a little each phase. Centres are rolled when a
   * run starts so every match plays differently. */
  function rollZoneCenters() {
    zoneCenters = [{ x: E.WORLD_W / 2, y: E.WORLD_H / 2 }];
    for (var i = 1; i < E.ZONE_PHASES.length; i++) {
      var prev = zoneCenters[i - 1];
      var r = E.ZONE_PHASES[i].radius;
      zoneCenters.push({
        x: E.clamp(prev.x + rand(-220, 220), r * 0.6, E.WORLD_W - r * 0.6),
        y: E.clamp(prev.y + rand(-220, 220), r * 0.6, E.WORLD_H - r * 0.6)
      });
    }
  }

  function zoneCenterAt(t) {
    var phases = E.ZONE_PHASES;
    var last = phases[phases.length - 1];
    if (t >= last.at) return zoneCenters[zoneCenters.length - 1];
    for (var i = 1; i < phases.length; i++) {
      if (t <= phases[i].at) {
        var f = (t - phases[i - 1].at) / (phases[i].at - phases[i - 1].at);
        var a = zoneCenters[i - 1], b = zoneCenters[i];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return zoneCenters[0];
  }

  function nextPhaseIn(t) {
    for (var i = 0; i < E.ZONE_PHASES.length; i++) {
      if (E.ZONE_PHASES[i].at > t) return E.ZONE_PHASES[i].at - t;
    }
    return 0;
  }

  /* ---------- run setup ---------- */
  function resetRun() {
    player = {
      x: E.WORLD_W / 2, y: E.WORLD_H / 2,
      hp: PLAYER_MAX_HP, armor: 0,
      weapon: 'pistol', ammo: Infinity,
      angle: -Math.PI / 2, speed: PLAYER_SPEED,
      radius: PLAYER_RADIUS,
      dashTime: 0, dashCooldown: 0, dashX: 0, dashY: 0,
      lastShot: 0, hurtCooldown: 0, moving: false
    };
    enemies = []; bullets = []; ebullets = [];
    pickups = []; particles = []; floaters = [];
    spawnQueue = []; spawnTimer = 0;
    wave = 0; waveActive = false; enemiesLeft = 0;
    runTime = 0; score = 0; kills = 0;
    endless = false;
    zoneWarned = false;
    shake = 0;
    rollZoneCenters();
    // a couple of pickups on the floor so the first minute isn't bare
    spawnPickup('medkit', E.WORLD_W / 2 - 160, E.WORLD_H / 2 + 120);
    spawnPickup('smg', E.WORLD_W / 2 + 180, E.WORLD_H / 2 - 100);
  }

  function startGame() {
    Audio.ensureContext();
    Audio.sounds.click();
    resetRun();
    state = 'playing';
    showOverlay(null);
    updateScoresUI();
    startWave(1);
    updateHUD();
  }

  function startWave(n) {
    wave = n;
    waveActive = true;
    var comp = E.waveComposition(n);
    spawnQueue = [];
    comp.forEach(function (entry) {
      for (var i = 0; i < entry.count; i++) spawnQueue.push(entry.type);
    });
    // shuffle so the wave doesn't arrive in neat type order
    for (var i = spawnQueue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = spawnQueue[i]; spawnQueue[i] = spawnQueue[j]; spawnQueue[j] = tmp;
    }
    spawnTimer = 0.2;
    enemiesLeft = spawnQueue.length;
    showBanner('WAVE ' + n, n === E.MAX_WAVE ? 'Last wave — take the Booyah' : enemiesLeft + ' enemies incoming');
    Audio.sounds.waveStart();
  }

  function spawnEnemy(type) {
    var def = E.ENEMIES[type];
    var x, y, tries = 0;
    do {
      var edge = randInt(0, 3);
      if (edge === 0) { x = rand(40, E.WORLD_W - 40); y = 40; }
      else if (edge === 1) { x = rand(40, E.WORLD_W - 40); y = E.WORLD_H - 40; }
      else if (edge === 2) { x = 40; y = rand(40, E.WORLD_H - 40); }
      else { x = E.WORLD_W - 40; y = rand(40, E.WORLD_H - 40); }
      tries++;
    } while (E.dist(x, y, player.x, player.y) < 320 && tries < 12);
    var pos = E.clampToArena(x, y, def.radius);
    enemies.push({
      type: type, def: def, x: pos.x, y: pos.y,
      hp: def.hp, maxHp: def.hp,
      angle: 0, shootTimer: rand(0.5, 1.5),
      hitCooldown: 0, flash: 0, wobble: rand(0, Math.PI * 2)
    });
  }

  function spawnPickup(kind, x, y) {
    pickups.push({
      kind: kind, x: x, y: y,
      born: runTime, bob: rand(0, Math.PI * 2)
    });
  }

  function dropPickup(x, y) {
    var kind = E.rollDrop(Math.random, wave);
    if (kind) spawnPickup(kind, x, y);
  }

  /* ---------- combat ---------- */
  function fireWeapon() {
    var def = E.WEAPONS[player.weapon];
    var now = performance.now();
    if (now - player.lastShot < def.fireRateMs) return;
    player.lastShot = now;
    for (var i = 0; i < def.pellets; i++) {
      var spread = (Math.random() - 0.5) * 2 * def.spread;
      var angle = player.angle + spread;
      bullets.push({
        x: player.x + Math.cos(angle) * (player.radius + 8),
        y: player.y + Math.sin(angle) * (player.radius + 8),
        vx: Math.cos(angle) * def.bulletSpeed,
        vy: Math.sin(angle) * def.bulletSpeed,
        damage: def.damage, traveled: 0, range: def.range,
        color: def.color
      });
    }
    // muzzle flash
    addParticles(player.x + Math.cos(player.angle) * 26,
      player.y + Math.sin(player.angle) * 26, 3, def.color, 90, 0.12);
    if (player.ammo !== Infinity) {
      player.ammo -= 1;
      if (player.ammo <= 0) {
        player.weapon = 'pistol';
        player.ammo = Infinity;
        showBanner('BACK TO PISTOL', 'Out of ammo — grab a weapon drop', 1400);
      }
    }
    Audio.sounds.shoot(player.weapon);
  }

  function damagePlayer(amount) {
    if (player.hurtCooldown > 0 || player.dashTime > 0) return;
    var remaining = amount;
    if (player.armor > 0) {
      var absorbed = Math.min(player.armor, remaining);
      player.armor -= absorbed;
      remaining -= absorbed;
    }
    player.hp -= remaining;
    player.hurtCooldown = 0.35;
    shake = Math.max(shake, 7);
    flashDamage();
    Audio.sounds.playerHurt();
    if (player.hp <= 0) {
      player.hp = 0;
      endRun(false);
    }
  }

  function killEnemy(enemy, index) {
    var gained = E.scoreForKill(enemy.type, wave);
    score += gained;
    kills += 1;
    addFloater(enemy.x, enemy.y, '+' + gained, '#ffd166');
    addParticles(enemy.x, enemy.y, enemy.type === 'brute' ? 22 : 12,
      enemy.def.color, 160, 0.5);
    if (enemy.type === 'brute') shake = Math.max(shake, 5);
    dropPickup(enemy.x, enemy.y);
    enemies.splice(index, 1);
    enemiesLeft -= 1;
    Audio.sounds.enemyDown();
  }

  function applyPickup(p) {
    if (p.kind === 'medkit') {
      player.hp = Math.min(PLAYER_MAX_HP, player.hp + 40);
      addFloater(player.x, player.y - 24, '+40 HP', '#7dff6a');
    } else if (p.kind === 'armor') {
      player.armor = Math.min(50, player.armor + 25);
      addFloater(player.x, player.y - 24, '+25 ARMOR', '#4dd2ff');
    } else {
      var def = E.WEAPONS[p.kind];
      player.weapon = p.kind;
      player.ammo = def.ammo;
      addFloater(player.x, player.y - 24, def.name.toUpperCase(), def.color);
    }
    addParticles(p.x, p.y, 10, '#ffffff', 120, 0.35);
    Audio.sounds.pickup();
  }

  function addParticles(x, y, count, color, speed, life) {
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var s = rand(speed * 0.3, speed);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(life * 0.5, life), maxLife: life,
        color: color, size: rand(2, 4.5)
      });
    }
  }

  function addFloater(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color, life: 0.9 });
  }

  /* ---------- collision helpers ---------- */
  function circleHitsObstacle(x, y, r) {
    for (var i = 0; i < OBSTACLES.length; i++) {
      var o = OBSTACLES[i];
      var cx = E.clamp(x, o.x, o.x + o.w);
      var cy = E.clamp(y, o.y, o.y + o.h);
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) return o;
    }
    return null;
  }

  function moveWithCollision(ent, nx, ny, radius) {
    var pos = E.clampToArena(nx, ny, radius);
    nx = pos.x; ny = pos.y;
    if (!circleHitsObstacle(nx, ent.y, radius)) ent.x = nx;
    if (!circleHitsObstacle(ent.x, ny, radius)) ent.y = ny;
  }

  /* ---------- update ---------- */
  function update(dt) {
    runTime += dt;
    if (player.hurtCooldown > 0) player.hurtCooldown -= dt;
    if (player.dashCooldown > 0) player.dashCooldown -= dt;

    // --- spawning
    if (spawnQueue.length > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy(spawnQueue.shift());
        spawnTimer = SPAWN_STAGGER;
      }
    } else if (waveActive && enemies.length === 0) {
      waveActive = false;
      var bonus = E.waveClearBonus(wave);
      score += bonus;
      if (wave >= E.MAX_WAVE && !endless) {
        endRun(true);
        updateHUD();
        return;
      }
      showBanner('WAVE ' + wave + ' CLEAR', '+' + bonus + ' bonus — next wave incoming', 2000);
      Audio.sounds.waveClear();
      setTimeout(function () {
        if (state === 'playing') startWave(wave + 1);
      }, 2200);
    }

    // --- player aim
    if (isTouch && (touchFiring || joy.active)) {
      // touch: auto-aim at the nearest enemy while firing
      var nearest = nearestEnemy();
      if (nearest) {
        player.angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
      }
    } else {
      var wx = mouse.x + camera.x, wy = mouse.y + camera.y;
      player.angle = Math.atan2(wy - player.y, wx - player.x);
    }

    // --- player movement (keys or joystick)
    var mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (joy.active) { mx = joy.dx; my = joy.dy; }
    var mag = Math.sqrt(mx * mx + my * my);
    if (mag > 1) { mx /= mag; my /= mag; }
    player.moving = mag > 0.05;

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      moveWithCollision(player,
        player.x + player.dashX * DASH_SPEED * dt,
        player.y + player.dashY * DASH_SPEED * dt, player.radius);
    } else if (player.moving) {
      moveWithCollision(player,
        player.x + mx * player.speed * dt,
        player.y + my * player.speed * dt, player.radius);
    }

    if ((mouse.down || touchFiring) && state === 'playing') fireWeapon();

    // --- zone
    var zc = zoneCenterAt(runTime);
    var zr = E.zoneRadiusAt(runTime);
    var inZone = E.dist(player.x, player.y, zc.x, zc.y) <= zr;
    if (!inZone) {
      player.hp -= E.zoneDamage(dt, false);
      if (!zoneWarned) {
        zoneWarned = true;
        showBanner('GET INSIDE THE ZONE', 'The zone is eating your health', 1600);
        Audio.sounds.zoneWarn();
      }
      if (player.hp <= 0) { player.hp = 0; endRun(false); updateHUD(); return; }
    } else {
      zoneWarned = false;
    }

    // --- enemies
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.flash > 0) e.flash -= dt;
      if (e.hitCooldown > 0) e.hitCooldown -= dt;
      var d = E.dist(e.x, e.y, player.x, player.y);
      var ang = Math.atan2(player.y - e.y, player.x - e.x);
      e.angle = ang;
      if (e.type === 'gunner') {
        if (d > e.def.shootRange) {
          moveWithCollision(e, e.x + Math.cos(ang) * e.def.speed * dt,
            e.y + Math.sin(ang) * e.def.speed * dt, e.def.radius);
        } else if (d < e.def.shootRange * 0.6) {
          moveWithCollision(e, e.x - Math.cos(ang) * e.def.speed * 0.6 * dt,
            e.y - Math.sin(ang) * e.def.speed * 0.6 * dt, e.def.radius);
        }
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && d < e.def.shootRange + 60) {
          e.shootTimer = e.def.shootCooldownMs / 1000 * rand(0.9, 1.2);
          ebullets.push({
            x: e.x + Math.cos(ang) * (e.def.radius + 6),
            y: e.y + Math.sin(ang) * (e.def.radius + 6),
            vx: Math.cos(ang) * e.def.bulletSpeed,
            vy: Math.sin(ang) * e.def.bulletSpeed,
            damage: e.def.damage, traveled: 0, range: e.def.shootRange + 120
          });
        }
      } else {
        // rushers wobble a little so they don't march in a straight line
        var wob = e.type === 'rusher' ? Math.sin(runTime * 3 + e.wobble) * 0.35 : 0;
        var ma = ang + wob;
        moveWithCollision(e, e.x + Math.cos(ma) * e.def.speed * dt,
          e.y + Math.sin(ma) * e.def.speed * dt, e.def.radius);
      }
      // contact damage
      if (E.circlesHit(e.x, e.y, e.def.radius, player.x, player.y, player.radius)) {
        if (e.hitCooldown <= 0) {
          e.hitCooldown = CONTACT_DAMAGE_COOLDOWN;
          damagePlayer(e.def.damage);
        }
      }
    }
    // enemies push each other apart so they don't stack into one blob
    for (var a = 0; a < enemies.length; a++) {
      for (var b = a + 1; b < enemies.length; b++) {
        var ea = enemies[a], eb = enemies[b];
        var dx = eb.x - ea.x, dy = eb.y - ea.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        var min = ea.def.radius + eb.def.radius;
        if (dd > 0 && dd < min) {
          var push = (min - dd) / 2;
          var nx = dx / dd, ny = dy / dd;
          ea.x -= nx * push; ea.y -= ny * push;
          eb.x += nx * push; eb.y += ny * push;
        }
      }
    }

    // --- player bullets
    for (var bi = bullets.length - 1; bi >= 0; bi--) {
      var bl = bullets[bi];
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      bl.traveled += Math.sqrt(bl.vx * bl.vx + bl.vy * bl.vy) * dt;
      var dead = bl.traveled > bl.range ||
        bl.x < 0 || bl.x > E.WORLD_W || bl.y < 0 || bl.y > E.WORLD_H ||
        circleHitsObstacle(bl.x, bl.y, 2);
      if (!dead) {
        for (var ei = enemies.length - 1; ei >= 0; ei--) {
          var en = enemies[ei];
          if (E.circlesHit(bl.x, bl.y, 3, en.x, en.y, en.def.radius)) {
            en.hp -= bl.damage;
            en.flash = 0.12;
            addParticles(bl.x, bl.y, 4, '#ffffff', 120, 0.25);
            Audio.sounds.enemyHit();
            dead = true;
            if (en.hp <= 0) killEnemy(en, ei);
            break;
          }
        }
      }
      if (dead) bullets.splice(bi, 1);
    }

    // --- enemy bullets
    for (var ei2 = ebullets.length - 1; ei2 >= 0; ei2--) {
      var eb2 = ebullets[ei2];
      eb2.x += eb2.vx * dt; eb2.y += eb2.vy * dt;
      eb2.traveled += Math.sqrt(eb2.vx * eb2.vx + eb2.vy * eb2.vy) * dt;
      var dead2 = eb2.traveled > eb2.range ||
        eb2.x < 0 || eb2.x > E.WORLD_W || eb2.y < 0 || eb2.y > E.WORLD_H ||
        circleHitsObstacle(eb2.x, eb2.y, 2);
      if (!dead2 && E.circlesHit(eb2.x, eb2.y, 4, player.x, player.y, player.radius)) {
        damagePlayer(eb2.damage);
        dead2 = true;
      }
      if (dead2) ebullets.splice(ei2, 1);
    }

    // --- pickups
    for (var pi = pickups.length - 1; pi >= 0; pi--) {
      var p = pickups[pi];
      if (runTime - p.born > PICKUP_LIFETIME) { pickups.splice(pi, 1); continue; }
      if (E.circlesHit(p.x, p.y, PICKUP_RADIUS, player.x, player.y, player.radius)) {
        applyPickup(p);
        pickups.splice(pi, 1);
      }
    }

    // --- particles / floaters
    for (var qi = particles.length - 1; qi >= 0; qi--) {
      var pt = particles[qi];
      pt.life -= dt;
      if (pt.life <= 0) { particles.splice(qi, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.92; pt.vy *= 0.92;
    }
    for (var fi = floaters.length - 1; fi >= 0; fi--) {
      floaters[fi].life -= dt;
      floaters[fi].y -= 34 * dt;
      if (floaters[fi].life <= 0) floaters.splice(fi, 1);
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 26);

    updateHUD();
  }

  function nearestEnemy() {
    var best = null, bestD = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var d = E.dist(enemies[i].x, enemies[i].y, player.x, player.y);
      if (d < bestD) { bestD = d; best = enemies[i]; }
    }
    return best;
  }

  function tryDash() {
    if (state !== 'playing' || player.dashCooldown > 0 || player.dashTime > 0) return;
    var mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (joy.active) { mx = joy.dx; my = joy.dy; }
    if (mx === 0 && my === 0) { mx = Math.cos(player.angle); my = Math.sin(player.angle); }
    var mag = Math.sqrt(mx * mx + my * my);
    player.dashX = mx / mag; player.dashY = my / mag;
    player.dashTime = DASH_TIME;
    player.dashCooldown = DASH_COOLDOWN;
    Audio.sounds.dash();
  }

  /* ---------- end of run ---------- */
  function endRun(won) {
    if (state !== 'playing') return;
    var entry = {
      score: score, wave: wave, kills: kills, time: Math.floor(runTime),
      date: new Date().toISOString().slice(0, 10)
    };
    var scores = E.saveScore(entry);
    var rank = scores.indexOf(scores.find(function (s) {
      return s.score === entry.score && s.wave === entry.wave && s.kills === entry.kills;
    }));
    if (won) {
      state = 'victory';
      Audio.sounds.booyah();
      $('victory-stats').innerHTML = statRows(entry, rank);
      renderScoreTable($('victory-scores'), scores);
      showOverlay('victory');
    } else {
      state = 'gameover';
      Audio.sounds.gameOver();
      $('gameover-stats').innerHTML = statRows(entry, rank);
      renderScoreTable($('gameover-scores'), scores);
      showOverlay('gameover');
    }
    updateScoresUI();
  }

  function statRows(entry, rank) {
    var rows = [
      ['Score', entry.score.toLocaleString('en-US')],
      ['Wave reached', entry.wave + (endless ? ' (endless)' : ' / ' + E.MAX_WAVE)],
      ['Kills', entry.kills],
      ['Survived', E.formatTime(entry.time)]
    ];
    if (rank >= 0 && rank < E.MAX_SCORES) {
      rows.push(['Leaderboard', '#' + (rank + 1) + (rank === 0 ? ' — new best run' : ' — on the board')]);
    }
    return rows.map(function (r) {
      return '<div class="stat-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>';
    }).join('');
  }

  function renderScoreTable(el, scores) {
    if (!scores || scores.length === 0) {
      el.innerHTML = '<p class="muted">No runs yet — be the first on the board.</p>';
      return;
    }
    el.innerHTML = '<ol class="score-list">' + scores.map(function (s, i) {
      return '<li><span class="rank">#' + (i + 1) + '</span>' +
        '<span class="s-score">' + s.score.toLocaleString('en-US') + '</span>' +
        '<span class="s-meta">Wave ' + s.wave + ' · ' + s.kills + ' kills · ' + E.formatTime(s.time) + ' · ' + s.date + '</span></li>';
    }).join('') + '</ol>';
  }

  function updateScoresUI() {
    var scores = E.loadScores();
    renderScoreTable($('menu-scores'), scores);
    var best = E.bestScore();
    $('best-score').textContent = best > 0
      ? 'Best run: ' + best.toLocaleString('en-US') + ' pts'
      : 'No runs yet — set the first score.';
  }

  /* ---------- rendering ---------- */
  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(320, Math.floor(rect.width));
    view.h = Math.max(320, Math.floor(Math.min(rect.height, window.innerHeight * 0.72)));
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
  }

  function worldToScreen(x, y) {
    return { x: x - camera.x, y: y - camera.y };
  }

  function draw() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    // camera follows the player, clamped to the world
    var sx = shake > 0 ? rand(-shake, shake) : 0;
    var sy = shake > 0 ? rand(-shake, shake) : 0;
    camera.x = E.clamp(player.x - view.w / 2 + sx, 0, Math.max(0, E.WORLD_W - view.w));
    camera.y = E.clamp(player.y - view.h / 2 + sy, 0, Math.max(0, E.WORLD_H - view.h));

    drawFloor();
    drawZone();
    drawObstacles();
    drawPickups();
    drawEnemies();
    drawPlayer();
    drawBullets();
    drawParticles();
    drawFloaters();
    drawMinimap();
  }

  function drawFloor() {
    ctx.fillStyle = '#171a1f';
    ctx.fillRect(0, 0, view.w, view.h);
    var startX = Math.floor(camera.x / 80) * 80;
    var startY = Math.floor(camera.y / 80) * 80;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = startX; x < camera.x + view.w + 80; x += 80) {
      ctx.moveTo(x - camera.x, 0);
      ctx.lineTo(x - camera.x, view.h);
    }
    for (var y = startY; y < camera.y + view.h + 80; y += 80) {
      ctx.moveTo(0, y - camera.y);
      ctx.lineTo(view.w, y - camera.y);
    }
    ctx.stroke();
    // arena border
    ctx.strokeStyle = '#ff6b1a';
    ctx.lineWidth = 3;
    ctx.strokeRect(-camera.x, -camera.y, E.WORLD_W, E.WORLD_H);
  }

  function drawZone() {
    var zc = zoneCenterAt(runTime);
    var zr = E.zoneRadiusAt(runTime);
    var s = worldToScreen(zc.x, zc.y);
    // darken everything outside the zone
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.w, view.h);
    ctx.arc(s.x, s.y, zr, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(120, 10, 30, 0.30)';
    ctx.fill('evenodd');
    ctx.restore();
    // zone ring
    ctx.beginPath();
    ctx.arc(s.x, s.y, zr, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff2e4d';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, zr - 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,46,77,0.25)';
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  function drawObstacles() {
    OBSTACLES.forEach(function (o) {
      var s = worldToScreen(o.x, o.y);
      if (s.x + o.w < 0 || s.y + o.h < 0 || s.x > view.w || s.y > view.h) return;
      if (o.kind === 'crate') {
        ctx.fillStyle = '#2b2f36';
        ctx.fillRect(s.x, s.y, o.w, o.h);
        ctx.strokeStyle = '#ff9f43';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 2, s.y + 2, o.w - 4, o.h - 4);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + o.w, s.y + o.h);
        ctx.moveTo(s.x + o.w, s.y); ctx.lineTo(s.x, s.y + o.h);
        ctx.strokeStyle = 'rgba(255,159,67,0.4)';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#26292f';
        ctx.beginPath();
        ctx.ellipse(s.x + o.w / 2, s.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3a3f47';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  function pickupStyle(kind) {
    switch (kind) {
      case 'medkit': return { color: '#7dff6a', label: '+' };
      case 'armor': return { color: '#4dd2ff', label: 'A' };
      case 'smg': return { color: '#7dff6a', label: 'S' };
      case 'shotgun': return { color: '#ff9f43', label: 'G' };
      case 'rifle': return { color: '#4dd2ff', label: 'R' };
      default: return { color: '#ffffff', label: '?' };
    }
  }

  function drawPickups() {
    pickups.forEach(function (p) {
      var s = worldToScreen(p.x, p.y);
      var bob = Math.sin(runTime * 3 + p.bob) * 3;
      var style = pickupStyle(p.kind);
      var blink = (runTime - p.born > PICKUP_LIFETIME - 5)
        ? (Math.floor(runTime * 6) % 2 === 0 ? 0.35 : 1) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.arc(s.x, s.y + bob, PICKUP_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#101216';
      ctx.fill();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = style.color;
      ctx.font = 'bold 15px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(style.label, s.x, s.y + bob + 0.5);
      ctx.restore();
    });
  }

  function drawEnemies() {
    enemies.forEach(function (e) {
      var s = worldToScreen(e.x, e.y);
      if (s.x < -60 || s.y < -60 || s.x > view.w + 60 || s.y > view.h + 60) return;
      // shadow
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + e.def.radius * 0.8, e.def.radius * 0.9, e.def.radius * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      // body
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.def.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.def.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // direction tick (gun barrel for gunners)
      if (e.type === 'gunner') {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(e.angle) * (e.def.radius + 10),
          s.y + Math.sin(e.angle) * (e.def.radius + 10));
        ctx.strokeStyle = e.def.color;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      // eyes
      var ex = Math.cos(e.angle), ey = Math.sin(e.angle);
      var px = -ey, py = ex;
      ctx.fillStyle = '#101216';
      ctx.beginPath();
      ctx.arc(s.x + ex * 5 + px * 6, s.y + ey * 5 + py * 6, 3, 0, Math.PI * 2);
      ctx.arc(s.x + ex * 5 - px * 6, s.y + ey * 5 - py * 6, 3, 0, Math.PI * 2);
      ctx.fill();
      // hp bar
      if (e.hp < e.maxHp) {
        var w = e.def.radius * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x - w / 2, s.y - e.def.radius - 10, w, 5);
        ctx.fillStyle = '#ff5d5d';
        ctx.fillRect(s.x - w / 2, s.y - e.def.radius - 10, w * (e.hp / e.maxHp), 5);
      }
    });
  }

  function drawPlayer() {
    var s = worldToScreen(player.x, player.y);
    // dash trail
    if (player.dashTime > 0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, player.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,209,102,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // shadow
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + player.radius * 0.85, player.radius * 0.9, player.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.arc(s.x, s.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.strokeStyle = '#101216';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // gun
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(player.angle) * (player.radius + 14),
      s.y + Math.sin(player.angle) * (player.radius + 14));
    ctx.strokeStyle = '#101216';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    // visor
    ctx.beginPath();
    ctx.arc(s.x + Math.cos(player.angle) * 6, s.y + Math.sin(player.angle) * 6, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#101216';
    ctx.fill();
    // armor ring
    if (player.armor > 0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, player.radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(77,210,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // hurt flicker
    if (player.hurtCooldown > 0.2) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, player.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,46,77,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawBullets() {
    bullets.forEach(function (b) {
      var s = worldToScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(s.x - b.vx * 0.012, s.y - b.vy * 0.012);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    });
    ebullets.forEach(function (b) {
      var s = worldToScreen(b.x, b.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5d5d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,93,93,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function drawParticles() {
    particles.forEach(function (p) {
      var s = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(s.x - p.size / 2, s.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    floaters.forEach(function (f) {
      var s = worldToScreen(f.x, f.y);
      ctx.globalAlpha = Math.min(1, f.life / 0.4);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    var mw = 132, mh = 99;
    var mx = view.w - mw - 12, my = 12;
    var kx = mw / E.WORLD_W, ky = mh / E.WORLD_H;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = 'rgba(10,12,14,0.85)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mw, mh);
    var zc = zoneCenterAt(runTime);
    var zr = E.zoneRadiusAt(runTime);
    ctx.beginPath();
    ctx.arc(mx + zc.x * kx, my + zc.y * ky, zr * kx, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff2e4d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    enemies.forEach(function (e) {
      ctx.fillStyle = e.def.color;
      ctx.fillRect(mx + e.x * kx - 1.5, my + e.y * ky - 1.5, 3, 3);
    });
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(mx + player.x * kx, my + player.y * ky, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#101216';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- HUD ---------- */
  function updateHUD() {
    if (!player) return;
    var hpPct = Math.max(0, player.hp / PLAYER_MAX_HP * 100);
    hud.hpFill.style.width = hpPct + '%';
    hud.hpFill.classList.toggle('low', hpPct <= 30);
    hud.hpText.textContent = Math.ceil(player.hp) + ' / ' + PLAYER_MAX_HP;
    hud.armorRow.style.display = player.armor > 0 ? 'flex' : 'none';
    hud.armorFill.style.width = Math.min(100, player.armor / 50 * 100) + '%';
    var def = E.WEAPONS[player.weapon];
    hud.weaponName.textContent = def.name;
    hud.ammoText.textContent = player.ammo === Infinity ? '∞' : player.ammo + ' rounds';
    hud.waveText.textContent = 'Wave ' + wave + (endless ? ' (endless)' : ' / ' + E.MAX_WAVE);
    hud.enemiesText.textContent = (enemies.length + spawnQueue.length) + ' left';
    hud.scoreText.textContent = score.toLocaleString('en-US');
    hud.killsText.textContent = kills + ' kills';
    hud.timerText.textContent = E.formatTime(runTime);
    var next = nextPhaseIn(runTime);
    var zc = zoneCenterAt(runTime);
    var inside = E.dist(player.x, player.y, zc.x, zc.y) <= E.zoneRadiusAt(runTime);
    hud.zoneText.textContent = inside
      ? (next > 0 ? 'Zone shrinks in ' + Math.ceil(next) + 's' : 'Zone at smallest')
      : 'OUTSIDE ZONE';
    hud.zoneText.classList.toggle('danger', !inside);
    var dashPct = player.dashCooldown > 0
      ? (1 - player.dashCooldown / DASH_COOLDOWN) * 100 : 100;
    hud.dashFill.style.width = dashPct + '%';
  }

  /* ---------- main loop ---------- */
  function loop(timestamp) {
    requestAnimationFrame(loop);
    if (state !== 'playing') {
      // still render the arena behind overlays so the menu isn't a black box
      if (player) draw();
      lastTime = timestamp;
      return;
    }
    var dt = Math.min((timestamp - lastTime) / 1000, 1 / 30);
    lastTime = timestamp;
    if (dt > 0) update(dt);
    draw();
  }

  /* ---------- input: keyboard ---------- */
  document.addEventListener('keydown', function (ev) {
    var key = ev.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(key) >= 0) {
      ev.preventDefault();
    }
    keys[key] = true;
    if (key === ' ' || key === 'shift') tryDash();
    if (key === 'escape' || key === 'p') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    }
    if (key === 'enter' && state === 'menu') startGame();
    if (key === 'm') toggleMute();
  });
  document.addEventListener('keyup', function (ev) {
    keys[ev.key.toLowerCase()] = false;
  });

  /* ---------- input: mouse ---------- */
  canvas.addEventListener('mousemove', function (ev) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = ev.clientX - rect.left;
    mouse.y = ev.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', function (ev) {
    if (ev.button === 0) mouse.down = true;
    Audio.ensureContext();
  });
  document.addEventListener('mouseup', function () { mouse.down = false; });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  /* ---------- input: touch ---------- */
  function touchPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  canvas.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    Audio.ensureContext();
    for (var i = 0; i < ev.changedTouches.length; i++) {
      var t = ev.changedTouches[i];
      var p = touchPos(t);
      if (p.x < view.w * 0.5 && !joy.active) {
        joy.active = true; joy.id = t.identifier;
        joy.ox = p.x; joy.oy = p.y; joy.dx = 0; joy.dy = 0;
        positionJoystick(p.x, p.y, p.x, p.y);
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function (ev) {
    ev.preventDefault();
    for (var i = 0; i < ev.changedTouches.length; i++) {
      var t = ev.changedTouches[i];
      if (joy.active && t.identifier === joy.id) {
        var p = touchPos(t);
        var dx = p.x - joy.ox, dy = p.y - joy.oy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var max = 56;
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        joy.dx = dx / max; joy.dy = dy / max;
        positionJoystick(joy.ox, joy.oy, joy.ox + dx, joy.oy + dy);
      }
    }
  }, { passive: false });

  function endTouch(ev) {
    for (var i = 0; i < ev.changedTouches.length; i++) {
      if (joy.active && ev.changedTouches[i].identifier === joy.id) {
        joy.active = false; joy.dx = 0; joy.dy = 0;
        joyBase.classList.add('hidden');
      }
    }
  }
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  function positionJoystick(bx, by, kx, ky) {
    var rect = canvas.getBoundingClientRect();
    joyBase.style.left = (rect.left + bx - 56) + 'px';
    joyBase.style.top = (rect.top + by - 56) + 'px';
    joyKnob.style.left = (kx - bx + 56 - 24) + 'px';
    joyKnob.style.top = (ky - by + 56 - 24) + 'px';
    joyBase.classList.remove('hidden');
  }

  fireBtn.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    touchFiring = true;
    Audio.ensureContext();
  }, { passive: false });
  fireBtn.addEventListener('touchend', function (ev) {
    ev.preventDefault();
    touchFiring = false;
  }, { passive: false });
  fireBtn.addEventListener('mousedown', function () { touchFiring = true; });
  fireBtn.addEventListener('mouseup', function () { touchFiring = false; });
  dashBtn.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    tryDash();
  }, { passive: false });
  dashBtn.addEventListener('click', function () { tryDash(); });

  /* ---------- pause / resume ---------- */
  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    showOverlay('pause');
    Audio.sounds.click();
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    showOverlay(null);
    Audio.sounds.click();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') pauseGame();
  });

  /* ---------- buttons ---------- */
  function toggleMute() {
    var m = Audio.setMuted(!Audio.isMuted());
    muteBtn.textContent = m ? 'Sound: Off' : 'Sound: On';
    muteBtn.setAttribute('aria-pressed', String(!m));
  }
  muteBtn.textContent = Audio.isMuted() ? 'Sound: Off' : 'Sound: On';

  $('start-btn').addEventListener('click', startGame);
  $('pause-btn').addEventListener('click', pauseGame);
  $('resume-btn').addEventListener('click', resumeGame);
  $('restart-btn').addEventListener('click', startGame);
  $('quit-btn').addEventListener('click', function () {
    state = 'menu';
    resetRun();
    updateScoresUI();
    showOverlay('menu');
  });
  $('again-btn').addEventListener('click', startGame);
  $('menu-btn').addEventListener('click', function () {
    state = 'menu';
    resetRun();
    updateScoresUI();
    showOverlay('menu');
  });
  $('victory-again-btn').addEventListener('click', startGame);
  $('victory-menu-btn').addEventListener('click', function () {
    state = 'menu';
    resetRun();
    updateScoresUI();
    showOverlay('menu');
  });
  $('endless-btn').addEventListener('click', function () {
    endless = true;
    state = 'playing';
    showOverlay(null);
    startWave(wave + 1);
  });
  muteBtn.addEventListener('click', toggleMute);

  /* ---------- debug handle ---------- */
  /* Read-only snapshots of the live game state, for automated tests
   * and for curious players poking around in the console. */
  window.BooyahDash = {
    get state() { return state; },
    get wave() { return wave; },
    get score() { return score; },
    get kills() { return kills; },
    get runTime() { return runTime; },
    get camera() { return { x: camera.x, y: camera.y }; },
    get zone() {
      var zc = zoneCenterAt(runTime);
      return { x: zc.x, y: zc.y, radius: E.zoneRadiusAt(runTime) };
    },
    get player() {
      return player ? {
        x: player.x, y: player.y, hp: player.hp, armor: player.armor,
        weapon: player.weapon, ammo: player.ammo
      } : null;
    },
    get enemies() {
      return enemies.map(function (e) {
        return { type: e.type, x: e.x, y: e.y, hp: e.hp };
      });
    }
  };

  /* ---------- boot ---------- */
  if (isTouch) touchUI.classList.remove('hidden');
  window.addEventListener('resize', resize);
  resetRun();
  resize();
  updateScoresUI();
  showOverlay('menu');
  updateHUD();
  requestAnimationFrame(function (ts) {
    lastTime = ts;
    requestAnimationFrame(loop);
  });
})();

/* booyahdash — core rules, kept pure so they can be tested without a browser.
 *
 * This file has no DOM or canvas in it on purpose. The game loop in game.js
 * owns rendering and input; everything here is numbers in, numbers out.
 * Works in the browser (window.BooyahEngine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.BooyahEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORLD_W = 1600;
  var WORLD_H = 1200;
  var MAX_WAVE = 10; // clear wave 10 and you take the Booyah
  var ZONE_DPS = 8; // damage per second while outside the safe zone
  var PICKUP_DROP_CHANCE = 0.14;

  var WEAPONS = {
    pistol: {
      key: 'pistol', name: 'Pistol', damage: 34, fireRateMs: 300,
      bulletSpeed: 640, spread: 0.035, pellets: 1, ammo: Infinity,
      range: 560, color: '#ffd166'
    },
    smg: {
      key: 'smg', name: 'SMG', damage: 17, fireRateMs: 95,
      bulletSpeed: 720, spread: 0.085, pellets: 1, ammo: 120,
      range: 480, color: '#7dff6a'
    },
    shotgun: {
      key: 'shotgun', name: 'Scattergun', damage: 24, fireRateMs: 750,
      bulletSpeed: 580, spread: 0.20, pellets: 6, ammo: 30,
      range: 380, color: '#ff9f43'
    },
    rifle: {
      key: 'rifle', name: 'Longshot Rifle', damage: 78, fireRateMs: 540,
      bulletSpeed: 980, spread: 0.012, pellets: 1, ammo: 36,
      range: 760, color: '#4dd2ff'
    }
  };

  var ENEMIES = {
    rusher: {
      key: 'rusher', name: 'Rusher', hp: 42, speed: 158, radius: 14,
      damage: 12, score: 100, color: '#ff5d5d', ranged: false
    },
    brute: {
      key: 'brute', name: 'Brute', hp: 175, speed: 72, radius: 25,
      damage: 24, score: 250, color: '#c44dff', ranged: false
    },
    gunner: {
      key: 'gunner', name: 'Gunner', hp: 62, speed: 108, radius: 15,
      damage: 10, score: 200, color: '#4dd2ff', ranged: true,
      shootRange: 340, shootCooldownMs: 1600, bulletSpeed: 300
    }
  };

  /* Zone phases: [seconds into the run, radius]. The zone only ever
   * shrinks, and it drifts a little toward a new centre each phase so
   * camping one corner stops working. Centres are picked by the game
   * loop; this table only fixes the timing and sizes. */
  var ZONE_PHASES = [
    { at: 0, radius: 780 },
    { at: 40, radius: 640 },
    { at: 85, radius: 510 },
    { at: 135, radius: 400 },
    { at: 190, radius: 300 },
    { at: 250, radius: 210 },
    { at: 320, radius: 150 }
  ];

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function circlesHit(ax, ay, ar, bx, by, br) {
    var dx = ax - bx;
    var dy = ay - by;
    var r = ar + br;
    return dx * dx + dy * dy <= r * r;
  }

  function clampToArena(x, y, radius) {
    return {
      x: clamp(x, radius, WORLD_W - radius),
      y: clamp(y, radius, WORLD_H - radius)
    };
  }

  /* How many of each enemy a wave throws at you. Wave 1 is gentle on
   * purpose — two rushers so a new player learns the controls before
   * the gunners show up on wave 3 and brutes on wave 4. */
  function waveComposition(wave) {
    if (wave < 1) wave = 1;
    var rushers = 1 + wave;
    var gunners = wave >= 3 ? Math.floor((wave - 1) / 2) : 0;
    var brutes = wave >= 4 ? Math.floor((wave - 2) / 2) : 0;
    return [
      { type: 'rusher', count: rushers },
      { type: 'gunner', count: gunners },
      { type: 'brute', count: brutes }
    ].filter(function (entry) { return entry.count > 0; });
  }

  function waveEnemyCount(wave) {
    return waveComposition(wave).reduce(function (sum, entry) {
      return sum + entry.count;
    }, 0);
  }

  function isVictoryWave(wave) {
    return wave >= MAX_WAVE;
  }

  /* Zone radius at a given run time (seconds). Linear between phases,
   * then pinned at the smallest radius — the endgame is a knife fight. */
  function zoneRadiusAt(elapsedSeconds) {
    var t = Math.max(0, elapsedSeconds);
    var last = ZONE_PHASES[ZONE_PHASES.length - 1];
    if (t >= last.at) return last.radius;
    for (var i = 1; i < ZONE_PHASES.length; i++) {
      var prev = ZONE_PHASES[i - 1];
      var cur = ZONE_PHASES[i];
      if (t <= cur.at) {
        var f = (t - prev.at) / (cur.at - prev.at);
        return prev.radius + (cur.radius - prev.radius) * f;
      }
    }
    return ZONE_PHASES[0].radius;
  }

  /* Damage ticks: outside the zone you lose ZONE_DPS per second.
   * Returns whole damage for a frame of dt seconds. */
  function zoneDamage(dtSeconds, insideZone) {
    if (insideZone || dtSeconds <= 0) return 0;
    return ZONE_DPS * dtSeconds;
  }

  function scoreForKill(enemyType, wave) {
    var base = ENEMIES[enemyType] ? ENEMIES[enemyType].score : 100;
    var multiplier = 1 + 0.1 * Math.max(0, wave - 1);
    return Math.round(base * multiplier);
  }

  function waveClearBonus(wave) {
    return 250 * wave;
  }

  /* Enemy drops: a flat chance, weighted toward health early when the
   * player is likely hurting, weapons once the waves get busy. */
  function rollDrop(rand, wave) {
    if (rand() > PICKUP_DROP_CHANCE) return null;
    var roll = rand();
    if (wave <= 2 || roll < 0.45) return 'medkit';
    if (roll < 0.65) return 'armor';
    if (roll < 0.82) return 'smg';
    if (roll < 0.93) return 'shotgun';
    return 'rifle';
  }

  function formatTime(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(s / 60);
    var rest = s % 60;
    return m + ':' + (rest < 10 ? '0' : '') + rest;
  }

  /* High scores live in localStorage. Guarded so the engine file can
   * still load (and be tested) where storage does not exist. */
  var SCORE_KEY = 'booyahdash.scores.v1';
  var MAX_SCORES = 8;

  function loadScores(storage) {
    try {
      var store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!store) return [];
      var raw = store.getItem(SCORE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (entry) {
        return entry && typeof entry.score === 'number' && typeof entry.wave === 'number';
      }).slice(0, MAX_SCORES);
    } catch (err) {
      return [];
    }
  }

  function saveScore(entry, storage) {
    var scores = loadScores(storage);
    scores.push({
      score: Math.max(0, Math.floor(entry.score || 0)),
      wave: Math.max(1, Math.floor(entry.wave || 1)),
      kills: Math.max(0, Math.floor(entry.kills || 0)),
      time: Math.max(0, Math.floor(entry.time || 0)),
      date: entry.date || new Date().toISOString().slice(0, 10)
    });
    scores.sort(function (a, b) { return b.score - a.score; });
    scores = scores.slice(0, MAX_SCORES);
    try {
      var store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (store) store.setItem(SCORE_KEY, JSON.stringify(scores));
    } catch (err) {
      // storage full or blocked (private mode) — scores just don't persist
    }
    return scores;
  }

  function bestScore(storage) {
    var scores = loadScores(storage);
    return scores.length ? scores[0].score : 0;
  }

  return {
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    MAX_WAVE: MAX_WAVE,
    ZONE_DPS: ZONE_DPS,
    PICKUP_DROP_CHANCE: PICKUP_DROP_CHANCE,
    WEAPONS: WEAPONS,
    ENEMIES: ENEMIES,
    ZONE_PHASES: ZONE_PHASES,
    clamp: clamp,
    dist: dist,
    circlesHit: circlesHit,
    clampToArena: clampToArena,
    waveComposition: waveComposition,
    waveEnemyCount: waveEnemyCount,
    isVictoryWave: isVictoryWave,
    zoneRadiusAt: zoneRadiusAt,
    zoneDamage: zoneDamage,
    scoreForKill: scoreForKill,
    waveClearBonus: waveClearBonus,
    rollDrop: rollDrop,
    formatTime: formatTime,
    loadScores: loadScores,
    saveScore: saveScore,
    bestScore: bestScore,
    SCORE_KEY: SCORE_KEY,
    MAX_SCORES: MAX_SCORES
  };
});

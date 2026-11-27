/* Tests for booyahdash/js/engine.js — pure rules, no browser needed.
 * Run: node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine');

test('weapons are sane: damage, fire rate and ammo defined for every gun', () => {
  for (const [key, w] of Object.entries(E.WEAPONS)) {
    assert.ok(w.damage > 0, `${key} damage`);
    assert.ok(w.fireRateMs >= 50, `${key} fire rate`);
    assert.ok(w.pellets >= 1, `${key} pellets`);
    assert.ok(w.bulletSpeed > w.range * 0.5, `${key} bullets can reach their range`);
    assert.ok(w.ammo === Infinity || w.ammo > 0, `${key} ammo`);
  }
  assert.equal(E.WEAPONS.pistol.ammo, Infinity, 'pistol never runs dry');
});

test('wave composition grows and unlocks enemy types on schedule', () => {
  const w1 = E.waveComposition(1);
  assert.deepEqual(w1, [{ type: 'rusher', count: 2 }]);
  assert.equal(E.waveEnemyCount(1), 2);

  const w3 = E.waveComposition(3);
  assert.ok(w3.some((e) => e.type === 'gunner'), 'gunners appear on wave 3');
  assert.ok(!w3.some((e) => e.type === 'brute'), 'no brutes yet on wave 3');

  const w4 = E.waveComposition(4);
  assert.ok(w4.some((e) => e.type === 'brute'), 'brutes appear on wave 4');
  assert.ok(E.waveEnemyCount(5) > E.waveEnemyCount(1), 'later waves are bigger');
  assert.ok(E.waveEnemyCount(10) > E.waveEnemyCount(5), 'wave 10 is the biggest');
});

test('wave 10 is the victory wave, wave 9 is not', () => {
  assert.equal(E.isVictoryWave(9), false);
  assert.equal(E.isVictoryWave(10), true);
  assert.equal(E.isVictoryWave(11), true);
});

test('zone only ever shrinks and ends small', () => {
  let prev = E.zoneRadiusAt(0);
  assert.equal(prev, 780, 'starts wide');
  for (let t = 10; t <= 400; t += 10) {
    const r = E.zoneRadiusAt(t);
    assert.ok(r <= prev, `zone grew at t=${t}: ${prev} -> ${r}`);
    prev = r;
  }
  assert.equal(E.zoneRadiusAt(400), 150, 'endgame zone is a knife fight');
  assert.equal(E.zoneRadiusAt(-5), 780, 'negative time clamps to start');
});

test('zone damage is zero inside, positive outside', () => {
  assert.equal(E.zoneDamage(1, true), 0);
  assert.equal(E.zoneDamage(1, false), E.ZONE_DPS);
  assert.equal(E.zoneDamage(0.5, false), E.ZONE_DPS / 2);
  assert.equal(E.zoneDamage(0, false), 0);
  assert.equal(E.zoneDamage(-1, false), 0);
});

test('circle collision is exact at the boundary', () => {
  assert.equal(E.circlesHit(0, 0, 10, 20, 0, 10), true, 'touching counts as hit');
  assert.equal(E.circlesHit(0, 0, 10, 21, 0, 10), false, 'one pixel past misses');
  assert.equal(E.circlesHit(100, 100, 5, 100, 100, 5), true, 'same spot hits');
});

test('arena clamp keeps entities inside the world', () => {
  assert.deepEqual(E.clampToArena(-50, -50, 10), { x: 10, y: 10 });
  assert.deepEqual(E.clampToArena(99999, 99999, 10), { x: E.WORLD_W - 10, y: E.WORLD_H - 10 });
  assert.deepEqual(E.clampToArena(800, 600, 10), { x: 800, y: 600 });
});

test('kill score scales with wave and respects enemy type', () => {
  const brute1 = E.scoreForKill('brute', 1);
  const brute5 = E.scoreForKill('brute', 5);
  assert.ok(brute5 > brute1, 'later waves pay more');
  assert.ok(E.scoreForKill('brute', 1) > E.scoreForKill('rusher', 1), 'brutes pay more than rushers');
  assert.equal(E.waveClearBonus(1), 250);
  assert.equal(E.waveClearBonus(10), 2500);
});

test('drop rolls respect the drop chance and return valid kinds', () => {
  const never = () => 0.99; // above PICKUP_DROP_CHANCE
  assert.equal(E.rollDrop(never, 5), null);
  const always = () => 0.01; // below chance, low roll -> medkit
  assert.equal(E.rollDrop(always, 1), 'medkit');
  const valid = new Set(['medkit', 'armor', 'smg', 'shotgun', 'rifle']);
  for (let i = 0; i < 200; i++) {
    const drop = E.rollDrop(Math.random, 6);
    assert.ok(drop === null || valid.has(drop), `bad drop: ${drop}`);
  }
});

test('formatTime renders m:ss', () => {
  assert.equal(E.formatTime(0), '0:00');
  assert.equal(E.formatTime(65), '1:05');
  assert.equal(E.formatTime(600), '10:00');
  assert.equal(E.formatTime(3599), '59:59');
});

test('high scores keep the top 8, sorted, and survive bad storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.deepEqual(E.loadScores(storage), []);
  assert.equal(E.bestScore(storage), 0);
  E.saveScore({ score: 500, wave: 3, kills: 12, time: 120 }, storage);
  E.saveScore({ score: 900, wave: 5, kills: 20, time: 200 }, storage);
  E.saveScore({ score: 100, wave: 1, kills: 2, time: 30 }, storage);
  const scores = E.loadScores(storage);
  assert.equal(scores.length, 3);
  assert.equal(scores[0].score, 900, 'best first');
  assert.equal(E.bestScore(storage), 900);
  for (let i = 0; i < 10; i++) {
    E.saveScore({ score: 50 + i, wave: 1, kills: 1, time: 10 }, storage);
  }
  assert.equal(E.loadScores(storage).length, E.MAX_SCORES, 'capped at 8');

  // corrupt JSON and missing storage must not throw
  const broken = { getItem: () => '{not json', setItem: () => {} };
  assert.deepEqual(E.loadScores(broken), []);
  assert.deepEqual(E.loadScores(null), []);
  assert.doesNotThrow(() => E.saveScore({ score: 1, wave: 1, kills: 0, time: 0 }, null));
});

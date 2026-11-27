/* booyahdash — sound effects, all synthesized with WebAudio.
 * No audio files to download, nothing to license. The context is
 * created lazily on the first user gesture (browsers block audio
 * before that) and every sound is a short oscillator/noise burst.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.BooyahAudio = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ctx = null;
  var muted = false;
  var MUTE_KEY = 'booyahdash.muted.v1';

  try {
    var stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem(MUTE_KEY)
      : null;
    muted = stored === '1';
  } catch (err) {
    muted = false;
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AudioContext = (typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext)) || null;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    return ctx;
  }

  function isMuted() { return muted; }

  function setMuted(value) {
    muted = !!value;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      }
    } catch (err) { /* private mode — mute just doesn't persist */ }
    return muted;
  }

  function tone(freq, durationMs, type, volume, slideTo) {
    if (muted) return;
    var ac = ensureContext();
    if (!ac) return;
    var t = ac.currentTime;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + durationMs / 1000);
    gain.gain.setValueAtTime(volume || 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + durationMs / 1000 + 0.02);
  }

  function noise(durationMs, volume, lowpassHz) {
    if (muted) return;
    var ac = ensureContext();
    if (!ac) return;
    var t = ac.currentTime;
    var len = Math.max(1, Math.floor(ac.sampleRate * durationMs / 1000));
    var buffer = ac.createBuffer(1, len, ac.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource();
    src.buffer = buffer;
    var filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz || 1200;
    var gain = ac.createGain();
    gain.gain.setValueAtTime(volume || 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    src.start(t);
  }

  var sounds = {
    shoot: function (weaponKey) {
      if (weaponKey === 'shotgun') { noise(120, 0.22, 900); tone(140, 90, 'square', 0.10, 60); }
      else if (weaponKey === 'rifle') { noise(90, 0.18, 2400); tone(320, 70, 'square', 0.08, 140); }
      else if (weaponKey === 'smg') { tone(520, 55, 'square', 0.07, 240); }
      else { tone(440, 70, 'square', 0.09, 180); }
    },
    enemyHit: function () { tone(220, 60, 'triangle', 0.10, 140); },
    enemyDown: function () { noise(140, 0.16, 700); tone(180, 140, 'sawtooth', 0.10, 50); },
    playerHurt: function () { tone(110, 180, 'sawtooth', 0.14, 55); noise(120, 0.12, 500); },
    pickup: function () { tone(660, 90, 'sine', 0.12); setTimeout(function () { tone(880, 120, 'sine', 0.12); }, 70); },
    dash: function () { noise(160, 0.10, 1800); },
    waveStart: function () {
      tone(392, 140, 'square', 0.10);
      setTimeout(function () { tone(523, 140, 'square', 0.10); }, 130);
      setTimeout(function () { tone(659, 200, 'square', 0.10); }, 260);
    },
    waveClear: function () {
      tone(523, 120, 'triangle', 0.12);
      setTimeout(function () { tone(659, 120, 'triangle', 0.12); }, 110);
      setTimeout(function () { tone(784, 220, 'triangle', 0.12); }, 220);
    },
    gameOver: function () {
      tone(330, 220, 'sawtooth', 0.12, 220);
      setTimeout(function () { tone(247, 220, 'sawtooth', 0.12, 165); }, 200);
      setTimeout(function () { tone(165, 420, 'sawtooth', 0.12, 82); }, 400);
    },
    booyah: function () {
      var notes = [523, 659, 784, 1047, 784, 1047];
      notes.forEach(function (freq, i) {
        setTimeout(function () { tone(freq, 180, 'triangle', 0.14); }, i * 130);
      });
      setTimeout(function () { noise(300, 0.08, 4000); }, 650);
    },
    click: function () { tone(700, 40, 'sine', 0.08); },
    zoneWarn: function () { tone(196, 200, 'square', 0.07, 185); }
  };

  return {
    ensureContext: ensureContext,
    isMuted: isMuted,
    setMuted: setMuted,
    sounds: sounds
  };
});

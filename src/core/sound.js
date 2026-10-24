// The suite's notification sound, "Counter": two soft ticks, then a D6 tone (a nod to the Geiger counter).
// Synthesized with Web Audio, so there is no file to host. Import-safe on the server; it only touches `window` when called.

export const CHIME_GAP_MS = 3_000; // at most one chime per gap, across every suite tab
export const SOUND_STORAGE_KEY = "geiger-notify:sound"; // "off" silences this browser
const LOG_KEY = "geiger-notify:chimes";
const LOCK_NAME = "geiger-notify:chime";
const KEEP_MS = 10 * 60_000; // how long a claim is remembered
const LEVEL = 0.48; // the level it was auditioned at: about -12 dBFS peak
const HIDDEN_DELAY_MS = 300; // a visible tab gets the first claim
const IDLE_MS = 1_500; // suspend after this long, so an idle tab holds no audio device

function envelope(ctx, t, gain, attack, decay) {
  const node = ctx.createGain();
  node.gain.setValueAtTime(0, t);
  node.gain.linearRampToValueAtTime(gain, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return node;
}

function tone(ctx, out, t, frequency, gain, attack, decay) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(frequency, t);
  osc.connect(envelope(ctx, t, gain, attack, decay)).connect(out);
  osc.start(t);
  osc.stop(t + attack + decay + 0.02);
}

// Seeded, so every tick sounds the same.
const noiseBuffers = new WeakMap();
function noise(ctx) {
  let buffer = noiseBuffers.get(ctx);
  if (buffer) return buffer;
  buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

function tick(ctx, out, t, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2600;
  band.Q.value = 1.4;
  src.connect(band).connect(envelope(ctx, t, gain, 0.001, 0.018)).connect(out);
  src.start(t);
  src.stop(t + 0.035);
}

// Schedules the chime at `t` on any (Offline)AudioContext, into `out`.
export function playCounter(ctx, out, t) {
  tick(ctx, out, t, 1);
  tick(ctx, out, t + 0.06, 0.8);
  tone(ctx, out, t + 0.13, 1174.66, 0.5, 0.006, 0.55);
  tone(ctx, out, t + 0.13, 2349.32, 0.05, 0.006, 0.2);
}

// One claim step on the shared log: each key plays once, and at most one chime per gap. Skipped keys are still claimed.
export function claimChime(log, key, now, gap = CHIME_GAP_MS) {
  const ids = Object.create(null);
  const prior = log && log.ids && typeof log.ids === "object" ? log.ids : {};
  for (const [id, at] of Object.entries(prior)) {
    if (typeof at === "number" && now - at < KEEP_MS) ids[id] = at;
  }
  const last = typeof log?.at === "number" ? log.at : null;
  if (ids[key] !== undefined) return { play: false, log: { at: last, ids } };
  ids[key] = now;
  const play = last === null || now - last >= gap;
  return { play, log: { at: play ? now : last, ids } };
}

let audio = null;
let idleTimer = null;

function context() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      audio = new AudioContext();
    } catch {
      return null;
    }
  }
  return audio;
}

function idle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (audio?.state === "running") audio.suspend().catch(() => {});
  }, IDLE_MS);
}

// Browsers allow sound only after a user gesture, so call this from one; the provider does on the first pointer or key press.
export function unlockSound() {
  const ctx = context();
  if (ctx) ctx.resume().then(idle, () => {});
}

export function isSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on) {
  try {
    if (on) window.localStorage.removeItem(SOUND_STORAGE_KEY);
    else window.localStorage.setItem(SOUND_STORAGE_KEY, "off");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

function claim(key) {
  let log = null;
  try {
    log = JSON.parse(window.localStorage.getItem(LOG_KEY) || "null");
  } catch {
    // Unreadable or blocked storage: claim against an empty log.
  }
  const result = claimChime(log, key, Date.now());
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(result.log));
  } catch {
    // Blocked storage: tabs can't coordinate, so each one plays.
  }
  return result.play;
}

// Plays the chime for one arrival and resolves true if this tab played it. `key` dedupes across tabs; omit it to just play.
export async function chime(key) {
  if (typeof window === "undefined" || !isSoundEnabled()) return false;
  // A tab with no user gesture yet can't make sound, so it leaves the claim to one that can.
  if (window.navigator?.userActivation?.hasBeenActive === false) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    await new Promise((resolve) => setTimeout(resolve, HIDDEN_DELAY_MS));
  }
  const id = key ?? `local:${Date.now()}:${Math.random()}`;
  const locks = window.navigator?.locks;
  const play = locks ? await locks.request(LOCK_NAME, () => claim(id)).catch(() => false) : claim(id);
  if (!play) return false;
  const ctx = context();
  if (!ctx) return false;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  const out = ctx.createGain();
  out.gain.value = LEVEL;
  out.connect(ctx.destination);
  playCounter(ctx, out, ctx.currentTime + 0.03);
  setTimeout(() => out.disconnect(), IDLE_MS);
  idle();
  return true;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIME_GAP_MS, chime, claimChime, playCounter } from "../src/core/sound.js";

// Records what the chime schedules: oscillator frequencies, source start times and their stops.
function fakeAudioContext() {
  const started = [];
  const param = (value = 0) => ({
    value,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const node = (extra = {}) => ({ connect: (dest) => dest, disconnect() {}, ...extra });
  const source = (kind) =>
    node({
      kind,
      frequency: param(),
      start(t) {
        started.push({ kind, t, frequency: this.frequency.value });
      },
      stop() {},
    });
  return {
    started,
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ frequency: param(), Q: param() }),
    createOscillator: () => {
      const osc = source("osc");
      osc.frequency.setValueAtTime = (v) => {
        osc.frequency.value = v;
      };
      return osc;
    },
    createBufferSource: () => source("noise"),
    createBuffer: (_channels, length) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
}

test("claimChime plays each arrival once and at most once per gap", () => {
  let r = claimChime(null, "a", 1_000);
  assert.equal(r.play, true);
  r = claimChime(r.log, "a", 1_050);
  assert.equal(r.play, false, "a second tab sees the claim");
  r = claimChime(r.log, "b", 1_000 + CHIME_GAP_MS - 1);
  assert.equal(r.play, false, "inside the gap");
  assert.ok("b" in r.log.ids, "a skipped arrival is still claimed, so no other tab plays it");
  r = claimChime(r.log, "c", 1_000 + CHIME_GAP_MS);
  assert.equal(r.play, true);
});

test("claimChime forgets old claims and survives a corrupt log", () => {
  const { log } = claimChime(null, "a", 0);
  const later = claimChime(log, "b", 11 * 60_000);
  assert.deepEqual(Object.keys(later.log.ids), ["b"]);
  assert.equal(claimChime({ at: "x", ids: "y" }, "a", 5_000).play, true);
  assert.equal(claimChime({ ids: { __proto__: 1 } }, "__proto__", 5_000).play, true);
});

test("playCounter schedules two ticks, then the D6 tone", () => {
  const ctx = fakeAudioContext();
  playCounter(ctx, ctx.createGain(), 1);
  const ticks = ctx.started.filter((s) => s.kind === "noise").map((s) => s.t);
  const tones = ctx.started.filter((s) => s.kind === "osc");
  assert.deepEqual(ticks, [1, 1.06]);
  assert.deepEqual(
    tones.map((s) => [s.t, s.frequency]),
    [
      [1.13, 1174.66],
      [1.13, 2349.32],
    ],
  );
});

test("chime is a no-op without a browser", async () => {
  assert.equal(await chime("a"), false);
});

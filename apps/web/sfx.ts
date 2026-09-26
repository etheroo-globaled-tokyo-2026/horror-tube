const ctx = new AudioContext();
const MUTE_KEY = "ht.muted";
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  muted = false;
}

const master = ctx.createGain();
master.gain.value = muted ? 0 : 0.9;
const comp = ctx.createDynamicsCompressor();
comp.threshold.value = -14;
comp.ratio.value = 4;
master.connect(comp).connect(ctx.destination);

const filter = (type: BiquadFilterType, f: number, q = 0.7, gain = 0): BiquadFilterNode => {
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  n.gain.value = gain;
  return n;
};
const gain = (v: number): GainNode => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

const verb = ctx.createConvolver();
const ir = ctx.createBuffer(2, Math.round(ctx.sampleRate * 1.8), ctx.sampleRate);
for (let c = 0; c < 2; c++) {
  const d = ir.getChannelData(c);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
}
verb.buffer = ir;
verb.connect(filter("lowpass", 3000)).connect(master);

const bus = (dry: number, wet: number): GainNode => {
  const g = ctx.createGain();
  g.connect(gain(dry)).connect(master);
  g.connect(gain(wet)).connect(verb);
  return g;
};
const near = bus(1, 0.08);
const room = bus(1, 0.35);
const far = filter("lowpass", 900);
far.connect(bus(0.35, 0.9));
const tv = filter("highpass", 320);
tv.connect(filter("peaking", 1150, 1.4, 6))
  .connect(filter("lowpass", 3200))
  .connect(bus(1, 0.25));

const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
const nd = noiseBuf.getChannelData(0);
for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
const noise = (t: number, dur: number): AudioBufferSourceNode => {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t, Math.random() * 1.9);
  if (dur > 0) s.stop(t + dur);
  return s;
};

const env = (to: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(to);
  return g;
};
const osc = (type: OscillatorType, f: number, t: number, dur: number): OscillatorNode => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
};
const tone = (
  to: AudioNode,
  t: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  peak: number,
  attack: number,
  decay: number,
): void => {
  const o = osc(type, f0, t, attack + decay);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  o.connect(env(to, t, peak, attack, decay));
};
const hiss = (
  to: AudioNode,
  t: number,
  type: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  peak: number,
  attack: number,
  decay: number,
): void => {
  const f = filter(type, f0, q);
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  noise(t, attack + decay + 0.05)
    .connect(f)
    .connect(env(to, t, peak, attack, decay));
};
const jit = (spread: number): number => 1 + (Math.random() * 2 - 1) * spread;
const clink = (to: AudioNode, t: number, peak: number): void => {
  const f = 2300 + Math.random() * 1500;
  [1, 2.76, 5.4, 8.93].forEach((r, i) =>
    tone(to, t, "sine", f * r, f * r, peak / (i + 1), 0.001, 0.25 / (i * 0.6 + 1)),
  );
};
const thud = (to: AudioNode, t: number, peak: number, f: number): void => {
  tone(to, t, "sine", f, f * 0.45, peak, 0.004, 0.16);
  hiss(to, t, "lowpass", 500, 500, 0.9, peak * 0.7, 0.002, 0.08);
};
const clack = (to: AudioNode, t: number, peak: number): void => {
  const k = jit(0.1);
  hiss(to, t, "bandpass", 1500 * k, 1500 * k, 2, peak, 0.001, 0.02);
  tone(to, t, "sine", 170 * k, 120 * k, peak * 0.5, 0.002, 0.035);
};

const beep = (t: number, freqs: number[], level: number, dur: number): void => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.005);
  g.gain.setValueAtTime(level, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  g.connect(tv);
  const wow = osc("sine", 0.7, t, dur);
  const depth = gain(6);
  wow.connect(depth);
  for (const f of freqs) {
    const o = osc("triangle", f, t, dur);
    depth.connect(o.detune);
    o.connect(g);
  }
};

const rumble = gain(0.1);
noise(0, 0).connect(filter("lowpass", 140)).connect(rumble).connect(master);
const hum = gain(0.02);
osc("sawtooth", 60, 0, 1e7).connect(filter("lowpass", 240)).connect(hum);
osc("sine", 120, 0, 1e7).connect(gain(0.5)).connect(hum);
hum.connect(room);
const bed = gain(0);
noise(0, 0).connect(filter("highpass", 1800)).connect(filter("lowpass", 8000)).connect(bed);
bed.connect(master);
const whine = gain(0);
osc("sine", 15625, 0, 1e7).connect(whine).connect(master);

const allowed = (): boolean =>
  !muted && (ctx.state === "running" || navigator.userActivation.isActive);
const now = (): number => ctx.currentTime + 0.01;
const resume = (): void => void ctx.resume();
addEventListener("pointerdown", resume, true);
addEventListener("keydown", resume, true);

const on =
  <A extends (number | boolean)[]>(fn: (...a: A) => void) =>
  (...a: A): void => {
    if (allowed()) fn(...a);
  };

export const sfx = {
  key: on((): void => {
    const t = now(),
      k = jit(0.08);
    hiss(near, t, "bandpass", 3800 * k, 3800 * k, 1.5, 0.3, 0.001, 0.012);
    tone(near, t, "triangle", 1900 * k, 1400 * k, 0.06, 0.001, 0.02);
    tone(near, t, "sine", 220 * k, 140 * k, 0.25, 0.002, 0.045);
  }),
  deny: on((): void => {
    const t = now();
    for (const s of [0, 0.17]) {
      const g = env(tv, t + s, 0.22, 0.004, 0.13);
      for (const f of [110, 116]) osc("square", f, t + s, 0.14).connect(g);
    }
  }),
  tick: on((n: number): void => {
    const t = now();
    hiss(near, t, "bandpass", 2400 + n * 260, 2400 + n * 260, 8, 0.35, 0.001, 0.018);
    tone(near, t, "sine", 500 + n * 80, 500 + n * 80, 0.05, 0.002, 0.05);
  }),
  bet: on((): void => {
    const t = now();
    tone(room, t, "sine", 110, 45, 0.7, 0.003, 0.25);
    hiss(room, t, "lowpass", 900, 900, 0.8, 0.5, 0.002, 0.08);
    for (const f of [523, 1370, 2210, 3050]) tone(room, t + 0.01, "sine", f, f, 0.05, 0.001, 0.6);
  }),
  tape: on((): void => {
    const t = now();
    hiss(near, t, "bandpass", 900, 2200, 2, 0.2, 0.05, 0.15);
    clack(near, t + 0.2, 0.5);
  }),
  slide: on((): void => {
    hiss(near, now(), "bandpass", 700, 1200, 1.5, 0.06, 0.03, 0.09);
  }),
  pen: on((dur: number): void => {
    const t = now(),
      g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let s = 0; s < dur; s += 0.04)
      g.gain.setTargetAtTime(0.03 + Math.random() * 0.25, t + s, 0.01);
    g.gain.setTargetAtTime(0, t + dur, 0.02);
    noise(t, dur + 0.2)
      .connect(filter("bandpass", 3200, 0.9))
      .connect(g)
      .connect(near);
  }),
  stamp: on((): void => {
    const t = now();
    thud(room, t, 0.8, 140);
    hiss(room, t, "highpass", 2000, 2000, 0.7, 0.3, 0.001, 0.03);
  }),
  static: on((): void => {
    hiss(tv, now(), "bandpass", 3500, 3500, 0.6, 0.45, 0.002, 0.14);
  }),
  tvOff: on((): void => {
    const t = now();
    hiss(tv, t, "lowpass", 3000, 3000, 0.7, 0.5, 0.001, 0.01);
    tone(room, t, "sine", 1200, 60, 0.3, 0.002, 0.25);
    thud(room, t + 0.08, 0.6, 80);
  }),
  burn: on((dur: number): void => {
    const t = now();
    hiss(room, t, "bandpass", 300, 2500, 1, 0.3, 0.2, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.6);
    g.gain.setValueAtTime(0.3, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    noise(t, dur).connect(filter("lowpass", 900)).connect(g).connect(room);
    for (let i = 0; i < 60; i++) {
      const at = t + Math.random() * dur;
      if (Math.random() < 0.75)
        hiss(room, at, "highpass", 2500, 2500, 0.7, 0.1 + Math.random() * 0.4, 0.001, 0.008);
      else hiss(room, at, "bandpass", 900, 900, 4, 0.4, 0.001, 0.02);
    }
  }),
  dark: on((): void => {
    const t = now();
    tone(room, t, "sine", 55, 28, 0.7, 0.01, 2.5);
    tone(near, t, "sine", 6800, 6800, 0.015, 0.3, 5);
  }),
  tvOn: on((): void => {
    const t = now();
    const g = env(room, t, 0.35, 0.01, 1.2);
    osc("sawtooth", 60, t, 1.3).connect(filter("lowpass", 400)).connect(g);
    tone(room, t, "sine", 60, 60, 0.4, 0.01, 1.2);
    hiss(tv, t + 0.1, "highpass", 4000, 4000, 0.7, 0.12, 0.4, 0.3);
  }),
  bell: on((): void => {
    const t = now(),
      f = 110;
    hiss(room, t, "bandpass", 1500, 1500, 1, 0.3, 0.001, 0.02);
    const parts: [ratio: number, amp: number, decay: number][] = [
      [0.5, 0.5, 4],
      [1, 1, 3.5],
      [1.19, 0.6, 2.5],
      [1.56, 0.45, 2],
      [2, 0.35, 1.6],
      [2.51, 0.2, 1.2],
      [2.66, 0.2, 1],
      [3.01, 0.1, 0.8],
    ];
    for (const [r, a, d] of parts)
      for (const dt of [-0.3, 0.3])
        tone(room, t, "sine", f * r + dt, f * r + dt, a * 0.08, 0.004, d);
  }),
  type: on((dur: number): void => {
    const t = now();
    let s = 0;
    while (s < dur - 0.5) {
      clack(tv, t + s, 0.5);
      s += Math.random() < 0.12 ? 0.35 : 0.07 + Math.random() * 0.1;
    }
    hiss(tv, t + s, "bandpass", 1200, 3000, 3, 0.25, 0.05, 0.2);
    for (const f of [2637, 3951]) tone(tv, t + s + 0.3, "sine", f, f, 0.1, 0.002, 1.2);
  }),
  sting: on((lost: boolean): void => {
    const t = now();
    hiss(tv, t, "bandpass", 3500, 3500, 0.6, 0.5, 0.002, 0.2);
    beep(t + 0.24, [853, 960], 0.35, 1.85);
    const b = t + 2.4;
    tone(room, b, "sine", 74, 30, 0.9, 0.005, 2.6);
    hiss(room, b, "lowpass", 260, 260, 0.9, 0.8, 0.002, 0.12);
    const drone = env(room, b, 0.12, 0.9, 2.4);
    const lp = filter("lowpass", 420, 1.2);
    lp.connect(drone);
    for (const f of [55, 58.27, 82.4]) osc("sawtooth", f, b, 3.4).connect(lp);
    if (!lost) return;
    const s = t + 4.6,
      g = env(room, s, 0.14, 0.02, 1.4);
    const tape = filter("lowpass", 700);
    tape.connect(g);
    for (const f of [220, 221.5]) {
      const o = osc("sawtooth", f, s, 1.4);
      o.frequency.exponentialRampToValueAtTime(f * 0.3, s + 1.4);
      o.connect(tape);
    }
  }),
  beat: on((k: number): void => {
    const t = now();
    tone(near, t, "sine", 62, 40, 0.8 * k, 0.008, 0.12);
    tone(near, t + 0.18, "sine", 58, 38, 0.55 * k, 0.008, 0.14);
  }),
  hit: on((): void => {
    const t = now(),
      k = jit(0.15);
    hiss(tv, t, "lowpass", 1800 * k, 1800 * k, 0.8, 0.7, 0.002, 0.08);
    tone(tv, t, "sine", 130 * k, 50, 0.8, 0.002, 0.12);
    hiss(tv, t + 0.01, "bandpass", 3000, 3000, 2, 0.3, 0.001, 0.03);
  }),
  fight: on((): void => {
    const t = now();
    hiss(tv, t, "bandpass", 3500, 3500, 0.6, 0.45, 0.002, 0.14);
    tone(room, t + 0.1, "sine", 90, 32, 0.9, 0.004, 1.4);
    hiss(room, t + 0.1, "bandpass", 4000, 400, 0.8, 0.3, 0.005, 0.8);
  }),
  pick: on((): void => {
    const t = now();
    [1318.5, 1244.5].forEach((f, i) => {
      const s = t + i * 0.32;
      tone(room, s, "sine", f, f, 0.18, 0.002, 1.2);
      tone(room, s, "sine", f * 3, f * 3, 0.04, 0.002, 0.4);
      tone(room, s, "sine", f * 5.4, f * 5.4, 0.02, 0.001, 0.15);
    });
  }),
  coins: on((n: number): void => {
    const t = now();
    let s = 0;
    for (let i = 0; i < n; i++) {
      clink(near, t + s, 0.12 + Math.random() * 0.08);
      s += 0.02 + Math.random() * 0.07 * (1 - i / n);
    }
    thud(near, t + s, 0.3, 200);
  }),
  coin: on((): void => {
    const t = now();
    clink(near, t, 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.08);
    for (let s = 0.08; s < 0.42; s += 0.03)
      g.gain.setTargetAtTime(Math.random() * 0.12, t + s, 0.01);
    g.gain.setTargetAtTime(0, t + 0.42, 0.02);
    noise(t, 0.5)
      .connect(filter("bandpass", 3000, 6))
      .connect(g)
      .connect(near);
    thud(near, t + 0.45, 0.45, 180);
    clink(near, t + 0.47, 0.08);
  }),
  lever: on((): void => {
    const t = now();
    for (let i = 0; i < 6; i++)
      hiss(near, t + i * 0.05, "bandpass", 2200, 2200, 6, 0.35, 0.001, 0.015);
    const o = osc("sine", 180, t + 0.3, 0.5),
      lfo = osc("sine", 25, t + 0.3, 0.5),
      depth = gain(40);
    lfo.connect(depth).connect(o.frequency);
    o.connect(env(room, t + 0.3, 0.15, 0.005, 0.5));
  }),
  meter: on((): void => {
    const t = now();
    for (let i = 0; i < 8; i++) {
      hiss(near, t + i * 0.045, "bandpass", 4500, 4500, 5, 0.25, 0.001, 0.006);
      tone(near, t + i * 0.045, "sine", 2200, 2200, 0.04, 0.001, 0.015);
    }
  }),
  spat: on((): void => {
    const t = now(),
      g = env(room, t, 0.25, 0.005, 0.5),
      lp = filter("lowpass", 900);
    lp.connect(g);
    for (const f of [90, 94.5]) osc("square", f, t, 0.55).connect(lp);
    thud(room, t, 0.5, 110);
  }),
  signoff: on((): void => {
    beep(now(), [1000], 0.18, 3);
  }),
  creak: on((): void => {
    const t = now(),
      dur = 0.8 + Math.random() * 0.8,
      o = osc("sawtooth", 22, t, dur);
    o.frequency.linearRampToValueAtTime(14 + Math.random() * 20, t + dur);
    o.connect(filter("bandpass", 500 + Math.random() * 300, 8)).connect(
      env(far, t, 0.5, dur * 0.3, dur * 0.7),
    );
  }),
  drip: on((): void => {
    tone(far, now(), "sine", 900, 1900, 0.3, 0.002, 0.05);
  }),
  knock: on((): void => {
    const t = now();
    thud(far, t, 0.5, 90);
    thud(far, t + 0.25, 0.4, 90);
  }),
};

let flick = 1;
const zap = on((): void => {
  const t = now();
  hiss(room, t, "bandpass", 2500, 2500, 1, 0.12, 0.001, 0.04);
  hiss(room, t + 0.03, "highpass", 3000, 3000, 0.7, 0.08, 0.001, 0.01);
});
export function ambience(level: number, bulb: number, lightsOut: boolean): void {
  const t = ctx.currentTime;
  bed.gain.setTargetAtTime(level * 0.35, t, 0.03);
  whine.gain.setTargetAtTime(level > 0 ? 0.003 : 0, t, 0.05);
  hum.gain.setTargetAtTime(lightsOut ? 0 : bulb < 1 ? 0.07 : 0.02, t, 0.02);
  rumble.gain.setTargetAtTime(lightsOut ? 0.04 : 0.1, t, 0.3);
  if (bulb < 1 && flick === 1 && !lightsOut) zap();
  flick = bulb;
}

export const isMuted = (): boolean => muted;
export function toggleMute(): void {
  muted = !muted;
  master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

const distant = (): void => {
  const pick = [sfx.creak, sfx.drip, sfx.knock][(Math.random() * 3) | 0];
  if (pick && ctx.state === "running") pick();
  setTimeout(distant, 15000 + Math.random() * 30000);
};
setTimeout(distant, 20000);

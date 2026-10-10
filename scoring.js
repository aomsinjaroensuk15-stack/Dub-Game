"use strict";
/* ============================================================
   Dub Roast — scoring engine (pure DSP, no DOM, testable)
   Compares the original clip with the user's voice take and
   returns a 0-100 score plus sub-scores.
   ============================================================ */
const Scoring = (() => {

  function toMono(buf) {
    const n = buf.length;
    const out = new Float32Array(n);
    const ch = buf.numberOfChannels || 1;
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    if (ch > 1) for (let i = 0; i < n; i++) out[i] /= ch;
    return { data: out, sr: buf.sampleRate };
  }

  // RMS envelope at fixed fps, log-compressed
  function envelope(data, sr, fps) {
    fps = fps || 100;
    const frame = Math.max(1, Math.round(sr / fps));
    const n = Math.max(1, Math.floor(data.length / frame));
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const off = i * frame;
      const lim = Math.min(frame, data.length - off);
      for (let j = 0; j < lim; j++) sum += data[off + j] * data[off + j];
      env[i] = Math.sqrt(sum / lim);
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.log10(1 + 1000 * env[i]);
    return out;
  }

  function znorm(a) {
    const n = a.length;
    let m = 0;
    for (let i = 0; i < n; i++) m += a[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (a[i] - m) * (a[i] - m);
    const s = Math.sqrt(v / n) || 1;
    return a.map(x => (x - m) / s);
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 4) return 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
  }

  function resample(a, len) {
    if (a.length === len) return a.slice();
    const out = new Array(len);
    const scale = (a.length - 1) / Math.max(1, len - 1);
    for (let i = 0; i < len; i++) {
      const pos = i * scale;
      const i0 = Math.floor(pos);
      const i1 = Math.min(a.length - 1, i0 + 1);
      const t = pos - i0;
      out[i] = a[i0] * (1 - t) + a[i1] * t;
    }
    return out;
  }

  // best lag (frames) of b relative to a; positive => b starts later
  function findLag(a, b, maxLag) {
    const za = znorm(a), zb = znorm(b);
    let best = 0, bestVal = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const start = Math.max(0, lag);
      const end = Math.min(a.length, b.length + lag);
      let num = 0, da = 0, db = 0, n = 0;
      for (let i = start; i < end; i++) {
        const x = za[i], y = zb[i - lag];
        num += x * y; da += x * x; db += y * y; n++;
      }
      if (n < 10) continue;
      const den = Math.sqrt(da * db);
      const r = den === 0 ? 0 : num / den;
      if (r > bestVal) { bestVal = r; best = lag; }
    }
    return best;
  }

  function shiftAlign(a, b, lag) {
    const startA = Math.max(0, lag);
    const startB = Math.max(0, -lag);
    const len = Math.min(a.length - startA, b.length - startB);
    if (len < 10) return [a.slice(), b.slice()];
    return [a.slice(startA, startA + len), b.slice(startB, startB + len)];
  }

  // normalized autocorrelation pitch for one frame; 0 = unvoiced
  function framePitch(frame, sr) {
    const minLag = Math.max(2, Math.floor(sr / 1000));   // up to 1000 Hz
    const maxLag = Math.min(Math.floor(sr / 70), frame.length >> 1); // down to 70 Hz
    if (maxLag <= minLag) return 0;
    let r0 = 0;
    for (let i = 0; i < frame.length; i++) r0 += frame[i] * frame[i];
    if (r0 < 1e-6) return 0;
    let bestLag = 0, bestR = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < frame.length - lag; i++) s += frame[i] * frame[i + lag];
      const r = s / r0;
      if (r > bestR) { bestR = r; bestLag = lag; }
    }
    if (bestR < 0.4) return 0;
    return sr / bestLag;
  }

  function pitchContour(data, sr, fps) {
    fps = fps || 50;
    const frameLen = Math.max(64, Math.round(sr / 20)); // 50 ms window
    const hop = Math.max(1, Math.round(sr / fps));
    const n = Math.max(1, Math.floor((data.length - frameLen) / hop));
    const out = new Array(n).fill(0);
    const frame = new Float32Array(frameLen);
    for (let i = 0; i < n; i++) {
      const off = i * hop;
      for (let j = 0; j < frameLen; j++) frame[j] = data[off + j] || 0;
      out[i] = framePitch(frame, sr);
    }
    return out;
  }

  function interpolateUnvoiced(c) {
    const out = c.slice();
    let last = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > 0) {
        if (last >= 0 && i > last + 1) {
          for (let j = last + 1; j < i; j++) {
            const t = (j - last) / (i - last);
            out[j] = out[last] * (1 - t) + out[i] * t;
          }
        }
        last = i;
      }
    }
    if (last >= 0) for (let i = last + 1; i < out.length; i++) out[i] = out[last];
    return out;
  }

  function voicedRatio(c) {
    let v = 0;
    for (const x of c) if (x > 0) v++;
    return v / c.length;
  }

  function trimSilence(data, sr, thresh) {
    const win = Math.max(64, Math.floor(sr * 0.02));
    const rmsAt = (i) => {
      let s = 0, n = 0;
      for (let j = i; j < Math.min(data.length, i + win); j++) { s += data[j] * data[j]; n++; }
      return Math.sqrt(s / n);
    };
    let a = 0, b = data.length;
    while (a < data.length - win && rmsAt(a) < thresh) a += win;
    while (b > win && rmsAt(b - win) < thresh) b -= win;
    if (b - a < sr * 0.3) return data.slice(); // too aggressive, keep original
    return data.slice(a, b);
  }

  /* main entry: originalBuffer & takeBuffer are Web Audio AudioBuffers */
  function score(originalBuffer, takeBuffer) {
    const orig = toMono(originalBuffer);
    const take = toMono(takeBuffer);

    const tData = trimSilence(take.data, take.sr, 0.012);

    // --- rhythm / energy (100 fps envelopes) ---
    const envO = envelope(orig.data, orig.sr);
    const envT = envelope(tData, take.sr);
    const lag = findLag(envO, envT, 150); // ±1.5 s mic-start tolerance
    const eo = shiftAlign(envO, envT, lag)[0];
    const et = shiftAlign(envO, envT, lag)[1];
    const envR = Math.max(0, pearson(znorm(resample(eo, 400)), znorm(resample(et, 400))));

    // --- pitch (50 fps contours) ---
    const pcO = pitchContour(orig.data, orig.sr);
    const pcT = pitchContour(tData, take.sr);
    let pitchR;
    if (Math.min(voicedRatio(pcO), voicedRatio(pcT)) < 0.15) {
      pitchR = 0.5; // mostly speech/noise -> neutral
    } else {
      const liO = interpolateUnvoiced(pcO).map(p => p > 0 ? Math.log2(p) : 0);
      const liT = interpolateUnvoiced(pcT).map(p => p > 0 ? Math.log2(p) : 0);
      const po = shiftAlign(liO, liT, Math.round(lag / 2))[0];
      const pt = shiftAlign(liO, liT, Math.round(lag / 2))[1];
      pitchR = Math.max(0, pearson(znorm(resample(po, 200)), znorm(resample(pt, 200))));
    }

    // --- timing ---
    const durO = orig.data.length / orig.sr;
    const durT = tData.length / take.sr;
    const durRatio = Math.min(durO, durT) / Math.max(durO, durT);

    const raw = 0.5 * envR + 0.3 * pitchR + 0.2 * durRatio;
    const percent = Math.max(1, Math.min(99, Math.round(100 * Math.pow(raw, 0.8))));
    return { percent: percent, env: envR, pitch: pitchR, dur: durRatio };
  }

  return { score: score };
})();

if (typeof module !== "undefined") module.exports = Scoring;

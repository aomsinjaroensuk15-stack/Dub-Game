"use strict";
/* Waveform drawing — magenta clip bars + cyan take bars, TikTok-dub style */
const Waveform = (() => {

  function peaksFromBuffer(buffer, columns) {
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / columns));
    const peaks = new Array(columns).fill(0);
    for (let c = 0; c < columns; c++) {
      let max = 0;
      const off = c * block;
      for (let i = 0; i < block && off + i < data.length; i++) {
        const v = Math.abs(data[off + i]);
        if (v > max) max = v;
      }
      peaks[c] = max;
    }
    const m = Math.max.apply(null, peaks.concat([0.01]));
    return peaks.map(p => Math.pow(p / m, 0.7));
  }

  function setup(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 80;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#12101a";
    ctx.fillRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function bars(ctx, w, h, peaks, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const mid = h / 2;
    const barW = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(2, peaks[i] * (h - 12));
      ctx.fillRect(i * barW + barW * 0.15, mid - ph / 2, Math.max(1, barW * 0.7), ph);
    }
    ctx.restore();
  }

  function centerLine(ctx, w, h) {
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  // single waveform with playhead progress (0..1)
  function draw(canvas, peaks, progress) {
    progress = progress || 0;
    const s = setup(canvas);
    bars(s.ctx, s.w, s.h, peaks, "#3a2440", 1);
    // played portion
    const played = Math.floor(progress * peaks.length);
    if (played > 0) {
      s.ctx.save();
      s.ctx.beginPath();
      s.ctx.rect(0, 0, s.w * Math.min(1, progress), s.h);
      s.ctx.clip();
      bars(s.ctx, s.w, s.h, peaks, "#ff2bd6", 1);
      s.ctx.restore();
    }
    centerLine(s.ctx, s.w, s.h);
    if (progress > 0 && progress < 1) {
      s.ctx.fillStyle = "#ff2bd6";
      s.ctx.fillRect(progress * s.w - 1, 2, 2, s.h - 4);
    }
  }

  // clip (magenta) + your take (cyan), each at 50% opacity
  function drawDual(canvas, clipPeaks, takePeaks) {
    const s = setup(canvas);
    bars(s.ctx, s.w, s.h, clipPeaks, "#ff2bd6", 0.5);
    bars(s.ctx, s.w, s.h, takePeaks, "#2be4ff", 0.5);
    centerLine(s.ctx, s.w, s.h);
  }

  return { peaksFromBuffer: peaksFromBuffer, draw: draw, drawDual: drawDual };
})();

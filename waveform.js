"use strict";
/* Waveform drawing — magenta bars + playhead, TikTok-dub style */
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

  function draw(canvas, peaks, progress) {
    progress = progress || 0;
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
    const mid = h / 2;
    const barW = w / peaks.length;
    const played = Math.floor(progress * peaks.length);
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(2, peaks[i] * (h - 12));
      ctx.fillStyle = i < played ? "#ff2bd6" : "#3a2440";
      ctx.fillRect(i * barW + barW * 0.15, mid - ph / 2, Math.max(1, barW * 0.7), ph);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, mid); ctx.lineTo(w, mid);
    ctx.stroke();
    if (progress > 0 && progress < 1) {
      ctx.fillStyle = "#ff2bd6";
      ctx.fillRect(progress * w - 1, 2, 2, h - 4);
    }
  }

  return { peaksFromBuffer: peaksFromBuffer, draw: draw };
})();

"use strict";
/* ============================================================
   Dub Roast — app orchestration  v2
   import -> preview -> countdown -> play+record -> judging
   (download button available while judging) -> results
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);

  let audioCtx = null;
  let clipBuffer = null;
  let clipName = "";
  let clipPeaks = [];
  let takePeaks = null;
  let micStream = null;
  let mediaRecorder = null;
  let recChunks = [];
  let recMime = "";
  let sourceNode = null;
  let startTime = 0;
  let playing = false;
  let stopping = false;
  let rafId = 0;
  let takeBlobUrl = null;
  // preview state
  let previewNode = null;
  let previewOn = false;
  let previewStart = 0;

  /* ---------- screens & toast ---------- */

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) =>
      s.classList.toggle("hidden", s.id !== "screen-" + name));
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
  }

  /* ---------- audio context ---------- */

  async function ensureCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();
    return audioCtx;
  }

  // silent "punch" through the autoplay gate (must run inside a click handler)
  function unlockAudio() {
    const s = audioCtx.createBufferSource();
    s.buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.05, audioCtx.sampleRate);
    s.connect(audioCtx.destination);
    s.start();
  }

  /* ---------- import ---------- */

  async function handleFile(file) {
    if (!file) return;
    const ctx = await ensureCtx();
    let decoded;
    try {
      const ab = await file.arrayBuffer();
      decoded = await ctx.decodeAudioData(ab);
    } catch (e) {
      toast("Couldn't decode that file 😅 try mp3 / wav / m4a / ogg");
      return;
    }
    clipBuffer = decoded;
    clipName = file.name;
    takePeaks = null;
    clipPeaks = Waveform.peaksFromBuffer(clipBuffer, 240);
    $("clip-name").textContent = clipName;
    $("clip-duration").textContent = clipBuffer.duration.toFixed(1) + "s";
    updateBestBadge();
    showScreen("main");
    resetStage();
  }

  function resetStage() {
    cancelAnimationFrame(rafId);
    if (previewOn) stopPreview();
    playing = false;
    stopping = false;
    Waveform.draw($("wave-canvas"), clipPeaks, 0);
    $("controls-ready").classList.remove("hidden");
    $("controls-record").classList.add("hidden");
    $("hint").classList.remove("hidden");
  }

  function updateBestBadge() {
    const b = localStorage.getItem(bestKey());
    const badge = $("clip-best");
    if (b) {
      badge.textContent = "🏆 best " + b + "%";
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  function bestKey() { return "dubroast_best_" + clipName; }

  /* ---------- preview (listen to the clip, no recording) ---------- */

  function togglePreview() {
    if (previewOn) { stopPreview(); return; }
    ensureCtx().then(() => {
      unlockAudio();
      previewNode = audioCtx.createBufferSource();
      previewNode.buffer = clipBuffer;
      previewNode.connect(audioCtx.destination);
      previewOn = true;
      previewStart = audioCtx.currentTime;
      previewNode.onended = () => { if (previewOn) stopPreview(); };
      previewNode.start();
      $("btn-preview").textContent = "⏹ Stop Song";
      previewLoop();
    });
  }

  function previewLoop() {
    if (!previewOn) return;
    const p = (audioCtx.currentTime - previewStart) / clipBuffer.duration;
    Waveform.draw($("wave-canvas"), clipPeaks, Math.max(0, Math.min(1, p)));
    if (p < 1) rafId = requestAnimationFrame(previewLoop);
  }

  function stopPreview() {
    previewOn = false;
    cancelAnimationFrame(rafId);
    try { previewNode.stop(); } catch (e) {}
    $("btn-preview").textContent = "▶ Preview";
    Waveform.draw($("wave-canvas"), clipPeaks, 0);
  }

  /* ---------- countdown ---------- */

  function countdown() {
    return new Promise((resolve) => {
      const el = $("countdown");
      const seq = ["3", "2", "1", "GO! 🎤"];
      let i = 0;
      el.classList.remove("hidden");
      const tick = () => {
        if (i >= seq.length) {
          el.classList.add("hidden");
          resolve();
          return;
        }
        el.textContent = seq[i++];
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
        setTimeout(tick, 550);
      };
      tick();
    });
  }

  /* ---------- record + play ---------- */

  async function startDub() {
    if (!clipBuffer) return;
    if (previewOn) stopPreview();
    const ctx = await ensureCtx();
    unlockAudio();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
      });
    } catch (e) {
      toast("Mic permission needed babe! Allow mic & try again 🎤");
      return;
    }
    micStream = stream;
    recChunks = [];
    recMime = "";

    if (!window.MediaRecorder) {
      toast("This browser can't record 😢 use Chrome");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
    for (const t of types) {
      if (!t || MediaRecorder.isTypeSupported(t)) { recMime = t; break; }
    }
    mediaRecorder = new MediaRecorder(stream, recMime ? { mimeType: recMime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };

    $("controls-ready").classList.add("hidden");
    $("controls-record").classList.remove("hidden");
    $("hint").classList.add("hidden");

    await countdown();
    // start mic right before playback -> no dead air, tiny lag, easy alignment
    mediaRecorder.start(250);
    setTimeout(playClip, 150);
  }

  function playClip() {
    const ctx = audioCtx;
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = clipBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    sourceNode.connect(gain);
    gain.connect(ctx.destination);
    startTime = ctx.currentTime;
    playing = true;
    stopping = false;
    sourceNode.onended = () => {
      setTimeout(stopRecording, 500); // small tail so the last note isn't cut
    };
    sourceNode.start();
    updatePlayhead();
  }

  function updatePlayhead() {
    if (!playing) return;
    const p = (audioCtx.currentTime - startTime) / clipBuffer.duration;
    Waveform.draw($("wave-canvas"), clipPeaks, Math.max(0, Math.min(1, p)));
    if (p < 1.05) {
      rafId = requestAnimationFrame(updatePlayhead);
    }
  }

  async function stopRecording() {
    if (stopping) return;
    stopping = true;
    playing = false;
    cancelAnimationFrame(rafId);

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      await new Promise((res) => {
        mediaRecorder.onstop = res;
        try { mediaRecorder.stop(); } catch (e) { res(); }
      });
    }
    if (micStream) micStream.getTracks().forEach((t) => t.stop());

    const blob = new Blob(recChunks, { type: recMime || "audio/webm" });
    if (!blob.size) {
      toast("Got an empty recording 😢 try again");
      showScreen("main");
      resetStage();
      return;
    }
    if (takeBlobUrl) URL.revokeObjectURL(takeBlobUrl);
    takeBlobUrl = URL.createObjectURL(blob);

    // decode take (fast) so the dual waveform can show during judging
    let takeBuffer;
    try {
      const ab = await blob.arrayBuffer();
      takeBuffer = await audioCtx.decodeAudioData(ab);
    } catch (e) {
      toast("Couldn't decode your take 😢 try again");
      showScreen("main");
      resetStage();
      return;
    }
    takePeaks = Waveform.peaksFromBuffer(takeBuffer, 240);

    showJudging(blob);
    // let the UI paint, then score (~250 ms even for long songs)
    setTimeout(() => {
      const result = Scoring.score(clipBuffer, takeBuffer);
      showScores(result);
    }, 80);
  }

  /* ---------- results ---------- */

  function tierMessage(p) {
    if (p < 35) return ["Don't quit your day job. 😭", false];
    if (p < 55) return ["The cows are unimpressed. 🐄", true];
    if (p < 75) return ["Not bad... for a beginner. 😏", true];
    if (p < 90) return ["Okay okay, that was actually good. 🔥", true];
    return ["🏆 GOLDEN VOICE — VERITY CERTIFIED", true];
  }

  // judging mode: spinner + audio + DOWNLOAD BUTTON, scores hidden
  function showJudging(blob) {
    $("score-block").classList.add("hidden");
    $("judging").classList.remove("hidden");
    $("results-wave").classList.remove("hidden");
    $("legend").classList.remove("hidden");
    Waveform.drawDual($("results-wave"), clipPeaks, takePeaks);

    const audio = $("take-audio");
    audio.src = takeBlobUrl;

    const ext = recMime.indexOf("mp4") >= 0 ? ".m4a" : ".webm";
    const dl = $("btn-download");
    dl.href = takeBlobUrl;
    dl.download = "dub-take-" + clipName.replace(/\.[^.]+$/, "") + ext;

    updateBestBadge();
    showScreen("results");
  }

  function showScores(result) {
    const p = result.percent;
    const prevBest = Number(localStorage.getItem(bestKey()) || 0);
    const isNewBest = p > prevBest;
    if (isNewBest) localStorage.setItem(bestKey(), String(p));

    const flame = tierMessage(p)[1];
    $("flames").classList.toggle("hidden", !flame);

    // count-up animation
    const el = $("score-percent");
    const t0 = performance.now();
    const dur = 1200;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(p * (1 - Math.pow(1 - k, 3))) + "%";
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    $("score-msg").textContent = tierMessage(p)[0];
    $("bar-env").style.width = Math.round(result.env * 100) + "%";
    $("bar-pitch").style.width = Math.round(result.pitch * 100) + "%";
    $("bar-dur").style.width = Math.round(result.dur * 100) + "%";
    $("new-best").classList.toggle("hidden", !isNewBest);

    $("judging").classList.add("hidden");
    $("score-block").classList.remove("hidden");
    updateBestBadge();
  }

  /* ---------- wiring ---------- */

  window.addEventListener("DOMContentLoaded", () => {
    const input = $("file-input");
    input.addEventListener("change", (e) => handleFile(e.target.files[0]));
    $("dropzone").addEventListener("click", () => input.click());

    $("btn-preview").addEventListener("click", togglePreview);
    $("btn-start").addEventListener("click", startDub);
    $("btn-stop").addEventListener("click", () => {
      if (sourceNode) { try { sourceNode.stop(); } catch (e) {} }
      stopRecording();
    });
    $("btn-retry").addEventListener("click", () => { showScreen("main"); resetStage(); });
    $("btn-new").addEventListener("click", () => { showScreen("drop"); input.value = ""; });

    window.addEventListener("resize", () => {
      if (clipBuffer && !$("screen-main").classList.contains("hidden")) {
        Waveform.draw($("wave-canvas"), clipPeaks, 0);
      }
      if (takePeaks && !$("screen-results").classList.contains("hidden")) {
        Waveform.drawDual($("results-wave"), clipPeaks, takePeaks);
      }
    });
  });
})();

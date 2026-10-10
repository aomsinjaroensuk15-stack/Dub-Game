# 🎤 Dub Roast

Import a sound, dub your voice over it, get roasted with a score. A meme voice-dub game that runs entirely in the browser — no installs, no build step, no backend.

Inspired by the classic "voice over the song" clips 🐄

## 🕹️ How to play

1. Open the page (needs **HTTPS** and Chrome — mic permission)
2. Tap **import sound** (mp3 / wav / m4a / ogg)
3. Tap **🎤 Start Dubbing** — 3-2-1-GO, the clip plays and your mic records at the same time
4. Get scored on **Rhythm** (energy envelope), **Pitch** (autocorrelation contour) and **Timing**
5. Get roasted. Retry. Beat your best score 🏆

Extras: **▶ Preview** listens to the clip first, your take is shown as a cyan waveform overlaid 50/50 on the magenta clip, and you can **⬇️ download your take** right from the judging screen.

## 🚀 Host it free on GitHub Pages

1. Create a new repository on [github.com](https://github.com) (Public)
2. Upload **all files in this folder** via *Add file → Upload files*
3. *Settings → Pages → Source: `main` branch → Save*
4. Wait ~1 minute, then open `https://<your-username>.github.io/<repo-name>/`
5. Share the link with friends so they can get roasted too 😌

## 🧠 How scoring works (`scoring.js`)

Pure DSP, no libraries:

- **Alignment** — cross-correlation of RMS envelopes finds mic-start lag (±1.5 s tolerance)
- **Rhythm (50%)** — Pearson correlation of log-RMS energy envelopes
- **Pitch (30%)** — per-frame autocorrelation pitch detection → contour correlation (neutral 0.5 if the clip is mostly speech)
- **Timing (20%)** — duration ratio after silence trimming
- Final: weighted mix, softened with a `pow(raw, 0.8)` curve

## 📁 Files

| file | what it does |
|---|---|
| `index.html` | screens: import / main / results |
| `style.css` | dark magenta theme, animated flames 🔥 |
| `app.js` | flow: import → countdown → play+record → score |
| `waveform.js` | canvas waveform + playhead |
| `scoring.js` | the judge (pure DSP, node-testable) |

## 🗺️ Roadmap

- video files (strip audio in-browser with ffmpeg.wasm)
- share your take (Web Share API)
- leaderboard per clip via URL hash
- duet mode: two takes panned left/right

## ⚠️ Honest notes

- The clip plays through your speaker while you record, so the mic hears it too — this makes scores forgiving. It's a party game, not a conservatory exam 😄
- Best scores are stored per-clip in `localStorage` (stays on your phone)

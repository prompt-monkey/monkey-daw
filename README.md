# monkey-daw

A music studio that runs in the browser. Record, arrange, program beats and melodies, mix with
effects and export, with no account, no paywall and no server. Projects and samples stay on your
device.

## Features

- **Timeline:** audio, MIDI and drum tracks; trim, split, fade, stretch, reverse, pitch and
  duplicate clips; loop region, snap and zoom.
- **Recording:** record from a microphone or an interface onto an armed track, with a metronome
  and count-in.
- **Piano roll:** draw, brush and edit notes, built-in instruments or your own sample, glide,
  swing and MIDI file import.
- **Drums:** 16 pads, a step sequencer, kit presets, choke groups and a pattern generator for
  genres such as trap, reggaeton, hip-hop, lo-fi, R&B, rock and corridos.
- **Mixer:** faders, pan, meters, buses and sends.
- **Effects:** over 30 effects, from EQ, compression, reverb and delay to saturation, amp
  simulation and auto-tune, with presets and a pitch editor for vocals.
- **Automation:** draw or record volume, pan and effect parameters over time.
- **Tempo sync:** loops follow the project tempo by stretching or resampling.
- **Sample library:** import folders of your own samples, then tag, filter, preview and drag them
  onto tracks.
- **Lyrics:** write song sections next to the timeline and sing along in a large-text mode.
- **Export:** the mix or each track as WAV or MP3, or the whole project as an `.mdaw` file to back
  up or move to another computer.
- **Phone friendly:** a touch layout with pinch zoom and tap gestures.

## Getting started

You need [Node.js](https://nodejs.org) 20.19 or newer (22.12+ or 24 recommended).

```sh
npm install
npm run dev
```

Then open the address it prints (usually <http://localhost:5173>).

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Unit tests |
| `npm run typecheck` | Type checking |
| `npm run lint` | Lint |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serve the production build locally |

The build is a static site, so `dist/` can be hosted anywhere that serves files. Pushes to `main`
publish it to GitHub Pages through `.github/workflows/pages.yml`; to serve it from a sub-folder
elsewhere, build with `BASE_PATH=/folder/ npm run build`.

## How it's built

React 19 and TypeScript, built with Vite. Audio runs on the Web Audio API with AudioWorklets for
the custom effects; state lives in Zustand with Immer, projects are stored in IndexedDB through
Dexie, and styling is Tailwind CSS. The full feature list and design notes are in
[`docs/features.md`](docs/features.md).

It is developed and tested in Chrome.

## License

MIT, see [`LICENSE`](LICENSE). The MP3 encoder is a separate library under the LGPL; see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

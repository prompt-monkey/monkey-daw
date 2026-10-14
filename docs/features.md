# monkey-daw — feature list

Scope: a browser DAW with no accounts, no collaboration and no paywall. Everything is free and
unlimited, and projects and samples stay on the user's device. One fixed dark theme.

## 1. Sample browser
- Libraries made from the user's own imported folders, plus an optional bundled starter pack
- Folder tree, waveform preview
- Filter by time signature (6/8, 3/4, 2/4, 4/4)
- Instrument categories, each with its own colour
- Drag a sample onto a track
- One-shots and MIDI melodies sections
- Import files or whole folders

## 2. Transport
- Play/pause, stop, record
- Time readout
- BPM control (scroll wheel, drag, double-click to type)
- Time signature
- Metronome
- Loop toggle
- Playhead follow

## 3. Timeline
- Ruler, playhead, loop region
- Snap: off, bar or beat, with a free-placement modifier key
- Clip editing:
  - Move, trim, duplicate, copy/paste, delete
  - Multi-select
- Clip properties:
  - Fades with adjustable curves
  - Gain line
  - Reverse, pitch shift, time stretch
  - Rename
- Consolidate a selection to audio
- Convert MIDI or drums to audio
- Zoom
- Track height: normal or compact

## 4. Tracks
- Types: audio, MIDI, drums
- Add, insert, reorder, duplicate, delete
- Volume, pan, mute, solo
- Output routing to the master or a bus
- Record-arm with input device and channel

## 5. Recording
- Mic or line input
- Input meter
- Latency offset
- No time limit
- Takes stored on the device
- Download takes as WAV

## 6. Piano roll (MIDI)
- Tools: draw, erase, select, zoom
- Note editing:
  - Move, resize
  - Copy/duplicate/paste
  - Octave shift
- Glissando preview
- PAT/SONG modes
- MIDI file import

## 7. Drums
- Pad view: drop a one-shot to assign it
- Step sequencer
- Kit presets
- Pattern generator: genre, major/minor, chords/melody/bass, new variation

## 8. Mixer
- Channel strips
- Buses with post-fader sends
- Master channel and fader
- VU meter and input meter

## 9. Effects rack
- Ordered chain per track, bus and master
- Effect groups:
  - **Voice:** auto-pitch, graphic pitch editor, gate
  - **Dynamics:** EQ, compressor, opto, de-esser, sidechain duck, transient shaper
  - **Colour:** saturation, clipper, tape, amp, bitcrusher, vinyl, air, tilt, filter, mid/side
  - **Space:** delay, ping-pong, slapback, reverb, plate, spread
  - **Modulation:** chorus/width, phaser/flanger, auto-pan/tremolo, vibrato, 12-string doubler
- BPM-synced parameters
- Chain presets, built-in and your own

## 10. Automation
- Lanes for effect knobs, volume and pan
- Add, move and delete points
- Curve handles
- Knobs move during playback

## 11. Tempo sync
- Samples with a BPM in their filename fit the project tempo
- Stretch mode (keeps the pitch) vs. Resample mode (pitch follows tempo)

## 12. Export
- WAV and MP3 mix
- Stems as a ZIP
- Export the loop region only
- Progress display
- No restrictions

## 13. Projects and storage (local only)
- Unlimited projects saved in the browser (IndexedDB)
- New, save, save a copy, rename, delete
- Unsaved-changes tracking
- Automatic crash recovery
- Project file (a ZIP of the project plus its audio) to download, restore, or move to another machine
- Device storage meter

## 14. Lyrics
- Song sections
- Write and Sing modes
- Font size, copy
- Download as .txt

## 15. App shell
- One fixed dark theme
- Automatic "lite" performance mode
- Fullscreen and mobile layout
- Shortcuts guide (`?`)

## Tech stack

A static app with no backend.

| Layer | Choice | Why |
|---|---|---|
| Language and build | TypeScript + Vite | Fast development builds, easy setup for AudioWorklets and Web Workers |
| UI | React | Large ecosystem; the parts that need speed (timeline, meters) live outside React anyway |
| Styling and components | Tailwind CSS + shadcn/ui (Radix) | Accessible dialogs, sliders and menus; one dark theme via CSS variables |
| State and undo/redo | Zustand + Immer, with a command history for undo/redo | Simple, fast, and lets the audio engine subscribe outside React |
| Audio engine | Web Audio API, our own engine (no Tone.js) | Full control of routing, buses and sends; one scheduler shared by live playback and offline export |
| Custom DSP | AudioWorklet | Auto-pitch and effects the built-in audio nodes can't do |
| Timeline and waveforms | Canvas 2D, peaks computed in a Web Worker | Smooth scrolling and zoom with many clips |
| Local storage | IndexedDB via Dexie | Projects, recordings and imported samples; request persistent storage |
| Project file and stems | fflate (or JSZip) | Builds the project ZIP and the stems ZIP |
| MP3 export | lamejs (maintained fork), in a Web Worker | |
| Time stretch / pitch shift | SoundTouch (WASM/worklet) first; Rubber Band WASM later if quality matters | The hardest DSP part, best left to a library |
| MIDI import | @tonejs/midi | Parsing only, not the Tone.js audio engine |
| Testing | Vitest (model, scheduler, DSP) + Playwright (end-to-end in a real browser) | The audio engine needs real-browser tests |
| Hosting | Any static host (GitHub Pages, Netlify, Cloudflare Pages); optional PWA for offline use | No server needed |

Decisions:
- React over Svelte/Solid: the safer pick for a large UI.
- Our own audio engine over Tone.js: Tone.js speeds up the start but limits buses, sends and
  keeping playback and export identical.

## Build order

0. **Foundation:** data model (tracks, clips, BPM/time-signature grid), state store with
   undo/redo, audio engine and scheduler
1. **MVP:** Transport → Timeline → Tracks → Mixer → Export (WAV)
2. Projects and storage → Sample browser → Recording
3. Effects rack (start with EQ, compressor, delay, reverb, filter) → Automation
4. Piano roll → Drums → Tempo sync
5. Remaining effects, the MP3/stems export formats, Lyrics, App shell polish

Why this order:
- Undo/redo is easy to design in on day one and painful to add later.
- Export is the offline renderer (the same graph without real-time output). Consolidate,
  convert-to-audio and stems all reuse it, so it belongs in the MVP.
- Projects and storage come early: without saving, test sessions are lost, and the file format
  shapes the data model.
- Recording comes early: Transport already has a record button, and the pitch editor needs takes.

Dependencies:
- Sidechain duck needs bus routing (Mixer)
- Automation needs the Effects rack
- The graphic pitch editor needs Recording
- Convert-to-audio and stems need Export

## Risks

| Feature | Difficulty | Why / approach |
|---|---|---|
| Time stretch / pitch shift that keeps quality (Tempo sync, clip pitch) | High | Use a library such as SoundTouch or Rubber Band compiled to WebAssembly rather than writing your own |
| Graphic pitch editor | Very high | Melodyne-style: pitch detection, a note-blob UI, then resynthesis. Defer it, or cut it |
| Auto-pitch | Medium-high | An AudioWorklet with pitch detection (YIN) and period shifting |
| Timeline performance | Medium | Waveforms on canvas, a virtualised track list, no React re-render on every frame |
| Scheduling with automation | Medium | Live playback and offline export must match exactly. Use one scheduler for both |
| About 30 effects | Medium, but a lot of work | Each is small, but there are many. Ship 5–6 well, then add more |
| Browser storage limits | Medium | Browsers can evict IndexedDB data. Request persistent storage, show usage, and push users to the project-file backup |
| iOS Safari | Medium | Audio unlocking and recording quirks |
| MP3 export | Low | Use an encoder library such as lamejs |

Plan: reach a usable MVP first (arrange samples, mix, save, export WAV), then grow it feature by
feature. The graphic pitch editor and high-quality time-stretch are optional stretch goals.

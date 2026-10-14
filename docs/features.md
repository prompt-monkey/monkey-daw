# monkey-daw — feature list

Scope: a browser DAW with no accounts, no collaboration and no paywall. Everything is free and
unlimited, and projects and samples stay on the user's device. One fixed dark theme.

## Progress

Phases 0–3, the piano roll and drums are built. Every step has unit tests (195 in total) and was
checked in Chrome.

| Phase | Step | Status | Commit |
|---|---|---|---|
| 0 | Foundation: data model, undo/redo, audio engine and scheduler | Done | `1ce5b5f` |
| 1 | Timeline: ruler, clip editing, waveforms, selection, zoom | Done | `e121d45` |
| 1 | Tracks and mixer: buses, sends, routing, meters, track management | Done | `5591d58` |
| 1 | Export: WAV mix (whole project or loop) | Done | `0eab8e0` |
| 2 | Projects and storage: save/open, recovery autosave, `.mdaw` project file | Done | `3fe3cba` |
| 2 | Sample browser: libraries, tagging, filters, preview, drag to tracks | Done | `b2f1f9a` |
| 2 | Recording and metronome | Done | `da81b00` |
| 3 | Effects rack with batch 1 (7 effects), presets, export tails | Done | `177f1a8`, `1588287` |
| 3 | Automation: volume, pan and effect parameters on tracks | Done | `4f14e62` |
| 4 | Piano roll: MIDI tracks, instruments, note editing, PAT/SONG, MIDI import | Done | `02bc687` |
| 4 | Drums: pads, step sequencer, kit presets, pattern generator | Done | |
| 4 | Tempo sync | Next | |
| 5 | MP3/stems export, Lyrics, App shell polish | Planned | |
| 6 | Effects batches 2 and 3 | Deferred to the end | |

Known gaps in what's built (planned for later steps):
- Timeline: reverse, pitch and stretch on clips, curved clip fades, consolidate and
  convert-to-audio; clips can only be renamed in the piano roll (MIDI clips)
- Mixer and automation: automation on buses and the master, writing automation by moving a knob
- Sample browser: no bundled starter pack; no MIDI melodies section yet (.mid files import from
  the timeline's Import button or by dropping them on the timeline)
- Recording: tested with a synthetic signal; real microphones and latency setups need a hands-on check
- Drums: no choke groups (a closed hat doesn't cut an open hat); swing comes only from the
  generator's genres; generated patterns are written for 16 steps per bar, so other time
  signatures use the first steps of each pattern

## Development

- **Node.js 24** (24.21.0 is what the project is built and tested with). Vite 8 and Vitest 5 don't
  start on Node 20.12. With nvm-windows: `nvm use 24.21.0`.
- `npm install`, then:
  - `npm run dev`: development server
  - `npm test`: unit tests
  - `npm run typecheck` and `npm run lint`
  - `npm run build`: production build in `dist/`

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

Built in phase 4. A MIDI track plays its clips with an instrument: five built-in synths (Keys,
Pluck, Bass, Pad, Lead) or a sampler that pitches a dropped one-shot across the keys from a root
note. Glide makes the instrument play one note at a time and slide between overlapping notes.
Notes are stored in beats, so MIDI clips keep their place in bars and beats when the tempo
changes. Double-click a MIDI clip (or empty space on a MIDI track) to open it in the piano roll.
The piano roll has draw, select, erase and zoom tools (D, S, E, Z), and right-click erases with
any tool. Shortcuts: Ctrl+A/C/X/V/D, Delete, ↑/↓ semitone, Shift+↑/↓ octave, ←/→ by one grid
step. Alt places notes off the grid. Click or sweep the keyboard to hear the notes (glissando).
PAT loops the open clip on its own while the piano roll is shown; SONG plays the project.

## 7. Drums
- Pad view: drop a one-shot to assign it
- Step sequencer
- Kit presets
- Pattern generator: genre, major/minor, chords/melody/bass, new variation

Built in phase 4. A drum track has a 16-pad kit; each pad sits on a General MIDI drum note, so
drum clips are note clips and drum MIDI files (and channel 10 of any MIDI file) land on the right
pads. Every pad has a synthesized sound (no sample packs are bundled) with tune, decay and level;
drop a one-shot from the library or a WAV/MP3 on a pad to use it instead. Kit presets (Standard,
Trap, Lo-fi, Latin, Rock) retune the synthesized pads. The step sequencer works in 1/8, 1/16 or
1/32 steps: click or drag to add steps (Shift for an accent), drag from a filled step or
right-click to remove, Alt+click to change a step's velocity. The pattern generator (genres:
Reggaeton, Trap, Trap latino, Hip hop, Lo-fi, Ballad, Corrido tumbado, Rock) writes drums into the
clip and chords, melody and bass onto MIDI tracks named after them, in a chosen key and major or
minor; "New variation" makes another take. PAT/SONG works as in the piano roll.

## 8. Mixer
- Channel strips
- Buses with post-fader sends
- Master channel and fader
- VU meter and input meter

## 9. Effects rack
The rack is built in three batches. Only the rack and batch 1 are built in phase 3; batches 2 and 3
are deferred to the end of the project (see "Deferred to the end" below).

**Rack (phase 3)**
- Ordered effect chain per track, bus and master: add, remove, drag to reorder
- Bypass per effect and for the whole chain
- Knobs: drag or mouse wheel, double-click to reset, values in real units (Hz, ms, dB, %)
- BPM-synced parameters (delay time)
- Same graph live and in exports, so playback and the exported file always match
- Settings saved in the project, with undo/redo
- Chain presets: built-in starting points plus your own saved chains
- Export option to add a tail so reverb and delay decays aren't cut off
- Every parameter ready to be automated in the Automation step

**Batch 1: essentials (phase 3)**
| Effect | Parameters |
|---|---|
| EQ | Low shelf, peaking mid (with Q), high shelf, low-cut, high-cut |
| Compressor | Threshold, ratio, knee, attack, release, makeup gain, mix |
| Filter | Low-, high- or band-pass; cutoff, resonance, mix |
| Delay | Time (free or BPM-synced), feedback, tone, ping-pong, mix |
| Reverb | Decay, pre-delay, damping, mix (generated impulse response) |
| Saturation | Drive, tone, output, mix |
| Gate | Threshold, attack, release, range |

**Batch 2: character and space (deferred to the end)**
- Stereo width / chorus, phaser / flanger, tremolo / auto-pan, vibrato
- Tape (wobble and wear), bitcrusher, soft clipper
- Tilt EQ, air (high-end lift), mid/side balance
- Slapback, plate reverb, stereo spread
- Sidechain duck (BPM-synced pumping, no sidechain input needed)

**Batch 3: specialist, AudioWorklet-based (deferred to the end)**
- Transient shaper, de-esser, optical-style compressor
- 12-string doubler, amp/cabinet colour
- Auto-tune (real-time pitch correction to a key and scale): its own step
- Graphic pitch editor: optional stretch goal

## 10. Automation
- Lanes for effect knobs, volume and pan
- Add, move and delete points
- Curve handles
- Knobs move during playback

Built in phase 3, on tracks. Lanes are drawn over the track's clips (track menu → Show automation,
or right-click a rack knob). Values follow each control's own scale (fader curve, octaves for
frequencies). Not yet: automation on buses and the master, writing automation by moving a knob
during playback, and automating reverb decay or saturation drive (changing those rebuilds audio
data, so they can't move smoothly).

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
| Styling and components | Tailwind CSS with small custom components (dialog, menu, knob) | One dark theme via CSS variables; shadcn/ui (Radix) wasn't needed so far |
| State and undo/redo | Zustand + Immer, with a command history for undo/redo | Simple, fast, and lets the audio engine subscribe outside React |
| Audio engine | Web Audio API, our own engine (no Tone.js) | Full control of routing, buses and sends; one scheduler shared by live playback and offline export |
| Custom DSP | AudioWorklet | Auto-pitch and effects the built-in audio nodes can't do |
| Timeline and waveforms | Canvas 2D, peaks computed in a Web Worker | Smooth scrolling and zoom with many clips |
| Local storage | IndexedDB via Dexie | Projects, recordings and imported samples; request persistent storage |
| Project file and stems | fflate | Builds the project ZIP (and later the stems ZIP) |
| MP3 export | lamejs (maintained fork), in a Web Worker | |
| Time stretch / pitch shift | SoundTouch (WASM/worklet) first; Rubber Band WASM later if quality matters | The hardest DSP part, best left to a library |
| MIDI import | Our own small Standard MIDI File reader (notes only) | No dependency needed for reading notes; each track/channel becomes a part |
| Testing | Vitest (model, scheduler, DSP, storage with fake-indexeddb); browser checks in Chrome | The audio engine needs real-browser checks; automated Playwright tests are still to add |
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
3. Effects rack with batch 1 (EQ, compressor, filter, delay, reverb, saturation, gate) → Automation
4. Piano roll → Drums → Tempo sync
5. The MP3/stems export formats, Lyrics, App shell polish
6. **Deferred to the end:** effects batch 2 (character and space), then batch 3 (specialist and
   pitch effects), one effect at a time

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

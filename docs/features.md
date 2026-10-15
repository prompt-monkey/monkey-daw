# monkey-daw — feature list

Scope: a browser DAW with no accounts, no collaboration and no paywall. Everything is free and
unlimited, and projects and samples stay on the user's device. One fixed dark theme.

## Progress

Every planned feature is built, including the optional graphic pitch editor. Every step has unit
tests (270 in total) and was checked in Chrome.

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
| 4 | Drums: pads, step sequencer, kit presets, pattern generator | Done | `7d0ac05` |
| 4 | Tempo sync: BPM from file names, Stretch and Resample modes | Done | `96f4544` |
| 5 | Export: MP3, stems as a ZIP | Done | `dad7618` |
| 5 | Lyrics: sections, Write and Sing modes, copy, .txt | Done | `3d54e4b` |
| 5 | App shell: shortcuts guide, lite mode, fullscreen, phone layout | Done | `73d7ab2` |
| 6 | Effects batch 2: character and space (14 effects) | Done | `ae07721` |
| 6 | Effects batch 3: transient shaper, de-esser, opto compressor, 12-string doubler, amp/cabinet | Done | `b229b4f` |
| 6 | Effects batch 3: auto-tune | Done | `642b1fd` |
| 7 | Follow-ups: auto-tune readout, drum choke groups, compact phone top bar, clip reverse / pitch / curved fades / consolidate / convert to audio, automation on buses and the master, writing automation, graphic pitch editor | Done | |

Known gaps in what's built (planned for later steps):
- Timeline: no free time-stretch of a clip by dragging its edge (clips stretch through tempo sync);
  consolidating a hard-panned mono clip comes out about 3 dB louder on that side
- Sample browser: no bundled starter pack; no MIDI melodies section yet (.mid files import from
  the timeline's Import button or by dropping them on the timeline)
- Recording: tested with a synthetic signal; real microphones and latency setups need a hands-on check
- Phones: the layout was checked at 390 px wide in desktop Chrome; touch gestures (pinch zoom, tap
  to seek, touch drags) need a check on a real phone. Long-press menus depend on the browser
  (Chrome on Android opens them; iOS Safari doesn't)
- Drums: swing comes only from the generator's genres; generated patterns are written for 16 steps
  per bar, so other time signatures use the first steps of each pattern
- Pitch editor: works best on clean, single-voice recordings; its pitch line shows the original
  recording, not the moved notes

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

The clip properties and consolidate / convert were added in the follow-ups. Right-click an audio
clip to reverse it, set its pitch (semitones, without changing its length), bounce it, or
consolidate the selected clips on each track into one (gain, fades, pitch, reverse and tempo
baked in; the track's effects are not). Right-click a MIDI or drum clip to convert it to audio,
with or without the track's effects: the result goes on a new audio track below, the source track
is muted, and the silent tail is trimmed. Fades bend when their handle is dragged up or down;
double-click the handle to straighten it.

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

Pads have choke groups (None or 1–4): a hit cuts off the other pads of its group that are still
ringing, with a 6 ms fade. The closed and open hi-hats are in group 1 in every kit.

## 8. Mixer
- Channel strips
- Buses with post-fader sends
- Master channel and fader
- VU meter and input meter

## 9. Effects rack
The rack is built in three batches. The rack and batch 1 were built in phase 3, batch 2 in phase 6;
batch 3 is still to do.

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

**Batch 2: character and space (phase 6)**
| Effect | Parameters |
|---|---|
| Chorus | Rate, depth, delay, width (left and right move apart), mix |
| Phaser / Flanger | Type, rate, depth, feedback, mix |
| Tremolo / Auto-pan | Type, sync (free or a note length), rate, depth, shape (smooth, triangle, choppy) |
| Vibrato | Rate, depth (up to a semitone) |
| Tape | Wobble (slow wow), flutter, wear (duller highs and hiss), mix |
| Bitcrusher | Bits, downsample, mix (an AudioWorklet) |
| Soft clipper | Drive, ceiling, softness |
| Tilt EQ | Tilt, pivot |
| Air | Amount, frequency |
| Mid/Side | Mid level, side level (widen or narrow) |
| Slapback | Time, tone, feedback, mix |
| Plate reverb | Decay, pre-delay, tone, low cut, mix (a generated plate impulse) |
| Stereo spread | Amount, time (a Haas delay on one side) |
| Sidechain duck | Every (1/2 to 1/16), depth, release; pumps on the song's beat grid |

The "+ Add effect" button opens a picker grouped into Essentials and Character and space. Tempo
sync now covers the tremolo's rate as well as the delay's time. The sidechain duck is scheduled
with the song position like automation, so it lands on the beat live and in exports. New
built-in presets: Slap vocal, Wide pad, Lo-fi keys and Pumping bus. Plate decay, the clipper's
softness and the duck's depth and release can't be automated (they reshape audio data or
schedules); the other new knobs can. Tremolo and the other LFOs run free in phase (only their rate
follows the tempo).

**Batch 3: specialist (phase 6)**
| Effect | Parameters |
|---|---|
| Transient shaper | Attack and sustain (−100…100%, up to ±12 dB on the attack), output; works at any level |
| De-esser | Frequency, threshold, range; turns down only the highs, split so the rest is untouched |
| Opto compressor | Peak reduction, gain, mix; gentle 3:1 with a soft knee and a two-stage release |
| 12-string doubler | Octave level, detune (cents), spread, mix |
| Amp / cabinet | Drive, bass, mid, treble, cabinet (none, 1×12, 4×12), output |
| Auto-tune | Key, scale (chromatic, major, minor, harmonic minor, major and minor pentatonic), retune speed (0 ms = the hard robotic effect), amount, mix |

The first four run in one AudioWorklet; their DSP lives in `specialist-dsp.ts` and is unit-tested
on its own. The amp is built from standard nodes (an asymmetric tube-style curve and filters that
voice the cabinet). The doubler's pitch shifter is a simple two-head delay line: fine for a
doubled copy under the dry sound, but it smears big shifts into sidebands, so auto-tune will need
a better one. New presets: Vocal polish, Acoustic 12-string, Punchy drums and Electric crunch.

Auto-tune detects the pitch with YIN on a 2× down-sampled copy every ~12 ms (70 Hz–1 kHz), snaps it
to the nearest note of the key and scale, glides there at the retune speed and shifts the sound by
the difference. The shifter drifts one read head through a short delay line and only ever jumps by
whole periods of the detected pitch, with a short cross-fade, so sung notes stay clean; unpitched
sounds (breaths, consonants) pass through untouched. Detection runs on a mono mix and every channel
is shifted the same way, so stereo is kept. It adds about 25 ms of latency and is the heaviest
effect (around 12% of a core per instance on the test machine), so use it on vocals, not on every
track. While audio plays, its rack card shows the note it hears, how far off it is, and the note
it pulls to (e.g. "A3 +30¢ → A3"). Presets: Vocal tune and Robot voice.

**Graphic pitch editor** (follow-ups). Right-click an audio clip → Edit pitch… The recording's
pitch is analysed in a worker (YIN every ~6 ms) and grouped into notes, shown as blobs over a
semitone grid with the pitch line. Drag a note up or down (it lands on a semitone; Alt moves it
freely), double-click it to reset, or "Snap all to notes". Each change is rendered with the
auto-tune's shifter into new audio that the clip then plays; the clip keeps the original audio and
the list of moves, so edits can be changed or undone, and the result works with reverse, tempo
sync, export and saving like any audio clip.

## 10. Automation
- Lanes for effect knobs, volume and pan
- Add, move and delete points
- Curve handles
- Knobs move during playback

Built in phase 3 on tracks; buses, the master and writing were added in the follow-ups. Track lanes
are drawn over the track's clips (track menu → Show automation, or right-click a rack knob). Bus
and master lanes get rows under the tracks (the "A" button on their mixer strip, or right-click a
knob in their rack); the master has no pan lane. Values follow each control's own scale (fader
curve, octaves for frequencies).

Write mode (the Write button, or W): while the song plays, moving a fader, pan or knob records the
movement into its lane, replacing what was there for as long as the control is held, and you hear
the movement as you make it. Each movement is one undo step. Automated controls can only be moved by
hand while Write is on. Reverb decay and saturation drive still can't be automated (changing them
rebuilds audio data, so they can't move smoothly).

## 11. Tempo sync
- Samples with a BPM in their filename fit the project tempo
- Stretch mode (keeps the pitch) vs. Resample mode (pitch follows tempo)

Built in phase 4. An audio clip whose name gives a tempo ("Loop 95bpm", "drums_128_BPM", or a bare
number such as "Guitar_92_Am" when the sample lasts whole beats at that tempo) is synced when it
is placed: it plays at project BPM ÷ its tempo and, like MIDI and drum clips, keeps its place in
bars when the tempo changes. Right-click a clip to sync it by hand, change its original tempo,
stop syncing, rename, duplicate or delete it. The mode next to the BPM applies to the whole
project: Stretch keeps the pitch (our own WSOLA time-stretch, run in a worker and cached; until
it's ready, playback resamples for a moment), Resample speeds the audio up or down like a record.
Exports always wait for the stretched audio.

## 12. Export
- WAV and MP3 mix
- Stems as a ZIP
- Export the loop region only
- Progress display
- No restrictions

MP3 and stems added in phase 5. The export dialog chooses the mix or stems, WAV (16 or 24-bit) or
MP3 (128–320 kbps), the whole project or the loop, and effect tails. Stems are one file per
unmuted track with clips (solo is ignored), numbered in track order and zipped; each stem goes
through its buses and the master, so the stems add up to the mix except for effects that react to
the whole mix (like a master compressor).

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

Built in phase 5. The Lyrics button opens a panel on the right. The lyrics are part of the
project (saved, undoable, in the project file) as sections: Intro, Verse, Pre-chorus, Chorus,
Bridge, Solo and Outro, which can be added, retyped, moved and deleted. Verses are numbered, other
kinds only when repeated. Write mode edits each section; Sing mode shows the lyrics large to sing
along. A−/A+ change the text size; the mode and size are remembered in the browser. Copy puts the
lyrics on the clipboard and .txt downloads them, as "[Verse 1]" headed sections.

## 15. App shell
- One fixed dark theme
- Automatic "lite" performance mode
- Fullscreen and mobile layout
- Shortcuts guide (`?`)

Built in phase 5. `?` (or "All shortcuts" in the footer, or the View menu) lists every keyboard
and mouse shortcut by area. The View menu also toggles fullscreen (F) and sets lite mode: Auto,
On or Off. Lite mode redraws the meters about 20 times a second instead of every frame, draws
waveforms at lower resolution and keeps 0.3 s of audio scheduled instead of 0.12 s, so playback
survives longer stalls. Auto turns it on for devices with two cores or 2 GB of memory or less, or
when playback keeps dropping frames (a message says so). Below 768 px wide the layout changes: a
narrower track header with volume and pan left to the mixer, the library and lyrics as drawers
over the timeline, shorter bottom panels, fewer toolbar buttons, no footer. On touch screens two
fingers pinch to zoom the timeline, one finger scrolls, a tap moves the playhead, and drags on
clips, notes, steps, pads, knobs and automation edit instead of scrolling.

On phones the top bar keeps Save, undo/redo, the time, the transport and tempo / time signature /
snap / loop, and puts Projects, Library, Lyrics, Mixer, Export and the view options in a ☰ menu.

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
| MP3 export | @breezystack/lamejs (maintained lamejs fork), in the export Web Worker | LGPL-3.0, used unmodified and loaded only in the worker's own file |
| Time stretch | Our own WSOLA time-stretch in a Web Worker, cached per clip rate | No dependency (SoundTouch's JS port is LGPL); good on loops and drums. Rubber Band WASM later if quality on sustained material matters |
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
| Time stretch / pitch shift that keeps quality (Tempo sync, clip pitch) | High | Tempo sync uses our own WSOLA; heavy stretches of sustained tones can warble. Clip pitch shift and better quality may need Rubber Band compiled to WebAssembly |
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

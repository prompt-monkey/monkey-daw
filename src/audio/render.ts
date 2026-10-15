// Offline rendering: the same graph and the same clip events as live playback, rendered
// faster than real time. Export, consolidate and convert-to-audio build on this.

import { ensureEffectWorklets } from '../effects/nodes'
import type { Project } from '../model/types'
import type { AssetRegistry } from './assets'
import { MixGraph } from './graph'
import { clipEvents, noteEvents } from './schedule'
import { clipBuffer, prepareStretches } from './stretch'

export interface RenderRange {
  start: number
  end: number
}

export interface RenderOptions {
  sampleRate?: number
  /** Called with 0…1 as rendering advances. */
  onProgress?: (fraction: number) => void
}

/** Number of progress updates over a render. */
const PROGRESS_STEPS = 40
/** Web Audio renders in blocks of this many frames; suspend times must fall on block edges. */
const RENDER_QUANTUM = 128

export async function renderProject(
  project: Project,
  assets: AssetRegistry,
  range: RenderRange,
  { sampleRate = 44100, onProgress }: RenderOptions = {},
): Promise<AudioBuffer> {
  const duration = range.end - range.start
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  // Exports always use the stretched audio, so wait for it.
  await prepareStretches(project, assets)
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  await ensureEffectWorklets(ctx)
  const mix = new MixGraph(ctx)
  mix.sync(project, true, range.start)
  mix.scheduleAutomation(project, { from: range.start, to: range.end, catchUp: true }, -range.start)
  mix.scheduleEffects(project, { from: range.start, to: range.end, catchUp: true }, -range.start)
  const window = { from: range.start, to: range.end, catchUp: true, cutAt: range.end }
  for (const ev of clipEvents(project, window)) {
    const source = clipBuffer(assets, ev)
    if (source) mix.playClip(ev, source, ev.at - range.start)
  }
  const audio = (id: string) => assets.get(id)
  for (const ev of noteEvents(project, window)) {
    const track = project.tracks.find((t) => t.id === ev.trackId)
    if (track) mix.playNoteEvent(ev, track, ev.at - range.start, audio)
  }

  if (onProgress) {
    const blocks = Math.floor(length / RENDER_QUANTUM)
    let previous = 0
    for (let i = 1; i < PROGRESS_STEPS; i++) {
      const block = Math.floor((blocks * i) / PROGRESS_STEPS)
      if (block <= previous) continue
      previous = block
      const at = (block * RENDER_QUANTUM) / sampleRate
      try {
        void ctx.suspend(at).then(() => {
          onProgress(at / duration)
          void ctx.resume()
        })
      } catch {
        // Some browsers can't suspend offline rendering; progress then jumps to the end.
        break
      }
    }
  }

  const rendered = await ctx.startRendering()
  onProgress?.(1)
  return rendered
}

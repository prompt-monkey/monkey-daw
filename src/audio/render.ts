// Offline rendering: the same graph and the same clip events as live playback, rendered
// faster than real time. Export, consolidate and convert-to-audio build on this.

import type { Project } from '../model/types'
import type { AssetRegistry } from './assets'
import { MixGraph } from './graph'
import { clipEvents } from './schedule'

export interface RenderRange {
  start: number
  end: number
}

export async function renderProject(
  project: Project,
  assets: AssetRegistry,
  range: RenderRange,
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((range.end - range.start) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  const mix = new MixGraph(ctx)
  mix.sync(project, true)
  for (const ev of clipEvents(project, { from: range.start, to: range.end, catchUp: true, cutAt: range.end })) {
    const buffer = assets.get(ev.clip.assetId)
    if (buffer) mix.playClip(ev, buffer, ev.at - range.start)
  }
  return ctx.startRendering()
}

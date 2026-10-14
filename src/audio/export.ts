// Mix export: render the project offline, then encode WAV in a worker.

import { projectLength } from '../model/factory'
import type { Project } from '../model/types'
import { engine } from './engine'
import { renderProject, type RenderRange } from './render'
import { loopIsActive } from './schedule'
import { peakOf, type BitDepth } from './wav'

export type ExportScope = 'project' | 'loop'

export interface ExportSettings {
  scope: ExportScope
  sampleRate: 44100 | 48000
  bitDepth: BitDepth
}

export interface ExportResult {
  blob: Blob
  filename: string
  /** Highest sample value in the mix; above 1 means the file clipped. */
  peak: number
  duration: number
}

/** The time range an export covers, or null when there is nothing to export. */
export function exportRange(project: Project, scope: ExportScope): RenderRange | null {
  if (scope === 'loop') return loopIsActive(project.loop) ? { start: project.loop.start, end: project.loop.end } : null
  const end = projectLength(project)
  return end > 0 ? { start: 0, end } : null
}

/** A filesystem-safe file name from the project name. */
export function exportFilename(projectName: string, scope: ExportScope): string {
  const base =
    projectName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, ' ') || 'mix'
  return `${base}${scope === 'loop' ? ' (loop)' : ''}.wav`
}

function encodeInWorker(channels: Float32Array[], sampleRate: number, bitDepth: BitDepth): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wav.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'WAV encoding failed'))
    }
    worker.postMessage({ channels, sampleRate, bitDepth }, channels.map((c) => c.buffer))
  })
}

/** Renders and encodes the mix. Progress goes 0…1 (rendering ~85%, encoding the rest). */
export async function exportMix(
  project: Project,
  settings: ExportSettings,
  onProgress: (fraction: number) => void = () => {},
): Promise<ExportResult> {
  const range = exportRange(project, settings.scope)
  if (!range) throw new Error(settings.scope === 'loop' ? 'Turn on a loop region to export it.' : 'There are no clips to export.')
  const rendered = await renderProject(project, engine.assets, range, {
    sampleRate: settings.sampleRate,
    onProgress: (f) => onProgress(f * 0.85),
  })
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i).slice())
  const peak = peakOf(channels)
  const wav = await encodeInWorker(channels, settings.sampleRate, settings.bitDepth)
  onProgress(1)
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    filename: exportFilename(project.name, settings.scope),
    peak,
    duration: range.end - range.start,
  }
}

/** Saves a blob through the browser's download flow. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

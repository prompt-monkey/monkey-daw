import { createId } from '../model/factory'
import type { AssetMeta, Id } from '../model/types'
import { encodeWav } from './wav'

/**
 * Decoded audio for the project's assets, plus each asset's encoded source (the original file,
 * when there is one) for saving. The project itself only stores AssetMeta.
 */
export class AssetRegistry {
  private buffers = new Map<Id, AudioBuffer>()
  private sources = new Map<Id, Blob>()

  get(id: Id): AudioBuffer | undefined {
    return this.buffers.get(id)
  }

  has(id: Id): boolean {
    return this.buffers.has(id)
  }

  add(name: string, buffer: AudioBuffer, source?: Blob): AssetMeta {
    const meta: AssetMeta = {
      id: createId('ast'),
      name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    }
    this.buffers.set(meta.id, buffer)
    if (source) this.sources.set(meta.id, source)
    return meta
  }

  async importFile(file: File, ctx: BaseAudioContext): Promise<AssetMeta> {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    return this.add(file.name.replace(/\.[^.]+$/, ''), buffer, file)
  }

  /** Decodes stored audio back into the registry under its original id. */
  async restore(id: Id, source: Blob, ctx: BaseAudioContext): Promise<void> {
    if (this.buffers.has(id)) return
    const buffer = await ctx.decodeAudioData(await source.arrayBuffer())
    this.buffers.set(id, buffer)
    this.sources.set(id, source)
  }

  /** Encoded audio for saving: the original file, or a 24-bit WAV for generated audio. */
  source(id: Id): Blob | undefined {
    const existing = this.sources.get(id)
    if (existing) return existing
    const buffer = this.buffers.get(id)
    if (!buffer) return undefined
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    const wav = new Blob([encodeWav(channels, { sampleRate: buffer.sampleRate, bitDepth: 24 })], { type: 'audio/wav' })
    this.sources.set(id, wav)
    return wav
  }
}

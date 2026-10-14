import { createId } from '../model/factory'
import type { AssetMeta, Id } from '../model/types'

/** Decoded audio for the project's assets. The project itself only stores AssetMeta. */
export class AssetRegistry {
  private buffers = new Map<Id, AudioBuffer>()

  get(id: Id): AudioBuffer | undefined {
    return this.buffers.get(id)
  }

  add(name: string, buffer: AudioBuffer): AssetMeta {
    const meta: AssetMeta = {
      id: createId('ast'),
      name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    }
    this.buffers.set(meta.id, buffer)
    return meta
  }

  async importFile(file: File, ctx: BaseAudioContext): Promise<AssetMeta> {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    return this.add(file.name.replace(/\.[^.]+$/, ''), buffer)
  }
}

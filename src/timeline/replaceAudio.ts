// Swapping a clip's audio for a file from the device (clip menu and the touch clip bubble).

import { engine } from '../audio/engine'
import type { Id } from '../model/types'
import { replaceClipAudio } from '../state/actions'
import { toast } from '../ui/toast'

/** Opens the file picker for one WAV or MP3. */
export function pickAudio(onFile: (file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,.wav,.mp3'
  input.onchange = () => input.files?.[0] && onFile(input.files[0])
  input.click()
}

export async function replaceWith(clipId: Id, file: File) {
  try {
    replaceClipAudio(clipId, await engine.assets.importFile(file, engine.context))
  } catch {
    toast(`Could not open ${file.name}`, 'error')
  }
}

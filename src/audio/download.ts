// Saving files through the browser's download flow, with file names made from the project name.
// Kept apart from the export code so the rest of the app doesn't load it (and its zip library).

import type { ExportScope } from './export'

/** A filesystem-safe file name from the project name, e.g. "Song (loop).mp3" or "Song stems.zip". */
export function exportFilename(projectName: string, scope: ExportScope, extension = 'wav', suffix = ''): string {
  return `${safeName(projectName, 'mix')}${suffix}${scope === 'loop' ? ' (loop)' : ''}.${extension}`
}

export function safeName(name: string, fallback: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, ' ') || fallback
  )
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

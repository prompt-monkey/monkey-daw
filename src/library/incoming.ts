// Turns picked or dropped files and folders into libraries to import.

import type { IncomingFile } from './repo'

export interface IncomingLibrary {
  name: string
  files: IncomingFile[]
}

const LOOSE_FILES_NAME = 'Imported samples'

/**
 * Files from an <input>. With a folder picker each file has a relative path whose first part is
 * the folder name; loose files become one library.
 */
export function fromFileList(list: FileList | File[]): IncomingLibrary[] {
  const byRoot = new Map<string, IncomingFile[]>()
  for (const file of Array.from(list)) {
    const relative = file.webkitRelativePath || file.name
    const root = relative.includes('/') ? relative.split('/')[0] : LOOSE_FILES_NAME
    const files = byRoot.get(root) ?? []
    files.push({ path: relative, file })
    byRoot.set(root, files)
  }
  return [...byRoot].map(([name, files]) => ({ name, files }))
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns results in batches; keep reading until it returns none.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all)
        all.push(...batch)
        next()
      }, reject)
    next()
  })
}

async function walk(entry: FileSystemEntry, out: IncomingFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file })
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) await walk(child, out)
  }
}

/** Files and folders dropped from the operating system. Each dropped folder becomes a library. */
export async function fromDataTransfer(items: DataTransferItemList): Promise<IncomingLibrary[]> {
  const entries = Array.from(items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null)
  const libraries: IncomingLibrary[] = []
  const loose: IncomingFile[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      const files: IncomingFile[] = []
      await walk(entry, files)
      libraries.push({ name: entry.name, files })
    } else {
      await walk(entry, loose)
    }
  }
  if (loose.length) libraries.push({ name: LOOSE_FILES_NAME, files: loose })
  return libraries
}

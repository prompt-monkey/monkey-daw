// Folder trees and filtering for the sample browser. Pure functions.

import { detectKind, type SampleCategory, type SampleKind, type SignatureTag } from './classify'
import type { SampleInfo } from './repo'

export interface FolderNode {
  /** Path of the folder inside its library ("" for the library root). */
  path: string
  name: string
  folders: FolderNode[]
  samples: SampleInfo[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Builds a sorted folder tree from sample paths (folders first, natural number order). */
export function buildTree(samples: SampleInfo[]): FolderNode {
  const root: FolderNode = { path: '', name: '', folders: [], samples: [] }
  for (const sample of samples) {
    const parts = sample.path.split(/[\\/]/)
    parts.pop()
    let node = root
    for (const part of parts) {
      let child = node.folders.find((f) => f.name === part)
      if (!child) {
        child = { path: node.path ? `${node.path}/${part}` : part, name: part, folders: [], samples: [] }
        node.folders.push(child)
      }
      node = child
    }
    node.samples.push(sample)
  }
  const sort = (node: FolderNode) => {
    node.folders.sort((a, b) => collator.compare(a.name, b.name))
    node.samples.sort((a, b) => collator.compare(a.name, b.name))
    node.folders.forEach(sort)
  }
  sort(root)
  return root
}

/** A single folder that only wraps everything is skipped, so the tree starts where content does. */
export function skipWrapperFolders(node: FolderNode): FolderNode {
  let current = node
  while (current.samples.length === 0 && current.folders.length === 1) current = current.folders[0]
  return current
}

export interface SampleFilter {
  query: string
  categories: SampleCategory[]
  signatures: SignatureTag[]
  kind: SampleKind | null
}

export const EMPTY_FILTER: SampleFilter = { query: '', categories: [], signatures: [], kind: null }

export function isFiltering(filter: SampleFilter): boolean {
  return Boolean(filter.query.trim() || filter.categories.length || filter.signatures.length || filter.kind)
}

/** Samples matching every active filter. The query matches all words against the path. */
export function filterSamples(samples: SampleInfo[], filter: SampleFilter): SampleInfo[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  return samples.filter((s) => {
    if (filter.categories.length && !filter.categories.includes(s.category)) return false
    if (filter.signatures.length && (!s.signature || !filter.signatures.includes(s.signature))) return false
    if (filter.kind && detectKind(s.path, s.duration) !== filter.kind) return false
    const haystack = s.path.toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}

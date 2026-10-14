import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { computePeaks } from '../audio/peaks'
import { useTransportStore } from '../state/transport'
import { Menu } from '../ui/Menu'
import { decodeSample, placeSample, previewSample, SAMPLE_DRAG_TYPE, stopPreview } from './audio'
import { buildTree, filterSamples, isFiltering, skipWrapperFolders, type FolderNode } from './browse'
import { CATEGORY_LABELS, SIGNATURES, categoryColor, detectKind, type SampleCategory } from './classify'
import { fromDataTransfer, fromFileList } from './incoming'
import type { SampleInfo } from './repo'
import { importLibrary, loadLibrary, removeLibrary, renameLibraryTo, useLibraryStore } from './store'

/** Most results shown at once while searching or filtering. */
const MAX_RESULTS = 300

const chip = (active: boolean) =>
  `flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-4 ${
    active ? 'border-accent bg-accent/15 text-text' : 'border-line text-text-dim hover:text-text'
  }`

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

const addAtPlayhead = (id: string) => void placeSample(id, useTransportStore.getState().cursor)

const SampleRow = memo(function SampleRow({ sample, depth, hint }: { sample: SampleInfo; depth: number; hint?: string }) {
  const selected = useLibraryStore((s) => s.selectedId === sample.id)
  const playing = useLibraryStore((s) => s.previewingId === sample.id)
  const kind = detectKind(sample.path, sample.duration)
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SAMPLE_DRAG_TYPE, sample.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => {
        useLibraryStore.getState().select(sample.id)
        if (playing) stopPreview()
        else void previewSample(sample.id)
      }}
      onDoubleClick={() => addAtPlayhead(sample.id)}
      className={`flex cursor-grab items-center gap-1.5 rounded px-1.5 py-1 text-xs select-none ${
        selected ? 'bg-surface-2 text-text' : 'text-text-dim hover:bg-surface-2/60 hover:text-text'
      }`}
      style={{ paddingLeft: 6 + depth * 12 }}
      title={`${sample.path}\nClick to preview · double-click to add at the playhead · drag onto a track`}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(sample.category) }} />
      <span className="min-w-0 flex-1 truncate">
        {sample.name}
        {hint && <span className="ml-1 text-[10px] text-text-dim/70">{hint}</span>}
      </span>
      {sample.bpm && <span className="font-mono text-[10px] text-text-dim">{sample.bpm}</span>}
      {kind === 'one-shot' && <span className="text-[10px] text-text-dim" title="One-shot">•</span>}
      <span className={`w-3 text-center text-[10px] ${playing ? 'text-accent' : 'text-transparent'}`}>▶</span>
    </li>
  )
})

function Folder({ node, libraryId, depth }: { node: FolderNode; libraryId: string; depth: number }) {
  const key = `${libraryId}:${node.path}`
  const open = useLibraryStore((s) => s.expanded.includes(key))
  const toggleExpanded = useLibraryStore((s) => s.toggleExpanded)
  return (
    <li>
      <button
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-text-dim hover:bg-surface-2/60 hover:text-text"
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => toggleExpanded(key)}
        aria-expanded={open}
      >
        <span className="w-3 text-[10px]">{open ? '▾' : '▸'}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && <FolderContents node={node} libraryId={libraryId} depth={depth + 1} />}
    </li>
  )
}

function FolderContents({ node, libraryId, depth }: { node: FolderNode; libraryId: string; depth: number }) {
  return (
    <ul>
      {node.folders.map((f) => (
        <Folder key={f.path} node={f} libraryId={libraryId} depth={depth} />
      ))}
      {node.samples.map((s) => (
        <SampleRow key={s.id} sample={s} depth={depth} />
      ))}
    </ul>
  )
}

function LibraryItem({ id, name, samples }: { id: string; name: string; samples: SampleInfo[] }) {
  const open = useLibraryStore((s) => s.expanded.includes(id))
  const toggleExpanded = useLibraryStore((s) => s.toggleExpanded)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const tree = useMemo(() => skipWrapperFolders(buildTree(samples)), [samples])

  return (
    <li className="border-b border-line">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            aria-label="Library name"
            className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-0.5 text-xs"
            onBlur={(e) => {
              setRenaming(false)
              if (e.target.value.trim() && e.target.value !== name) void renameLibraryTo(id, e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => toggleExpanded(id)} aria-expanded={open}>
            <span className="w-3 text-[10px] text-text-dim">{open ? '▾' : '▸'}</span>
            <span className="truncate text-xs font-semibold">{name}</span>
            <span className="shrink-0 text-[10px] text-text-dim">{samples.length}</span>
          </button>
        )}
        {confirmDelete ? (
          <>
            <button className="rounded border border-line px-1.5 py-0.5 text-[10px] text-danger" onClick={() => void removeLibrary(id)}>
              Remove
            </button>
            <button className="rounded border border-line px-1.5 py-0.5 text-[10px]" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <Menu
            label="Library options"
            className="rounded px-1.5 py-0.5 text-xs text-text-dim hover:bg-surface-2 hover:text-text"
            items={[
              { label: 'Rename library', onSelect: () => setRenaming(true) },
              { label: 'Remove library', onSelect: () => setConfirmDelete(true), danger: true },
            ]}
          >
            ⋮
          </Menu>
        )}
      </div>
      {open && (
        <div className="pb-1">
          <FolderContents node={tree} libraryId={id} depth={1} />
        </div>
      )}
    </li>
  )
}

function PreviewPane() {
  const selectedId = useLibraryStore((s) => s.selectedId)
  const sample = useLibraryStore((s) => s.samples.find((x) => x.id === s.selectedId))
  const playing = useLibraryStore((s) => s.previewingId !== null && s.previewingId === s.selectedId)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    void decodeSample(selectedId)
      .then((buffer) => {
        const el = canvas.current
        if (cancelled || !el) return
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(el.clientWidth * dpr)
        const h = Math.round(el.clientHeight * dpr)
        el.width = w
        el.height = h
        const g = el.getContext('2d')
        if (!g) return
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
        const { min, max } = computePeaks(channels, Math.max(1, Math.floor(buffer.length / w)))
        g.clearRect(0, 0, w, h)
        g.fillStyle = getComputedStyle(el).getPropertyValue('--color-accent')
        for (let x = 0; x < Math.min(w, min.length); x++) {
          const top = h / 2 - max[x] * (h / 2)
          g.fillRect(x, top, 1, Math.max(1, (max[x] - min[x]) * (h / 2)))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedId])

  if (!sample) return null
  const kind = detectKind(sample.path, sample.duration)
  const tags = [
    CATEGORY_LABELS[sample.category],
    sample.bpm ? `${sample.bpm} BPM` : null,
    sample.signature,
    kind === 'one-shot' ? 'One-shot' : kind === 'loop' ? 'Loop' : null,
    sample.duration ? `${sample.duration.toFixed(2)} s` : null,
  ].filter(Boolean)

  return (
    <section className="flex flex-col gap-2 border-t border-line p-2.5" aria-label="Sample preview">
      <div className="truncate text-xs font-semibold" title={sample.path}>
        {sample.name}
      </div>
      <div className="text-[10px] text-text-dim">{tags.join(' · ')}</div>
      <canvas ref={canvas} className="h-12 w-full rounded bg-bg" aria-hidden />
      <div className="flex gap-2">
        <button
          className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2"
          onClick={() => (playing ? stopPreview() : void previewSample(sample.id))}
        >
          {playing ? '■ Stop' : '▶ Preview'}
        </button>
        <button className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2" onClick={() => addAtPlayhead(sample.id)}>
          Add at playhead
        </button>
      </div>
    </section>
  )
}

export function LibraryPanel() {
  const { libraries, samples, loaded, importing, filter, setFilter } = useLibraryStore()
  const folderInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    if (!loaded) void loadLibrary()
  }, [loaded])

  // The folder picker attribute isn't in React's typings, so it is set directly.
  useEffect(() => folderInput.current?.setAttribute('webkitdirectory', ''), [])

  const byLibrary = useMemo(() => {
    const map = new Map<string, SampleInfo[]>()
    for (const s of samples) {
      const list = map.get(s.libraryId)
      if (list) list.push(s)
      else map.set(s.libraryId, [s])
    }
    return map
  }, [samples])
  const filtering = isFiltering(filter)
  const results = useMemo(() => (filtering ? filterSamples(samples, filter) : []), [samples, filter, filtering])
  const categories = useMemo(() => {
    const counts = new Map<SampleCategory, number>()
    for (const s of samples) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [samples])
  const signatures = useMemo(() => SIGNATURES.filter((sig) => samples.some((s) => s.signature === sig)), [samples])

  const importLists = async (libs: ReturnType<typeof fromFileList>) => {
    for (const lib of libs) await importLibrary(lib.name, lib.files)
  }

  return (
    <aside
      className={`flex w-72 shrink-0 flex-col border-r border-line bg-surface ${dropping ? 'ring-2 ring-accent ring-inset' : ''}`}
      aria-label="Sample library"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(false)
        void fromDataTransfer(e.dataTransfer.items).then(importLists)
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-text-dim uppercase">
          Library <span className="font-normal normal-case">· {samples.length} samples</span>
        </h2>
        <Menu
          label="Import samples"
          className="rounded border border-line px-2 py-0.5 text-[11px] hover:bg-surface-2"
          items={[
            { label: 'Import folder…', onSelect: () => folderInput.current?.click() },
            { label: 'Import files…', onSelect: () => fileInput.current?.click() },
          ]}
        >
          Import
        </Menu>
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            void importLists(fromFileList(files))
          }}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".wav,.mp3,.ogg,.flac,.m4a,audio/*"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            void importLists(fromFileList(files))
          }}
        />
      </div>

      {samples.length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-line p-2">
          <input
            type="search"
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder="Search samples"
            aria-label="Search samples"
            className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {(['loop', 'one-shot'] as const).map((k) => (
              <button key={k} className={chip(filter.kind === k)} onClick={() => setFilter({ kind: filter.kind === k ? null : k })}>
                {k === 'loop' ? 'Loops' : 'One-shots'}
              </button>
            ))}
            {signatures.map((sig) => (
              <button key={sig} className={chip(filter.signatures.includes(sig))} onClick={() => setFilter({ signatures: toggle(filter.signatures, sig) })}>
                {sig}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {categories.map(([category, count]) => (
              <button
                key={category}
                className={chip(filter.categories.includes(category))}
                onClick={() => setFilter({ categories: toggle(filter.categories, category) })}
                title={`${count} sample${count === 1 ? '' : 's'}`}
              >
                <span className="size-1.5 rounded-full" style={{ background: categoryColor(category) }} />
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {importing && <p className="p-3 text-xs text-text-dim">Importing “{importing}”…</p>}
        {loaded && samples.length === 0 && !importing && (
          <div className="flex flex-col gap-2 p-4 text-xs text-text-dim">
            <p>Your sample library is empty.</p>
            <p>Import a folder of WAV or MP3 samples, or drop folders here. They stay in this browser.</p>
            <button className="self-start rounded-md border border-accent px-2.5 py-1 text-accent" onClick={() => folderInput.current?.click()}>
              Import folder…
            </button>
          </div>
        )}
        {filtering ? (
          <ul className="p-1" aria-label="Search results">
            {results.length === 0 && <li className="p-2 text-xs text-text-dim">No samples match.</li>}
            {results.slice(0, MAX_RESULTS).map((s) => (
              <SampleRow key={s.id} sample={s} depth={0} hint={s.path.split('/').slice(-2, -1)[0]} />
            ))}
            {results.length > MAX_RESULTS && (
              <li className="p-2 text-[11px] text-text-dim">
                Showing {MAX_RESULTS} of {results.length}. Narrow the search to see more.
              </li>
            )}
          </ul>
        ) : (
          <ul>
            {libraries.map((lib) => (
              <LibraryItem key={lib.id} id={lib.id} name={lib.name} samples={byLibrary.get(lib.id) ?? []} />
            ))}
          </ul>
        )}
      </div>

      <PreviewPane />
    </aside>
  )
}

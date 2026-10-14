import { useEffect, useRef, useState } from 'react'
import { renameProject } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { PROJECT_FILE_EXTENSION } from '../storage/projectFile'
import {
  deleteSavedProject,
  downloadProjectFile,
  importProjectFile,
  makeStoragePersistent,
  newProject,
  openProject,
  refreshProjectList,
  renameSaved,
  saveCopy,
  saveCurrent,
  storageEstimate,
  useIsDirty,
  useSessionStore,
} from '../storage/session'
import { Dialog } from './Dialog'

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

const formatWhen = (ms: number) => {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function StorageMeter() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null)
  const projects = useSessionStore((s) => s.projects)
  useEffect(() => {
    void storageEstimate().then(setInfo)
  }, [projects])
  if (!info) return null
  const share = info.quota ? Math.min(1, info.usage / info.quota) : 0
  return (
    <div className="flex flex-col gap-1 text-[11px] text-text-dim">
      <div className="h-1.5 overflow-hidden rounded-full bg-bg">
        <div className="h-full bg-accent" style={{ width: `${Math.max(1, share * 100)}%` }} />
      </div>
      <div className="flex justify-between gap-2">
        <span>
          Using {formatBytes(info.usage)} of {formatBytes(info.quota)} on this device
        </span>
        {info.persisted ? (
          <span title="The browser won't clear this data on its own">Protected storage ✓</span>
        ) : (
          <button
            className="text-accent underline"
            onClick={() => void makeStoragePersistent().then(() => storageEstimate().then(setInfo))}
            title="Ask the browser not to clear your projects when space runs low"
          >
            Protect storage
          </button>
        )}
      </div>
    </div>
  )
}

type Pending = { kind: 'open'; id: string } | { kind: 'new' } | { kind: 'file'; file: File }

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project)
  const { projects, savedId, saving } = useSessionStore()
  const dirty = useIsDirty()
  const [pending, setPending] = useState<Pending | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshProjectList()
  }, [])

  /** Runs an action that replaces the open project, asking first if that would lose changes. */
  const replaceWith = async (action: Pending, force = false) => {
    if (dirty && !force) {
      setPending(action)
      return
    }
    setPending(null)
    if (action.kind === 'open') await openProject(action.id)
    else if (action.kind === 'new') await newProject()
    else await importProjectFile(action.file)
    onClose()
  }

  const btn = 'rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40'

  return (
    <Dialog title="Projects" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-lg bg-bg p-3">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            Open project
            <span className={dirty ? 'text-warn' : ''}>{dirty ? '· unsaved changes' : savedId ? '· saved' : ''}</span>
          </div>
          <input
            defaultValue={project.name}
            key={project.name}
            onBlur={(e) => e.target.value.trim() !== project.name && renameProject(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Project name"
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button className={`${btn} border-accent text-accent`} onClick={() => void saveCurrent()} disabled={saving}>
              Save (Ctrl+S)
            </button>
            <button className={btn} onClick={() => void saveCopy()} disabled={saving}>
              Save a copy
            </button>
            <button className={btn} onClick={() => void downloadProjectFile()} title={`Download a ${PROJECT_FILE_EXTENSION} file with the audio`}>
              Download project file
            </button>
          </div>
        </section>

        {pending && (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/50 p-3 text-xs" role="alert">
            <span>
              “{project.name}” has unsaved changes. They will be lost if you continue.
            </span>
            <div className="flex gap-2">
              <button
                className={`${btn} border-accent text-accent`}
                onClick={async () => {
                  if (await saveCurrent()) await replaceWith(pending, true)
                }}
              >
                Save, then continue
              </button>
              <button className={`${btn} text-danger`} onClick={() => void replaceWith(pending, true)}>
                Discard changes
              </button>
              <button className={btn} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-text-dim">Saved in this browser</h3>
            <div className="flex gap-2">
              <button className={btn} onClick={() => void replaceWith({ kind: 'new' })}>
                New project
              </button>
              <button className={btn} onClick={() => fileRef.current?.click()}>
                Open file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={`${PROJECT_FILE_EXTENSION},application/zip`}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void replaceWith({ kind: 'file', file })
                }}
              />
            </div>
          </div>
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-line" aria-label="Saved projects">
            {projects.length === 0 && <li className="p-3 text-xs text-text-dim">No saved projects yet. Press Save to keep this one.</li>}
            {projects.map((p) => (
              <li key={p.id} className={`flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 ${p.id === savedId ? 'bg-surface-2' : ''}`}>
                <div className="min-w-0 flex-1">
                  {renaming === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.name}
                      aria-label="New project name"
                      className="w-full rounded border border-line bg-bg px-1.5 py-0.5 text-sm"
                      onBlur={(e) => {
                        setRenaming(null)
                        if (e.target.value.trim() && e.target.value !== p.name) void renameSaved(p.id, e.target.value, renameProject)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setRenaming(null)
                        }
                      }}
                    />
                  ) : (
                    <div className="truncate text-sm">
                      {p.name}
                      {p.id === savedId && <span className="ml-2 text-[10px] text-accent">open</span>}
                    </div>
                  )}
                  <div className="text-[11px] text-text-dim">Saved {formatWhen(p.updatedAt)}</div>
                </div>
                {confirmDelete === p.id ? (
                  <>
                    <button
                      className={`${btn} text-danger`}
                      onClick={() => {
                        setConfirmDelete(null)
                        void deleteSavedProject(p.id)
                      }}
                    >
                      Delete for good
                    </button>
                    <button className={btn} onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button className={btn} onClick={() => void replaceWith({ kind: 'open', id: p.id })} disabled={p.id === savedId && !dirty}>
                      Open
                    </button>
                    <button className={btn} onClick={() => setRenaming(p.id)}>
                      Rename
                    </button>
                    <button className={`${btn} hover:text-danger`} onClick={() => setConfirmDelete(p.id)} aria-label={`Delete ${p.name}`}>
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        <StorageMeter />
        <p className="text-[11px] text-text-dim">
          Projects live only in this browser. Download a project file to back one up or move it to another computer.
        </p>
      </div>
    </Dialog>
  )
}

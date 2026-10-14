// Snapshot-based undo/redo. States are immutable (produced with Immer), so keeping whole
// snapshots is cheap: unchanged parts are shared between them.
//
// Continuous gestures (dragging a fader, moving a clip) pass a coalesce key so the whole
// gesture becomes one undo step. The gesture ends with endGesture(); after that, the same key
// starts a new step.

export interface HistoryEntry<T> {
  state: T
  label: string
}

export interface HistoryState<T> {
  past: HistoryEntry<T>[]
  present: T
  future: HistoryEntry<T>[]
  /** Coalesce key of the gesture in progress, if any. */
  openKey: string | null
}

export const HISTORY_LIMIT = 200

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], openKey: null }
}

export function commit<T>(h: HistoryState<T>, next: T, label: string, coalesceKey?: string): HistoryState<T> {
  if (next === h.present) return h
  if (coalesceKey !== undefined && coalesceKey === h.openKey) {
    return { ...h, present: next, future: [] }
  }
  const past = [...h.past, { state: h.present, label }]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, present: next, future: [], openKey: coalesceKey ?? null }
}

export function endGesture<T>(h: HistoryState<T>): HistoryState<T> {
  return h.openKey === null ? h : { ...h, openKey: null }
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  const entry = h.past.at(-1)
  if (!entry) return h
  return {
    past: h.past.slice(0, -1),
    present: entry.state,
    future: [{ state: h.present, label: entry.label }, ...h.future],
    openKey: null,
  }
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  const [entry, ...future] = h.future
  if (!entry) return h
  return {
    past: [...h.past, { state: h.present, label: entry.label }],
    present: entry.state,
    future,
    openKey: null,
  }
}

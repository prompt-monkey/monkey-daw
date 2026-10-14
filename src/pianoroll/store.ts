// Piano roll view state: tool, grid, zoom, note selection and the note clipboard. Not part of
// the project or the undo history.

import { create } from 'zustand'
import type { Id, Note } from '../model/types'

export type PianoRollTool = 'draw' | 'select' | 'erase' | 'zoom'

/** Grid steps in beats (quarter notes). */
export const GRID_STEPS = [
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/32', beats: 1 / 8 },
  { label: '1/4 T', beats: 2 / 3 },
  { label: '1/8 T', beats: 1 / 3 },
  { label: '1/16 T', beats: 1 / 6 },
] as const

export const MIN_PPB = 12
export const MAX_PPB = 480

interface PianoRollStore {
  tool: PianoRollTool
  /** Grid step in beats. */
  grid: number
  /** Zoom, in pixels per beat. */
  ppb: number
  selection: Id[]
  clipboard: Note[]
  /** Length of new notes: the last length drawn or resized, in beats. */
  lastLength: number
  /** Velocity of new notes. */
  velocity: number
  setTool: (tool: PianoRollTool) => void
  setGrid: (grid: number) => void
  setPpb: (ppb: number) => void
  setSelection: (ids: Id[]) => void
  setClipboard: (notes: Note[]) => void
  setLastLength: (beats: number) => void
  setVelocity: (velocity: number) => void
}

export const usePianoRollStore = create<PianoRollStore>()((set) => ({
  tool: 'draw',
  grid: 1 / 4,
  ppb: 64,
  selection: [],
  clipboard: [],
  lastLength: 1 / 2,
  velocity: 0.8,
  setTool: (tool) => set({ tool }),
  setGrid: (grid) => set({ grid }),
  setPpb: (ppb) => set({ ppb: Math.min(MAX_PPB, Math.max(MIN_PPB, ppb)) }),
  setSelection: (selection) => set({ selection }),
  setClipboard: (clipboard) => set({ clipboard }),
  setLastLength: (lastLength) => set({ lastLength }),
  setVelocity: (velocity) => set({ velocity: Math.min(1, Math.max(0.05, velocity)) }),
}))

// Timeline view state: zoom, selection, gesture previews and the clipboard. None of it is part
// of the project or the undo history.

import { create } from 'zustand'
import type { Clip, Id } from '../model/types'
import { DEFAULT_PPS, clampPps, type TrackHeight } from '../timeline/geometry'
import type { ClipPreview } from '../timeline/edits'

export interface ClipboardItem {
  clip: Clip
  trackId: Id
}

/** Rubber-band selection rectangle, in timeline seconds and track indices. */
export interface Marquee {
  t0: number
  t1: number
  track0: number
  track1: number
}

interface ViewStore {
  /** Zoom, in pixels per second. */
  pps: number
  trackHeight: TrackHeight
  followPlayhead: boolean
  selection: Id[]
  /** Pending clip edits while a gesture is in progress. */
  preview: ClipPreview | null
  clipboard: ClipboardItem[]
  marquee: Marquee | null
  /** Insertion index shown while a track is dragged to a new position. */
  trackDrop: number | null
  mixerOpen: boolean
  projectsOpen: boolean
  libraryOpen: boolean
  /** What the bottom panel shows. */
  bottomPanel: 'mixer' | 'effects'
  /** Channel whose effect chain the rack shows. */
  rackChannel: Id | 'master'
  setPps: (pps: number) => void
  setTrackHeight: (h: TrackHeight) => void
  setFollowPlayhead: (on: boolean) => void
  setSelection: (ids: Id[]) => void
  toggleSelected: (id: Id) => void
  setPreview: (preview: ClipPreview | null) => void
  setClipboard: (items: ClipboardItem[]) => void
  setMarquee: (marquee: Marquee | null) => void
  setTrackDrop: (index: number | null) => void
  setMixerOpen: (open: boolean) => void
  setProjectsOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  setBottomPanel: (panel: 'mixer' | 'effects') => void
  /** Shows a channel's effects in the bottom panel. */
  openRack: (channel: Id | 'master') => void
}

export const useViewStore = create<ViewStore>()((set) => ({
  pps: DEFAULT_PPS,
  trackHeight: 'normal',
  followPlayhead: true,
  selection: [],
  preview: null,
  clipboard: [],
  marquee: null,
  trackDrop: null,
  mixerOpen: true,
  projectsOpen: false,
  libraryOpen: true,
  bottomPanel: 'mixer',
  rackChannel: 'master',
  setPps: (pps) => set({ pps: clampPps(pps) }),
  setTrackHeight: (trackHeight) => set({ trackHeight }),
  setFollowPlayhead: (followPlayhead) => set({ followPlayhead }),
  setSelection: (selection) => set({ selection }),
  toggleSelected: (id) =>
    set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  setPreview: (preview) => set({ preview }),
  setClipboard: (clipboard) => set({ clipboard }),
  setMarquee: (marquee) => set({ marquee }),
  setTrackDrop: (trackDrop) => set({ trackDrop }),
  setMixerOpen: (mixerOpen) => set({ mixerOpen }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel }),
  openRack: (rackChannel) => set({ rackChannel, bottomPanel: 'effects', mixerOpen: true }),
}))

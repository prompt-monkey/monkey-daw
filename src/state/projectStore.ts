import { produce } from 'immer'
import { create } from 'zustand'
import { createProject } from '../model/factory'
import type { Project } from '../model/types'
import * as history from './history'

interface ProjectStore {
  history: history.HistoryState<Project>
  /** Same as history.present; kept at the top level for convenient selectors. */
  project: Project
  /** Applies an undoable change. Pass coalesceKey for continuous gestures (see history.ts). */
  update: (label: string, recipe: (draft: Project) => void, coalesceKey?: string) => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  /** Replaces the project and clears the undo history. */
  load: (project: Project) => void
}

export const useProjectStore = create<ProjectStore>()((set) => {
  const initial = createProject()
  const apply = (h: history.HistoryState<Project>) => ({ history: h, project: h.present })
  return {
    history: history.createHistory(initial),
    project: initial,
    update: (label, recipe, coalesceKey) =>
      set((s) => apply(history.commit(s.history, produce(s.history.present, recipe), label, coalesceKey))),
    endGesture: () => set((s) => apply(history.endGesture(s.history))),
    undo: () => set((s) => apply(history.undo(s.history))),
    redo: () => set((s) => apply(history.redo(s.history))),
    load: (project) => set(apply(history.createHistory(project))),
  }
})

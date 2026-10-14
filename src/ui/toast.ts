import { create } from 'zustand'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: ToastAction
}

interface ToastStore {
  toasts: Toast[]
  dismiss: (id: number) => void
}

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

let nextId = 1

/** Shows a short message in the corner; errors and messages with an action stay longer. */
export function toast(text: string, kind: Toast['kind'] = 'info', action?: ToastAction) {
  const id = nextId++
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), kind === 'error' || action ? 8000 : 3000)
}

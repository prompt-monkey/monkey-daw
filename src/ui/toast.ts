import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
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

/** Shows a short message in the corner; errors stay longer. */
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = nextId++
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), kind === 'error' ? 8000 : 3000)
}

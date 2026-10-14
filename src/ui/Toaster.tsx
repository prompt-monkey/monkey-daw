import { useToastStore } from './toast'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[300] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-left text-xs shadow-xl ${
            t.kind === 'error' ? 'border-danger/50 bg-surface-2 text-danger' : 'border-line bg-surface-2 text-text'
          }`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}

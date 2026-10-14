import { useToastStore } from './toast'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[300] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-xl ${
            t.kind === 'error' ? 'border-danger/50 bg-surface-2 text-danger' : 'border-line bg-surface-2 text-text'
          }`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              className="shrink-0 font-semibold text-accent underline"
              onClick={() => {
                t.action!.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="shrink-0 text-text-dim hover:text-text" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

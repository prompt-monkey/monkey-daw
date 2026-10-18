import { useToastStore } from './toast'
import { Icon } from './Icon'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-[300] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`enter pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg border bg-surface-2 py-2 ps-3 pe-2 text-xs shadow-popover ${
            t.kind === 'error' ? 'border-danger/50 text-danger' : 'border-transparent text-text'
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
          <button className="btn btn-sm btn-icon btn-ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

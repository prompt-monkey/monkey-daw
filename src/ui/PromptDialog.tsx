import { useState } from 'react'
import { Dialog } from './Dialog'

interface Props {
  title: string
  label: string
  initial: string
  type?: 'text' | 'number'
  /** Shown under the field. */
  hint?: string
  submitLabel?: string
  /** Returns an error message to keep the dialog open, or nothing to close it. */
  onSubmit: (value: string) => string | void
  onClose: () => void
}

/** Asks for one value (a name, a tempo…). */
export function PromptDialog({ title, label, initial, type = 'text', hint, submitLabel = 'OK', onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = onSubmit(value)
    if (problem) setError(problem)
    else onClose()
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-dim">
          {label}
          <input
            type={type}
            step="any"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onFocus={(e) => e.target.select()}
            className="field h-8 text-sm"
          />
        </label>
        {hint && <p className="text-xs text-text-dim">{hint}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn h-8 px-3 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary h-8 px-3 text-sm">
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

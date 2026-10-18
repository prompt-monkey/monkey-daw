import { useState } from 'react'

interface Props {
  value: number
  onCommit: (value: number) => void
  label: string
  step?: number
  min?: number
  className?: string
}

/** A number input that edits a local draft and commits on Enter or blur. */
export function NumberField({ value, onCommit, label, step = 1, min, className = '' }: Props) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n)
    setDraft(null)
  }

  return (
    <input
      type="number"
      aria-label={label}
      step={step}
      min={min}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className={`field font-mono tabular-nums ${className}`}
    />
  )
}

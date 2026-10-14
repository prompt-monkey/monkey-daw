import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

interface Props {
  items: MenuItem[]
  label: string
  className?: string
  children: React.ReactNode
}

/**
 * A button that opens a small list of actions. The list is rendered into document.body with
 * fixed positioning, so neighbouring sticky elements (like the next track header) never cover
 * it. Closes on selection, outside click, Escape, scroll or resize.
 */
export function Menu({ items, label, className = '', children }: Props) {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    setAnchor(anchor || !rect ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  useEffect(() => {
    if (!anchor) return
    const dismiss = () => setAnchor(null)
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!button.current?.contains(target) && !list.current?.contains(target)) dismiss()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss()
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [anchor])

  return (
    <>
      <button
        ref={button}
        className={className}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title={label}
      >
        {children}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={list}
            role="menu"
            className="fixed z-[100] min-w-40 rounded-md border border-line bg-surface-2 py-1 shadow-xl"
            style={{ top: anchor.top, right: anchor.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surface ${item.danger ? 'text-danger' : ''}`}
                onClick={() => {
                  setAnchor(null)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

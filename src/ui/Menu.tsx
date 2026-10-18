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

/** Closes a menu on an outside click (outside `inside` elements), Escape, scroll or resize. */
function useDismiss(open: boolean, inside: React.RefObject<HTMLElement | null>[], dismiss: () => void) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!inside.some((r) => r.current?.contains(target))) dismiss()
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
    // The refs are stable; only opening and closing matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dismiss])
}

function MenuList({
  items,
  style,
  listRef,
  onClose,
}: {
  items: MenuItem[]
  style: React.CSSProperties
  listRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  return createPortal(
    <div
      ref={listRef}
      role="menu"
      className="fixed z-[100] max-h-[70vh] min-w-44 overflow-y-auto overscroll-contain rounded-lg border border-transparent bg-surface-2 p-1 shadow-popover"
      style={style}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`block w-full rounded px-2.5 py-1.5 text-left text-xs whitespace-nowrap transition-[background-color] duration-150 ease-out hover:bg-surface-3 ${item.danger ? 'text-danger' : ''}`}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
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
  const [close] = useState(() => () => setAnchor(null))
  useDismiss(anchor !== null, [button, list], close)

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    setAnchor(anchor || !rect ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  return (
    <>
      <button
        ref={button}
        className={className}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title={label}
      >
        {children}
      </button>
      {anchor && <MenuList items={items} style={{ top: anchor.top, right: anchor.right }} listRef={list} onClose={close} />}
    </>
  )
}

/** A menu opened at a point (right-click). Kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null)
  useDismiss(true, [list], onClose)
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - (items.length * 28 + 16))
  return <MenuList items={items} style={{ left, top }} listRef={list} onClose={onClose} />
}

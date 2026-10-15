/** Shown in a panel while its code loads (the first time it opens). */
export function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-xs text-text-dim" role="status">
      Loading…
    </div>
  )
}

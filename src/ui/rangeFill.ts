/**
 * Style for a range input's filled part (see the slider styles in index.css). The fill runs from
 * `from` (the minimum by default; the center for pan) to the current value.
 */
export function rangeFill(value: number, min: number, max: number, from = min): React.CSSProperties {
  const pct = (v: number) => `${(((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100).toFixed(2)}%`
  const [lo, hi] = value < from ? [pct(value), pct(from)] : [pct(from), pct(value)]
  return { '--lo': lo, '--hi': hi } as React.CSSProperties
}

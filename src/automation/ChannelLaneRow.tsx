import type { AutomatedChannel, Id } from '../model/types'
import { removeAutomationLane } from '../state/actions'
import { useViewStore } from '../state/viewStore'
import { LaneView } from './LaneView'
import { availableTargets } from './targets'

interface Props {
  channelId: Id | 'master'
  name: string
  channel: AutomatedChannel
  target: string
  headerWidth: number
  width: number
  height: number
  pps: number
  grid: React.CSSProperties
}

const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-none hover:bg-surface-2 disabled:opacity-40'

/** A timeline row with one automation lane of a bus or the master (they have no clips). */
export function ChannelLaneRow({ channelId, name, channel, target, headerWidth, width, height, pps, grid }: Props) {
  const setAutomationView = useViewStore((s) => s.setAutomationView)
  const hasPoints = channel.automation.some((l) => l.target === target && l.points.length)
  return (
    <div className="flex">
      <div
        className="sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1.5 border-r border-b border-line bg-surface px-2"
        style={{ width: headerWidth, height, boxShadow: 'inset 3px 0 0 var(--color-text-dim)' }}
      >
        <div className="truncate text-sm font-semibold" title={`${name} automation`}>
          {name} <span className="text-[10px] font-normal text-text-dim">automation</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-text-dim">
          <select
            value={target}
            onChange={(e) => setAutomationView(channelId, e.target.value)}
            aria-label={`${name} automation lane`}
            className="min-w-0 flex-1 rounded border border-accent/60 bg-bg px-1 py-0.5 text-[11px] text-text"
          >
            {availableTargets(channel).map((t) => (
              <option key={t.target} value={t.target}>
                {channel.automation.some((l) => l.target === t.target && l.points.length) ? '● ' : ''}
                {t.label}
              </option>
            ))}
          </select>
          <button className={small} onClick={() => removeAutomationLane(channelId, target)} disabled={!hasPoints} title="Delete this lane's points">
            Clear
          </button>
          <button className={small} onClick={() => setAutomationView(channelId, null)} aria-label="Hide automation" title="Hide this row">
            ✕
          </button>
        </div>
      </div>
      <div className="relative shrink-0 border-b border-line" style={{ width, height, ...grid }}>
        <LaneView channel={channel} channelId={channelId} target={target} pps={pps} width={width} height={height} color="var(--color-text-dim)" />
      </div>
    </div>
  )
}

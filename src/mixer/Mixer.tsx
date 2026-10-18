import { addBus } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { trackColor } from '../timeline/colors'
import { BusStrip, MasterStrip, TrackStrip } from './ChannelStrip'
import { Icon } from '../ui/Icon'

/** Bottom panel: one strip per track, then the buses, with the master pinned on the right. */
export function Mixer() {
  const tracks = useProjectStore((s) => s.project.tracks)
  const buses = useProjectStore((s) => s.project.buses)

  return (
    <div className="flex min-h-0 flex-1" aria-label="Mixer">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tracks.map((track, i) => (
          <TrackStrip key={track.id} track={track} color={trackColor(i)} buses={buses} />
        ))}
        {buses.map((bus) => (
          <BusStrip
            key={bus.id}
            bus={bus}
            sources={tracks.filter((t) => t.output === bus.id || t.sends.some((s) => s.busId === bus.id)).map((t) => t.name)}
          />
        ))}
        <div className="flex shrink-0 items-start p-2">
          <button
            onClick={() => addBus()}
            className="btn ps-2 text-xs text-text-dim"
            title="Add a bus (Ctrl+Shift+B)"
          >
            <Icon name="plus" size={14} />
            Bus
          </button>
        </div>
      </div>
      <MasterStrip />
    </div>
  )
}

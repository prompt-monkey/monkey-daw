import { EffectsRack } from '../effects/EffectsRack'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { Mixer } from './Mixer'

/** The panel under the timeline: the mixer, or the effect rack of one channel. */
export function BottomPanel() {
  const panel = useViewStore((s) => s.bottomPanel)
  const setPanel = useViewStore((s) => s.setBottomPanel)
  const channel = useViewStore((s) => s.rackChannel)
  const channelName = useProjectStore((s) =>
    channel === 'master' ? 'Master' : ([...s.project.tracks, ...s.project.buses].find((c) => c.id === channel)?.name ?? 'Master'),
  )
  const tab = (id: 'mixer' | 'effects', label: string) => (
    <button
      role="tab"
      aria-selected={panel === id}
      onClick={() => setPanel(id)}
      className={`border-b-2 px-3 py-1.5 text-xs ${panel === id ? 'border-accent text-text' : 'border-transparent text-text-dim hover:text-text'}`}
    >
      {label}
    </button>
  )
  return (
    <section className="flex h-72 shrink-0 flex-col border-t border-line bg-bg" aria-label="Mixer and effects">
      <div role="tablist" className="flex shrink-0 border-b border-line bg-surface px-2">
        {tab('mixer', 'Mixer')}
        {tab('effects', `Effects · ${channelName}`)}
      </div>
      {panel === 'mixer' ? <Mixer /> : <EffectsRack />}
    </section>
  )
}

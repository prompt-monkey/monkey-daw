import { Suspense, lazy } from 'react'
import { useProjectStore } from '../state/projectStore'
import { useViewStore, type BottomPanelView } from '../state/viewStore'
import { useShellStore } from '../ui/shell'
import { Loading } from '../ui/Loading'
import { Mixer } from './Mixer'

// The editors load the first time they open, so the app starts faster.
const EffectsRack = lazy(() => import('../effects/EffectsRack').then((m) => ({ default: m.EffectsRack })))
const PianoRoll = lazy(() => import('../pianoroll/PianoRoll').then((m) => ({ default: m.PianoRoll })))
const PitchEditor = lazy(() => import('../pitch/PitchEditor').then((m) => ({ default: m.PitchEditor })))

/** The panel under the timeline: the mixer, an effect rack, the piano roll or the pitch editor. */
export function BottomPanel() {
  const panel = useViewStore((s) => s.bottomPanel)
  const setPanel = useViewStore((s) => s.setBottomPanel)
  const channel = useViewStore((s) => s.rackChannel)
  const channelName = useProjectStore((s) =>
    channel === 'master' ? 'Master' : ([...s.project.tracks, ...s.project.buses].find((c) => c.id === channel)?.name ?? 'Master'),
  )
  const pianoClipId = useViewStore((s) => s.pianoRoll?.clipId)
  const narrow = useShellStore((s) => s.narrow)
  const tall = panel === 'pianoRoll' || panel === 'pitch'
  const height = tall ? (narrow ? 'h-[55vh]' : 'h-[26rem]') : narrow ? 'h-56' : 'h-72'
  const pitchClipId = useViewStore((s) => s.pitchClip)
  const pitchClipName = useProjectStore((s) => {
    for (const t of s.project.tracks) for (const c of t.clips) if (c.id === pitchClipId) return c.name
    return null
  })
  const openTrack = useProjectStore((s) => s.project.tracks.find((t) => t.clips.some((c) => c.id === pianoClipId)))
  const clipName = openTrack?.clips.find((c) => c.id === pianoClipId)?.name
  const tab = (id: BottomPanelView, label: string) => (
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
    <section
      className={`flex shrink-0 flex-col border-t border-line bg-bg ${height}`}
      aria-label="Mixer, effects and editors"
    >
      <div role="tablist" className="flex shrink-0 border-b border-line bg-surface px-2">
        {tab('mixer', 'Mixer')}
        {tab('effects', `Effects · ${channelName}`)}
        {pianoClipId && tab('pianoRoll', `${openTrack?.kind === 'drums' ? 'Drums' : 'Piano roll'}${clipName ? ` · ${clipName}` : ''}`)}
        {pitchClipId && tab('pitch', `Pitch${pitchClipName ? ` · ${pitchClipName}` : ''}`)}
      </div>
      <Suspense fallback={<Loading />}>
        {panel === 'mixer' ? <Mixer /> : panel === 'effects' ? <EffectsRack /> : panel === 'pitch' ? <PitchEditor /> : <PianoRoll />}
      </Suspense>
    </section>
  )
}

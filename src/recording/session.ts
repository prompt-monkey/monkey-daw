// Recording workflow: arm a track, open the input, count in, capture, and drop the take on the
// armed track, lined up with where recording started.

import { engine } from '../audio/engine'
import { downloadBlob } from '../audio/export'
import { secondsPerBar } from '../model/grid'
import type { Id } from '../model/types'
import { addAudioClip } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { pause, useTransportStore } from '../state/transport'
import { toast } from '../ui/toast'
import { Recorder, inputErrorMessage, recordingSupported } from './recorder'
import { useRecordingStore } from './store'
import { buildTake, type RecordedChunk } from './take'

/** Takes shorter than this are treated as accidental and discarded. */
const MIN_TAKE_SECONDS = 0.05

let recorder: Recorder | null = null
const getRecorder = () => (recorder ??= new Recorder(engine.context))

/** Recording session in progress. */
let session: { trackId: Id; start: number; startCtxTime: number; latency: number } | null = null
let countInTimer: ReturnType<typeof setTimeout> | null = null

export function readInputMeter() {
  return recorder?.readMeter() ?? null
}

/** Total latency to compensate, in seconds: manual setting, or what the browser reports. */
export function latencySeconds(): number {
  const { latencyMs } = useRecordingStore.getState().prefs
  if (latencyMs !== null) return latencyMs / 1000
  const ctx = engine.context
  return (recorder?.inputLatency ?? 0) + (ctx.outputLatency || ctx.baseLatency || 0)
}

export async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    useRecordingStore.setState({
      devices: devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` })),
    })
  } catch {
    // Device listing unavailable; the default input is still used.
  }
}

/** Opens the chosen input (asking for microphone permission the first time). */
export async function openInput(): Promise<boolean> {
  if (!recordingSupported()) {
    toast('Recording is not available in this browser. On iPhone and iPad, record on a computer instead.', 'error')
    return false
  }
  useRecordingStore.setState({ status: 'opening' })
  try {
    await getRecorder().openDevice(useRecordingStore.getState().prefs.deviceId)
    useRecordingStore.setState({ inputOpen: true })
    await refreshDevices()
    return true
  } catch (err) {
    toast(inputErrorMessage(err), 'error')
    useRecordingStore.setState({ inputOpen: false })
    return false
  } finally {
    useRecordingStore.setState({ status: 'idle' })
  }
}

/** Uses a given stream as the input instead of a device (synthetic audio in tests). */
export async function openInputStream(stream: MediaStream) {
  await getRecorder().openStream(stream)
  useRecordingStore.setState({ inputOpen: true })
}

export function closeInput() {
  recorder?.close()
  useRecordingStore.setState({ inputOpen: false })
}

/** Arms a track for recording (one at a time); arming the armed track disarms it. */
export async function toggleArm(trackId: Id) {
  const { armedTrackId, status } = useRecordingStore.getState()
  if (status !== 'idle') return
  if (armedTrackId === trackId) {
    useRecordingStore.setState({ armedTrackId: null })
    closeInput()
    return
  }
  useRecordingStore.setState({ armedTrackId: trackId })
  if (!useRecordingStore.getState().inputOpen && !(await openInput())) useRecordingStore.setState({ armedTrackId: null })
}

/** Reopens the input after the device setting changes. */
export async function changeInputDevice(deviceId: string | null) {
  useRecordingStore.getState().setPrefs({ deviceId })
  if (useRecordingStore.getState().inputOpen) await openInput()
}

export async function startRecording() {
  const { armedTrackId, status, prefs } = useRecordingStore.getState()
  if (status !== 'idle') return
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === armedTrackId)
  if (!track) {
    toast('Arm a track first: press its ● button, then record.', 'error')
    return
  }
  if (!useRecordingStore.getState().inputOpen && !(await openInput())) return

  const { bpm, timeSignature } = useProjectStore.getState().project
  const start = useTransportStore.getState().cursor
  const countIn = prefs.countInBars * secondsPerBar(bpm, timeSignature)
  engine.metronome.countInUntil = countIn > 0 ? start : null
  await engine.play(start - countIn, { ignoreLoop: true })
  useTransportStore.setState({ playing: true })

  const startCtxTime = engine.contextTimeAt(start)!
  const latency = latencySeconds()
  session = { trackId: track.id, start, startCtxTime, latency }
  const rec = getRecorder()
  const peakFrom = startCtxTime + latency
  rec.onChunk = (chunk: RecordedChunk) => {
    const frames = chunk.channels[0].length
    if (chunk.time + frames / engine.context.sampleRate <= peakFrom) return
    let peak = 0
    for (const data of chunk.channels) for (const v of data) peak = Math.max(peak, Math.abs(v))
    // The peaks array grows in place (copying it per chunk would be quadratic over long takes);
    // a new outer object tells subscribers to redraw.
    useRecordingStore.setState((s) => {
      if (!s.live) return {}
      s.live.peaks.push(peak)
      return { live: { ...s.live, peakDuration: frames / engine.context.sampleRate } }
    })
  }
  rec.start()
  useRecordingStore.setState({
    status: countIn > 0 ? 'counting-in' : 'recording',
    live: { trackId: track.id, start, peaks: [], peakDuration: 2048 / engine.context.sampleRate },
  })
  if (countIn > 0) {
    countInTimer = setTimeout(() => {
      if (useRecordingStore.getState().status === 'counting-in') useRecordingStore.setState({ status: 'recording' })
    }, (startCtxTime - engine.context.currentTime) * 1000)
  }
}

/** Stops recording and places the take. Stopping the transport also ends a recording. */
export async function stopRecording() {
  const current = session
  if (!current || useRecordingStore.getState().status === 'saving') return
  session = null
  if (countInTimer) clearTimeout(countInTimer)
  useRecordingStore.setState({ status: 'saving' })
  if (useTransportStore.getState().playing) pause()
  engine.metronome.countInUntil = null
  const rec = getRecorder()
  rec.onChunk = null
  try {
    const { chunks, sampleRate } = await rec.stop()
    const channels = buildTake(chunks, sampleRate, current.startCtxTime + current.latency, useRecordingStore.getState().prefs.channelMode)
    const length = channels[0]?.length ?? 0
    if (length < MIN_TAKE_SECONDS * sampleRate) {
      toast('Nothing was recorded: stop came before the count-in finished.')
      return
    }
    const buffer = engine.context.createBuffer(channels.length, length, sampleRate)
    channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i))
    const takes = Object.values(useProjectStore.getState().project.assets).filter((a) => /^Take \d+$/.test(a.name)).length
    const name = `Take ${takes + 1}`
    const asset = engine.assets.add(name, buffer)
    addAudioClip(current.trackId, asset, current.start, 'Record take')
    toast(`Recorded "${name}" (${buffer.duration.toFixed(1)} s)`, 'info', {
      label: 'Download WAV',
      onClick: () => {
        const source = engine.assets.source(asset.id)
        if (source) downloadBlob(source, `${name}.wav`)
      },
    })
  } catch (err) {
    toast(`Recording failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
  } finally {
    useRecordingStore.setState({ status: 'idle', live: null })
  }
}

export function toggleRecording() {
  const { status } = useRecordingStore.getState()
  if (status === 'recording' || status === 'counting-in') void stopRecording()
  else if (status === 'idle') void startRecording()
}

/** Keeps the engine's metronome in step with the preferences, and ends recordings on stop. */
export function connectRecording() {
  const apply = () => {
    const { metronome, metronomeVolume } = useRecordingStore.getState().prefs
    engine.metronome.enabled = metronome
    engine.metronome.volume = metronomeVolume
  }
  apply()
  useRecordingStore.subscribe((s, prev) => s.prefs !== prev.prefs && apply())
  useTransportStore.subscribe((s, prev) => {
    if (prev.playing && !s.playing && session) void stopRecording()
  })
  // A deleted track can't stay armed.
  useProjectStore.subscribe((s) => {
    const armed = useRecordingStore.getState().armedTrackId
    if (armed && !s.project.tracks.some((t) => t.id === armed) && !session) {
      useRecordingStore.setState({ armedTrackId: null })
      closeInput()
    }
  })
}

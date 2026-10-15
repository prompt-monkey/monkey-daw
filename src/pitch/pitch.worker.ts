import { analysePitch, renderPitchEdits, segmentNotes, type PitchSegment, type PitchTrack } from './analysis'

type Request =
  | { job: number; kind: 'analyse'; channels: Float32Array[]; sampleRate: number }
  | { job: number; kind: 'render'; channels: Float32Array[]; sampleRate: number; track: PitchTrack; edits: PitchSegment[] }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = (e) => {
  const req = e.data
  try {
    if (req.kind === 'analyse') {
      const track = analysePitch(req.channels, req.sampleRate)
      scope.postMessage({ job: req.job, track, notes: segmentNotes(track) }, [])
    } else {
      const channels = renderPitchEdits(req.channels, req.sampleRate, req.track, req.edits)
      scope.postMessage({ job: req.job, channels }, channels.map((c) => c.buffer))
    }
  } catch (err) {
    scope.postMessage({ job: req.job, error: err instanceof Error ? err.message : 'failed' }, [])
  }
}

import { timeStretch } from './wsola'

interface Request {
  job: number
  channels: Float32Array[]
  sampleRate: number
  rate: number
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = (e) => {
  const { job, channels, sampleRate, rate } = e.data
  try {
    const out = timeStretch(channels, sampleRate, rate)
    scope.postMessage({ job, channels: out }, out.map((c) => c.buffer))
  } catch {
    scope.postMessage({ job, channels: null }, [])
  }
}

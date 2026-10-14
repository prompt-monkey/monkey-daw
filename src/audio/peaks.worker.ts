import { computePeaks } from './peaks'

interface Request {
  id: string
  channels: Float32Array[]
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = (e) => {
  const { min, max } = computePeaks(e.data.channels)
  scope.postMessage({ id: e.data.id, min, max }, [min.buffer, max.buffer])
}

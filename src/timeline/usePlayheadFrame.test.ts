import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribePlayheadFrame } from './usePlayheadFrame'

// A manual animation-frame queue, so frames run when the test says so.
let queue: FrameRequestCallback[] = []
const runFrame = () => {
  const due = queue
  queue = []
  due.forEach((cb) => cb(0))
}

beforeEach(() => {
  queue = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  runFrame() // let the loop see it has no subscribers and stop
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('subscribePlayheadFrame', () => {
  it('keeps calling healthy subscribers when another one throws', () => {
    const calls: number[] = []
    const offBad = subscribePlayheadFrame(() => {
      throw new Error('broken display')
    })
    const offGood = subscribePlayheadFrame((t) => calls.push(t))
    runFrame()
    runFrame()
    runFrame()
    expect(calls).toHaveLength(3)
    expect(console.error).toHaveBeenCalled()
    offBad()
    offGood()
  })

  it('stops scheduling frames when nobody listens, and restarts on a new subscriber', () => {
    const off = subscribePlayheadFrame(() => {})
    off()
    runFrame()
    expect(queue).toHaveLength(0)
    const seen: number[] = []
    const off2 = subscribePlayheadFrame((t) => seen.push(t))
    runFrame()
    expect(seen).toHaveLength(1)
    off2()
  })
})

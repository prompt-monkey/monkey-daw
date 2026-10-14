let shared: AudioContext | null = null

/** The app's single AudioContext, created on first use and resumed when the page comes back. */
export function getAudioContext(): AudioContext {
  if (shared) return shared
  const mobile = /Android|Mobi/i.test(navigator.userAgent)
  try {
    shared = new AudioContext({ latencyHint: mobile ? 'playback' : 'interactive' })
  } catch {
    shared = new AudioContext()
  }
  const ctx = shared
  const resume = () => {
    if (document.visibilityState === 'visible' && ctx.state !== 'running') ctx.resume().catch(() => {})
  }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('pageshow', resume)
  window.addEventListener('focus', resume)
  return ctx
}

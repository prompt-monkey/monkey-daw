import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, commit, createHistory, endGesture, redo, undo } from './history'

describe('history', () => {
  it('undoes and redoes changes in order', () => {
    let h = createHistory(0)
    h = commit(h, 1, 'one')
    h = commit(h, 2, 'two')
    h = undo(h)
    expect(h.present).toBe(1)
    expect(h.future[0].label).toBe('two')
    h = undo(h)
    expect(h.present).toBe(0)
    h = redo(h)
    expect(h.present).toBe(1)
    expect(h.past.at(-1)?.label).toBe('one')
  })

  it('clears the redo stack on a new change', () => {
    let h = commit(createHistory(0), 1, 'one')
    h = commit(undo(h), 5, 'five')
    expect(h.future).toHaveLength(0)
    expect(redo(h)).toBe(h)
  })

  it('ignores no-op commits and empty undo/redo', () => {
    const h = createHistory(0)
    expect(commit(h, 0, 'same')).toBe(h)
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('merges a gesture into one step until it ends', () => {
    let h = createHistory(0)
    h = commit(h, 1, 'drag', 'fader')
    h = commit(h, 2, 'drag', 'fader')
    h = commit(h, 3, 'drag', 'fader')
    expect(h.past).toHaveLength(1)
    h = endGesture(h)
    h = commit(h, 4, 'drag', 'fader')
    expect(h.past).toHaveLength(2)
    expect(undo(h).present).toBe(3)
    expect(undo(undo(h)).present).toBe(0)
  })

  it('does not merge different gestures', () => {
    let h = commit(createHistory(0), 1, 'a', 'fader:1')
    h = commit(h, 2, 'b', 'fader:2')
    expect(h.past).toHaveLength(2)
  })

  it('caps the number of steps', () => {
    let h = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = commit(h, i, `step ${i}`)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0].state).toBe(10)
  })
})

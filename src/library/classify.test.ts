import { describe, expect, it } from 'vitest'
import { detectBpm, detectCategory, detectKind, detectSignature } from './classify'

describe('detectCategory', () => {
  it('recognises English and Spanish instrument names', () => {
    expect(detectCategory('Drums/Kick_Hard_01.wav')).toBe('kick')
    expect(detectCategory('Tarola seca 2.wav')).toBe('snare')
    expect(detectCategory('Tolo/tololoche_Am_120bpm.wav')).toBe('tololoche')
    expect(detectCategory('REQ - Requinto 6-8 loop.wav')).toBe('requinto')
    expect(detectCategory('808 Glide C.wav')).toBe('808')
    expect(detectCategory('Charchetas/open.wav')).toBe('hihat')
    expect(detectCategory('voz_coro_final.mp3')).toBe('vocals')
    expect(detectCategory('Trombon melodia.wav')).toBe('brass')
  })

  it('falls back to the folder name, nearest folder first', () => {
    expect(detectCategory('Bajos/Take 03.wav')).toBe('bass')
    expect(detectCategory('Guitarras/Bajo sexto/take.wav')).toBe('guitar')
    expect(detectCategory('Bass guitar DI.wav')).toBe('bass')
    expect(detectCategory('Misc/thing.wav')).toBe('other')
  })

  it('does not match words inside other words', () => {
    expect(detectCategory('Hatchet.wav')).toBe('other')
    expect(detectCategory('Bassoon-like tone.wav')).toBe('other')
  })
})

describe('detectBpm', () => {
  it('reads tempos written before or after "bpm"', () => {
    expect(detectBpm('loop_120bpm.wav')).toBe(120)
    expect(detectBpm('Loop 92 BPM Am.wav')).toBe(92)
    expect(detectBpm('BPM-140 trap.wav')).toBe(140)
    expect(detectBpm('take 01.wav')).toBeNull()
    expect(detectBpm('999bpm.wav')).toBeNull()
  })
})

describe('detectSignature', () => {
  it('reads common signatures in names', () => {
    expect(detectSignature('Corridos 6-8/req.wav')).toBe('6/8')
    expect(detectSignature('loop 3_4 92bpm.wav')).toBe('3/4')
    expect(detectSignature('4/4/kick.wav')).toBe('4/4')
    expect(detectSignature('take 5-7.wav')).toBeNull()
    expect(detectSignature('kick 01.wav')).toBeNull()
  })
})

describe('detectKind', () => {
  it('uses the name first, then the duration', () => {
    expect(detectKind('One Shots/kick.wav', 5)).toBe('one-shot')
    expect(detectKind('Loops/kick.wav', 0.3)).toBe('loop')
    expect(detectKind('snare.wav', 0.4)).toBe('one-shot')
    expect(detectKind('guitar take.wav', 8)).toBe('loop')
    expect(detectKind('guitar take.wav')).toBeNull()
  })
})

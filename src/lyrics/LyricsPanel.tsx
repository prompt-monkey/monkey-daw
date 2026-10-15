import { useEffect, useRef } from 'react'
import { downloadBlob, exportFilename } from '../audio/download'
import type { LyricSection, LyricSectionKind } from '../model/types'
import { addLyricSection, moveLyricSection, removeLyricSection, setLyricKind, setLyricText } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { toast } from '../ui/toast'
import { KIND_NAMES, LYRIC_KINDS, lyricsStats, lyricsText, sectionLabels } from './lyrics'
import { MAX_FONT, MIN_FONT, changeFontSize, setLyricsMode, useLyricsPrefs } from './prefs'

/** A section just added from the buttons; its text box takes the focus when it appears. */
const focusNext = { id: null as string | null }

const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-4 hover:bg-surface-2 disabled:opacity-40'

function AddButtons({ big = false }: { big?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LYRIC_KINDS.map((kind) => (
        <button
          key={kind}
          className={big ? 'rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2' : small}
          onClick={() => {
            focusNext.id = addLyricSection(kind)
          }}
        >
          + {KIND_NAMES[kind]}
        </button>
      ))}
    </div>
  )
}

function SectionEditor({ section, label, index, count, fontSize }: { section: LyricSection; label: string; index: number; count: number; fontSize: number }) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const textRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusNext.id !== section.id) return
    focusNext.id = null
    textRef.current?.focus()
    textRef.current?.scrollIntoView({ block: 'nearest' })
  }, [section.id])
  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-accent">{label}</span>
        <select
          value={section.kind}
          onChange={(e) => setLyricKind(section.id, e.target.value as LyricSectionKind)}
          aria-label={`${label} type`}
          className="rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-text"
        >
          {LYRIC_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_NAMES[k]}
            </option>
          ))}
        </select>
        <button className={small} disabled={index === 0} onClick={() => moveLyricSection(section.id, index - 1)} aria-label={`Move ${label} up`}>
          ↑
        </button>
        <button
          className={small}
          disabled={index === count - 1}
          onClick={() => moveLyricSection(section.id, index + 1)}
          aria-label={`Move ${label} down`}
        >
          ↓
        </button>
        <button className={`${small} text-danger`} onClick={() => removeLyricSection(section.id)} aria-label={`Delete ${label}`} title="Delete this section">
          ✕
        </button>
      </div>
      <textarea
        ref={textRef}
        data-lyric-id={section.id}
        value={section.text}
        onChange={(e) => setLyricText(section.id, e.target.value)}
        onBlur={endGesture}
        placeholder={`Write the ${KIND_NAMES[section.kind].toLowerCase()}…`}
        aria-label={`${label} lyrics`}
        spellCheck
        className="block min-h-16 w-full resize-none bg-transparent px-2 py-1.5 leading-snug text-text [field-sizing:content] placeholder:text-text-dim/60 focus:outline-none"
        style={{ fontSize: Math.max(13, Math.round(fontSize * 0.65)) }}
      />
    </div>
  )
}

/** The song's lyrics in sections: written in Write mode, shown large to sing along in Sing mode. */
export function LyricsPanel() {
  const sections = useProjectStore((s) => s.project.lyrics)
  const projectName = useProjectStore((s) => s.project.name)
  const { mode, fontSize } = useLyricsPrefs()
  const labels = sectionLabels(sections)
  const stats = lyricsStats(sections)
  const seg = (active: boolean) => `px-2 py-0.5 text-[11px] leading-4 ${active ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lyricsText(sections))
      toast('Lyrics copied')
    } catch {
      toast('Could not copy: the browser blocked the clipboard.', 'error')
    }
  }
  const download = () =>
    downloadBlob(
      new Blob([lyricsText(sections, projectName)], { type: 'text/plain;charset=utf-8' }),
      exportFilename(projectName, 'project', 'txt', ' lyrics'),
    )

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-bg" aria-label="Lyrics">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Lyrics mode">
          <button className={seg(mode === 'write')} aria-pressed={mode === 'write'} onClick={() => setLyricsMode('write')}>
            Write
          </button>
          <button className={seg(mode === 'sing')} aria-pressed={mode === 'sing'} onClick={() => setLyricsMode('sing')} title="Big text to sing along">
            Sing
          </button>
        </div>
        <button className={small} onClick={() => changeFontSize(-2)} disabled={fontSize <= MIN_FONT} aria-label="Smaller text" title="Smaller text">
          A−
        </button>
        <button className={small} onClick={() => changeFontSize(2)} disabled={fontSize >= MAX_FONT} aria-label="Larger text" title="Larger text">
          A+
        </button>
        <span className="flex-1" />
        <button className={small} onClick={() => void copy()} disabled={!sections.length} title="Copy the lyrics as text">
          Copy
        </button>
        <button className={small} onClick={download} disabled={!sections.length} title="Download the lyrics as a .txt file">
          .txt
        </button>
        <button className={small} onClick={() => useViewStore.getState().setLyricsOpen(false)} aria-label="Close lyrics" title="Close">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!sections.length ? (
          <div className="flex flex-col gap-3 p-2 text-sm text-text-dim">
            <p>Write the song in sections: verses, chorus, bridge… Add the first one:</p>
            <AddButtons big />
          </div>
        ) : mode === 'write' ? (
          <div className="flex flex-col gap-2">
            {sections.map((s, i) => (
              <SectionEditor key={s.id} section={s} label={labels[i]} index={i} count={sections.length} fontSize={fontSize} />
            ))}
            <div className="pt-1">
              <AddButtons />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-2 py-3" style={{ fontSize }}>
            {sections.map((s, i) => (
              <section key={s.id}>
                <h3 className="mb-1 text-xs font-semibold tracking-wider text-accent uppercase">{labels[i]}</h3>
                {s.text.trim() ? (
                  <p className="leading-normal whitespace-pre-wrap">{s.text.trim()}</p>
                ) : (
                  <p className="text-sm text-text-dim italic">(empty)</p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      {sections.length > 0 && (
        <div className="shrink-0 border-t border-line px-3 py-1 text-[11px] text-text-dim">
          {sections.length} {sections.length === 1 ? 'section' : 'sections'} · {stats.lines} lines · {stats.words} words
        </div>
      )}
    </aside>
  )
}

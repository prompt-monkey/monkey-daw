import { Dialog } from './Dialog'

/** Every keyboard and mouse shortcut, by area. */
const SHORTCUTS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Transport',
    items: [
      ['Space', 'Play / pause'],
      ['R', 'Record on the armed track'],
      ['K', 'Metronome on / off'],
      ['W', 'Write automation: moving controls while playing records them'],
      ['Click the ruler', 'Move the playhead'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y · Ctrl+Shift+Z', 'Redo'],
      ['Delete', 'Delete the selected clips'],
      ['Ctrl+D', 'Duplicate the selected clips'],
      ['Ctrl+C · Ctrl+V', 'Copy, paste at the playhead'],
      ['Ctrl+A · Esc', 'Select all · deselect'],
      ['Shift / Ctrl + click', 'Add a clip to the selection'],
      ['Alt while dragging', 'Place off the grid'],
      ['Right-click a clip', 'Clip options (tempo sync, rename…)'],
      ['Double-click a MIDI or drum clip', 'Edit its notes'],
    ],
  },
  {
    title: 'Project and view',
    items: [
      ['Ctrl+S', 'Save'],
      ['Ctrl+O', 'Projects'],
      ['Ctrl+Shift+B', 'Add a bus'],
      ['Ctrl + wheel · pinch', 'Zoom the timeline'],
      ['F', 'Fullscreen'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Piano roll',
    items: [
      ['D · S · E · Z', 'Draw, select, erase, zoom tools'],
      ['Right-click', 'Erase notes'],
      ['↑ / ↓ · Shift+↑ / ↓', 'Semitone · octave'],
      ['← / →', 'Move by one grid step'],
      ['Ctrl+A / C / X / V / D', 'Select all, copy, cut, paste, duplicate'],
      ['Click or sweep the keys', 'Hear notes (glissando)'],
    ],
  },
  {
    title: 'Drums',
    items: [
      ['Click or drag steps', 'Add or remove hits'],
      ['Shift + click', 'Accented hit'],
      ['Alt + click a hit', 'Change its velocity'],
      ['Drop a sample on a pad', 'Use it on that pad'],
    ],
  },
  {
    title: 'Effects',
    items: [
      ['Drag or wheel on a knob', 'Change it (Shift for fine steps)'],
      ['Double-click a knob', 'Reset'],
      ['Right-click a knob', 'Automate it'],
      ['Drag an effect header', 'Reorder the chain'],
    ],
  },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard and mouse shortcuts" onClose={onClose} wide>
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        {SHORTCUTS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-accent uppercase">{group.title}</h3>
            <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-1 text-xs">
              {group.items.map(([keys, action]) => (
                <div key={keys} className="contents">
                  <dt className="font-mono text-text">{keys}</dt>
                  <dd className="text-text-dim">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-text-dim">On a Mac, use Cmd instead of Ctrl.</p>
    </Dialog>
  )
}

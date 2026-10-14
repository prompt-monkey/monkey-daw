// Class names shared by the piano roll and the drum editor toolbars.

export const segClass = (active: boolean) => `px-1.5 py-0.5 leading-4 ${active ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`
export const btnClass = 'rounded border border-line px-1.5 py-0.5 leading-4 hover:bg-surface-2'
export const selectClass = 'rounded border border-line bg-bg px-1 py-0.5 text-text'

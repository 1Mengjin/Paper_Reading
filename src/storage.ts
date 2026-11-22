import { createStore, entries, get, set, update } from 'idb-keyval'
import type { Anchor, Book, Layout, Volume } from './model'
import { anchorOf, compare, locate } from './model'

const titles = createStore('paperpocket-catalog', 'titles')
export type Title = Pick<Book, 'id' | 'title' | 'author'>
export async function catalog(): Promise<Title[]> { return (await entries<string, Title>(titles)).map(([, value]) => value) }
export async function saveBook(book: Book) {
  await set('book/' + book.id, book)
  await set(book.id, { id: book.id, title: book.title, author: book.author }, titles)
}
export interface Note { id: string; start: Anchor; end: Anchor; type: 'mark' | 'line'; quote: string; message: string }
export interface Span { start: Anchor; end: Anchor }
export interface Journal { last?: Anchor; visits: Anchor[]; finished: Span[]; folds: Anchor[]; notes: Note[] }
export function emptyJournal(): Journal { return { visits: [], finished: [], folds: [], notes: [] } }
export function volumeSpan(layout: Layout, volume: Volume): Span {
  const tail = layout.pages[volume.end - 1].parts.at(-1)!
  return { start: anchorOf(layout.pages[volume.start]), end: { block: tail.block, offset: tail.to } }
}
export function isFinished(journal: Journal, span: Span) {
  return journal.finished.some(s => compare(s.start, span.start) <= 0 && compare(s.end, span.end) >= 0)
}
export function remember(journal: Journal, layout: Layout, volume: Volume, page: number, finish: boolean): Journal {
  const last = anchorOf(layout.pages[page])
  const visits = journal.visits.filter(a => { const p = locate(layout.pages, a); return p < volume.start || p >= volume.end })
  const span = volumeSpan(layout, volume)
  let finished = journal.finished
  if (finish && !isFinished(journal, span)) {
    const merged: Span[] = []
    for (const s of [...finished, span].sort((a,b) => compare(a.start,b.start))) {
      const prev = merged.at(-1)
      if (prev && (compare(prev.end,s.start) >= 0 || (prev.end.block + 1 === s.start.block && s.start.offset === 0))) {
        if (compare(s.end, prev.end) > 0) prev.end = s.end
      } else merged.push({ ...s })
    }
    finished = merged
  }
  return { ...journal, last, visits: [...visits, last], finished }
}
export { get, set, update }

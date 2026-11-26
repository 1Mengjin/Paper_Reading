import { createStore, del, entries, get, set, update } from 'idb-keyval'
import { defaultPrefs, type Book, type MobileJournal, type MobileLayout, type MobilePrefs } from './model'
import type { Levels } from './utils/soundEngine'

// Independent IndexedDB stores for Android mobile app (no cross-device coupling with PC)
const catalogStore = createStore('paperpocket-android-catalog', 'books')
const dataStore = createStore('paperpocket-android-data', 'kv')

export interface BookMeta {
  id: string
  title: string
  author: string
  coverTone: number
  addedAt: number
  lastReadAt: number
  progress: number
  chapterTitle: string
  pinned: boolean
  totalBlocks: number
}

export function emptyJournal(): MobileJournal {
  return { bookmarks: [], notes: [] }
}

function toneForId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % 6
}

export async function listBooks(): Promise<BookMeta[]> {
  const rows = await entries<string, BookMeta>(catalogStore)
  return rows
    .map(([, v]) => v)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
    })
}

export async function saveBook(book: Book): Promise<BookMeta> {
  const existing = await get<BookMeta>(book.id, catalogStore)
  const now = Date.now()
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    author: book.author,
    coverTone: existing?.coverTone ?? toneForId(book.id),
    addedAt: existing?.addedAt ?? now,
    lastReadAt: now,
    progress: existing?.progress ?? 0,
    chapterTitle: existing?.chapterTitle ?? (book.toc[0]?.title || book.blocks[0]?.chapter || ''),
    pinned: existing?.pinned ?? false,
    totalBlocks: book.blocks.length,
  }
  await set('book/' + book.id, book, dataStore)
  await set(book.id, meta, catalogStore)
  return meta
}

export async function getBook(id: string): Promise<Book | undefined> {
  return get<Book>('book/' + id, dataStore)
}

export async function deleteBook(id: string): Promise<void> {
  await Promise.all([
    del(id, catalogStore),
    del('book/' + id, dataStore),
    del('journal/' + id, dataStore),
    del('layout/' + id, dataStore),
  ])
}

export async function togglePinBook(id: string): Promise<void> {
  await update<BookMeta | undefined>(
    id,
    old => (old ? { ...old, pinned: !old.pinned } : old),
    catalogStore
  )
}

export async function updateBookProgress(id: string, progress: number, chapterTitle: string): Promise<void> {
  const clamped = Math.max(0, Math.min(1, progress))
  await update<BookMeta | undefined>(
    id,
    old =>
      old
        ? {
            ...old,
            progress: clamped,
            chapterTitle: chapterTitle || old.chapterTitle,
            lastReadAt: Date.now(),
          }
        : old,
    catalogStore
  )
}

export async function getJournal(id: string): Promise<MobileJournal> {
  return (await get<MobileJournal>('journal/' + id, dataStore)) || emptyJournal()
}

export async function updateJournal(
  id: string,
  fn: (j: MobileJournal) => MobileJournal
): Promise<MobileJournal> {
  let next = emptyJournal()
  await update<MobileJournal>(
    'journal/' + id,
    old => {
      next = fn(old || emptyJournal())
      return next
    },
    dataStore
  )
  return next
}

export async function getCachedLayout(id: string): Promise<MobileLayout | undefined> {
  return get<MobileLayout>('layout/' + id, dataStore)
}

export async function saveCachedLayout(id: string, layout: MobileLayout): Promise<void> {
  await set('layout/' + id, layout, dataStore)
}

export async function getPrefs(): Promise<MobilePrefs> {
  const raw = await get<Partial<MobilePrefs>>('prefs', dataStore)
  return { ...defaultPrefs, ...raw }
}

export async function savePrefs(prefs: MobilePrefs): Promise<void> {
  await set('prefs', prefs, dataStore)
}

export async function getMix(): Promise<Partial<Levels> | undefined> {
  return get<Partial<Levels>>('mix', dataStore)
}

export async function saveMix(levels: Levels): Promise<void> {
  await set('mix', levels, dataStore)
}

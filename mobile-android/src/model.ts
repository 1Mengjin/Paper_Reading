export type Tag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'blockquote' | 'img'

export interface Block {
  tag: Tag
  text: string
  chapter: string
  image?: string
}

export interface Picture {
  src: string
  width: number
  height: number
}

export interface TocEntry {
  title: string
  block: number
}

export interface Book {
  id: string
  title: string
  author: string
  blocks: Block[]
  images: Record<string, Picture>
  toc: TocEntry[]
}

export interface Anchor {
  block: number
  offset: number
}

export interface Part {
  block: number
  from: number
  to: number
}

export interface Page {
  parts: Part[]
}

export interface MobileLayout {
  key: string
  pages: Page[]
}

export interface BookmarkItem {
  id: string
  anchor: Anchor
  chapter: string
  excerpt: string
  createdAt: number
}

export type NoteStyle = 'mark' | 'line'

export interface Note {
  id: string
  start: Anchor
  end: Anchor
  type: NoteStyle
  quote: string
  message: string
  chapter: string
  createdAt: number
}

export interface MobileJournal {
  last?: Anchor
  bookmarks: BookmarkItem[]
  notes: Note[]
}

export type ReadMode = 'page' | 'scroll'
export type ThemeId = 'cream' | 'kraft' | 'sage' | 'white' | 'night'
export type FontId = 'serif' | 'kai' | 'sans'

export interface MobilePrefs {
  mode: ReadMode
  theme: ThemeId
  font: FontId
  fontSize: number
  lineHeight: number
}

export const defaultPrefs: MobilePrefs = {
  mode: 'page',
  theme: 'cream',
  font: 'serif',
  fontSize: 18,
  lineHeight: 1.85,
}

export function anchorOf(page: Page): Anchor {
  const part = page.parts[0]
  return { block: part.block, offset: part.from }
}

export function compare(a: Anchor, b: Anchor) {
  return a.block - b.block || a.offset - b.offset
}

export function locate(pages: Page[], anchor: Anchor) {
  if (!pages.length) return 0
  let lo = 0
  let hi = pages.length
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (compare(anchorOf(pages[mid]), anchor) <= 0) lo = mid
    else hi = mid
  }
  return lo
}

export interface ChapterSlice {
  index: number
  title: string
  startBlock: number
  endBlock: number
}

export function extractChapters(book: Book): ChapterSlice[] {
  if (!book.blocks.length) return []
  const starts = new Map<number, string>()
  for (const t of book.toc) {
    if (t.block >= 0 && t.block < book.blocks.length && !starts.has(t.block)) {
      starts.set(t.block, t.title)
    }
  }
  if (!starts.has(0)) {
    starts.set(0, book.blocks[0].chapter || book.title)
  }
  const sorted = [...starts.entries()].sort((a, b) => a[0] - b[0])
  return sorted.map(([startBlock, title], index) => ({
    index,
    title,
    startBlock,
    endBlock: index + 1 < sorted.length ? sorted[index + 1][0] : book.blocks.length,
  }))
}

export function findChapterIndex(chapters: ChapterSlice[], blockIndex: number): number {
  if (!chapters.length) return 0
  let lo = 0
  let hi = chapters.length
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (chapters[mid].startBlock <= blockIndex) lo = mid
    else hi = mid
  }
  return lo
}

export function excerptAt(book: Book, anchor: Anchor, maxLen = 48): string {
  const block = book.blocks[anchor.block]
  if (!block) return ''
  if (block.tag === 'img') return block.text || '[插图]'
  const raw = block.text.slice(anchor.offset).trim() || block.text.trim()
  return raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

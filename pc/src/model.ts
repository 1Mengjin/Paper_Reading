export type Tag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'blockquote' | 'img'
export interface Block { tag: Tag; text: string; chapter: string; image?: string }
export interface Picture { src: string; width: number; height: number }
export interface Book {
  id: string; title: string; author: string; blocks: Block[]
  images: Record<string, Picture>; toc: { title: string; block: number }[]
}
export interface Anchor { block: number; offset: number }
export interface Part { block: number; from: number; to: number }
export interface Page { parts: Part[] }
export interface Volume { start: number; end: number; title: string }
export interface Layout { key: string; pages: Page[]; volumes: Volume[] }
export function anchorOf(page: Page): Anchor {
  const part = page.parts[0]
  return { block: part.block, offset: part.from }
}
export function compare(a: Anchor, b: Anchor) { return a.block - b.block || a.offset - b.offset }
export function locate(pages: Page[], anchor: Anchor) {
  let lo = 0, hi = pages.length
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (compare(anchorOf(pages[mid]), anchor) <= 0) lo = mid
    else hi = mid
  }
  return lo
}
export const serial = (index: number) => String(index + 1).padStart(2, '0')

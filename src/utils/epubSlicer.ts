import type { Book, Layout, Page, Part, Volume } from '../model'
export interface Metrics { width: number; height: number; spread: number }
export function metrics(viewWidth = document.documentElement.clientWidth, viewHeight = window.innerHeight): Metrics {
  const spread = viewWidth >= 840 ? 2 : 1
  const width = Math.floor(Math.min(1240, viewWidth - (spread === 2 ? 72 : 24)) / spread)
  return { width, height: Math.min(920, viewHeight - (viewHeight < 480 ? 92 : 146)), spread }
}
export const layoutKey = (m: Metrics, size: number) => [3, m.width, m.height, size].join('/')
export function makePart(book: Book, part: Part) {
  const block = book.blocks[part.block]
  const el = document.createElement(block.tag)
  if (el instanceof HTMLImageElement) {
    const image = book.images[block.image!]
    el.src = image.src
    el.width = image.width
    el.height = image.height
    el.alt = block.text
  } else el.textContent = block.text.slice(part.from, part.to)
  return el
}
export function volumesFor(book: Book, pages: Page[], size: number) {
  const result: Volume[] = []
  for (let start = 0; start < pages.length;) {
    let end = Math.min(start + size, pages.length)
    if (end < pages.length && pages[end].parts[0].from > 0) {
      const natural = [-1, 1, -2, 2].map(d => end + d).find(n => n > start && n < pages.length && !pages[n].parts[0].from)
      if (natural !== undefined) end = natural
    }
    result.push({ start, end, title: book.blocks[pages[start].parts[0].block].chapter })
    start = end
  }
  return result
}
export async function paginate(book: Book, m: Metrics, size: number, signal?: AbortSignal): Promise<Layout> {
  await document.fonts.ready
  if (m.height < 145 || m.width < 145) throw new Error('请放大阅读窗口后重试')
  const leaf = document.createElement('section')
  leaf.className = 'leaf measuring'
  leaf.style.width = m.width + 'px'
  leaf.style.height = m.height + 'px'
  const body = document.createElement('div')
  body.className = 'page-text'
  leaf.append(document.createElement('header'), body, document.createElement('footer'))
  document.body.append(leaf)
  const pages: Page[] = []
  let parts: Part[] = []
  const fits = (el: HTMLElement) => el.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 0.01
  function finish() {
    if (parts.length) pages.push({ parts })
    parts = []
    body.replaceChildren()
  }
  let tick = performance.now()
  try {
    for (let block = 0; block < book.blocks.length; block++) {
      const source = book.blocks[block]
      const length = source.tag === 'img' ? 1 : source.text.length
      let from = 0
      while (from < length) {
        signal?.throwIfAborted()
        if (performance.now() - tick > 20) { await new Promise(r => setTimeout(r, 0)); tick = performance.now() }
        const part = { block, from, to: length }
        const el = makePart(book, part)
        body.append(el)
        if (fits(el)) { parts.push(part); break }
        if (parts.length) { finish(); continue }
        if (source.tag === 'img') throw new Error('页面空间不足以容纳插图')
        // 只拆独占一页仍然溢出的段落。二分寻找能放下的前缀，再回退到最近的句末。
        let lo = from, hi = length
        while (lo + 1 < hi) {
          const mid = Math.floor((lo + hi) / 2)
          el.textContent = source.text.slice(from, mid)
          if (fits(el)) lo = mid
          else hi = mid
        }
        if (lo > from && /[\uD800-\uDBFF]/.test(source.text[lo - 1])) lo--
        const prefix = source.text.slice(from, lo)
        const natural = Array.from(prefix.matchAll(/[。！？!?\n]|\.(?=\s)/g)).pop()
        const to = natural ? from + natural.index! + 1 : lo
        if (from === to) throw new Error('窗口过小，无法容纳一行正文')
        parts.push({ block, from, to })
        finish()
        from = to
      }
    }
    finish()
    return { key: layoutKey(m, size), pages, volumes: volumesFor(book, pages, size) }
  } finally { leaf.remove() }
}

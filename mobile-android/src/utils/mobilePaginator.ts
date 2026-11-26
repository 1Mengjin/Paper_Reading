import type { Book, MobileLayout, MobilePrefs, Page, Part } from '../model'

export interface MobileMetrics {
  width: number
  height: number
}

export function measureMobileMetrics(
  viewWidth = window.innerWidth,
  viewHeight = window.innerHeight
): MobileMetrics {
  return {
    width: Math.max(260, Math.floor(viewWidth)),
    height: Math.max(360, Math.floor(viewHeight)),
  }
}

export function mobileLayoutKey(m: MobileMetrics, prefs: Pick<MobilePrefs, 'font' | 'fontSize' | 'lineHeight'>) {
  return ['m2', m.width, m.height, prefs.font, prefs.fontSize, prefs.lineHeight.toFixed(2)].join('/')
}

function makePartElement(book: Book, part: Part) {
  const block = book.blocks[part.block]
  const el = document.createElement(block.tag)
  if (el instanceof HTMLImageElement) {
    const image = book.images[block.image!]
    el.src = image.src
    el.width = image.width
    el.height = image.height
    el.alt = block.text
  } else {
    el.textContent = block.text.slice(part.from, part.to)
  }
  return el
}

export async function paginateMobile(
  book: Book,
  m: MobileMetrics,
  prefs: Pick<MobilePrefs, 'font' | 'fontSize' | 'lineHeight'>,
  signal?: AbortSignal
): Promise<MobileLayout> {
  await document.fonts.ready

  const host = document.createElement('section')
  host.className = 'm-page-sheet m-measuring'
  host.dataset.font = prefs.font
  host.style.width = m.width + 'px'
  host.style.height = m.height + 'px'
  host.style.setProperty('--reader-size', prefs.fontSize + 'px')
  host.style.setProperty('--reader-lh', String(prefs.lineHeight))

  const head = document.createElement('header')
  head.className = 'm-page-head'
  head.textContent = '测'

  const body = document.createElement('div')
  body.className = 'm-page-body'

  const foot = document.createElement('footer')
  foot.className = 'm-page-foot'
  foot.textContent = '1/1'

  host.append(head, body, foot)
  document.body.append(host)

  const pages: Page[] = []
  let parts: Part[] = []

  const fits = (el: HTMLElement) => el.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 0.5

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

      // Start new chapter headings cleanly on a fresh page if current page already has content
      if ((source.tag === 'h1' || source.tag === 'h2') && parts.length > 0) {
        finish()
      }

      while (from < length) {
        signal?.throwIfAborted()
        if (performance.now() - tick > 18) {
          await new Promise(r => setTimeout(r, 0))
          tick = performance.now()
        }

        const part: Part = { block, from, to: length }
        const el = makePartElement(book, part)
        body.append(el)
        if (el instanceof HTMLImageElement) await el.decode().catch(() => {})

        if (fits(el)) {
          parts.push(part)
          break
        }
        if (parts.length) {
          finish()
          continue
        }
        if (source.tag === 'img') {
          parts.push(part)
          finish()
          break
        }

        // Binary search longest fitting prefix for a single long paragraph
        let lo = from
        let hi = length
        while (lo + 1 < hi) {
          const mid = Math.floor((lo + hi) / 2)
          el.textContent = source.text.slice(from, mid)
          if (fits(el)) lo = mid
          else hi = mid
        }
        if (lo > from && /[\uD800-\uDBFF]/.test(source.text[lo - 1])) lo--
        const prefix = source.text.slice(from, lo)
        const natural = Array.from(prefix.matchAll(/[。！？!?\n]|\.(?=\s)/g)).pop()
        const to = natural && from + natural.index! + 1 > from + 8 ? from + natural.index! + 1 : Math.max(from + 1, lo)

        parts.push({ block, from, to })
        finish()
        from = to
      }
    }
    finish()
    return { key: mobileLayoutKey(m, prefs), pages }
  } finally {
    host.remove()
  }
}

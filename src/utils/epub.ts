import JSZip from 'jszip'
import type { Block, Book, Picture, Tag } from '../model'

const parser = new DOMParser()
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name))
function xml(value: string) {
  const doc = parser.parseFromString(value.replace(/&nbsp;/g, '&#160;'), 'application/xml')
  if (elements(doc, 'parsererror').length) throw new Error('书籍 XML 格式有误，无法解析')
  return doc
}
function resolve(base: string, reference: string) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return ''
  const url = new URL(reference, 'https://book.invalid/' + base.split('/').map(encodeURIComponent).join('/'))
  return decodeURIComponent(url.pathname.slice(1)) + decodeURIComponent(url.hash)
}
const heading = /^h[1-4]$/
const grouping = /^(body|section|article|main|div|aside|header|footer|figure|figcaption|li|ul|ol|table|tr|td|pre|dl|dd|dt)$/
export async function parseEpub(file: File): Promise<Book> {
  const bytes = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(bytes)
  async function read(path: string) {
    const entry = zip.file(path)
    if (!entry) throw new Error('书内缺少文件 ' + path)
    return xml(await entry.async('string'))
  }
  const container = await read('META-INF/container.xml')
  const opf = elements(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!opf) throw new Error('找不到 EPUB 书籍清单')
  const doc = await read(opf)
  const manifest = new Map(elements(doc, 'item').map(e => [e.getAttribute('id'), {
    path: resolve(opf, e.getAttribute('href') || ''), mime: e.getAttribute('media-type') || '',
    properties: (e.getAttribute('properties') || '').split(/\s+/)
  }]))
  const items = [...manifest.values()]
  const nav = items.find(i => i.properties.includes('nav'))
  const ncx = manifest.get(elements(doc, 'spine')[0]?.getAttribute('toc') || '') || items.find(i => i.mime.includes('ncx'))
  const links: {title: string; target: string}[] = []
  if (nav) {
    const menus = elements(await read(nav.path), 'nav')
    const menu = menus.find(e => (e.getAttribute('epub:type') || '').split(/\s+/).includes('toc')) || menus[0]
    for (const a of menu ? elements(menu, 'a') : []) links.push({ title: a.textContent!.trim(), target: resolve(nav.path, a.getAttribute('href') || '') })
  } else if (ncx) {
    for (const point of elements(await read(ncx.path), 'navPoint')) {
      const label = elements(point, 'navLabel')[0], content = elements(point, 'content')[0]
      if (label && content) links.push({ title: label.textContent!.trim(), target: resolve(ncx.path, content.getAttribute('src') || '') })
    }
  }
  const blocks: Block[] = [], images: Record<string, Picture> = {}, targets = new Map<string, number>()
  const chapters: Book['toc'] = []
  for (const ref of elements(doc, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref'))
    if (!item || ref.getAttribute('linear') === 'no') continue
    const chapterPath = item.path
    const chapter = await read(chapterPath)
    const body = elements(chapter, 'body')[0]
    if (!body) continue
    const title = links.find(l => l.target.split('#')[0] === item.path)?.title || body.querySelector('h1,h2,h3,h4')?.textContent?.trim() || '第 ' + (chapters.length + 1) + ' 章'
    const start = blocks.length
    targets.set(item.path, start)
    let buffer = ''
    function flush(tag: Tag) {
      const text = buffer.trim()
      if (text) blocks.push({ tag, text, chapter: title })
      buffer = ''
    }
    async function walk(node: Node, tag: Tag) {
      if (node.nodeType === Node.TEXT_NODE) { buffer += node.textContent || ''; return }
      if (!(node instanceof Element)) return
      const name = node.localName.toLowerCase()
      if (/^(script|style|iframe|object|noscript|head|audio|video)$/.test(name) || node.hasAttribute('hidden')) return
      const own = heading.test(name) || name === 'blockquote' || name === 'p'
      const boundary = own || grouping.test(name)
      if (boundary) flush(tag)
      if (node.id) targets.set(chapterPath + '#' + node.id, blocks.length)
      const next = tag === 'blockquote' && name === 'p' ? tag : own ? name as Tag : tag
      if (name === 'br') { buffer += '\n'; return }
      if (name === 'img' || name === 'image') {
        flush(tag)
        const src = resolve(chapterPath, node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href') || '')
        const entry = src && zip.file(src)
        if (entry) {
          const mime = items.find(i => i.path === src)?.mime || 'image/png'
          if (!images[src]) {
            const data = 'data:' + mime + ';base64,' + await entry.async('base64')
            const probe = new Image()
            probe.src = data
            try { await probe.decode(); images[src] = { src: data, width: probe.naturalWidth, height: probe.naturalHeight } }
            catch { buffer += node.getAttribute('alt') || ''; return }
          }
          if (images[src]) { blocks.push({ tag: 'img', image: src, text: node.getAttribute('alt') || '', chapter: title }); return }
        }
        buffer += node.getAttribute('alt') || ''
        return
      }
      for (const child of node.childNodes) await walk(child, next)
      if (boundary) flush(next)
    }
    await walk(body, 'p')
    if (blocks.length > start) chapters.push({ title, block: start })
  }
  if (!blocks.length) throw new Error('书中没有可排版的正文')
  const toc = links.flatMap(link => {
    const block = targets.get(link.target) ?? targets.get(link.target.split('#')[0])
    return block === undefined || block >= blocks.length ? [] : [{ title: link.title, block }]
  })
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return { id: Array.from(hash, x => x.toString(16).padStart(2, '0')).join(''), title: elements(doc, 'title')[0]?.textContent?.trim() || file.name.replace(/\.epub$/i, ''),
    author: elements(doc, 'creator').map(e => e.textContent?.trim()).filter(Boolean).join(' / '), blocks, images, toc: toc.length ? toc : chapters }
}

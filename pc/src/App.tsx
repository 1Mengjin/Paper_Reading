import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, ChevronRight, LibraryBig, Upload } from 'lucide-react'
import { anchorOf, locate, serial, type Anchor, type Book, type Layout } from './model'
import { catalog, emptyJournal, get, isFinished, saveBook, set, update, volumeSpan, type Journal, type Title } from './storage'
import { parseEpub } from './utils/epub'
import { layoutKey, metrics, paginate } from './utils/epubSlicer'
import { BookReader } from './components/BookReader'

type Preferences = { size: number; theme: string; font: 'serif' | 'kai' }
const defaults: Preferences = { size: 40, theme: 'cream', font: 'serif' }
const papers = [['cream','米黄纸'],['kraft','牛皮纸'],['night','低光纸'],['white','铜版纸']]
const fonts: [Preferences['font'], string][] = [['serif','书版宋体'],['kai','温润文楷']]
const describe = (e: unknown) => e instanceof Error ? e.message : String(e)
function PaperOptions({ prefs, change }: { prefs: Preferences; change: (p: Preferences) => void }) {
  return <div className="options"><label>每册页数 <select value={prefs.size} onChange={e => change({ ...prefs, size: Number(e.target.value) })}>{[20,40,60].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>纸张 <select value={prefs.theme} onChange={e => change({ ...prefs, theme: e.target.value })}>{papers.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <label>字体 <select value={prefs.font} onChange={e => change({ ...prefs, font: e.target.value as Preferences['font'] })}>{fonts.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
}
export function App() {
  const [titles, setTitles] = useState<Title[]>([])
  const [current, choose] = useState('')
  const [prefs, setPrefs] = useState(defaults)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, report] = useState('')
  const [immersive, setImmersive] = useState(false)
  const [drag, setDrag] = useState(false), input = useRef<HTMLInputElement>(null), importing = useRef(false)
  useEffect(() => {
    Promise.all([catalog(), get<string>('selected'), get<Partial<Preferences>>('prefs')]).then(([items, id, options]) => {
      setTitles(items); choose(items.find(b => b.id === id)?.id || items[0]?.id || '')
      setPrefs({ ...defaults, ...options }); setReady(true)
    }).catch(e => { report(describe(e)); setReady(true) })
  }, [])
  useLayoutEffect(() => {
    document.documentElement.dataset.font = prefs.font
  }, [prefs.font])
  function select(id: string) { choose(id); void set('selected', id).catch(e => report(describe(e))) }
  async function open(file?: File) {
    if (!file || importing.current) return
    if (!/\.epub$/i.test(file.name)) { report('请选择 EPUB 格式的电子书'); return }
    importing.current = true; setBusy(true); report('')
    try { const book = await parseEpub(file); await saveBook(book); setTitles(await catalog()); select(book.id) }
    catch (e) { report('导入失败：' + describe(e)) }
    finally { importing.current = false; setBusy(false) }
  }
  function change(p: Preferences) { setPrefs(p); void set('prefs', p).catch(e => report(describe(e))) }
  return <main className="app" data-theme={prefs.theme} data-font={prefs.font} data-immersive={immersive ? 'true' : undefined}
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false) }}
    onDrop={e => { e.preventDefault(); setDrag(false); void open(e.dataTransfer.files[0]) }}>
    <header className="mast"><div className="brand"><span className="brand-mark" aria-hidden="true"><BookOpen size={18} strokeWidth={1.7}/></span><span className="brand-name">PaperPocket</span><span className="brand-sub">纸间书架</span></div><button className="import-btn" disabled={!ready || busy} onClick={() => input.current?.click()}><Upload size={15}/>{busy ? '正在导入…' : '导入 EPUB'}</button></header>
    <input aria-label="选择 EPUB 文件" hidden ref={input} type="file" accept=".epub,application/epub+zip" onChange={e => { void open(e.target.files?.[0]); e.target.value = '' }}/>
    {error && !immersive && <aside className="notice" role="alert">{error}<button onClick={() => report('')}>关闭</button></aside>}
    {drag && <div className="dropveil"><div className="dropveil-card"><BookOpen size={36} strokeWidth={1.2}/><strong>松开即可导入 EPUB</strong><span>将在本地为您装订成一册册可细读的纸质小书</span></div></div>}
    {current ? <Desk key={current} id={current} titles={titles} select={select} prefs={prefs} change={change} report={report} immersive={immersive} setImmersive={setImmersive}/> :
      <section className="shelf empty"><div className="empty-card"><div className="empty-art" aria-hidden="true"><span className="empty-art-band"/><BookOpen size={44} strokeWidth={1.1}/><span className="empty-art-rule"/></div><span className="kicker">静谧阅读空间</span><h1>我的书架</h1><p>{ready ? '把一本 EPUB 拖到这里，装订成可以一册册慢读的小书。' : '正在打开书架…'}</p><button className="primary" disabled={!ready || busy} onClick={() => input.current?.click()}>选择第一本书 <ChevronRight size={16}/></button></div></section>}
  </main>
}
interface DeskProps { id: string; titles: Title[]; select: (id: string) => void; prefs: Preferences; change: (p: Preferences) => void; report: (s: string) => void; immersive: boolean; setImmersive: (v: boolean) => void }
function Desk({ id, titles, select, prefs, change, report, immersive, setImmersive }: DeskProps) {
  const [book, setBook] = useState<Book>(), [journal, setJournal] = useState<Journal>(emptyJournal)
  const [m, setMetrics] = useState(metrics), [layout, setLayout] = useState<Layout>()
  const [reading, read] = useState<Anchor | null>(null), [failure, setFailure] = useState('')
  const key = layoutKey(m, prefs.size) + '/' + prefs.font
  useEffect(() => {
    let live = true
    Promise.all([get<Book>('book/' + id), get<Journal>('journal/' + id)]).then(([b,j]) => {
      if (!live) return
      if (!b) throw new Error('找不到这本书的正文，请重新导入')
      setJournal(j || emptyJournal()); setBook(b)
    }).catch(e => { if (live) setFailure(describe(e)) })
    return () => { live = false }
  }, [id])
  useEffect(() => {
    const resize = () => setMetrics(metrics())
    window.addEventListener('resize',resize)
    return () => window.removeEventListener('resize',resize)
  }, [])
  useEffect(() => {
    if (!book) return
    const abort = new AbortController()
    const run = async () => {
      setFailure('')
      const cached = await get<Layout>('layout/' + id)
      let result: Layout
      if (cached?.key === key) {
        result = cached
      } else {
        await document.fonts?.load(prefs.font === 'kai' ? '18px "LXGW WenKai Screen"' : '18px "Noto Serif SC"').catch(() => {})
        result = { ...(await paginate(book, m, prefs.size, abort.signal)), key }
      }
      if (abort.signal.aborted) return
      setLayout(result)
      if (result !== cached) await set('layout/' + id,result)
    }
    void run().catch(e => { if (!abort.signal.aborted) setFailure(describe(e)) })
    return () => abort.abort()
  }, [book,id,key,prefs.size])
  function edit(fn: (j: Journal) => Journal) {
    setJournal(fn)
    void update<Journal>('journal/' + id, old => fn(old || emptyJournal())).catch(e => report('阅读记录保存失败：' + describe(e)))
  }
  const options = <PaperOptions prefs={prefs} change={change}/>
  const active = layout?.key === key ? layout : undefined
  if (book && active && reading) return <BookReader book={book} layout={active} metrics={m} journal={journal} anchor={reading} go={read} edit={edit} close={() => { setImmersive(false); read(null) }} options={options} immersive={immersive} setImmersive={setImmersive}/>
  const finishedCount = active ? active.volumes.filter(v => isFinished(journal, volumeSpan(active, v))).length : 0
  return <section className="shelf"><div className="shelf-heading"><div className="book-meta"><span className="kicker"><LibraryBig size={15}/> 本地书架</span><h1>{book?.title || '正在打开书籍'}</h1>{book?.author && <p className="author">{book.author}</p>}</div>
    <label className="catalog-pick">藏书 <select aria-label="切换藏书" value={id} onChange={e => select(e.target.value)}>{titles.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
    <div className="rule"><h2>分册书架</h2>{options}</div>
    {failure && <p role="alert">{failure}</p>}
    {!active && !failure && <p className="binding-status" role="status">正在测量版心并装订小册子…</p>}
    {active && <><p className="summary">全书 {active.pages.length} 页 · 共 {active.volumes.length} 册{finishedCount > 0 ? ` · 已读完 ${finishedCount} 册` : ''}</p><div className="shelf-stage"><div className="shelf-plank" aria-hidden="true"/><div className="volumes" onWheel={e => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() } }}>{active.volumes.map((v,i) => {
      const saved = journal.visits.find(a => { const n = locate(active.pages,a); return n >= v.start && n < v.end })
      const done = isFinished(journal, volumeSpan(active,v))
      return <button key={v.start} className={'volume tone-' + i % 4 + (done ? ' is-done' : '')} onClick={() => read(saved || anchorOf(active.pages[v.start]))}>
        <span className="volume-number">第 {serial(i)} 册</span><strong>{v.title}</strong><span className="bookline"/><span className="volume-pages">第 {v.start+1} 至 {v.end} 页</span>
        {done ? <b className="stamp">已读完</b> : <small>{saved ? '读至第 ' + (locate(active.pages,saved)+1) + ' 页' : '开始阅读'} <ChevronRight size={13}/></small>}</button>
    })}</div></div></>}
  </section>
}

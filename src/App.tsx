import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronRight, LibraryBig, Upload } from 'lucide-react'
import { anchorOf, locate, serial, type Anchor, type Book, type Layout } from './model'
import { catalog, emptyJournal, get, isFinished, saveBook, set, update, volumeSpan, type Journal, type Title } from './storage'
import { parseEpub } from './utils/epub'
import { layoutKey, metrics, paginate } from './utils/epubSlicer'
import { BookReader } from './components/BookReader'

type Preferences = { size: number; theme: string }
const defaults: Preferences = { size: 40, theme: 'cream' }
const papers = [['cream','米黄纸'],['kraft','牛皮纸'],['night','低光纸'],['white','铜版纸']]
const describe = (e: unknown) => e instanceof Error ? e.message : String(e)
function PaperOptions({ prefs, change }: { prefs: Preferences; change: (p: Preferences) => void }) {
  return <div className="options"><label>每册页数 <select value={prefs.size} onChange={e => change({ ...prefs, size: Number(e.target.value) })}>{[20,40,60].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>纸张 <select value={prefs.theme} onChange={e => change({ ...prefs, theme: e.target.value })}>{papers.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
}
export function App() {
  const [titles, setTitles] = useState<Title[]>([])
  const [current, choose] = useState('')
  const [prefs, setPrefs] = useState(defaults)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, report] = useState('')
  const [drag, setDrag] = useState(false), input = useRef<HTMLInputElement>(null), importing = useRef(false)
  useEffect(() => {
    Promise.all([catalog(), get<string>('selected'), get<Preferences>('prefs')]).then(([items, id, options]) => {
      setTitles(items); choose(items.find(b => b.id === id)?.id || items[0]?.id || '')
      setPrefs(options || defaults); setReady(true)
    }).catch(e => { report(describe(e)); setReady(true) })
  }, [])
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
  return <main className="app" data-theme={prefs.theme}
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false) }}
    onDrop={e => { e.preventDefault(); setDrag(false); void open(e.dataTransfer.files[0]) }}>
    <header className="mast"><div className="brand"><BookOpen size={23}/> PaperPocket</div><button disabled={!ready || busy} onClick={() => input.current?.click()}><Upload size={16}/>{busy ? '正在导入' : '导入 EPUB'}</button></header>
    <input aria-label="选择 EPUB 文件" hidden ref={input} type="file" accept=".epub,application/epub+zip" onChange={e => { void open(e.target.files?.[0]); e.target.value = '' }}/>
    {error && <aside className="notice" role="alert">{error}<button onClick={() => report('')}>关闭</button></aside>}
    {drag && <div className="dropveil">松开即可导入 EPUB</div>}
    {current ? <Desk key={current} id={current} titles={titles} select={select} prefs={prefs} change={change} report={report}/> :
      <section className="shelf empty"><div className="empty-art" aria-hidden="true"><BookOpen size={78} strokeWidth={1}/></div><h1>我的书架</h1><p>{ready ? '把一本 EPUB 拖到这里，装订成可以一册册读的小书。' : '正在打开书架'}</p><button className="primary" disabled={!ready || busy} onClick={() => input.current?.click()}>选择第一本书 <ChevronRight size={16}/></button></section>}
  </main>
}
interface DeskProps { id: string; titles: Title[]; select: (id: string) => void; prefs: Preferences; change: (p: Preferences) => void; report: (s: string) => void }
function Desk({ id, titles, select, prefs, change, report }: DeskProps) {
  const [book, setBook] = useState<Book>(), [journal, setJournal] = useState<Journal>(emptyJournal)
  const [m, setMetrics] = useState(metrics), [layout, setLayout] = useState<Layout>()
  const [reading, read] = useState<Anchor | null>(null), [failure, setFailure] = useState('')
  const key = layoutKey(m,prefs.size)
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
      const result = cached?.key === key ? cached : await paginate(book, m, prefs.size, abort.signal)
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
  if (book && active && reading) return <BookReader book={book} layout={active} metrics={m} journal={journal} anchor={reading} go={read} edit={edit} close={() => read(null)} options={options}/>
  return <section className="shelf"><div className="shelf-heading"><div><span className="kicker"><LibraryBig size={17}/> 本地书架</span><h1>{book?.title || '正在打开书籍'}</h1>{book?.author && <p>{book.author}</p>}</div>
    <label>藏书 <select aria-label="切换藏书" value={id} onChange={e => select(e.target.value)}>{titles.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
    <div className="rule"><h2>分册书架</h2>{options}</div>
    {failure && <p role="alert">{failure}</p>}
    {!active && !failure && <p role="status">正在测量版心并装订小册子…</p>}
    {active && <><p className="summary">全书 {active.pages.length} 页，共 {active.volumes.length} 册</p><div className="volumes">{active.volumes.map((v,i) => {
      const saved = journal.visits.find(a => { const n = locate(active.pages,a); return n >= v.start && n < v.end })
      const done = isFinished(journal, volumeSpan(active,v))
      return <button key={v.start} className={'volume tone-' + i % 4} onClick={() => read(saved || anchorOf(active.pages[v.start]))}>
        <span className="volume-number">第 {serial(i)} 册</span><strong>{v.title}</strong><span className="bookline"/><span>第 {v.start+1} 至 {v.end} 页</span>
        {done ? <b className="stamp">已读完</b> : <small>{saved ? '读至第 ' + (locate(active.pages,saved)+1) + ' 页' : '开始阅读'} <ChevronRight size={13}/></small>}</button>
    })}</div></>}
  </section>
}

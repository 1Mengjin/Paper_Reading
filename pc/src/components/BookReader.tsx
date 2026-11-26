import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, BellOff, Bookmark, Check, ChevronLeft, ChevronRight, Eraser, Headphones, List, Maximize2, Minimize2, PencilLine, Settings2, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { anchorOf, compare, locate, serial, type Anchor, type Book, type Layout, type Page, type Part } from '../model'
import { get, isFinished, remember, set, volumeSpan, type Journal, type Note } from '../storage'
import type { Metrics } from '../utils/epubSlicer'
import { normalizeLevels, quiet, rainOptions, SoundEngine, turnOptions, type Levels } from '../utils/soundEngine'

interface Props {
  book: Book
  layout: Layout
  metrics: Metrics
  journal: Journal
  anchor: Anchor
  go: (a: Anchor) => void
  edit: (fn: (j: Journal) => Journal) => void
  close: () => void
  options: ReactNode
  immersive: boolean
  setImmersive: (v: boolean) => void
}

interface TurnSlot { page?: Page; num: number }
interface TurnState { id: number; dir: 'next' | 'back'; spread: number; oldSlots: TurnSlot[]; newSlots: TurnSlot[] }

function Paragraph({ book, part, notes }: { book: Book; part: Part; notes: Note[] }) {
  const block = book.blocks[part.block], Tag = block.tag
  if (Tag === 'img') {
    const image = book.images[block.image!]
    return <img src={image.src} alt={block.text} width={image.width} height={image.height}/>
  }
  const marks = notes.filter(n => n.start.block <= part.block && n.end.block >= part.block).map(n => ({
    note:n, lo: n.start.block === part.block ? Math.max(n.start.offset,part.from) : part.from,
    hi: n.end.block === part.block ? Math.min(n.end.offset,part.to) : part.to
  })).filter(n => n.hi > n.lo)
  const cuts = [...new Set([part.from,part.to,...marks.flatMap(n => [n.lo,n.hi])])].sort((a,b) => a-b)
  return <Tag data-block={part.block} data-from={part.from}>{cuts.slice(0,-1).map((start,i) => {
    const active = marks.filter(n => n.lo <= start && n.hi > start)
    return <span key={start} data-notes={active.length ? active.map(n => n.note.id).join(',') : undefined} className={active.map(n => n.note.type).join(' ')} title={active.map(n=>n.note.message).filter(Boolean).join('\n') || undefined}>{block.text.slice(start,cuts[i+1])}</span>
  })}</Tag>
}

function LeafContent({ book, page, num, notes }: { book: Book; page?: Page; num: number; notes: Note[] }) {
  return <>
    <header>{page && book.blocks[page.parts[0].block].chapter}</header>
    <div className="page-text">{page?.parts.map(part => <Paragraph key={part.block + '-' + part.from} book={book} part={part} notes={notes}/>)}</div>
    <footer>{page && num}</footer>
  </>
}

function endpoint(node: Node, offset: number): Anchor | undefined {
  const parent = node instanceof Element ? node : node.parentElement
  const block = parent?.closest<HTMLElement>('[data-block]')
  if (!block) return
  const distance = document.createRange()
  distance.selectNodeContents(block); distance.setEnd(node,offset)
  return { block: Number(block.dataset.block), offset: Number(block.dataset.from) + distance.toString().length }
}

export function BookReader({ book, layout, metrics: m, journal, anchor, go, edit, close, options, immersive, setImmersive }: Props) {
  const page = locate(layout.pages,anchor), index = layout.volumes.findIndex(v => page < v.end), volume = layout.volumes[index]
  const first = volume.start + Math.floor((page-volume.start)/m.spread)*m.spread
  const stop = Math.min(first+m.spread,volume.end), atEnd = stop === volume.end
  const [panel, show] = useState(''), [stamp, setStamp] = useState(false)
  const [selection, select] = useState<{id:number;start:Anchor;end:Anchor;quote:string;x:number;y:number}|null>(null)
  const [message, setMessage] = useState(''), [levels, setLevels] = useState<Levels>(quiet)
  const [audioError,soundError] = useState('')
  const [turning, setTurning] = useState<TurnState | null>(null)
  const [hudVisible, setHudVisible] = useState(false)
  const [hoverNote, setHoverNote] = useState<{ id: string; x: number; y: number; width: number; side: 'left' | 'right' | 'edge' } | null>(null)
  const [hoverDraft, setHoverDraft] = useState('')
  const [savedHint, setSavedHint] = useState(false)
  const [engine] = useState(() => new SoundEngine()), lastVisit = useRef('')
  const spreadFrameRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number>()
  const hoverActive = useRef(false)
  const hoverFocused = useRef(false)
  const mixTouched = useRef(false)
  const selSeq = useRef(0)
  const turnSeq = useRef(0)
  const turnTimer = useRef<number>()
  const hudTimer = useRef<number>()
  const hudHover = useRef(false)
  const enteredFullscreen = useRef(false)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    let live = true
    void get<Levels>('mix').then(value => { if (value && live && !mixTouched.current) setLevels(normalizeLevels(value)) }).catch(() => {})
    return () => {
      live = false
      window.clearTimeout(turnTimer.current)
      window.clearTimeout(hudTimer.current)
      window.clearTimeout(hoverTimer.current)
      engine.dispose()
      void wakeLock.current?.release().catch(() => {})
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
      setImmersive(false)
    }
  }, [engine, setImmersive])

  useEffect(() => { setTurning(null) }, [m.spread])
  useEffect(() => { setHoverNote(null) }, [first, panel, selection])

  useEffect(() => {
    const token = layout.key + '/' + first
    if (lastVisit.current === token) return
    lastVisit.current = token
    if (atEnd && !isFinished(journal,volumeSpan(layout,volume))) setStamp(true)
    edit(j => remember(j,layout,volume,first,atEnd))
  }, [layout,first,atEnd,edit,journal,volume])

  const wakeHud = useCallback(() => {
    setHudVisible(true)
    window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => {
      if (!hudHover.current) setHudVisible(false)
    }, 2600)
  }, [])

  const releaseImmersiveResources = useCallback(() => {
    enteredFullscreen.current = false
    void wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
  }, [])

  const enterImmersive = useCallback(() => {
    show(''); select(null)
    setImmersive(true)
    wakeHud()
    void document.documentElement.requestFullscreen?.().then(() => {
      enteredFullscreen.current = true
    }).catch(() => {})
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    void wl?.request('screen').then(lock => { wakeLock.current = lock }).catch(() => {})
  }, [setImmersive, wakeHud])

  const exitImmersive = useCallback(() => {
    window.clearTimeout(hudTimer.current)
    setHudVisible(false)
    setImmersive(false)
    releaseImmersiveResources()
  }, [releaseImmersiveResources, setImmersive])

  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) {
        if (immersive) enteredFullscreen.current = true
      } else if (enteredFullscreen.current) {
        enteredFullscreen.current = false
        setImmersive(false)
        void wakeLock.current?.release().catch(() => {})
        wakeLock.current = null
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [immersive, setImmersive])

  function goTo(n: number) { go(anchorOf(layout.pages[n])); show(''); select(null); setStamp(false) }
  function jump(n: number) {
    window.clearTimeout(turnTimer.current)
    setTurning(null)
    goTo(n)
  }
  function flip(delta: number) {
    if (delta < 0 && first === volume.start || delta > 0 && atEnd) return
    const nextFirst = first + delta * m.spread
    const nextStop = Math.min(nextFirst + m.spread, volume.end)
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduceMotion && Math.abs(delta) === 1) {
      const oldSlots: TurnSlot[] = Array.from({ length: m.spread }, (_, i) => {
        const n = first + i
        return { page: n < stop ? layout.pages[n] : undefined, num: n + 1 }
      })
      const newSlots: TurnSlot[] = Array.from({ length: m.spread }, (_, i) => {
        const n = nextFirst + i
        return { page: n < nextStop ? layout.pages[n] : undefined, num: n + 1 }
      })
      window.clearTimeout(turnTimer.current)
      const id = ++turnSeq.current
      const duration = m.spread === 2 ? 620 : 480
      setTurning({ id, dir: delta > 0 ? 'next' : 'back', spread: m.spread, oldSlots, newSlots })
      turnTimer.current = window.setTimeout(() => {
        setTurning(cur => cur?.id === id ? null : cur)
      }, duration + 80)
    }
    void engine.turn(levels).catch(() => soundError('浏览器未能播放声音'))
    goTo(nextFirst)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selection || panel || stamp || hoverNote) { select(null); show(''); setStamp(false); setHoverNote(null); return }
        if (immersive) { exitImmersive(); return }
        return
      }
      if (stamp || panel || selection || e.altKey || e.ctrlKey || e.metaKey || (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input,select,textarea')))) return
      if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        e.preventDefault()
        if (immersive) exitImmersive(); else enterImmersive()
        return
      }
      if (e.code === 'Space' && e.target instanceof HTMLElement && e.target.closest('button')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault(); flip(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown',key)
    return () => window.removeEventListener('keydown',key)
  })

  const folded = journal.folds.some(a => locate(layout.pages,a) === stop-1)
  function fold() {
    const target = anchorOf(layout.pages[stop-1])
    edit(j => ({...j, folds: j.folds.some(a => locate(layout.pages,a) === stop-1) ? j.folds.filter(a=>locate(layout.pages,a)!==stop-1) : [...j.folds,target]}))
  }
  function capture() {
    const sel = window.getSelection()
    if (!sel?.rangeCount || sel.isCollapsed) { select(null); return }
    const range = sel.getRangeAt(0)
    const start = endpoint(range.startContainer,range.startOffset), end = endpoint(range.endContainer,range.endOffset)
    if (!start || !end || compare(start,end)>=0) return
    const rect = range.getBoundingClientRect()
    const quote = book.blocks.slice(start.block,end.block+1).map((b,i)=>b.tag==='img' ? '' : b.text.slice(i===0?start.offset:0,start.block+i===end.block?end.offset:undefined)).join('\n')
    setMessage(''); select({id:++selSeq.current,start,end,quote,x:Math.max(8,Math.min(innerWidth-288,rect.left)),y:Math.max(8,Math.min(innerHeight-118,rect.bottom+6))})
  }
  function save(type: Note['type']) {
    if (!selection) return
    const {start,end,quote} = selection
    const note: Note = {id:crypto.randomUUID(),start,end,quote,type,message}
    edit(j => ({...j,notes:[...j.notes,note]})); select(null); window.getSelection()?.removeAllRanges()
  }
  const overlappingNotes = selection ? journal.notes.filter(n => compare(n.start, selection.end) < 0 && compare(n.end, selection.start) > 0) : []
  function clearAnnotation() {
    if (!selection) return
    const hadOverlap = overlappingNotes.length > 0
    if (hadOverlap) {
      const { start, end } = selection
      edit(j => ({ ...j, notes: j.notes.filter(n => !(compare(n.start, end) < 0 && compare(n.end, start) > 0)) }))
    }
    setMessage('')
    if (hadOverlap && !message) {
      select(null)
      window.getSelection()?.removeAllRanges()
    }
  }
  const activeHoverNote = hoverNote ? journal.notes.find(n => n.id === hoverNote.id) : undefined
  function openHoverNote(el: HTMLElement) {
    const noteId = el.dataset.notes?.split(',')[0]
    if (!noteId) return
    const note = journal.notes.find(n => n.id === noteId)
    if (!note) return
    window.clearTimeout(hoverTimer.current)
    const frame = spreadFrameRef.current?.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const marginLeft = frame ? frame.left : 0
    const marginRight = frame ? window.innerWidth - frame.right : 0
    const preferLeft = frame ? (rect.left + rect.width / 2) < (frame.left + frame.width / 2) : false
    const maxW = 248, gap = 14
    let x = 12, y = Math.max(66, Math.min(window.innerHeight - 226, rect.top - 8)), width = maxW, side: 'left' | 'right' | 'edge' = 'right'
    if (preferLeft && marginLeft >= 196) {
      width = Math.min(maxW, marginLeft - gap - 10)
      x = Math.max(10, frame!.left - width - gap)
      side = 'left'
    } else if (marginRight >= 196) {
      width = Math.min(maxW, marginRight - gap - 10)
      x = frame!.right + gap
      side = 'right'
    } else if (marginLeft >= 196) {
      width = Math.min(maxW, marginLeft - gap - 10)
      x = Math.max(10, frame!.left - width - gap)
      side = 'left'
    } else {
      width = Math.min(268, window.innerWidth - 20)
      x = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left))
      y = frame && (window.innerHeight - frame.bottom >= 175) ? frame.bottom + 8 : Math.max(10, (frame?.top ?? 72) - 180)
      side = 'edge'
    }
    if (hoverNote?.id !== note.id) {
      setHoverDraft(note.message)
      setSavedHint(false)
    }
    setHoverNote({ id: note.id, x, y, width, side })
  }
  function scheduleHideHover(delay = 420) {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      if (!hoverActive.current && !hoverFocused.current) setHoverNote(null)
    }, delay)
  }
  function saveHoverNote() {
    if (!activeHoverNote) return
    edit(j => ({ ...j, notes: j.notes.map(n => n.id === activeHoverNote.id ? { ...n, message: hoverDraft } : n) }))
    setSavedHint(true)
    window.setTimeout(() => setSavedHint(false), 1200)
  }
  function clearHoverNote() {
    if (!activeHoverNote) return
    setHoverDraft('')
    setSavedHint(false)
    edit(j => ({ ...j, notes: j.notes.map(n => n.id === activeHoverNote.id ? { ...n, message: '' } : n) }))
  }
  function removeHoverNote() {
    if (!activeHoverNote) return
    edit(j => ({ ...j, notes: j.notes.filter(n => n.id !== activeHoverNote.id) }))
    hoverActive.current = false
    hoverFocused.current = false
    setHoverNote(null)
  }
  function mix(next: Levels) {
    mixTouched.current = true; setLevels(next)
    void engine.activate(next).catch(() => soundError('浏览器未能播放声音'))
    void set('mix',next).catch(() => soundError('音量设置保存失败'))
  }
  const progress = (stop-volume.start)/(volume.end-volume.start)
  return <section className={'reader' + (immersive ? ' immersive' : '')} onPointerMove={immersive ? wakeHud : undefined} onTouchStart={immersive ? wakeHud : undefined}>
    <header className="reader-tools"><button onClick={() => { releaseImmersiveResources(); close() }}><ArrowLeft size={16}/>书架</button><strong>{book.title}</strong>
      {[[List,'目录'],[Bookmark,'书签'],[PencilLine,'笔记'],[Settings2,'设置']].map(([Icon,label]) => {
        const Glyph = Icon as typeof List, name=String(label)
        return <button key={name} aria-label={name} aria-expanded={panel===name} onClick={()=>show(panel===name?'':name)}><Glyph size={17}/></button>
      })}
      <button aria-label="沉浸模式" title="沉浸模式 (F)" onClick={enterImmersive}><Maximize2 size={17}/></button>
    </header>
    {immersive && <div className={'immersive-hud' + (hudVisible ? ' visible' : '')} onPointerEnter={() => { hudHover.current = true; setHudVisible(true) }} onPointerLeave={() => { hudHover.current = false; wakeHud() }}>
      <span className="dnd-badge"><BellOff size={14}/> 已屏蔽通知</span>
      <span className="hud-page">第 {serial(index)} 册 · {first+1}{stop>first+1?'–'+stop:''}/{volume.end}</span>
      <button type="button" aria-label="退出沉浸" onClick={exitImmersive}><Minimize2 size={15}/> 退出沉浸</button>
    </div>}
    <div className="spread-wrap"><div className="spread-frame" ref={spreadFrameRef}><article className="spread" style={{'--left-stack':(1+progress*7)+'px','--right-stack':(1+(1-progress)*7)+'px'} as CSSProperties} onPointerUp={capture} onKeyUp={e=>{if(e.shiftKey) capture()}} onPointerOver={e => { if (selection || panel || stamp) return; const hit = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-notes]'); if (hit) openHoverNote(hit) }} onPointerOut={e => { const hit = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-notes]'); const next = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>('[data-notes], .margin-note'); if (hit && !next) scheduleHideHover(440) }}>
      {Array.from({length:m.spread},(_,i) => {
        const n = first+i, p = n<stop ? layout.pages[n] : undefined
        return <section key={n} className="leaf sheet" style={{width:m.width,height:m.height}}>
          <LeafContent book={book} page={p} num={n+1} notes={journal.notes}/>
          {i===0 && <button className="edge prev" disabled={first===volume.start} aria-label="上一页边缘" onClick={()=>flip(-1)}/>}
          {i===m.spread-1 && <button className="edge next" disabled={atEnd} aria-label="下一页边缘" onClick={()=>flip(1)}/>}
          {n===stop-1 && <button aria-label="折角书签" aria-pressed={folded} className={'fold '+(folded?'folded':'')} onClick={fold}/>}
        </section>
      })}
      {turning && turning.spread === m.spread && <div key={turning.id} aria-hidden="true" className={'turn-overlay ' + (turning.spread === 2 ? 'spread-turn ' : 'single-turn ') + turning.dir}>
        {turning.spread === 2 ? (
          turning.dir === 'next' ? <>
            <section className="leaf turn-face turn-underlay left" style={{width:m.width,height:m.height}}>
              <LeafContent book={book} page={turning.oldSlots[0]?.page} num={turning.oldSlots[0]?.num ?? 1} notes={journal.notes}/>
            </section>
            <div className="turn-leaf" style={{width:m.width,height:m.height}} onAnimationEnd={e => { if (e.target === e.currentTarget) setTurning(cur => cur?.id === turning.id ? null : cur) }}>
              <section className="leaf turn-face turn-front"><LeafContent book={book} page={turning.oldSlots[1]?.page} num={turning.oldSlots[1]?.num ?? 1} notes={journal.notes}/></section>
              <section className="leaf turn-face turn-back"><LeafContent book={book} page={turning.newSlots[0]?.page} num={turning.newSlots[0]?.num ?? 1} notes={journal.notes}/></section>
            </div>
          </> : <>
            <section className="leaf turn-face turn-underlay right" style={{width:m.width,height:m.height}}>
              <LeafContent book={book} page={turning.oldSlots[1]?.page} num={turning.oldSlots[1]?.num ?? 1} notes={journal.notes}/>
            </section>
            <div className="turn-leaf" style={{width:m.width,height:m.height}} onAnimationEnd={e => { if (e.target === e.currentTarget) setTurning(cur => cur?.id === turning.id ? null : cur) }}>
              <section className="leaf turn-face turn-front"><LeafContent book={book} page={turning.oldSlots[0]?.page} num={turning.oldSlots[0]?.num ?? 1} notes={journal.notes}/></section>
              <section className="leaf turn-face turn-back"><LeafContent book={book} page={turning.newSlots[1]?.page} num={turning.newSlots[1]?.num ?? 1} notes={journal.notes}/></section>
            </div>
          </>
        ) : (
          turning.dir === 'next' ? <>
            <div className="turn-leaf" style={{width:m.width,height:m.height}} onAnimationEnd={e => { if (e.target === e.currentTarget) setTurning(cur => cur?.id === turning.id ? null : cur) }}>
              <section className="leaf turn-face turn-front"><LeafContent book={book} page={turning.oldSlots[0]?.page} num={turning.oldSlots[0]?.num ?? 1} notes={journal.notes}/></section>
            </div>
          </> : <>
            <section className="leaf turn-face turn-underlay" style={{width:m.width,height:m.height}}>
              <LeafContent book={book} page={turning.oldSlots[0]?.page} num={turning.oldSlots[0]?.num ?? 1} notes={journal.notes}/>
            </section>
            <div className="turn-leaf" style={{width:m.width,height:m.height}} onAnimationEnd={e => { if (e.target === e.currentTarget) setTurning(cur => cur?.id === turning.id ? null : cur) }}>
              <section className="leaf turn-face turn-front"><LeafContent book={book} page={turning.newSlots[0]?.page} num={turning.newSlots[0]?.num ?? 1} notes={journal.notes}/></section>
            </div>
          </>
        )}
      </div>}
    </article></div></div>
    <footer className="reader-foot"><button aria-label="上一页" disabled={first===volume.start} onClick={()=>flip(-1)}><ChevronLeft/></button><span>第 {serial(index)} 册　{first+1}{stop>first+1?' – '+stop:''} / {volume.end}</span>
      <button aria-label="下一页" disabled={atEnd} onClick={()=>flip(1)}><ChevronRight/></button><button aria-label="声景混音" aria-expanded={panel==='声景'} onClick={()=>show(panel==='声景'?'':'声景')}><Headphones size={17}/></button></footer>
    {panel && <aside className={'panel '+(panel==='声景'?'mixer':'')} aria-label={panel}><header><h2>{panel}</h2><button aria-label="关闭面板" onClick={()=>show('')}><X size={16}/></button></header>
      {panel==='设置' && options}
      {panel==='目录' && book.toc.map((t,i)=><button className="entry" key={i} onClick={()=>jump(locate(layout.pages,{block:t.block,offset:0}))}>{t.title}</button>)}
      {panel==='书签' && (journal.folds.length ? journal.folds.map(a=><button className="entry" key={a.block+'/'+a.offset} onClick={()=>jump(locate(layout.pages,a))}>第 {locate(layout.pages,a)+1} 页</button>) : <p className="empty-hint">点击书页右上角，折下一枚书角。</p>)}
      {panel==='笔记' && (journal.notes.length ? journal.notes.map(n=><button className="entry note-entry" key={n.id} onClick={()=>jump(locate(layout.pages,n.start))}><span className="note-quote">{n.quote}</span>{n.message && <small>{n.message}</small>}</button>) : <p className="empty-hint">轻选一段文字，即可划线或留下一行批注。</p>)}
      {panel==='声景' && <>
        <div className="mixer-group">
          <label>雨声<input type="range" min="0" max="1" step=".01" value={levels.rain} onChange={e=>mix({...levels,rain:Number(e.target.value)})}/></label>
          <label>雨声音效<select value={levels.rainSound} onChange={e=>mix({...levels,rainSound:e.target.value})}>{rainOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        </div>
        <div className="mixer-group">
          <label>棕噪音<input type="range" min="0" max="1" step=".01" value={levels.brown} onChange={e=>mix({...levels,brown:Number(e.target.value)})}/></label>
        </div>
        <div className="mixer-group">
          <label>翻页声<input type="range" min="0" max="1" step=".01" value={levels.turn} onChange={e=>mix({...levels,turn:Number(e.target.value)})}/></label>
          <label>翻页音效<select value={levels.turnSound} onChange={e=>mix({...levels,turnSound:e.target.value})}>{turnOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        </div>
        <button className="mixer-mute" aria-pressed={levels.muted} onClick={()=>mix({...levels,muted:!levels.muted})}>{levels.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}{levels.muted ? '已静音' : '静音'}</button>
        {!immersive && audioError && <p role="alert">{audioError}</p>}
      </>}
    </aside>}
    {selection && <div key={selection.id} className="annotation" style={{left:selection.x,top:selection.y}}><input aria-label="批注内容" placeholder="写下批注（可选）" value={message} onChange={e=>setMessage(e.target.value)}/><div><button onClick={()=>save('mark')}>高亮</button><button onClick={()=>save('line')}>下划线</button><button aria-label="清空批注" title={overlappingNotes.length ? '清空选中区域的批注与标记' : '清空输入的批注内容'} disabled={!message && !overlappingNotes.length} onClick={clearAnnotation}><Eraser size={14}/>清空</button><button aria-label="取消批注" onClick={()=>select(null)}><X size={15}/></button></div></div>}
    {hoverNote && activeHoverNote && !selection && <aside key={hoverNote.id} className={'margin-note ' + hoverNote.side} aria-label="书边笔记" style={{left:hoverNote.x,top:hoverNote.y,width:hoverNote.width}} onPointerEnter={() => { hoverActive.current = true; window.clearTimeout(hoverTimer.current) }} onPointerLeave={() => { hoverActive.current = false; scheduleHideHover(320) }}>
      <header><span>书边笔记</span><button type="button" aria-label="关闭笔记浮窗" onClick={() => { hoverActive.current = false; hoverFocused.current = false; setHoverNote(null) }}><X size={14}/></button></header>
      <p className="margin-quote">{activeHoverNote.quote}</p>
      <textarea aria-label="编辑笔记内容" rows={3} placeholder="添加或修改笔记内容…" value={hoverDraft} onFocus={() => { hoverFocused.current = true; window.clearTimeout(hoverTimer.current) }} onBlur={() => { hoverFocused.current = false; if (!hoverActive.current) scheduleHideHover(320) }} onChange={e => { setHoverDraft(e.target.value); setSavedHint(false) }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveHoverNote() } }}/>
      <div className="margin-actions">
        <button type="button" className="primary" disabled={hoverDraft === activeHoverNote.message} onClick={saveHoverNote}>{savedHint ? '已保存' : '保存'}</button>
        <button type="button" aria-label="清空笔记" disabled={!hoverDraft && !activeHoverNote.message} onClick={clearHoverNote}><Eraser size={13}/>清空</button>
        <button type="button" aria-label="删除标记" title="删除此条高亮与笔记" onClick={removeHoverNote}><Trash2 size={13}/></button>
      </div>
    </aside>}
    {stamp && <div className="curtain"><section role="dialog" aria-label="本册已读完" className="completion"><span className="seal"><Check size={18}/>已读完</span><h2>第 {serial(index)} 册</h2><p>{volume.title}</p><div className="completion-actions"><button onClick={()=>setStamp(false)}>留在此页</button>{index+1<layout.volumes.length?<button className="primary" onClick={()=>jump(volume.end)}>下一册</button>:<button className="primary" onClick={()=>{ releaseImmersiveResources(); close() }}>回到书架</button>}</div></section></div>}
  </section>
}

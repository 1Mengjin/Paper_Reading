import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Headphones, List, PencilLine, Settings2, Volume2, VolumeX, X } from 'lucide-react'
import { anchorOf, compare, locate, serial, type Anchor, type Book, type Layout, type Part } from '../model'
import { get, isFinished, remember, set, volumeSpan, type Journal, type Note } from '../storage'
import type { Metrics } from '../utils/epubSlicer'
import { quiet, SoundEngine, type Levels } from '../utils/soundEngine'

interface Props { book: Book; layout: Layout; metrics: Metrics; journal: Journal; anchor: Anchor; go: (a: Anchor) => void; edit: (fn: (j: Journal) => Journal) => void; close: () => void; options: ReactNode }
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
    return <span key={start} className={active.map(n => n.note.type).join(' ')} title={active.map(n=>n.note.message).filter(Boolean).join('\n') || undefined}>{block.text.slice(start,cuts[i+1])}</span>
  })}</Tag>
}
function endpoint(node: Node, offset: number): Anchor | undefined {
  const parent = node instanceof Element ? node : node.parentElement
  const block = parent?.closest<HTMLElement>('[data-block]')
  if (!block) return
  const distance = document.createRange()
  distance.selectNodeContents(block); distance.setEnd(node,offset)
  return { block: Number(block.dataset.block), offset: Number(block.dataset.from) + distance.toString().length }
}
export function BookReader({ book, layout, metrics: m, journal, anchor, go, edit, close, options }: Props) {
  const page = locate(layout.pages,anchor), index = layout.volumes.findIndex(v => page < v.end), volume = layout.volumes[index]
  const first = volume.start + Math.floor((page-volume.start)/m.spread)*m.spread
  const stop = Math.min(first+m.spread,volume.end), atEnd = stop === volume.end
  const [panel, show] = useState(''), [stamp, setStamp] = useState(false)
  const [selection, select] = useState<{start:Anchor;end:Anchor;quote:string;x:number;y:number}|null>(null)
  const [message, setMessage] = useState(''), [levels, setLevels] = useState<Levels>(quiet)
  const [audioError,soundError] = useState(''), [direction, turnDirection] = useState('next')
  const [engine] = useState(() => new SoundEngine()), lastVisit = useRef('')
  const mixTouched = useRef(false)
  useEffect(() => {
    let live = true
    void get<Levels>('mix').then(value => { if (value && live && !mixTouched.current) setLevels(value) }).catch(() => {})
    return () => { live = false; engine.dispose() }
  }, [engine])
  useEffect(() => {
    const token = layout.key + '/' + first
    if (lastVisit.current === token) return
    lastVisit.current = token
    if (atEnd && !isFinished(journal,volumeSpan(layout,volume))) setStamp(true)
    edit(j => remember(j,layout,volume,first,atEnd))
  }, [layout,first,atEnd,edit,journal,volume])
  function jump(n: number) { go(anchorOf(layout.pages[n])); show(''); select(null); setStamp(false) }
  function flip(delta: number) {
    if (delta < 0 && first === volume.start || delta > 0 && atEnd) return
    turnDirection(delta > 0 ? 'next' : 'back')
    void engine.turn(levels).catch(() => soundError('浏览器未能播放声音'))
    jump(first + delta*m.spread)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { select(null); show(''); setStamp(false); return }
      if (stamp || panel || selection || e.altKey || e.ctrlKey || e.metaKey || (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input,select,textarea')))) return
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
    setMessage(''); select({start,end,quote,x:Math.max(8,Math.min(innerWidth-248,rect.left)),y:Math.max(8,Math.min(innerHeight-110,rect.bottom+6))})
  }
  function save(type: Note['type']) {
    if (!selection) return
    const {start,end,quote} = selection
    const note: Note = {id:crypto.randomUUID(),start,end,quote,type,message}
    edit(j => ({...j,notes:[...j.notes,note]})); select(null); window.getSelection()?.removeAllRanges()
  }
  function mix(next: Levels) {
    mixTouched.current = true; setLevels(next)
    void engine.activate(next).catch(() => soundError('浏览器未能播放声音'))
    void set('mix',next).catch(() => soundError('音量设置保存失败'))
  }
  const progress = (stop-volume.start)/(volume.end-volume.start)
  return <section className="reader"><header className="reader-tools"><button onClick={close}><ArrowLeft size={16}/>书架</button><strong>{book.title}</strong>
    {[[List,'目录'],[Bookmark,'书签'],[PencilLine,'笔记'],[Settings2,'设置']].map(([Icon,label]) => {
      const Glyph = Icon as typeof List, name=String(label)
      return <button key={name} aria-label={name} aria-expanded={panel===name} onClick={()=>show(panel===name?'':name)}><Glyph size={17}/></button>
    })}</header>
    <div className="spread-wrap"><article className="spread" style={{'--left-stack':(1+progress*7)+'px','--right-stack':(1+(1-progress)*7)+'px'} as CSSProperties} onPointerUp={capture} onKeyUp={e=>{if(e.shiftKey) capture()}}>
      {Array.from({length:m.spread},(_,i) => {
        const n = first+i, p = n<stop ? layout.pages[n] : undefined
        return <section key={n} className={'leaf sheet '+direction} style={{width:m.width,height:m.height}}>
          <header>{p && book.blocks[p.parts[0].block].chapter}</header>
          <div className="page-text">{p?.parts.map(part=><Paragraph key={part.block+'-'+part.from} book={book} part={part} notes={journal.notes}/>)}</div>
          <footer>{p && n+1}</footer>
          {i===0 && <button className="edge prev" disabled={first===volume.start} aria-label="上一页边缘" onClick={()=>flip(-1)}/>}
          {i===m.spread-1 && <button className="edge next" disabled={atEnd} aria-label="下一页边缘" onClick={()=>flip(1)}/>}
          {n===stop-1 && <button aria-label="折角书签" aria-pressed={folded} className={'fold '+(folded?'folded':'')} onClick={fold}/>}
        </section>
      })}
    </article></div>
    <footer className="reader-foot"><button aria-label="上一页" disabled={first===volume.start} onClick={()=>flip(-1)}><ChevronLeft/></button><span>第 {serial(index)} 册　{first+1}{stop>first+1?' – '+stop:''} / {volume.end}</span>
      <button aria-label="下一页" disabled={atEnd} onClick={()=>flip(1)}><ChevronRight/></button><button aria-label="声景混音" aria-expanded={panel==='声景'} onClick={()=>show(panel==='声景'?'':'声景')}><Headphones size={17}/></button></footer>
    {panel && <aside className={'panel '+(panel==='声景'?'mixer':'')} aria-label={panel}><header><h2>{panel}</h2><button aria-label="关闭面板" onClick={()=>show('')}><X size={16}/></button></header>
      {panel==='设置' && options}
      {panel==='目录' && book.toc.map((t,i)=><button className="entry" key={i} onClick={()=>jump(locate(layout.pages,{block:t.block,offset:0}))}>{t.title}</button>)}
      {panel==='书签' && (journal.folds.length ? journal.folds.map(a=><button className="entry" key={a.block+'/'+a.offset} onClick={()=>jump(locate(layout.pages,a))}>第 {locate(layout.pages,a)+1} 页</button>) : <p>点击书页右上角留下折角。</p>)}
      {panel==='笔记' && (journal.notes.length ? journal.notes.map(n=><button className="entry" key={n.id} onClick={()=>jump(locate(layout.pages,n.start))}>{n.quote}<small>{n.message}</small></button>) : <p>选中一段文字即可划线或批注。</p>)}
      {panel==='声景' && <>{(['rain','brown','turn'] as const).map((k,i)=><label key={k}>{['雨声','棕噪音','翻页声'][i]}<input type="range" min="0" max="1" step=".01" value={levels[k]} onChange={e=>mix({...levels,[k]:Number(e.target.value)})}/></label>)}<button aria-pressed={levels.muted} onClick={()=>mix({...levels,muted:!levels.muted})}>{levels.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}静音</button>{audioError && <p role="alert">{audioError}</p>}</>}
    </aside>}
    {selection && <div className="annotation" style={{left:selection.x,top:selection.y}}><input aria-label="批注内容" placeholder="写下批注（可选）" value={message} onChange={e=>setMessage(e.target.value)}/><div><button onClick={()=>save('mark')}>高亮</button><button onClick={()=>save('line')}>下划线</button><button aria-label="取消批注" onClick={()=>select(null)}><X size={15}/></button></div></div>}
    {stamp && <div className="curtain"><section role="dialog" aria-label="本册已读完" className="completion"><span className="seal"><Check/>已读完</span><h2>第 {serial(index)} 册</h2><p>{volume.title}</p><button onClick={()=>setStamp(false)}>留在此页</button>{index+1<layout.volumes.length?<button className="primary" onClick={()=>jump(volume.end)}>下一册</button>:<button className="primary" onClick={close}>回到书架</button>}</section></div>}
  </section>
}

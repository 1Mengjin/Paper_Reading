import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Headphones,
  Highlighter,
  List,
  MessageSquarePlus,
  Moon,
  ScrollText,
  Settings2,
  Sun,
  Trash2,
  Underline,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  anchorOf,
  compare,
  excerptAt,
  extractChapters,
  findChapterIndex,
  formatTime,
  locate,
  type Anchor,
  type Book,
  type BookmarkItem,
  type MobileJournal,
  type MobileLayout,
  type MobilePrefs,
  type Note,
  type NoteStyle,
  type Page,
  type Part,
  type ThemeId,
} from '../model'
import { getMix, saveMix } from '../storage'
import {
  normalizeLevels,
  quiet,
  rainOptions,
  SoundEngine,
  turnOptions,
  type Levels,
} from '../utils/soundEngine'

interface Props {
  book: Book
  layout?: MobileLayout
  paginating: boolean
  journal: MobileJournal
  prefs: MobilePrefs
  onChangePrefs: (next: MobilePrefs) => void
  onEditJournal: (fn: (j: MobileJournal) => MobileJournal) => void
  onUpdateProgress: (progress: number, chapterTitle: string) => void
  onBack: () => void
  registerBackAction: (fn: () => boolean) => void
}

type SheetKind = '' | 'drawer' | 'settings' | 'sound' | 'note-editor'
type DrawerTab = 'toc' | 'bookmarks' | 'notes'

interface DraftSelection {
  start: Anchor
  end: Anchor
  quote: string
  chapter: string
}

const themes: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'cream', label: '米黄', swatch: '#f5efe2' },
  { id: 'kraft', label: '牛皮', swatch: '#eadcc3' },
  { id: 'sage', label: '护眼绿', swatch: '#e3eee3' },
  { id: 'white', label: '纯白', swatch: '#fbfbfb' },
  { id: 'night', label: '夜间', swatch: '#1d2026' },
]

const lineHeights = [
  { label: '紧凑', value: 1.55 },
  { label: '适中', value: 1.85 },
  { label: '宽松', value: 2.15 },
]

const fontChoices: { id: MobilePrefs['font']; label: string }[] = [
  { id: 'serif', label: '书版宋体' },
  { id: 'kai', label: '温润文楷' },
  { id: 'sans', label: '清爽黑体' },
]

function endpointFromNode(node: Node, offset: number): Anchor | undefined {
  const parent = node instanceof Element ? node : node.parentElement
  const blockEl = parent?.closest<HTMLElement>('[data-block]')
  if (!blockEl) return undefined
  const range = document.createRange()
  range.selectNodeContents(blockEl)
  range.setEnd(node, offset)
  return {
    block: Number(blockEl.dataset.block),
    offset: Number(blockEl.dataset.from || '0') + range.toString().length,
  }
}

function AnnotatedBlock({
  book,
  part,
  notes,
  onTapNote,
}: {
  book: Book
  part: Part
  notes: Note[]
  onTapNote: (noteId: string) => void
}) {
  const block = book.blocks[part.block]
  const Tag = block.tag
  if (Tag === 'img') {
    const image = book.images[block.image!]
    return (
      <img
        src={image.src}
        alt={block.text}
        width={image.width}
        height={image.height}
        className="m-reader-img"
      />
    )
  }

  const marks = notes
    .filter(n => n.start.block <= part.block && n.end.block >= part.block)
    .map(n => ({
      note: n,
      lo: n.start.block === part.block ? Math.max(n.start.offset, part.from) : part.from,
      hi: n.end.block === part.block ? Math.min(n.end.offset, part.to) : part.to,
    }))
    .filter(n => n.hi > n.lo)

  const cuts = [...new Set([part.from, part.to, ...marks.flatMap(n => [n.lo, n.hi])])].sort(
    (a, b) => a - b
  )

  return (
    <Tag data-block={part.block} data-from={part.from}>
      {cuts.slice(0, -1).map((start, i) => {
        const active = marks.filter(n => n.lo <= start && n.hi > start)
        const firstNote = active[0]?.note
        return (
          <span
            key={start}
            data-note-id={firstNote?.id}
            className={active.map(n => 'm-note-' + n.note.type).join(' ') || undefined}
            onClick={
              firstNote
                ? e => {
                    e.stopPropagation()
                    onTapNote(firstNote.id)
                  }
                : undefined
            }
          >
            {block.text.slice(start, cuts[i + 1])}
          </span>
        )
      })}
    </Tag>
  )
}

function PageContent({
  book,
  page,
  notes,
  pageIndex,
  totalPages,
  clockText,
  onTapNote,
}: {
  book: Book
  page?: Page
  notes: Note[]
  pageIndex: number
  totalPages: number
  clockText: string
  onTapNote: (noteId: string) => void
}) {
  const chapter = page ? book.blocks[page.parts[0].block]?.chapter || book.title : book.title
  const pct = totalPages > 0 ? Math.round(((pageIndex + 1) / totalPages) * 100) : 0
  return (
    <section className="m-page-sheet">
      <header className="m-page-head">
        <span>{chapter}</span>
      </header>
      <div className="m-page-body">
        {page?.parts.map(part => (
          <AnnotatedBlock
            key={`${part.block}-${part.from}`}
            book={book}
            part={part}
            notes={notes}
            onTapNote={onTapNote}
          />
        ))}
      </div>
      <footer className="m-page-foot">
        <span>{clockText}</span>
        <span>
          {pageIndex + 1} / {totalPages} · {pct}%
        </span>
      </footer>
    </section>
  )
}

export function MobileReader({
  book,
  layout,
  paginating,
  journal,
  prefs,
  onChangePrefs,
  onEditJournal,
  onUpdateProgress,
  onBack,
  registerBackAction,
}: Props) {
  const chapters = useMemo(() => extractChapters(book), [book])
  const [anchor, setAnchor] = useState<Anchor>(() => journal.last || { block: 0, offset: 0 })
  const [chromeOpen, setChromeOpen] = useState(false)
  const [sheet, setSheet] = useState<SheetKind>('')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('toc')
  const [toast, setToast] = useState('')
  const [clockText, setClockText] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })

  // Swipe state for page mode
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [slideAnim, setSlideAnim] = useState<'next' | 'prev' | ''>('')

  // Annotation states
  const [draftSel, setDraftSel] = useState<DraftSelection | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteStyle, setNoteStyle] = useState<NoteStyle>('mark')
  const [noteText, setNoteText] = useState('')

  // Soundscape state
  const [levels, setLevels] = useState<Levels>(quiet)
  const [engine] = useState(() => new SoundEngine())
  const mixTouched = useRef(false)

  // Refs for gestures & scroll
  const pointerStart = useRef<{ x: number; y: number; time: number; blockEl: HTMLElement | null } | null>(null)
  const longPressTimer = useRef<number>()
  const longPressFired = useRef(false)
  const toastTimer = useRef<number>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastDayTheme = useRef<ThemeId>(prefs.theme === 'night' ? 'cream' : prefs.theme)
  const savedAnchorRef = useRef('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }, [])

  // Keep clock updated
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date()
      setClockText(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      )
    }, 30000)
    return () => window.clearInterval(id)
  }, [])

  // Load saved sound mix & cleanup audio
  useEffect(() => {
    let live = true
    void getMix()
      .then(v => {
        if (live && v && !mixTouched.current) setLevels(normalizeLevels(v))
      })
      .catch(() => {})
    return () => {
      live = false
      window.clearTimeout(longPressTimer.current)
      window.clearTimeout(toastTimer.current)
      engine.dispose()
    }
  }, [engine])

  // Track last day theme for quick day/night toggle
  useEffect(() => {
    if (prefs.theme !== 'night') lastDayTheme.current = prefs.theme
  }, [prefs.theme])

  // Hardware back button behavior on Android
  useEffect(() => {
    registerBackAction(() => {
      if (draftSel) {
        setDraftSel(null)
        return true
      }
      if (sheet) {
        setSheet('')
        return true
      }
      if (chromeOpen) {
        setChromeOpen(false)
        return true
      }
      onBack()
      return true
    })
  }, [chromeOpen, draftSel, onBack, registerBackAction, sheet])

  const pages = layout?.pages || []
  const pageIndex = pages.length ? locate(pages, anchor) : 0
  const currentPage = pages[pageIndex]
  const currentChapterIdx = findChapterIndex(chapters, anchor.block)
  const currentChapter = chapters[currentChapterIdx] || {
    index: 0,
    title: book.title,
    startBlock: 0,
    endBlock: book.blocks.length,
  }

  const progressRatio = useMemo(() => {
    if (prefs.mode === 'page' && pages.length > 0) {
      return (pageIndex + 1) / pages.length
    }
    if (!book.blocks.length) return 0
    return (anchor.block + 1) / book.blocks.length
  }, [anchor.block, book.blocks.length, pageIndex, pages.length, prefs.mode])

  // Persist reading anchor & progress
  useEffect(() => {
    const token = `${anchor.block}:${anchor.offset}:${prefs.mode}`
    if (savedAnchorRef.current === token) return
    savedAnchorRef.current = token
    onEditJournal(j => ({ ...j, last: anchor }))
    onUpdateProgress(progressRatio, currentChapter.title)
  }, [anchor, currentChapter.title, onEditJournal, onUpdateProgress, prefs.mode, progressRatio])

  // Bookmark check for current position
  const activeBookmark = useMemo(() => {
    if (prefs.mode === 'page' && pages.length) {
      return journal.bookmarks.find(b => locate(pages, b.anchor) === pageIndex)
    }
    return journal.bookmarks.find(b => Math.abs(b.anchor.block - anchor.block) <= 1)
  }, [anchor.block, journal.bookmarks, pageIndex, pages, prefs.mode])

  const toggleBookmark = useCallback(() => {
    if (activeBookmark) {
      onEditJournal(j => ({
        ...j,
        bookmarks: j.bookmarks.filter(b => b.id !== activeBookmark.id),
      }))
      showToast('已移除当前书签')
    } else {
      const targetAnchor = prefs.mode === 'page' && currentPage ? anchorOf(currentPage) : anchor
      const item: BookmarkItem = {
        id: crypto.randomUUID(),
        anchor: targetAnchor,
        chapter: currentChapter.title,
        excerpt: excerptAt(book, targetAnchor),
        createdAt: Date.now(),
      }
      onEditJournal(j => ({
        ...j,
        bookmarks: [item, ...j.bookmarks],
      }))
      showToast('已添加书签')
    }
  }, [activeBookmark, anchor, book, currentChapter.title, currentPage, onEditJournal, prefs.mode, showToast])

  // Navigation helpers
  const jumpToAnchor = useCallback(
    (target: Anchor) => {
      setAnchor(target)
      setSheet('')
      setChromeOpen(false)
      setDraftSel(null)
      if (prefs.mode === 'scroll') {
        requestAnimationFrame(() => {
          const el = scrollContainerRef.current?.querySelector<HTMLElement>(
            `[data-block="${target.block}"]`
          )
          if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
          else scrollContainerRef.current?.scrollTo({ top: 0 })
        })
      }
    },
    [prefs.mode]
  )

  const flipPage = useCallback(
    (delta: -1 | 1) => {
      if (!pages.length) return
      const nextIdx = pageIndex + delta
      if (nextIdx < 0) {
        showToast('已经是第一页了')
        return
      }
      if (nextIdx >= pages.length) {
        showToast('已经是最后一页了')
        return
      }
      setSlideAnim(delta > 0 ? 'next' : 'prev')
      setAnchor(anchorOf(pages[nextIdx]))
      setChromeOpen(false)
      setDraftSel(null)
      void engine.turn(levels).catch(() => {})
      window.setTimeout(() => setSlideAnim(''), 220)
    },
    [engine, levels, pageIndex, pages, showToast]
  )

  const jumpChapter = useCallback(
    (delta: -1 | 1) => {
      const nextIdx = currentChapterIdx + delta
      if (nextIdx < 0) {
        showToast('已经是第一章')
        return
      }
      if (nextIdx >= chapters.length) {
        showToast('已经是最后一章')
        return
      }
      const ch = chapters[nextIdx]
      jumpToAnchor({ block: ch.startBlock, offset: 0 })
      showToast(ch.title)
    },
    [chapters, currentChapterIdx, jumpToAnchor, showToast]
  )

  // Scroll into anchor when switching into scroll mode
  useEffect(() => {
    if (prefs.mode !== 'scroll') return
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (!container) return
      const el = container.querySelector<HTMLElement>(`[data-block="${anchor.block}"]`)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, currentChapter.index])

  // Track reading position during vertical scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const topEdge = container.getBoundingClientRect().top + 48
    const nodes = container.querySelectorAll<HTMLElement>('[data-block]')
    for (const el of nodes) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom >= topEdge) {
        const block = Number(el.dataset.block)
        if (!Number.isNaN(block) && block !== anchor.block) {
          setAnchor({ block, offset: 0 })
        }
        break
      }
    }
  }, [anchor.block])

  // Long-press paragraph selection for touch-friendly annotation
  const triggerParagraphSelection = useCallback(
    (blockEl: HTMLElement) => {
      const blockIdx = Number(blockEl.dataset.block)
      const block = book.blocks[blockIdx]
      if (!block || block.tag === 'img' || !block.text.trim()) return
      const from = Number(blockEl.dataset.from || '0')
      const text = blockEl.textContent || block.text.slice(from)
      const to = Math.min(block.text.length, from + text.length)
      longPressFired.current = true
      setChromeOpen(false)
      setDraftSel({
        start: { block: blockIdx, offset: from },
        end: { block: blockIdx, offset: to },
        quote: block.text.slice(from, to),
        chapter: block.chapter,
      })
      if (navigator.vibrate) navigator.vibrate(15)
    },
    [book.blocks]
  )

  // Capture native text selection if user dragged selection handles
  const captureTextSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    const start = endpointFromNode(range.startContainer, range.startOffset)
    const end = endpointFromNode(range.endContainer, range.endOffset)
    if (!start || !end || compare(start, end) >= 0) return false
    const quote = book.blocks
      .slice(start.block, end.block + 1)
      .map((b, i) =>
        b.tag === 'img'
          ? ''
          : b.text.slice(i === 0 ? start.offset : 0, start.block + i === end.block ? end.offset : undefined)
      )
      .join('\n')
      .trim()
    if (!quote) return false
    setChromeOpen(false)
    setDraftSel({
      start,
      end,
      quote,
      chapter: book.blocks[start.block]?.chapter || currentChapter.title,
    })
    return true
  }, [book.blocks, currentChapter.title])

  // Unified pointer handlers for Page Mode (tap zones + swipe + long press)
  const onPagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sheet || e.button > 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('[data-note-id]')) return
    const blockEl = target?.closest<HTMLElement>('[data-block]') || null
    longPressFired.current = false
    pointerStart.current = { x: e.clientX, y: e.clientY, time: Date.now(), blockEl }
    if (blockEl) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = window.setTimeout(() => {
        if (pointerStart.current) triggerParagraphSelection(blockEl)
      }, 420)
    }
  }

  const onPagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      window.clearTimeout(longPressTimer.current)
    }
    if (!longPressFired.current && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      setDragging(true)
      setDragX(Math.max(-180, Math.min(180, dx)))
    }
  }

  const onPagePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    window.clearTimeout(longPressTimer.current)
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return

    if (longPressFired.current) {
      longPressFired.current = false
      setDragging(false)
      setDragX(0)
      return
    }

    if (captureTextSelection()) {
      setDragging(false)
      setDragX(0)
      return
    }

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dt = Date.now() - start.time

    if (dragging) {
      setDragging(false)
      setDragX(0)
      if (dx < -48) flipPage(1)
      else if (dx > 48) flipPage(-1)
      return
    }

    // Tap detection
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 350) {
      if (draftSel) {
        setDraftSel(null)
        return
      }
      if (chromeOpen) {
        setChromeOpen(false)
        return
      }
      const ratio = e.clientX / window.innerWidth
      if (ratio < 0.3) flipPage(-1)
      else if (ratio > 0.7) flipPage(1)
      else setChromeOpen(true)
    }
  }

  // Pointer handlers for Scroll Mode (tap to toggle chrome + long-press to annotate)
  const onScrollPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sheet || e.button > 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button, [data-note-id]')) return
    const blockEl = target?.closest<HTMLElement>('[data-block]') || null
    longPressFired.current = false
    pointerStart.current = { x: e.clientX, y: e.clientY, time: Date.now(), blockEl }
    if (blockEl) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = window.setTimeout(() => {
        if (pointerStart.current) triggerParagraphSelection(blockEl)
      }, 420)
    }
  }

  const onScrollPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    if (!start) return
    if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) {
      window.clearTimeout(longPressTimer.current)
    }
  }

  const onScrollPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    window.clearTimeout(longPressTimer.current)
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    if (captureTextSelection()) return
    const dx = Math.abs(e.clientX - start.x)
    const dy = Math.abs(e.clientY - start.y)
    if (dx < 10 && dy < 10 && Date.now() - start.time < 320) {
      if (draftSel) {
        setDraftSel(null)
        return
      }
      setChromeOpen(v => !v)
    }
  }

  // Save quick highlight / underline
  const saveQuickNote = (type: NoteStyle) => {
    if (!draftSel) return
    const note: Note = {
      id: crypto.randomUUID(),
      start: draftSel.start,
      end: draftSel.end,
      type,
      quote: draftSel.quote,
      message: '',
      chapter: draftSel.chapter,
      createdAt: Date.now(),
    }
    onEditJournal(j => ({ ...j, notes: [note, ...j.notes] }))
    setDraftSel(null)
    window.getSelection()?.removeAllRanges()
    showToast(type === 'mark' ? '已高亮标记' : '已添加下划线')
  }

  const openNoteEditorForSelection = () => {
    if (!draftSel) return
    setEditingNoteId(null)
    setNoteStyle('mark')
    setNoteText('')
    setSheet('note-editor')
  }

  const openNoteEditorForExisting = useCallback(
    (noteId: string) => {
      const existing = journal.notes.find(n => n.id === noteId)
      if (!existing) return
      setDraftSel({
        start: existing.start,
        end: existing.end,
        quote: existing.quote,
        chapter: existing.chapter,
      })
      setEditingNoteId(existing.id)
      setNoteStyle(existing.type)
      setNoteText(existing.message)
      setChromeOpen(false)
      setSheet('note-editor')
    },
    [journal.notes]
  )

  const commitNoteEditor = () => {
    if (!draftSel) return
    if (editingNoteId) {
      onEditJournal(j => ({
        ...j,
        notes: j.notes.map(n =>
          n.id === editingNoteId ? { ...n, type: noteStyle, message: noteText.trim() } : n
        ),
      }))
      showToast('批注已更新')
    } else {
      const note: Note = {
        id: crypto.randomUUID(),
        start: draftSel.start,
        end: draftSel.end,
        type: noteStyle,
        quote: draftSel.quote,
        message: noteText.trim(),
        chapter: draftSel.chapter,
        createdAt: Date.now(),
      }
      onEditJournal(j => ({ ...j, notes: [note, ...j.notes] }))
      showToast('批注已保存')
    }
    setSheet('')
    setDraftSel(null)
    setEditingNoteId(null)
    window.getSelection()?.removeAllRanges()
  }

  const deleteEditingNote = () => {
    if (!editingNoteId) return
    onEditJournal(j => ({ ...j, notes: j.notes.filter(n => n.id !== editingNoteId) }))
    setSheet('')
    setDraftSel(null)
    setEditingNoteId(null)
    showToast('已删除批注')
  }

  const updateMix = (next: Levels) => {
    mixTouched.current = true
    setLevels(next)
    void engine.activate(next).catch(() => {})
    void saveMix(next).catch(() => {})
  }

  const readerStyle = {
    '--reader-size': prefs.fontSize + 'px',
    '--reader-lh': String(prefs.lineHeight),
  } as CSSProperties

  return (
    <div
      className="m-reader-root"
      data-theme={prefs.theme}
      data-font={prefs.font}
      style={readerStyle}
    >
      {/* Reading Surface */}
      {prefs.mode === 'page' ? (
        <div
          className="m-page-viewport"
          onPointerDown={onPagePointerDown}
          onPointerMove={onPagePointerMove}
          onPointerUp={onPagePointerUp}
          onPointerCancel={() => {
            window.clearTimeout(longPressTimer.current)
            pointerStart.current = null
            setDragging(false)
            setDragX(0)
          }}
        >
          {paginating || !pages.length ? (
            <div className="m-paginating-state" role="status">
              正在智能排版…
            </div>
          ) : (
            <div
              className={
                'm-page-track' +
                (dragging ? ' is-dragging' : '') +
                (slideAnim ? ' anim-' + slideAnim : '')
              }
              style={{ transform: `translate3d(${dragX}px, 0, 0)` }}
            >
              <PageContent
                book={book}
                page={currentPage}
                notes={journal.notes}
                pageIndex={pageIndex}
                totalPages={pages.length}
                clockText={clockText}
                onTapNote={openNoteEditorForExisting}
              />
            </div>
          )}
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="m-scroll-viewport"
          onScroll={handleScroll}
          onPointerDown={onScrollPointerDown}
          onPointerMove={onScrollPointerMove}
          onPointerUp={onScrollPointerUp}
        >
          <div className="m-scroll-chapter-bar">
            <span>{currentChapter.title}</span>
            <small>
              第 {currentChapterIdx + 1} / {chapters.length} 章
            </small>
          </div>

          {currentChapterIdx > 0 && (
            <button
              type="button"
              className="m-chapter-nav-btn"
              onClick={() => jumpChapter(-1)}
            >
              <ChevronLeft size={16} />
              <span>上一章：{chapters[currentChapterIdx - 1].title}</span>
            </button>
          )}

          <article className="m-scroll-article">
            {book.blocks
              .slice(currentChapter.startBlock, currentChapter.endBlock)
              .map((block, offsetIdx) => {
                const blockIdx = currentChapter.startBlock + offsetIdx
                const part: Part = {
                  block: blockIdx,
                  from: 0,
                  to: block.tag === 'img' ? 1 : block.text.length,
                }
                return (
                  <AnnotatedBlock
                    key={blockIdx}
                    book={book}
                    part={part}
                    notes={journal.notes}
                    onTapNote={openNoteEditorForExisting}
                  />
                )
              })}
          </article>

          <div className="m-scroll-chapter-end">
            {currentChapterIdx + 1 < chapters.length ? (
              <button
                type="button"
                className="m-next-chapter-card"
                onClick={() => jumpChapter(1)}
              >
                <div>
                  <small>继续阅读下一章</small>
                  <strong>{chapters[currentChapterIdx + 1].title}</strong>
                </div>
                <ChevronRight size={20} />
              </button>
            ) : (
              <div className="m-book-end-note">已读至全书末尾</div>
            )}
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toast && (
        <div className="m-toast" role="status">
          {toast}
        </div>
      )}

      {/* Quick Annotation Action Bar (triggered by long-press paragraph or text selection) */}
      {draftSel && sheet !== 'note-editor' && (
        <div className="m-annot-bar" role="toolbar" aria-label="段落批注工具栏">
          <button type="button" onClick={() => saveQuickNote('mark')}>
            <Highlighter size={16} />
            <span>高亮</span>
          </button>
          <button type="button" onClick={() => saveQuickNote('line')}>
            <Underline size={16} />
            <span>划线</span>
          </button>
          <button type="button" onClick={openNoteEditorForSelection}>
            <MessageSquarePlus size={16} />
            <span>写批注</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(draftSel.quote).catch(() => {})
              setDraftSel(null)
              showToast('已复制文本')
            }}
          >
            <Copy size={16} />
            <span>复制</span>
          </button>
          <button
            type="button"
            aria-label="取消选择"
            onClick={() => {
              setDraftSel(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Floating Top Chrome */}
      <header className={'m-chrome-top' + (chromeOpen ? ' is-open' : '')}>
        <button type="button" className="m-chrome-btn" aria-label="返回书架" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="m-chrome-title">
          <strong>{book.title}</strong>
          <span>{currentChapter.title}</span>
        </div>
        <button
          type="button"
          className={'m-chrome-btn' + (activeBookmark ? ' is-active' : '')}
          aria-label={activeBookmark ? '取消书签' : '添加书签'}
          aria-pressed={Boolean(activeBookmark)}
          onClick={toggleBookmark}
        >
          <Bookmark size={20} fill={activeBookmark ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="m-chrome-btn"
          aria-label="声景白噪音"
          onClick={() => {
            setChromeOpen(false)
            setSheet('sound')
          }}
        >
          <Headphones size={20} />
        </button>
      </header>

      {/* Floating Bottom Chrome */}
      <footer className={'m-chrome-bottom' + (chromeOpen ? ' is-open' : '')}>
        <div className="m-progress-scrubber">
          <button type="button" onClick={() => jumpChapter(-1)}>
            上一章
          </button>
          <input
            type="range"
            aria-label="阅读进度"
            min={0}
            max={prefs.mode === 'page' && pages.length ? pages.length - 1 : Math.max(0, chapters.length - 1)}
            value={prefs.mode === 'page' && pages.length ? pageIndex : currentChapterIdx}
            onChange={e => {
              const val = Number(e.target.value)
              if (prefs.mode === 'page' && pages.length) {
                setAnchor(anchorOf(pages[val]))
              } else if (chapters[val]) {
                jumpToAnchor({ block: chapters[val].startBlock, offset: 0 })
              }
            }}
          />
          <button type="button" onClick={() => jumpChapter(1)}>
            下一章
          </button>
        </div>

        <nav className="m-chrome-tabs" aria-label="阅读工具">
          <button
            type="button"
            onClick={() => {
              setChromeOpen(false)
              setDrawerTab('toc')
              setSheet('drawer')
            }}
          >
            <List size={20} />
            <span>目录</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const nextTheme = prefs.theme === 'night' ? lastDayTheme.current : 'night'
              onChangePrefs({ ...prefs, theme: nextTheme })
            }}
          >
            {prefs.theme === 'night' ? <Sun size={20} /> : <Moon size={20} />}
            <span>{prefs.theme === 'night' ? '日间' : '夜间'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setChromeOpen(false)
              setSheet('settings')
            }}
          >
            <Settings2 size={20} />
            <span>设置</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setChromeOpen(false)
              setDrawerTab('notes')
              setSheet('drawer')
            }}
          >
            <Bookmark size={20} />
            <span>书签笔记</span>
          </button>
        </nav>
      </footer>

      {/* Bottom Sheet: Unified Drawer (目录 / 书签 / 笔记) */}
      {sheet === 'drawer' && (
        <div className="m-sheet-backdrop" onClick={() => setSheet('')}>
          <aside
            className="m-bottom-sheet m-drawer-sheet"
            role="dialog"
            aria-label="目录与书签笔记"
            onClick={e => e.stopPropagation()}
          >
            <div className="m-sheet-handle" />
            <div className="m-drawer-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'toc'}
                className={drawerTab === 'toc' ? 'is-active' : ''}
                onClick={() => setDrawerTab('toc')}
              >
                目录 ({chapters.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'bookmarks'}
                className={drawerTab === 'bookmarks' ? 'is-active' : ''}
                onClick={() => setDrawerTab('bookmarks')}
              >
                书签 ({journal.bookmarks.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'notes'}
                className={drawerTab === 'notes' ? 'is-active' : ''}
                onClick={() => setDrawerTab('notes')}
              >
                笔记 ({journal.notes.length})
              </button>
            </div>

            <div className="m-drawer-body">
              {drawerTab === 'toc' && (
                <div className="m-toc-list">
                  {chapters.map(ch => (
                    <button
                      key={ch.index}
                      type="button"
                      className={'m-toc-item' + (ch.index === currentChapterIdx ? ' is-current' : '')}
                      onClick={() => jumpToAnchor({ block: ch.startBlock, offset: 0 })}
                    >
                      <span>{ch.title}</span>
                      {ch.index === currentChapterIdx && <small>当前</small>}
                    </button>
                  ))}
                </div>
              )}

              {drawerTab === 'bookmarks' &&
                (journal.bookmarks.length ? (
                  <div className="m-card-list">
                    {journal.bookmarks.map(bm => (
                      <div key={bm.id} className="m-item-card">
                        <button
                          type="button"
                          className="m-item-card-main"
                          onClick={() => jumpToAnchor(bm.anchor)}
                        >
                          <div className="m-item-card-head">
                            <strong>{bm.chapter}</strong>
                            <small>{formatTime(bm.createdAt)}</small>
                          </div>
                          <p>{bm.excerpt || '书签位置'}</p>
                        </button>
                        <button
                          type="button"
                          className="m-item-del"
                          aria-label="删除书签"
                          onClick={() =>
                            onEditJournal(j => ({
                              ...j,
                              bookmarks: j.bookmarks.filter(x => x.id !== bm.id),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-sheet-empty">点击顶部书签图标，即可快速收藏当前阅读位置。</p>
                ))}

              {drawerTab === 'notes' &&
                (journal.notes.length ? (
                  <div className="m-card-list">
                    {journal.notes.map(n => (
                      <div key={n.id} className="m-item-card">
                        <button
                          type="button"
                          className="m-item-card-main"
                          onClick={() => jumpToAnchor(n.start)}
                        >
                          <div className="m-item-card-head">
                            <span className={'m-note-badge ' + n.type}>
                              {n.type === 'mark' ? '高亮' : '划线'}
                            </span>
                            <small>{formatTime(n.createdAt)}</small>
                          </div>
                          <blockquote className="m-note-quote-card">{n.quote}</blockquote>
                          {n.message && <p className="m-note-msg">{n.message}</p>}
                        </button>
                        <button
                          type="button"
                          className="m-item-del"
                          aria-label="删除笔记"
                          onClick={() =>
                            onEditJournal(j => ({
                              ...j,
                              notes: j.notes.filter(x => x.id !== n.id),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-sheet-empty">长按任意段落或选中文字，即可高亮、划线或写下批注。</p>
                ))}
            </div>
          </aside>
        </div>
      )}

      {/* Bottom Sheet: Reading Settings */}
      {sheet === 'settings' && (
        <div className="m-sheet-backdrop" onClick={() => setSheet('')}>
          <aside
            className="m-bottom-sheet m-settings-sheet"
            role="dialog"
            aria-label="阅读设置"
            onClick={e => e.stopPropagation()}
          >
            <div className="m-sheet-handle" />
            <div className="m-setting-row">
              <span className="m-setting-label">翻页方式</span>
              <div className="m-segmented-2">
                <button
                  type="button"
                  className={prefs.mode === 'page' ? 'is-active' : ''}
                  onClick={() => onChangePrefs({ ...prefs, mode: 'page' })}
                >
                  <BookOpen size={15} />
                  <span>单页翻页</span>
                </button>
                <button
                  type="button"
                  className={prefs.mode === 'scroll' ? 'is-active' : ''}
                  onClick={() => onChangePrefs({ ...prefs, mode: 'scroll' })}
                >
                  <ScrollText size={15} />
                  <span>上下滚动</span>
                </button>
              </div>
            </div>

            <div className="m-setting-row">
              <span className="m-setting-label">字号</span>
              <div className="m-stepper">
                <button
                  type="button"
                  aria-label="减小字号"
                  disabled={prefs.fontSize <= 14}
                  onClick={() =>
                    onChangePrefs({ ...prefs, fontSize: Math.max(14, prefs.fontSize - 1) })
                  }
                >
                  A-
                </button>
                <span>{prefs.fontSize}</span>
                <button
                  type="button"
                  aria-label="增大字号"
                  disabled={prefs.fontSize >= 28}
                  onClick={() =>
                    onChangePrefs({ ...prefs, fontSize: Math.min(28, prefs.fontSize + 1) })
                  }
                >
                  A+
                </button>
              </div>
            </div>

            <div className="m-setting-row">
              <span className="m-setting-label">行距</span>
              <div className="m-pill-group">
                {lineHeights.map(lh => (
                  <button
                    key={lh.label}
                    type="button"
                    className={Math.abs(prefs.lineHeight - lh.value) < 0.05 ? 'is-active' : ''}
                    onClick={() => onChangePrefs({ ...prefs, lineHeight: lh.value })}
                  >
                    {lh.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="m-setting-row">
              <span className="m-setting-label">字体</span>
              <div className="m-pill-group">
                {fontChoices.map(fc => (
                  <button
                    key={fc.id}
                    type="button"
                    className={prefs.font === fc.id ? 'is-active' : ''}
                    onClick={() => onChangePrefs({ ...prefs, font: fc.id })}
                  >
                    {fc.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="m-setting-row">
              <span className="m-setting-label">纸张</span>
              <div className="m-swatch-row">
                {themes.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={t.label}
                    className={'m-swatch' + (prefs.theme === t.id ? ' is-active' : '')}
                    style={{ backgroundColor: t.swatch }}
                    onClick={() => onChangePrefs({ ...prefs, theme: t.id })}
                  >
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Bottom Sheet: Soundscape */}
      {sheet === 'sound' && (
        <div className="m-sheet-backdrop" onClick={() => setSheet('')}>
          <aside
            className="m-bottom-sheet m-sound-sheet"
            role="dialog"
            aria-label="声景白噪音"
            onClick={e => e.stopPropagation()}
          >
            <div className="m-sheet-handle" />
            <div className="m-sheet-header-row">
              <h3>阅读声景</h3>
              <button
                type="button"
                className={'m-mute-pill' + (levels.muted ? ' is-muted' : '')}
                onClick={() => updateMix({ ...levels, muted: !levels.muted })}
              >
                {levels.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                <span>{levels.muted ? '已静音' : '开启中'}</span>
              </button>
            </div>

            <div className="m-sound-control">
              <label>
                <span>雨声</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={levels.rain}
                  onChange={e => updateMix({ ...levels, rain: Number(e.target.value) })}
                />
              </label>
              <select
                aria-label="雨声音效"
                value={levels.rainSound}
                onChange={e => updateMix({ ...levels, rainSound: e.target.value })}
              >
                {rainOptions.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="m-sound-control">
              <label>
                <span>棕噪音</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={levels.brown}
                  onChange={e => updateMix({ ...levels, brown: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="m-sound-control">
              <label>
                <span>翻页声</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={levels.turn}
                  onChange={e => updateMix({ ...levels, turn: Number(e.target.value) })}
                />
              </label>
              <select
                aria-label="翻页音效"
                value={levels.turnSound}
                onChange={e => updateMix({ ...levels, turnSound: e.target.value })}
              >
                {turnOptions.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>
        </div>
      )}

      {/* Bottom Sheet: Annotation / Note Editor */}
      {sheet === 'note-editor' && draftSel && (
        <div
          className="m-sheet-backdrop"
          onClick={() => {
            setSheet('')
            setEditingNoteId(null)
            setDraftSel(null)
          }}
        >
          <aside
            className="m-bottom-sheet m-note-editor-sheet"
            role="dialog"
            aria-label="编辑批注"
            onClick={e => e.stopPropagation()}
          >
            <div className="m-sheet-handle" />
            <div className="m-sheet-header-row">
              <h3>{editingNoteId ? '查看 / 编辑批注' : '写下批注'}</h3>
              {editingNoteId && (
                <button
                  type="button"
                  className="m-danger-text-btn"
                  onClick={deleteEditingNote}
                >
                  <Trash2 size={15} />
                  <span>删除</span>
                </button>
              )}
            </div>

            <blockquote className="m-editor-quote">{draftSel.quote}</blockquote>

            <div className="m-editor-style-row">
              <button
                type="button"
                className={noteStyle === 'mark' ? 'is-active' : ''}
                onClick={() => setNoteStyle('mark')}
              >
                <Highlighter size={15} />
                <span>黄色高亮</span>
              </button>
              <button
                type="button"
                className={noteStyle === 'line' ? 'is-active' : ''}
                onClick={() => setNoteStyle('line')}
              >
                <Underline size={15} />
                <span>优雅下划线</span>
              </button>
            </div>

            <textarea
              rows={4}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="记下此刻的想法（可留空仅做标记）…"
              aria-label="批注内容"
            />

            <div className="m-editor-footer">
              <button
                type="button"
                className="m-secondary-btn"
                onClick={() => {
                  setSheet('')
                  setEditingNoteId(null)
                  setDraftSel(null)
                }}
              >
                取消
              </button>
              <button type="button" className="m-primary-btn" onClick={commitNoteEditor}>
                保存批注
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

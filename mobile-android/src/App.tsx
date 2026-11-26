import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultPrefs, type Book, type MobileJournal, type MobileLayout, type MobilePrefs } from './model'
import {
  deleteBook,
  emptyJournal,
  getBook,
  getCachedLayout,
  getJournal,
  getPrefs,
  listBooks,
  saveBook,
  saveCachedLayout,
  savePrefs,
  togglePinBook,
  updateBookProgress,
  updateJournal,
  type BookMeta,
} from './storage'
import { parseEpub } from './utils/epub'
import { measureMobileMetrics, mobileLayoutKey, paginateMobile } from './utils/mobilePaginator'
import { registerAndroidBackHandler, syncAndroidStatusBar } from './utils/nativeAndroid'
import { MobileBookshelf } from './components/MobileBookshelf'
import { MobileReader } from './components/MobileReader'

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function App() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [prefs, setPrefs] = useState<MobilePrefs>(defaultPrefs)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [activeId, setActiveId] = useState('')
  const [activeBook, setActiveBook] = useState<Book>()
  const [journal, setJournal] = useState<MobileJournal>(emptyJournal)
  const [metrics, setMetrics] = useState(measureMobileMetrics)
  const [layout, setLayout] = useState<MobileLayout>()
  const [paginating, setPaginating] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const importingRef = useRef(false)
  const backActionRef = useRef<() => boolean>(() => false)

  // Initial load of independent Android bookshelf & preferences
  useEffect(() => {
    Promise.all([listBooks(), getPrefs()])
      .then(([items, p]) => {
        setBooks(items)
        setPrefs(p)
        setReady(true)
      })
      .catch(e => {
        setError(describe(e))
        setReady(true)
      })
  }, [])

  // Sync Android StatusBar & root dataset with theme/font
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme
    document.documentElement.dataset.font = prefs.font
    void syncAndroidStatusBar(prefs.theme)
  }, [prefs.theme, prefs.font])

  // Track mobile viewport changes (orientation / resize)
  useEffect(() => {
    const onResize = () => setMetrics(measureMobileMetrics())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Android hardware back button
  useEffect(() => {
    return registerAndroidBackHandler(() => backActionRef.current())
  }, [])

  // Load book + journal when opening a book
  useEffect(() => {
    if (!activeId) {
      setActiveBook(undefined)
      setLayout(undefined)
      return
    }
    let live = true
    Promise.all([getBook(activeId), getJournal(activeId)])
      .then(([b, j]) => {
        if (!live) return
        if (!b) {
          setError('找不到该书籍正文，请重新导入')
          setActiveId('')
          return
        }
        setJournal(j)
        setActiveBook(b)
      })
      .catch(e => {
        if (live) {
          setError(describe(e))
          setActiveId('')
        }
      })
    return () => {
      live = false
    }
  }, [activeId])

  // Paginate active book when in page mode (or cache layout for instant switching)
  const layoutKey = mobileLayoutKey(metrics, prefs)
  useEffect(() => {
    if (!activeBook) return
    const abort = new AbortController()
    const run = async () => {
      setPaginating(true)
      const cached = await getCachedLayout(activeBook.id)
      if (cached?.key === layoutKey) {
        if (!abort.signal.aborted) {
          setLayout(cached)
          setPaginating(false)
        }
        return
      }
      if (prefs.font === 'kai') {
        await document.fonts?.load(`${prefs.fontSize}px "LXGW WenKai Screen"`).catch(() => {})
      } else if (prefs.font === 'serif') {
        await document.fonts?.load(`${prefs.fontSize}px "Noto Serif SC"`).catch(() => {})
      }
      const result = await paginateMobile(activeBook, metrics, prefs, abort.signal)
      if (abort.signal.aborted) return
      setLayout(result)
      setPaginating(false)
      await saveCachedLayout(activeBook.id, result).catch(() => {})
    }
    void run().catch(e => {
      if (!abort.signal.aborted) {
        setPaginating(false)
        setError('排版失败：' + describe(e))
      }
    })
    return () => abort.abort()
  }, [activeBook, layoutKey, metrics, prefs.font, prefs.fontSize, prefs.lineHeight])

  const handleImportFile = async (file?: File) => {
    if (!file || importingRef.current) return
    if (!/\.epub$/i.test(file.name)) {
      setError('请选择 .epub 格式的电子书文件')
      return
    }
    importingRef.current = true
    setBusy(true)
    setError('')
    try {
      const parsed = await parseEpub(file)
      await saveBook(parsed)
      const updated = await listBooks()
      setBooks(updated)
      setActiveId(parsed.id)
    } catch (e) {
      setError('导入失败：' + describe(e))
    } finally {
      importingRef.current = false
      setBusy(false)
    }
  }

  const handleChangePrefs = useCallback((next: MobilePrefs) => {
    setPrefs(next)
    void savePrefs(next).catch(() => {})
  }, [])

  const handleEditJournal = useCallback(
    (fn: (j: MobileJournal) => MobileJournal) => {
      if (!activeId) return
      setJournal(fn)
      void updateJournal(activeId, fn).catch(e => setError('保存阅读记录失败：' + describe(e)))
    },
    [activeId]
  )

  const handleUpdateProgress = useCallback(
    (progress: number, chapterTitle: string) => {
      if (!activeId) return
      void updateBookProgress(activeId, progress, chapterTitle)
        .then(() => listBooks().then(setBooks))
        .catch(() => {})
    },
    [activeId]
  )

  const handleBackToShelf = useCallback(() => {
    setActiveId('')
    void listBooks().then(setBooks).catch(() => {})
  }, [])

  const handleTogglePin = async (id: string) => {
    await togglePinBook(id)
    setBooks(await listBooks())
  }

  const handleDeleteBook = async (id: string) => {
    await deleteBook(id)
    setBooks(await listBooks())
  }

  // Register default shelf back action (return false -> exit app)
  useEffect(() => {
    if (!activeId) {
      backActionRef.current = () => false
    }
  }, [activeId])

  return (
    <main className="m-app" data-theme={prefs.theme} data-font={prefs.font}>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        aria-label="选择 EPUB 文件"
        accept=".epub,application/epub+zip"
        onChange={e => {
          void handleImportFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {error && (
        <div className="m-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}

      {activeId && activeBook ? (
        <MobileReader
          key={activeBook.id}
          book={activeBook}
          layout={layout?.key === layoutKey ? layout : undefined}
          paginating={paginating}
          journal={journal}
          prefs={prefs}
          onChangePrefs={handleChangePrefs}
          onEditJournal={handleEditJournal}
          onUpdateProgress={handleUpdateProgress}
          onBack={handleBackToShelf}
          registerBackAction={fn => {
            backActionRef.current = fn
          }}
        />
      ) : (
        <MobileBookshelf
          books={books}
          ready={ready}
          busy={busy}
          onOpen={id => setActiveId(id)}
          onImport={() => fileInputRef.current?.click()}
          onTogglePin={id => void handleTogglePin(id)}
          onDelete={id => void handleDeleteBook(id)}
        />
      )}
    </main>
  )
}

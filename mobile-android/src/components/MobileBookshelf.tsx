import { useMemo, useState } from 'react'
import {
  BookOpen,
  LayoutGrid,
  List,
  MoreVertical,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { BookMeta } from '../storage'

interface Props {
  books: BookMeta[]
  ready: boolean
  busy: boolean
  onOpen: (id: string) => void
  onImport: () => void
  onTogglePin: (id: string) => void
  onDelete: (id: string) => void
}

export function MobileBookshelf({
  books,
  ready,
  busy,
  onOpen,
  onImport,
  onTogglePin,
  onDelete,
}: Props) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [menuBook, setMenuBook] = useState<BookMeta | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return books
    return books.filter(
      b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
  }, [books, query])

  const recent = useMemo(() => {
    if (!books.length) return undefined
    return [...books].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0]
  }, [books])

  return (
    <div className="m-shelf-screen">
      <header className="m-shelf-header">
        <div className="m-brand">
          <span className="m-brand-icon" aria-hidden="true">
            <BookOpen size={18} strokeWidth={1.8} />
          </span>
          <div>
            <h1>PaperPocket</h1>
            <p>随身书架 · 独立本地存储</p>
          </div>
        </div>
        <div className="m-header-actions">
          <button
            type="button"
            className="m-icon-btn"
            aria-label="搜索书籍"
            onClick={() => {
              setSearching(v => !v)
              if (searching) setQuery('')
            }}
          >
            {searching ? <X size={19} /> : <Search size={19} />}
          </button>
          <button
            type="button"
            className="m-icon-btn"
            aria-label={viewMode === 'grid' ? '切换列表视图' : '切换封面网格'}
            onClick={() => setViewMode(v => (v === 'grid' ? 'list' : 'grid'))}
          >
            {viewMode === 'grid' ? <List size={19} /> : <LayoutGrid size={19} />}
          </button>
          <button
            type="button"
            className="m-import-pill"
            disabled={!ready || busy}
            onClick={onImport}
          >
            <Plus size={16} />
            <span>{busy ? '导入中' : '导入'}</span>
          </button>
        </div>
      </header>

      {searching && (
        <div className="m-search-bar">
          <Search size={16} />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索书名或作者…"
            aria-label="搜索书名或作者"
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </div>
      )}

      <div className="m-shelf-scroll">
        {!books.length ? (
          <section className="m-empty-shelf">
            <div className="m-empty-badge" aria-hidden="true">
              <BookOpen size={40} strokeWidth={1.3} />
            </div>
            <h2>{ready ? '书架还是空的' : '正在加载书架…'}</h2>
            <p>导入本地 EPUB 电子书，享受番茄/起点式单页滑动与上下滚动双模式阅读。</p>
            <button
              type="button"
              className="m-primary-btn"
              disabled={!ready || busy}
              onClick={onImport}
            >
              <Plus size={18} />
              <span>导入第一本 EPUB</span>
            </button>
          </section>
        ) : (
          <>
            {!query && recent && (
              <section className="m-continue-card" aria-label="最近在读">
                <div className="m-continue-body" onClick={() => onOpen(recent.id)}>
                  <div className={'m-mini-cover tone-' + recent.coverTone}>
                    <span className="m-cover-spine" aria-hidden="true" />
                    <span className="m-mini-title">{recent.title}</span>
                  </div>
                  <div className="m-continue-info">
                    <span className="m-continue-kicker">最近在读</span>
                    <h3>{recent.title}</h3>
                    <p className="m-continue-chapter">
                      {recent.chapterTitle || recent.author || '点击继续阅读'}
                    </p>
                    <div className="m-progress-row">
                      <div className="m-progress-track">
                        <span style={{ width: `${Math.round(recent.progress * 100)}%` }} />
                      </div>
                      <small>{Math.round(recent.progress * 100)}%</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="m-continue-btn"
                    onClick={e => {
                      e.stopPropagation()
                      onOpen(recent.id)
                    }}
                  >
                    继续阅读
                  </button>
                </div>
              </section>
            )}

            <div className="m-shelf-section-head">
              <h2>全部藏书 ({filtered.length})</h2>
              <span>{viewMode === 'grid' ? '三列封面' : '列表详情'}</span>
            </div>

            {filtered.length === 0 ? (
              <p className="m-empty-filter">没有找到匹配“{query}”的书籍</p>
            ) : viewMode === 'grid' ? (
              <div className="m-book-grid" role="list">
                {filtered.map(book => {
                  const pct = Math.round(book.progress * 100)
                  return (
                    <article key={book.id} className="m-book-tile" role="listitem">
                      <button
                        type="button"
                        className={'m-book-cover tone-' + book.coverTone}
                        onClick={() => onOpen(book.id)}
                      >
                        <span className="m-cover-spine" aria-hidden="true" />
                        {book.pinned && (
                          <span className="m-pin-tag" aria-label="已置顶">
                            <Pin size={10} />
                          </span>
                        )}
                        <span className="m-cover-title">{book.title}</span>
                        {book.author && <span className="m-cover-author">{book.author}</span>}
                        <span className="m-cover-pct">{pct > 0 ? `${pct}%` : '未读'}</span>
                      </button>
                      <div className="m-tile-meta">
                        <span className="m-tile-name" onClick={() => onOpen(book.id)}>
                          {book.title}
                        </span>
                        <button
                          type="button"
                          className="m-tile-more"
                          aria-label={`管理 ${book.title}`}
                          onClick={() => setMenuBook(book)}
                        >
                          <MoreVertical size={15} />
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="m-book-list" role="list">
                {filtered.map(book => {
                  const pct = Math.round(book.progress * 100)
                  return (
                    <article key={book.id} className="m-book-row" role="listitem">
                      <button
                        type="button"
                        className="m-book-row-main"
                        onClick={() => onOpen(book.id)}
                      >
                        <div className={'m-mini-cover sm tone-' + book.coverTone}>
                          <span className="m-cover-spine" aria-hidden="true" />
                          <span className="m-mini-title">{book.title}</span>
                        </div>
                        <div className="m-row-info">
                          <div className="m-row-title-line">
                            {book.pinned && <Pin size={12} className="m-inline-pin" />}
                            <strong>{book.title}</strong>
                          </div>
                          {book.author && <span className="m-row-author">{book.author}</span>}
                          <small className="m-row-status">
                            {book.chapterTitle || '准备就绪'} · 已读 {pct}%
                          </small>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="m-tile-more"
                        aria-label={`管理 ${book.title}`}
                        onClick={() => setMenuBook(book)}
                      >
                        <MoreVertical size={17} />
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {menuBook && (
        <div className="m-sheet-backdrop" onClick={() => setMenuBook(null)}>
          <div
            className="m-bottom-sheet m-book-actions-sheet"
            role="dialog"
            aria-label="书籍管理"
            onClick={e => e.stopPropagation()}
          >
            <div className="m-sheet-handle" />
            <div className="m-sheet-book-head">
              <strong>{menuBook.title}</strong>
              {menuBook.author && <span>{menuBook.author}</span>}
            </div>
            <button
              type="button"
              className="m-sheet-action"
              onClick={() => {
                onTogglePin(menuBook.id)
                setMenuBook(null)
              }}
            >
              <Pin size={18} />
              <span>{menuBook.pinned ? '取消置顶' : '置顶到书架最前'}</span>
            </button>
            <button
              type="button"
              className="m-sheet-action danger"
              onClick={() => {
                onDelete(menuBook.id)
                setMenuBook(null)
              }}
            >
              <Trash2 size={18} />
              <span>从书架移出（删除本地数据）</span>
            </button>
            <button
              type="button"
              className="m-sheet-cancel"
              onClick={() => setMenuBook(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

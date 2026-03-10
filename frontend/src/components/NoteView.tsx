import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

import type { Segment, VideoNote, LLMProvider } from '../api/types'
import {
    getNotes, generateNote, updateNote, resetNote, activateNote, deleteNote,
    getLLMProviders,
} from '../api/client'
import { useToast } from '../contexts/ToastContext'
import Icons from './ui/Icons'

interface NoteViewProps {
    sourceId: string
    segments: Segment[]
    onSeek: (timeSeconds: number) => void
}

interface TocItem {
    level: number  // 1=h1, 2=h2, 3=h3
    text: string
    id: string
}

/** Parse "hh:mm:ss" or "mm:ss" → seconds */
function parseTimestamp(ts: string): number {
    const parts = ts.split(':').map(Number)
    if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!
    if (parts.length === 2) return (parts[0]! * 60) + parts[1]!
    return 0
}

/** Format date string for version display */
function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString() } catch { return iso }
}

/** Extract TOC items from Markdown content */
function extractToc(content: string): TocItem[] {
    const lines = content.split('\n')
    const items: TocItem[] = []
    let idx = 0
    for (const line of lines) {
        const m = line.match(/^(#{1,3})\s+(.+)/)
        if (m) {
            // Strip inline markdown (bold, timestamp emoji, etc.)
            const rawText = m[2]!.replace(/\*\*/g, '').replace(/⏱\s*[\d:]+/g, '').trim()
            items.push({ level: m[1]!.length, text: rawText, id: `note-h-${idx++}` })
        }
    }
    return items
}

// ---- TOC Sub-component ----
function NoteTOC({ items, activeId, onItemClick }: {
    items: TocItem[]
    activeId: string | null
    onItemClick: (id: string) => void
}) {
    const { t } = useTranslation()
    const [collapsed, setCollapsed] = useState(false)
    if (items.length < 2) return null
    return (
        <div className={`note-toc ${collapsed ? 'note-toc--collapsed' : ''}`}>
            <div className="note-toc-header" onClick={() => setCollapsed(v => !v)}>
                <Icons.List className="w-3 h-3" />
                <span>{t('detail.aiNotes.toc')}</span>
                <Icons.ChevronRight className={`w-3 h-3 ml-auto transition-transform ${collapsed ? '' : 'rotate-90'}`} />
            </div>
            {!collapsed && (
                <ul className="note-toc-list">
                    {items.map(item => (
                        <li key={item.id}
                            className={`note-toc-item note-toc-item--h${item.level} ${activeId === item.id ? 'active' : ''}`}
                            onClick={() => onItemClick(item.id)}
                            title={item.text}
                        >
                            {item.text}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ---- Generate Config Panel ----
function GeneratePanel({
    style, setStyle,
    selectedModelId, setSelectedModelId,
    enableScreenshots, setEnableScreenshots,
    providers,
    onGenerate,
    onCancel,
    isPending,
}: {
    style: string
    setStyle: (s: 'concise' | 'detailed' | 'outline') => void
    selectedModelId: number | ''
    setSelectedModelId: (id: number | '') => void
    enableScreenshots: boolean
    setEnableScreenshots: (v: boolean) => void
    providers: LLMProvider[]
    onGenerate: () => void
    onCancel: () => void
    isPending: boolean
}) {
    const { t } = useTranslation()
    return (
        <div className="note-gen-panel">
            <div className="note-gen-panel-body">
                {/* Style selector */}
                <div className="note-gen-field">
                    <label className="note-gen-label">{t('detail.aiNotes.style')}</label>
                    <div className="note-gen-segmented">
                        {(['concise', 'detailed', 'outline'] as const).map(s => (
                            <button
                                key={s}
                                className={`note-gen-seg-btn ${style === s ? 'active' : ''}`}
                                onClick={() => setStyle(s)}
                            >
                                {t(`detail.aiNotes.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Model selector */}
                <div className="note-gen-field">
                    <label className="note-gen-label">{t('detail.aiNotes.model')}</label>
                    <select
                        className="note-gen-select"
                        value={selectedModelId}
                        onChange={e => setSelectedModelId(e.target.value ? Number(e.target.value) : '')}
                    >
                        <option value="">{t('detail.aiNotes.defaultModel')}</option>
                        {providers.map(p => (
                            <optgroup key={p.id} label={p.name}>
                                {p.models?.map(m => (
                                    <option key={m.id} value={m.id}>{m.model_name}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>

                {/* Screenshots toggle */}
                <div className="note-gen-field">
                    <label className="note-gen-label">{t('detail.aiNotes.screenshots')}</label>
                    <label className="note-gen-checkbox">
                        <input
                            type="checkbox"
                            checked={enableScreenshots}
                            onChange={e => setEnableScreenshots(e.target.checked)}
                        />
                        <span>{t('detail.aiNotes.screenshotsDesc')}</span>
                    </label>
                </div>
            </div>
            <div className="note-gen-panel-footer">
                <button className="note-btn note-btn-secondary" onClick={onCancel}>
                    {t('detail.aiNotes.cancel')}
                </button>
                <button
                    className="note-btn note-btn-primary"
                    onClick={onGenerate}
                    disabled={isPending}
                >
                    ✨ {isPending ? t('detail.aiNotes.generating') : t('detail.aiNotes.startGenerate')}
                </button>
            </div>
        </div>
    )
}

// ---- Main Component ----
export default function NoteView({ sourceId, segments, onSeek }: NoteViewProps) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const queryClient = useQueryClient()
    const contentRef = useRef<HTMLDivElement>(null)

    // UI states
    const [isEditing, setIsEditing] = useState(false)
    const [editContent, setEditContent] = useState('')
    const [style, setStyle] = useState<'concise' | 'detailed' | 'outline'>('detailed')
    const [showVersions, setShowVersions] = useState(false)
    const [showGenPanel, setShowGenPanel] = useState(false)
    const [selectedModelId, setSelectedModelId] = useState<number | ''>('')
    const [enableScreenshots, setEnableScreenshots] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<number | null>(null)
    const [pendingReset, setPendingReset] = useState<boolean>(false)
    const [activeTocId, setActiveTocId] = useState<string | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const qkey = ['notes', sourceId]
    const hasSegments = segments.length > 0

    // Queries
    const { data: notes = [], isLoading } = useQuery<VideoNote[]>({
        queryKey: qkey,
        queryFn: () => getNotes(sourceId),
        enabled: !!sourceId,
    })
    const { data: providers = [] } = useQuery<LLMProvider[]>({
        queryKey: ['llm_providers'],
        queryFn: getLLMProviders,
    })

    const activeNote = notes.find(n => n.is_active) ?? notes[0] ?? null

    // Auto-select active model when providers load
    useEffect(() => {
        if (selectedModelId === '' && providers.length > 0) {
            const models = providers.flatMap(p => p.models ?? [])
            const active = models.find(m => m.is_active)
            if (active) setSelectedModelId(active.id)
        }
    }, [providers, selectedModelId])

    // Sync edit buffer
    useEffect(() => {
        if (!isEditing && activeNote) setEditContent(activeNote.content)
    }, [activeNote?.id, isEditing])

    // TOC extraction
    const tocItems = useMemo(() =>
        activeNote ? extractToc(activeNote.content) : []
        , [activeNote?.id, activeNote?.content])

    // IntersectionObserver for TOC active highlight
    useEffect(() => {
        if (!contentRef.current || tocItems.length === 0 || isEditing) return
        const observers: IntersectionObserver[] = []
        const visible = new Map<string, boolean>()

        tocItems.forEach(item => {
            const el = document.getElementById(item.id)
            if (!el) return
            const obs = new IntersectionObserver(
                ([entry]) => {
                    visible.set(item.id, !!entry?.isIntersecting)
                    // Pick first visible item
                    const first = tocItems.find(t => visible.get(t.id))
                    if (first) setActiveTocId(first.id)
                },
                { threshold: 0.1, rootMargin: '-10% 0px -80% 0px' }
            )
            obs.observe(el)
            observers.push(obs)
        })

        return () => observers.forEach(o => o.disconnect())
    }, [tocItems, isEditing, activeNote?.id])

    // Mutations
    const generateMut = useMutation({
        mutationFn: () => generateNote(sourceId, {
            style,
            llmModelId: selectedModelId || undefined,
            enableScreenshots,
        }),
        onSuccess: () => {
            showToast('success', t('detail.aiNotes.generatedSuccess'))
            setShowGenPanel(false)
            const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: qkey }), 2000)
            setTimeout(() => clearInterval(poll), 30000)
        },
        onError: () => showToast('error', t('detail.aiNotes.generateFailed')),
    })

    const saveMut = useMutation({
        mutationFn: (content: string) => updateNote(activeNote!.id, content),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: qkey }); setIsEditing(false) },
        onError: () => showToast('error', t('detail.aiNotes.saveFailed')),
    })

    const resetMut = useMutation({
        mutationFn: () => resetNote(activeNote!.id),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: qkey }); setPendingReset(false) },
    })

    const activateMut = useMutation({
        mutationFn: (noteId: number) => activateNote(noteId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: qkey }),
    })

    const deleteMut = useMutation({
        mutationFn: (noteId: number) => deleteNote(noteId),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: qkey }); setPendingDelete(null) },
        onError: () => showToast('error', t('detail.aiNotes.deleteFailed')),
    })

    // Handlers
    const handleStartEdit = () => {
        setEditContent(activeNote?.content ?? '')
        setIsEditing(true)
        setShowGenPanel(false)
        setTimeout(() => textareaRef.current?.focus(), 50)
    }
    const handleSave = () => { if (activeNote) saveMut.mutate(editContent) }
    const handleCancelEdit = () => { setIsEditing(false); setEditContent(activeNote?.content ?? '') }
    const handleExport = async () => {
        if (!activeNote) return
        try {
            const res = await fetch(`/api/notes/${activeNote.id}/export`)
            if (!res.ok) throw new Error('Export failed')
            const disposition = res.headers.get('Content-Disposition') || ''
            const nameMatch = disposition.match(/filename="([^"]+)"/) ||
                disposition.match(/filename=([^;]+)/)
            const filename = (nameMatch?.[1] ?? `note-${sourceId}.md`).trim()
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = filename; a.click()
            URL.revokeObjectURL(url)
        } catch {
            showToast('error', t('detail.aiNotes.exportFailed'))
        }
    }
    const handleTocClick = (id: string) => {
        const el = document.getElementById(id)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave() }
        if (e.key === 'Escape') handleCancelEdit()
    }, [editContent, activeNote])

    // Custom Markdown components — inject IDs on headings and clickable ⏱ timestamps
    let headingIdx = 0
    const tocId = () => `note-h-${headingIdx++}`

    function renderTimestamps(children: React.ReactNode): React.ReactNode {
        if (typeof children === 'string') {
            const parts = children.split(/(⏱\s*\d{1,2}:\d{2}(?::\d{2})?)/g)
            if (parts.length === 1) return children
            return parts.map((part, i) => {
                const m = part.match(/⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
                if (m) {
                    const secs = parseTimestamp(m[1]!)
                    return (
                        <button key={i} onClick={() => onSeek(secs)}
                            className="note-ts-btn" title={`Jump to ${m[1]}`}>
                            {part}
                        </button>
                    )
                }
                return part
            })
        }
        if (Array.isArray(children)) {
            return children.map((child, i) =>
                typeof child === 'string' ? <span key={i}>{renderTimestamps(child)}</span> : child
            )
        }
        return children
    }

    const makeHeading = (Tag: 'h1' | 'h2' | 'h3') =>
        ({ children, ...props }: any) => {
            const id = tocId()
            return <Tag id={id} {...props}>{renderTimestamps(children)}</Tag>
        }

    const markdownComponents = {
        h1: makeHeading('h1'),
        h2: makeHeading('h2'),
        h3: makeHeading('h3'),
        p: ({ children, ...props }: any) => <p {...props}>{renderTimestamps(children)}</p>,
        li: ({ children, ...props }: any) => <li {...props}>{renderTimestamps(children)}</li>,
        img: ({ src, alt, ...props }: any) => {
            const isScreenshot = src && src.includes('/api/note-screenshots/')
            return (
                <img
                    src={src}
                    alt={alt}
                    className={isScreenshot ? 'note-screenshot' : undefined}
                    loading="lazy"
                    {...props}
                />
            )
        },
    }

    // Reset heading counter before each render
    headingIdx = 0

    // ---- Render ----

    if (!hasSegments) {
        return (
            <div className="note-view-empty">
                <span className="note-empty-icon">📝</span>
                <p className="note-empty-title">{t('detail.aiNotes.noTranscription')}</p>
            </div>
        )
    }

    if (isLoading) {
        return <div className="note-view-loading">{t('common.loading')}</div>
    }

    return (
        <div className={`note-view${isEditing ? ' note-view--editing' : ''}`}>
            {/* ---- TOOLBAR ---- */}
            <div className="note-toolbar">
                <div className="note-toolbar-left">
                    {/* Version history toggle */}
                    {notes.length > 1 && (
                        <button
                            className={`note-btn note-btn-icon ${showVersions ? 'active' : ''}`}
                            onClick={() => setShowVersions(v => !v)}
                            title={t('detail.aiNotes.versionLabel')}
                        >
                            <Icons.Clock />
                            <span>{notes.length}</span>
                        </button>
                    )}
                </div>

                <div className="note-toolbar-right">
                    {activeNote && !isEditing && (
                        <>
                            {activeNote.is_edited && (
                                <span className="note-edited-badge">{t('detail.aiNotes.editedBadge')}</span>
                            )}
                            <button className="note-btn" onClick={handleStartEdit}>
                                <Icons.Edit />
                                {t('detail.aiNotes.edit')}
                            </button>
                            {activeNote.is_edited && activeNote.original_content && (
                                <button className="note-btn note-btn-secondary"
                                    onClick={() => setPendingReset(true)}
                                    title={t('detail.aiNotes.resetToOriginal')}>
                                    <Icons.Undo />
                                </button>
                            )}
                            <button className="note-btn note-btn-icon" onClick={handleExport}
                                title={t('detail.aiNotes.exportMd')}>
                                <Icons.Download />
                            </button>
                            {/* Regenerate → opens config panel */}
                            <button
                                className={`note-btn note-btn-primary ${showGenPanel ? 'active' : ''}`}
                                onClick={() => setShowGenPanel(v => !v)}
                            >
                                <Icons.Refresh />
                                {t('detail.aiNotes.regenerate')}
                            </button>
                        </>
                    )}

                    {activeNote && isEditing && (
                        <>
                            <button className="note-btn note-btn-secondary" onClick={handleCancelEdit}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button className="note-btn note-btn-primary" onClick={handleSave}
                                disabled={saveMut.isPending}>
                                {t('detail.aiNotes.save')}
                            </button>
                        </>
                    )}

                    {!activeNote && (
                        /* Generate button → opens config panel */
                        <button
                            className={`note-btn note-btn-primary ${showGenPanel ? 'active' : ''}`}
                            onClick={() => setShowGenPanel(v => !v)}
                        >
                            ✨ {t('detail.aiNotes.generate')}
                        </button>
                    )}
                </div>
            </div>

            {/* ---- GENERATE CONFIG PANEL ---- */}
            {showGenPanel && (
                <GeneratePanel
                    style={style}
                    setStyle={setStyle}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    enableScreenshots={enableScreenshots}
                    setEnableScreenshots={setEnableScreenshots}
                    providers={providers}
                    onGenerate={() => generateMut.mutate()}
                    onCancel={() => setShowGenPanel(false)}
                    isPending={generateMut.isPending}
                />
            )}

            {/* ---- VERSION HISTORY PANEL ---- */}
            {showVersions && notes.length > 1 && (
                <div className="note-version-panel">
                    {notes.map(note => (
                        <div key={note.id}
                            className={`note-version-item ${note.is_active ? 'active' : ''}`}>
                            <button className="note-version-select"
                                onClick={() => !note.is_active && activateMut.mutate(note.id)}>
                                <span className="note-version-model">{note.model ?? 'AI'}</span>
                                <span className="note-version-date">{fmtDate(note.created_at)}</span>
                                {note.is_edited && <span className="note-version-edited">✏️</span>}
                                {note.style && <span className="note-version-style">{note.style}</span>}
                            </button>
                            <button className="note-version-delete"
                                onClick={() => setPendingDelete(note.id)}
                                title={t('detail.aiNotes.deleteVersion')}>
                                <Icons.Trash />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ---- EMPTY STATE ---- */}
            {!activeNote && !generateMut.isPending && !showGenPanel && (
                <div className="note-view-empty">
                    <span className="note-empty-icon">🧠</span>
                    <p className="note-empty-title">{t('detail.aiNotes.emptyTitle')}</p>
                    <p className="note-empty-desc">{t('detail.aiNotes.emptyDesc')}</p>
                    <button className="note-btn note-btn-primary note-btn-lg"
                        onClick={() => setShowGenPanel(true)}>
                        ✨ {t('detail.aiNotes.generate')}
                    </button>
                </div>
            )}

            {/* ---- GENERATING STATE ---- */}
            {!activeNote && generateMut.isPending && (
                <div className="note-view-generating">
                    <div className="note-generating-spinner" />
                    <p>{t('detail.aiNotes.generating')}</p>
                </div>
            )}

            {/* ---- EDIT MODE ---- */}
            {activeNote && isEditing && (
                <div className="note-edit-area">
                    <textarea
                        ref={textareaRef}
                        className="note-textarea"
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        spellCheck={false}
                    />
                    <p className="note-edit-tip">Ctrl/Cmd + Enter 保存 · Esc 取消</p>
                </div>
            )}

            {/* ---- READ MODE (with TOC) ---- */}
            {activeNote && !isEditing && (
                <div className="note-read-layout">
                    <div className="note-content" ref={contentRef}>
                        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {activeNote.content}
                        </Markdown>
                    </div>
                    <NoteTOC
                        items={tocItems}
                        activeId={activeTocId}
                        onItemClick={handleTocClick}
                    />
                </div>
            )}

            {/* ---- RESET CONFIRM ---- */}
            {pendingReset && (
                <div className="note-confirm-overlay" onClick={() => setPendingReset(false)}>
                    <div className="note-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <p>{t('detail.aiNotes.resetConfirm')}</p>
                        <div className="note-confirm-actions">
                            <button className="note-btn note-btn-secondary" onClick={() => setPendingReset(false)}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button className="note-btn note-btn-danger"
                                onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>
                                {t('detail.aiNotes.resetToOriginal')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---- DELETE CONFIRM ---- */}
            {pendingDelete !== null && (
                <div className="note-confirm-overlay" onClick={() => setPendingDelete(null)}>
                    <div className="note-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <p>{t('detail.aiNotes.deleteConfirm')}</p>
                        <div className="note-confirm-actions">
                            <button className="note-btn note-btn-secondary" onClick={() => setPendingDelete(null)}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button className="note-btn note-btn-danger"
                                onClick={() => deleteMut.mutate(pendingDelete)} disabled={deleteMut.isPending}>
                                {t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

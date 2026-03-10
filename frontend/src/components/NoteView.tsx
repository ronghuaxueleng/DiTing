import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

import type { Segment, VideoNote, LLMProvider, Task } from '../api/types'
import {
    getNotes, generateNote, updateNote, resetNote, activateNote, deleteNote,
    getLLMProviders, getTasks, cancelTask,
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
    lineNumber: number  // 1-indexed line number in the markdown source
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
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!
        const m = line.match(/^(#{1,6})\s+(.+)/)
        if (m) {
            // Strip inline markdown (bold, timestamp emoji, etc.)
            const rawText = m[2]!.replace(/\*\*/g, '').replace(/⏱\s*[\d:]+/g, '').trim()
            items.push({ level: m[1]!.length, text: rawText, id: `note-h-${idx++}`, lineNumber: lineIdx + 1 })
        }
    }
    return items
}

// ---- TOC Sub-component ----
const TOC_MIN_WIDTH = 120
const TOC_MAX_WIDTH = 480
const TOC_DEFAULT_WIDTH = 180

function NoteTOC({ items, activeId, onItemClick }: {
    items: TocItem[]
    activeId: string | null
    onItemClick: (id: string) => void
}) {
    const { t } = useTranslation()
    const [collapsed, setCollapsed] = useState(false)
    const [tocWidth, setTocWidth] = useState(() => {
        const saved = localStorage.getItem('note-toc-width')
        return saved ? Math.max(TOC_MIN_WIDTH, Math.min(TOC_MAX_WIDTH, Number(saved))) : TOC_DEFAULT_WIDTH
    })
    const isDragging = useRef(false)

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        isDragging.current = true
        const startX = e.clientX
        const startWidth = tocWidth

        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        const onMove = (ev: MouseEvent) => {
            if (!isDragging.current) return
            // Dragging to the left = wider TOC (handle is on left edge of TOC)
            const delta = startX - ev.clientX
            const newWidth = Math.max(TOC_MIN_WIDTH, Math.min(TOC_MAX_WIDTH, startWidth + delta))
            setTocWidth(newWidth)
        }
        const onUp = () => {
            isDragging.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            // Persist after drag ends
            setTocWidth(w => { localStorage.setItem('note-toc-width', String(w)); return w })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [tocWidth])

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setTocWidth(TOC_DEFAULT_WIDTH)
        localStorage.setItem('note-toc-width', String(TOC_DEFAULT_WIDTH))
    }, [])

    if (items.length < 2) return null
    return (
        <div
            className={`note-toc ${collapsed ? 'note-toc--collapsed' : ''}`}
            style={collapsed ? undefined : { width: tocWidth }}
        >
            {/* Drag handle on left edge */}
            {!collapsed && (
                <div
                    className="note-toc-resize-handle"
                    onMouseDown={handleDragStart}
                    onDoubleClick={handleDoubleClick}
                    title={t('detail.aiNotes.tocResizeHint', 'Drag to resize, double-click to reset')}
                />
            )}
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
    screenshotDensity, setScreenshotDensity,
    transcriptionVersions,
    selectedTransVersion, setSelectedTransVersion,
    providers,
    onGenerate,
    onCancel,
    isPending,
    activeTask,
    onCancelTask,
    customPrompt,
    setCustomPrompt,
}: {
    style: string
    setStyle: (s: 'concise' | 'detailed' | 'outline') => void
    selectedModelId: number | ''
    setSelectedModelId: (id: number | '') => void
    screenshotDensity: string
    setScreenshotDensity: (v: string) => void
    transcriptionVersions: string[]
    selectedTransVersion: string
    setSelectedTransVersion: (v: string) => void
    providers: LLMProvider[]
    onGenerate: () => void
    onCancel: () => void
    isPending: boolean
    activeTask: Task | null
    onCancelTask: () => void
    customPrompt: string
    setCustomPrompt: (v: string) => void
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

                {/* Transcription version selector */}
                {transcriptionVersions.length > 1 && (
                    <div className="note-gen-field">
                        <label className="note-gen-label">{t('detail.aiNotes.transVersion')}</label>
                        <select
                            className="note-gen-select"
                            value={selectedTransVersion}
                            onChange={e => setSelectedTransVersion(e.target.value)}
                        >
                            <option value="">{t('detail.aiNotes.transVersionAuto')}</option>
                            {transcriptionVersions.map(v => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Screenshot density */}
                <div className="note-gen-field">
                    <label className="note-gen-label">{t('detail.aiNotes.screenshots')}</label>
                    <div className="note-gen-segmented">
                        {(['', 'few', 'moderate', 'dense'] as const).map(d => (
                            <button
                                key={d}
                                className={`note-gen-seg-btn ${screenshotDensity === d ? 'active' : ''}`}
                                onClick={() => setScreenshotDensity(d)}
                            >
                                {t(`detail.aiNotes.density${d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Off'}`)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Additional instructions */}
                <div className="note-gen-field" style={{ flexBasis: '100%' }}>
                    <label className="note-gen-label">{t('detail.aiNotes.customPrompt')}</label>
                    <textarea
                        className="note-gen-textarea"
                        value={customPrompt}
                        onChange={e => setCustomPrompt(e.target.value)}
                        placeholder={t('detail.aiNotes.customPromptPlaceholder')}
                        rows={2}
                    />
                </div>
            </div>
            <div className="note-gen-panel-footer">
                {activeTask ? (
                    /* ---- Progress view ---- */
                    <div className="note-gen-progress">
                        <div className="note-gen-progress-bar-wrap">
                            <div
                                className="note-gen-progress-bar"
                                style={{ width: `${activeTask.progress ?? 0}%` }}
                            />
                        </div>
                        <div className="note-gen-progress-meta">
                            <span className="note-gen-progress-msg">
                                {activeTask.message || t('detail.aiNotes.genStageProcessing')}
                            </span>
                            <span className="note-gen-progress-pct">{activeTask.progress ?? 0}%</span>
                        </div>
                        <div className="note-gen-progress-actions">
                            <button
                                className="note-btn note-btn-secondary"
                                onClick={onCancelTask}
                                style={{ fontSize: '0.78rem', padding: '4px 12px' }}
                            >
                                {t('detail.aiNotes.cancelGenerate')}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* ---- Normal config footer ---- */
                    <>
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
                    </>
                )}
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
    const [screenshotDensity, setScreenshotDensity] = useState('')
    const [selectedTransVersion, setSelectedTransVersion] = useState('')
    const [customPrompt, setCustomPrompt] = useState('')
    const [pendingDelete, setPendingDelete] = useState<number | null>(null)
    const [pendingReset, setPendingReset] = useState<boolean>(false)
    const [activeTocId, setActiveTocId] = useState<string | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const qkey = ['notes', sourceId]
    const hasSegments = segments.length > 0

    // Derive unique transcription versions (ASR model names) from segments
    const transcriptionVersions = useMemo(() => {
        const models = new Set<string>()
        for (const seg of segments) {
            const model = (seg as any).asr_model
            if (model) models.add(model)
        }
        return Array.from(models)
    }, [segments])

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

    // Build a line-number → TOC id map for deterministic heading ID assignment
    const tocLineMap = useMemo(() => {
        const map = new Map<number, string>()
        for (const item of tocItems) {
            map.set(item.lineNumber, item.id)
        }
        return map
    }, [tocItems])

    // Scroll-based active heading tracking
    useEffect(() => {
        const container = contentRef.current
        if (!container || tocItems.length === 0 || isEditing) return

        const handleScroll = () => {
            const offset = 40 // breathing room below top

            let activeId: string | null = tocItems[0]?.id ?? null
            for (const item of tocItems) {
                const el = document.getElementById(item.id)
                if (!el) continue
                // el.offsetTop is relative to the offsetParent; we need position relative to the scroll container
                const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top
                if (elTop <= offset) {
                    activeId = item.id
                } else {
                    break
                }
            }
            setActiveTocId(activeId)
        }

        // Run once immediately to set initial active heading
        handleScroll()

        container.addEventListener('scroll', handleScroll, { passive: true })
        return () => container.removeEventListener('scroll', handleScroll)
    }, [tocItems, isEditing, activeNote?.id])

    // Active task progress tracking — survives page refresh via sessionStorage
    const taskStorageKey = `note_task_${sourceId}`
    const [pendingTaskId, _setPendingTaskId] = useState<number | null>(() => {
        const saved = sessionStorage.getItem(taskStorageKey)
        return saved ? Number(saved) : null
    })
    const setPendingTaskId = (id: number | null) => {
        _setPendingTaskId(id)
        if (id === null) sessionStorage.removeItem(taskStorageKey)
        else sessionStorage.setItem(taskStorageKey, String(id))
    }
    // Also open the panel on mount if a task was already in flight
    useEffect(() => {
        if (pendingTaskId !== null) setShowGenPanel(true)
    }, [])

    const { data: tasksMap } = useQuery<Record<string, Task>>({
        queryKey: ['tasks'],
        queryFn: getTasks,
        refetchInterval: 1200,
        enabled: pendingTaskId !== null,
    })

    const activeTask: Task | null = pendingTaskId !== null
        ? (tasksMap?.[String(pendingTaskId)] ?? null)
        : null

    // Watch task completion
    useEffect(() => {
        if (!activeTask || pendingTaskId === null) return
        if (activeTask.status === 'completed') {
            setPendingTaskId(null)
            setShowGenPanel(false)
            showToast('success', t('detail.aiNotes.generatedSuccess'))
            // Refresh note list a couple times to catch the new note
            queryClient.invalidateQueries({ queryKey: qkey })
            setTimeout(() => queryClient.invalidateQueries({ queryKey: qkey }), 2500)
        } else if (activeTask.status === 'failed' || activeTask.status === 'cancelled') {
            setPendingTaskId(null)
            showToast('error', t('detail.aiNotes.generateFailed'))
        }
    }, [activeTask?.status, pendingTaskId])

    // Mutations
    const generateMut = useMutation({
        mutationFn: () => generateNote(sourceId, {
            style,
            llmModelId: selectedModelId || undefined,
            screenshotDensity: screenshotDensity || undefined,
            transcriptionVersion: selectedTransVersion || undefined,
            prompt: customPrompt.trim() || undefined,
        }),
        onSuccess: (data) => {
            // data = { status, task_id }
            if ((data as any)?.task_id) {
                setPendingTaskId((data as any).task_id)
            } else {
                // fallback: no task id returned, close immediately
                setShowGenPanel(false)
                showToast('success', t('detail.aiNotes.generatedSuccess'))
                queryClient.invalidateQueries({ queryKey: qkey })
            }
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
        if (el && contentRef.current) {
            // Scroll the note-content container directly
            const containerTop = contentRef.current.getBoundingClientRect().top
            const elTop = el.getBoundingClientRect().top
            // Calculate scroll target (add the offset minus some breathing room)
            contentRef.current.scrollTo({
                top: contentRef.current.scrollTop + (elTop - containerTop) - 10,
                behavior: 'smooth'
            })
        }
    }
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave() }
        if (e.key === 'Escape') handleCancelEdit()
    }, [editContent, activeNote])

    // Custom Markdown components — inject IDs on headings and clickable ⏱ timestamps

    function renderTimestamps(children: React.ReactNode): React.ReactNode {
        if (typeof children === 'string') {
            const parts = children.split(/(⏱\s*\d{1,2}:\d{2}(?::\d{2})?)/g)
            if (parts.length === 1) return children
            return parts.map((part, i) => {
                const m = part.match(/⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
                if (m) {
                    const secs = parseTimestamp(m[1]!)
                    return (
                        <button key={i}
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                onSeek(secs)
                            }}
                            onMouseDown={(e) => {
                                // Prevent browser auto-focus which causes scroll jumps
                                e.preventDefault()
                            }}
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

    const makeHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
        ({ children, node, ...props }: any) => {
            // Use the AST node's line number to look up the deterministic TOC id
            const line = node?.position?.start?.line
            const id = (line && tocLineMap.get(line)) || `note-h-unknown-${line ?? 'x'}`
            return <Tag id={id} {...props}>{renderTimestamps(children)}</Tag>
        }

    const markdownComponents = {
        h1: makeHeading('h1'),
        h2: makeHeading('h2'),
        h3: makeHeading('h3'),
        h4: makeHeading('h4'),
        h5: makeHeading('h5'),
        h6: makeHeading('h6'),
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
                    {notes.length > 0 && (
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
            {(showGenPanel || pendingTaskId !== null) && (
                <GeneratePanel
                    style={style}
                    setStyle={setStyle}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    screenshotDensity={screenshotDensity}
                    setScreenshotDensity={setScreenshotDensity}
                    transcriptionVersions={transcriptionVersions}
                    selectedTransVersion={selectedTransVersion}
                    setSelectedTransVersion={setSelectedTransVersion}
                    providers={providers}
                    onGenerate={() => generateMut.mutate()}
                    onCancel={() => setShowGenPanel(false)}
                    isPending={generateMut.isPending}
                    activeTask={activeTask}
                    onCancelTask={() => pendingTaskId !== null && cancelTask(pendingTaskId).then(() => setPendingTaskId(null))}
                    customPrompt={customPrompt}
                    setCustomPrompt={setCustomPrompt}
                />
            )}

            {/* ---- VERSION HISTORY PANEL ---- */}
            {showVersions && notes.length > 0 && (
                <div className="note-version-panel">
                    {notes.map(note => (
                        <div key={note.id}
                            className={`note-version-item ${note.is_active ? 'active' : ''}`}>
                            <button className="note-version-select"
                                onClick={() => !note.is_active && activateMut.mutate(note.id)}
                                title={note.gen_params?.user_prompt ? `💡 ${note.gen_params.user_prompt}` : undefined}>
                                <span className="note-version-model">{note.model ?? 'AI'}</span>
                                <span className="note-version-date">{fmtDate(note.created_at)}</span>
                                {note.is_edited && <span className="note-version-edited">✏️</span>}
                                {note.style && <span className="note-version-style">{note.style}</span>}
                                {note.gen_params?.screenshot_density && (
                                    <span className="note-version-badge">📷 {note.gen_params.screenshot_density}</span>
                                )}
                                {note.gen_params?.transcription_version && (
                                    <span className="note-version-badge">🎤 {note.gen_params.transcription_version}</span>
                                )}
                                {note.gen_params?.user_prompt && (
                                    <span className="note-version-badge" title={note.gen_params.user_prompt}>💡</span>
                                )}
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

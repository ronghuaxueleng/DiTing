import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

import type { Segment, VideoNote } from '../api/types'
import {
    getNotes, generateNote, updateNote, resetNote, activateNote, deleteNote,
} from '../api/client'
import { useToast } from '../contexts/ToastContext'
import Icons from './ui/Icons'

interface NoteViewProps {
    sourceId: string
    segments: Segment[]
    /** Called when user clicks a timestamp link in the note */
    onSeek: (timeSeconds: number) => void
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
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso
    }
}

export default function NoteView({ sourceId, segments, onSeek }: NoteViewProps) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const queryClient = useQueryClient()

    // Local UI states
    const [isEditing, setIsEditing] = useState(false)
    const [editContent, setEditContent] = useState('')
    const [style, setStyle] = useState<'concise' | 'detailed' | 'outline'>('detailed')
    const [showVersions, setShowVersions] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<number | null>(null)
    const [pendingReset, setPendingReset] = useState<boolean>(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const qkey = ['notes', sourceId]
    const hasSegments = segments.length > 0

    // --- Queries ---
    const { data: notes = [], isLoading } = useQuery<VideoNote[]>({
        queryKey: qkey,
        queryFn: () => getNotes(sourceId),
        enabled: !!sourceId,
    })

    const activeNote = notes.find(n => n.is_active) ?? notes[0] ?? null

    // Sync edit buffer when active note changes
    useEffect(() => {
        if (!isEditing && activeNote) {
            setEditContent(activeNote.content)
        }
    }, [activeNote?.id, isEditing])

    // --- Mutations ---
    const generateMut = useMutation({
        mutationFn: () => generateNote(sourceId, { style }),
        onSuccess: () => {
            showToast('success', t('detail.aiNotes.generatedSuccess'))
            // Poll for new notes (task runs in background)
            const poll = setInterval(() => {
                queryClient.invalidateQueries({ queryKey: qkey })
            }, 2000)
            setTimeout(() => clearInterval(poll), 30000)
        },
        onError: () => showToast('error', t('detail.aiNotes.generateFailed')),
    })

    const saveMut = useMutation({
        mutationFn: (content: string) => updateNote(activeNote!.id, content),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: qkey })
            setIsEditing(false)
        },
        onError: () => showToast('error', t('detail.aiNotes.saveFailed')),
    })

    const resetMut = useMutation({
        mutationFn: () => resetNote(activeNote!.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: qkey })
            setPendingReset(false)
        },
    })

    const activateMut = useMutation({
        mutationFn: (noteId: number) => activateNote(noteId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: qkey }),
    })

    const deleteMut = useMutation({
        mutationFn: (noteId: number) => deleteNote(noteId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: qkey })
            setPendingDelete(null)
        },
        onError: () => showToast('error', t('detail.aiNotes.deleteFailed')),
    })

    // --- Handlers ---
    const handleStartEdit = () => {
        setEditContent(activeNote?.content ?? '')
        setIsEditing(true)
        setTimeout(() => textareaRef.current?.focus(), 50)
    }

    const handleSave = () => {
        if (activeNote) saveMut.mutate(editContent)
    }

    const handleCancelEdit = () => {
        setIsEditing(false)
        setEditContent(activeNote?.content ?? '')
    }

    const handleExport = () => {
        if (!activeNote) return
        const blob = new Blob([activeNote.content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `note-${sourceId}.md`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            handleSave()
        }
        if (e.key === 'Escape') {
            handleCancelEdit()
        }
    }, [editContent, activeNote])

    // --- Custom Markdown components to make ⏱ timestamps clickable ---
    const markdownComponents = {
        // Intercept paragraph/heading text nodes to find ⏱ patterns
        p: ({ children, ...props }: any) => (
            <p {...props}>{renderTimestamps(children)}</p>
        ),
        h1: ({ children, ...props }: any) => (
            <h1 {...props}>{renderTimestamps(children)}</h1>
        ),
        h2: ({ children, ...props }: any) => (
            <h2 {...props}>{renderTimestamps(children)}</h2>
        ),
        h3: ({ children, ...props }: any) => (
            <h3 {...props}>{renderTimestamps(children)}</h3>
        ),
        li: ({ children, ...props }: any) => (
            <li {...props}>{renderTimestamps(children)}</li>
        ),
    }

    function renderTimestamps(children: React.ReactNode): React.ReactNode {
        if (typeof children === 'string') {
            // Match ⏱ mm:ss or ⏱ hh:mm:ss
            const parts = children.split(/(⏱\s*\d{1,2}:\d{2}(?::\d{2})?)/g)
            if (parts.length === 1) return children
            return parts.map((part, i) => {
                const m = part.match(/⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
                if (m) {
                    const secs = parseTimestamp(m[1]!)
                    return (
                        <button
                            key={i}
                            onClick={() => onSeek(secs)}
                            className="note-ts-btn"
                            title={`Jump to ${m[1]}`}
                        >
                            {part}
                        </button>
                    )
                }
                return part
            })
        }
        if (Array.isArray(children)) {
            return children.map((child, i) =>
                typeof child === 'string'
                    ? <span key={i}>{renderTimestamps(child)}</span>
                    : child
            )
        }
        return children
    }

    // --- Render ---

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
        <div className="note-view">
            {/* ---- TOOLBAR ---- */}
            <div className="note-toolbar">
                <div className="note-toolbar-left">
                    {/* Style selector (only shown when no note exists or generating) */}
                    {!activeNote && (
                        <select
                            className="note-style-select"
                            value={style}
                            onChange={e => setStyle(e.target.value as any)}
                        >
                            <option value="detailed">{t('detail.aiNotes.styleDetailed')}</option>
                            <option value="concise">{t('detail.aiNotes.styleConcise')}</option>
                            <option value="outline">{t('detail.aiNotes.styleOutline')}</option>
                        </select>
                    )}

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
                            {/* Edited badge */}
                            {activeNote.is_edited && (
                                <span className="note-edited-badge">{t('detail.aiNotes.editedBadge')}</span>
                            )}

                            {/* Edit */}
                            <button className="note-btn" onClick={handleStartEdit}>
                                <Icons.Edit />
                                {t('detail.aiNotes.edit')}
                            </button>

                            {/* Reset to original (only if edited) */}
                            {activeNote.is_edited && activeNote.original_content && (
                                <button
                                    className="note-btn note-btn-secondary"
                                    onClick={() => setPendingReset(true)}
                                    title={t('detail.aiNotes.resetToOriginal')}
                                >
                                    <Icons.Undo />
                                </button>
                            )}

                            {/* Export */}
                            <button className="note-btn note-btn-icon" onClick={handleExport} title={t('detail.aiNotes.exportMd')}>
                                <Icons.Download />
                            </button>

                            {/* Regenerate */}
                            <button
                                className="note-btn note-btn-primary"
                                onClick={() => generateMut.mutate()}
                                disabled={generateMut.isPending}
                            >
                                <Icons.Refresh />
                                {generateMut.isPending ? t('detail.aiNotes.generating') : t('detail.aiNotes.regenerate')}
                            </button>
                        </>
                    )}

                    {activeNote && isEditing && (
                        <>
                            <button className="note-btn note-btn-secondary" onClick={handleCancelEdit}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button
                                className="note-btn note-btn-primary"
                                onClick={handleSave}
                                disabled={saveMut.isPending}
                            >
                                {t('detail.aiNotes.save')}
                            </button>
                        </>
                    )}

                    {!activeNote && (
                        <button
                            className="note-btn note-btn-primary"
                            onClick={() => generateMut.mutate()}
                            disabled={generateMut.isPending}
                        >
                            {generateMut.isPending
                                ? t('detail.aiNotes.generating')
                                : t('detail.aiNotes.generate')}
                        </button>
                    )}
                </div>
            </div>

            {/* ---- VERSION HISTORY PANEL ---- */}
            {showVersions && notes.length > 1 && (
                <div className="note-version-panel">
                    {notes.map(note => (
                        <div
                            key={note.id}
                            className={`note-version-item ${note.is_active ? 'active' : ''}`}
                        >
                            <button
                                className="note-version-select"
                                onClick={() => !note.is_active && activateMut.mutate(note.id)}
                            >
                                <span className="note-version-model">{note.model ?? 'AI'}</span>
                                <span className="note-version-date">{fmtDate(note.created_at)}</span>
                                {note.is_edited && <span className="note-version-edited">✏️</span>}
                                {note.style && <span className="note-version-style">{note.style}</span>}
                            </button>
                            <button
                                className="note-version-delete"
                                onClick={() => setPendingDelete(note.id)}
                                title={t('detail.aiNotes.deleteVersion')}
                            >
                                <Icons.Trash />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ---- EMPTY STATE ---- */}
            {!activeNote && !generateMut.isPending && (
                <div className="note-view-empty">
                    <span className="note-empty-icon">🧠</span>
                    <p className="note-empty-title">{t('detail.aiNotes.emptyTitle')}</p>
                    <p className="note-empty-desc">{t('detail.aiNotes.emptyDesc')}</p>
                    <div className="note-empty-style">
                        <label className="note-empty-style-label">{t('detail.aiNotes.style')}:</label>
                        <select
                            className="note-style-select"
                            value={style}
                            onChange={e => setStyle(e.target.value as any)}
                        >
                            <option value="detailed">{t('detail.aiNotes.styleDetailed')}</option>
                            <option value="concise">{t('detail.aiNotes.styleConcise')}</option>
                            <option value="outline">{t('detail.aiNotes.styleOutline')}</option>
                        </select>
                    </div>
                    <button
                        className="note-btn note-btn-primary note-btn-lg"
                        onClick={() => generateMut.mutate()}
                    >
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

            {/* ---- READ MODE ---- */}
            {activeNote && !isEditing && (
                <div className="note-content">
                    <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                    >
                        {activeNote.content}
                    </Markdown>
                </div>
            )}

            {/* ---- RESET CONFIRM DIALOG ---- */}
            {pendingReset && (
                <div className="note-confirm-overlay" onClick={() => setPendingReset(false)}>
                    <div className="note-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <p>{t('detail.aiNotes.resetConfirm')}</p>
                        <div className="note-confirm-actions">
                            <button className="note-btn note-btn-secondary" onClick={() => setPendingReset(false)}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button
                                className="note-btn note-btn-danger"
                                onClick={() => resetMut.mutate()}
                                disabled={resetMut.isPending}
                            >
                                {t('detail.aiNotes.resetToOriginal')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---- DELETE CONFIRM DIALOG ---- */}
            {pendingDelete !== null && (
                <div className="note-confirm-overlay" onClick={() => setPendingDelete(null)}>
                    <div className="note-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <p>{t('detail.aiNotes.deleteConfirm')}</p>
                        <div className="note-confirm-actions">
                            <button className="note-btn note-btn-secondary" onClick={() => setPendingDelete(null)}>
                                {t('detail.aiNotes.cancel')}
                            </button>
                            <button
                                className="note-btn note-btn-danger"
                                onClick={() => deleteMut.mutate(pendingDelete)}
                                disabled={deleteMut.isPending}
                            >
                                {t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

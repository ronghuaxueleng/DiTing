import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { getVideos, getTasks, getTags, batchDeleteVideos, batchSetVideoTags, batchArchiveVideos } from '../api/client'
import type { Video, Task } from '../api/types'
import VideoCard from '../components/VideoCard'
import VideoListItem from '../components/VideoListItem'
import TagManager from '../components/TagManager'
import ConfirmModal from '../components/ConfirmModal'
import BatchTagEditor from '../components/BatchTagEditor'
import DetailPanel from '../components/DetailPanel'
import DashboardNotesPane from '../components/dashboard/DashboardNotesPane'
import Pagination from '../components/Pagination'
import DashboardFilterRibbon from '../components/dashboard/DashboardFilterRibbon'
import DashboardBatchActionBar from '../components/dashboard/DashboardBatchActionBar'
import { useState, useEffect, useRef } from 'react'

export default function Dashboard() {
    const { t } = useTranslation()
    const [searchParams, setSearchParams] = useSearchParams()

    // Batch Selection State
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [batchThinking, setBatchThinking] = useState(false)
    const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
    const [showBatchTagEditor, setShowBatchTagEditor] = useState(false)

    // Separate UI state
    const [showTagManager, setShowTagManager] = useState(false)
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)

    // Handle Escape key to cancel selection mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only cancel selection if no other popups/modals are open
            if (e.key === 'Escape' && selectionMode && !showBatchDeleteConfirm && !showBatchTagEditor && !showTagManager && !selectedVideo) {
                setSelectionMode(false)
                setSelectedIds(new Set())
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectionMode, showBatchDeleteConfirm, showBatchTagEditor, showTagManager, selectedVideo])


    // Read State from URL Params (with defaults)
    const page = parseInt(searchParams.get('page') || '1')
    const defaultLimit = localStorage.getItem('dashboard-limit') || '20'
    const limit = parseInt(searchParams.get('limit') || defaultLimit)
    const sourceType = searchParams.get('source') || ''
    const status = searchParams.get('status') || ''
    const selectedTagId = searchParams.get('tag') ? Number(searchParams.get('tag')) : undefined
    const tagExclude = searchParams.get('tag_exclude') === '1'
    const sortBy = (searchParams.get('sort') || 'time') as 'time' | 'title' | 'segments'
    const defaultView = localStorage.getItem('dashboard-view-mode') || 'grid'
    const viewMode = (searchParams.get('view') || defaultView) as 'grid' | 'list' | 'notes'

    // Save view mode and limit preferences when user changes them
    useEffect(() => {
        const view = searchParams.get('view')
        if (view) {
            localStorage.setItem('dashboard-view-mode', view)
        }
        const limitParam = searchParams.get('limit')
        if (limitParam) {
            localStorage.setItem('dashboard-limit', limitParam)
        }
    }, [searchParams])
    const [selectedNoteVideo, setSelectedNoteVideo] = useState<Video | null>(null)

    // Quick Filters
    const parseQuick = (v: string | null) => v === '1' ? true : v === '0' ? false : undefined
    const hasSegments = parseQuick(searchParams.get('segments'))
    const hasAI = parseQuick(searchParams.get('ai'))
    const hasNotes = parseQuick(searchParams.get('notes'))
    const hasCached = parseQuick(searchParams.get('cached'))
    const isSubtitle = parseQuick(searchParams.get('subtitle'))

    // Archive Filter (None=hide, '1'=only archived, 'all'=show all)
    const includeArchived = searchParams.get('archived')

    // Search query from URL
    const searchQuery = searchParams.get('q') || ''

    // Helper to update params
    const updateParams = (updates: Record<string, string | null>) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            Object.entries(updates).forEach(([key, value]) => {
                if (value === null) next.delete(key)
                else next.set(key, value)
            })
            return next
        })
    }

    // Helper specifically for page resets
    const updateFilter = (updates: Record<string, string | null>) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            // Reset to page 1 for any filter change
            next.set('page', '1')
            Object.entries(updates).forEach(([key, value]) => {
                if (value === null) next.delete(key)
                else next.set(key, value)
            })
            return next
        })
    }

    const { data: tags } = useQuery({
        queryKey: ['tags'],
        queryFn: getTags
    })

    // Smart polling: Poll tasks to check for active jobs
    const { data: tasksData } = useQuery({
        queryKey: ['tasks'],
        queryFn: getTasks,
        refetchInterval: (query) => {
            const data = query.state.data as Record<string, Task> | undefined
            const hasActive = data ? Object.values(data).some(t => ['processing', 'pending'].includes(t.status)) : false
            return hasActive ? 3000 : 30000
        },
        refetchIntervalInBackground: false,
    })

    const queryClient = useQueryClient()
    const prevTasksRef = useRef<Record<string, Task>>()
    const [recentlyFinished, setRecentlyFinished] = useState(false)
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        if (tasksData && prevTasksRef.current) {
            // Detect tasks that transitioned to a finished status
            const hasNewlyFinished = Object.entries(tasksData).some(([id, task]) => {
                const prev = prevTasksRef.current?.[id]
                return prev && ['processing', 'pending'].includes(prev.status) && ['completed', 'failed', 'cancelled'].includes(task.status)
            })
            // Detect tasks that disappeared entirely (evicted from TaskManager before we saw them complete)
            const hasDisappeared = Object.entries(prevTasksRef.current).some(([id, prev]) => {
                return ['processing', 'pending'].includes(prev.status) && !(id in tasksData)
            })
            if (hasNewlyFinished || hasDisappeared) {
                queryClient.refetchQueries({ queryKey: ['videos'] })
                // Keep fast polling for a cooldown period after tasks finish
                setRecentlyFinished(true)
                clearTimeout(cooldownTimerRef.current)
                cooldownTimerRef.current = setTimeout(() => setRecentlyFinished(false), 10000)
            }
        }
        prevTasksRef.current = tasksData
    }, [tasksData, queryClient])

    useEffect(() => {
        return () => clearTimeout(cooldownTimerRef.current)
    }, [])

    const hasActiveTasks = tasksData
        ? Object.values(tasksData).some(t => ['processing', 'pending'].includes(t.status))
        : false

    const { data, isLoading, refetch } = useQuery({
        // Include sort/filters in query key to trigger refetch
        queryKey: ['videos', page, limit, sourceType, status, selectedTagId, tagExclude, sortBy, hasSegments, hasAI, hasNotes, hasCached, isSubtitle, includeArchived, searchQuery],
        queryFn: () => getVideos({
            page,
            limit,
            sourceType: sourceType || undefined,
            status: status || undefined,
            tagId: tagExclude ? undefined : selectedTagId,
            excludeTagId: tagExclude ? selectedTagId : undefined,
            sortBy,
            hasSegments,
            hasAI,
            hasNotes,
            hasCached,
            isSubtitle,
            includeArchived: includeArchived || undefined,
            search: searchQuery || undefined
        }),
        refetchInterval: (query) => {
            // Also keep fast polling when videos themselves show processing/analyzing overlays
            const videoData = query.state.data as { items?: Video[] } | undefined
            const hasActiveVideos = videoData?.items?.some(v =>
                v.latest_status === 'processing' || v.latest_status === 'pending' || v.is_analyzing_ai
            ) ?? false
            return (hasActiveTasks || hasActiveVideos || recentlyFinished) ? 5000 : 30000
        },
        refetchIntervalInBackground: false,
    })

    const totalPages = data ? Math.ceil(data.total / limit) : 0

    // --- Batch Operations ---

    const toggleSelectionMode = () => {
        setSelectionMode(!selectionMode)
        setSelectedIds(new Set())
    }

    const toggleSelect = (sourceId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(sourceId)) next.delete(sourceId)
            else next.add(sourceId)
            return next
        })
    }

    const handleSelectAll = () => {
        const allIds = data?.items?.map(v => v.source_id) || []
        setSelectedIds(new Set(allIds))
    }

    const handleDeselectAll = () => {
        setSelectedIds(new Set())
    }

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return
        setBatchThinking(true)
        setShowBatchDeleteConfirm(false)
        try {
            const idsToDelete = Array.from(selectedIds)
            await batchDeleteVideos(idsToDelete)
            setSelectedIds(new Set())
            setSelectionMode(false)
            refetch()
        } catch (e) {
            alert(t('dashboard.batch.deleteFailed') + ': ' + (e as Error).message)
        } finally {
            setBatchThinking(false)
        }
    }

    const handleBatchArchive = async (archived: boolean) => {
        if (selectedIds.size === 0) return
        setBatchThinking(true)
        try {
            const idsToUpdate = Array.from(selectedIds)
            await batchArchiveVideos(idsToUpdate, archived)
            setSelectedIds(new Set())
            setSelectionMode(false)
            refetch()
        } catch (e) {
            alert(t('common.error') + ': ' + (e as Error).message)
        } finally {
            setBatchThinking(false)
        }
    }

    const handleBatchTags = async (tagIds: number[]) => {
        if (selectedIds.size === 0) return
        setBatchThinking(true)
        setShowBatchTagEditor(false)
        try {
            const idsToUpdate = Array.from(selectedIds)
            await batchSetVideoTags(idsToUpdate, tagIds)
            setSelectedIds(new Set())
            setSelectionMode(false)
            refetch()
        } catch (e) {
            alert(t('dashboard.batch.tagFailed') + ': ' + (e as Error).message)
        } finally {
            setBatchThinking(false)
        }
    }

    return (
        <>
            <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden relative">
                {/* Filters Ribbon */}
                <div className="shrink-0 pt-4 z-10 block">
                    <DashboardFilterRibbon
                        filterBarProps={{
                    sourceType, status, selectedTagId, tagExclude,
                    hasSegments, hasAI, hasNotes, hasCached, isSubtitle,
                    includeArchived, tags, onUpdateFilter: updateFilter
                }}
                toolbarProps={{
                    sortBy, limit, viewMode, selectionMode,
                    onUpdateParams: updateParams, onUpdateFilter: updateFilter,
                    onToggleSelectionMode: toggleSelectionMode,
                    onShowTagManager: () => setShowTagManager(true)
                }}
                activeFiltersProps={{
                    sourceType, status, selectedTagId, tagExclude,
                    hasSegments, hasAI, hasNotes, hasCached, isSubtitle,
                    includeArchived, searchQuery, tags,
                    onUpdateFilter: updateFilter, onUpdateParams: updateParams
                }}
                selectionMode={selectionMode}
                selectedCount={selectedIds.size}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
                sourceType={sourceType}
                status={status}
                selectedTagId={selectedTagId}
                tagExclude={tagExclude}
                hasSegments={hasSegments}
                hasAI={hasAI}
                hasNotes={hasNotes}
                hasCached={hasCached}
                isSubtitle={isSubtitle}
                includeArchived={includeArchived}
                searchQuery={searchQuery}
                sortBy={sortBy}
                viewMode={viewMode}
                tags={tags}
            />
            </div>


            {/* Content Area */}
            <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar w-full px-4 sm:px-6 lg:px-8 ${viewMode === 'notes' && !isLoading && data?.items?.length !== 0 ? 'hidden' : 'pb-8'}`}>
                {isLoading ? (
                    <div className="flex justify-center py-20" >
                        <div className="animate-spin h-8 w-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full" />
                    </div>
                ) : data?.items?.length === 0 ? (
                    <div className="text-center py-20 text-[var(--color-text-muted)]">
                        {t('dashboard.display.empty')}
                    </div>
                ) : (
                    viewMode !== 'notes' && (
                        viewMode === 'grid' ? (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
                                {(data?.items || []).map((video) => (
                                    <VideoCard
                                        key={video.source_id}
                                        video={video}
                                        onRefresh={refetch}
                                        onOpenPanel={() => setSelectedVideo(video)}
                                        selectionMode={selectionMode}
                                        selected={selectedIds.has(video.source_id)}
                                        onToggleSelect={toggleSelect}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {(data?.items || []).map((video) => (
                                    <VideoListItem
                                        key={video.source_id}
                                        video={video}
                                        onRefresh={refetch}
                                        onOpenPanel={() => setSelectedVideo(video)}
                                        selectionMode={selectionMode}
                                        selected={selectedIds.has(video.source_id)}
                                        onToggleSelect={toggleSelect}
                                    />
                                ))}
                            </div>
                        ))
                )}

                {/* Pagination (hidden in notes view — right pane handles its own scroll) */}
                {viewMode !== 'notes' && (
                    <Pagination
                        page={page}
                        totalPages={totalPages}
                        total={data?.total}
                        onPageChange={(p) => updateParams({ page: String(p) })}
                    />
                )}
            </div>

            {/* Notes View — master-detail layout, viewport-constrained so each panel scrolls independently */}
            {
                viewMode === 'notes' && (
                    <div className="flex-1 min-h-0 w-full px-4 sm:px-6 lg:px-8 pb-4 flex flex-col lg:flex-row gap-4 overflow-hidden">
                        {/* Left: video list (compact, scrolls independently) */}
                        <div className={`lg:w-80 flex-shrink-0 flex flex-col border border-[var(--color-border)] rounded-xl bg-[var(--color-card)] overflow-hidden ${selectedNoteVideo ? 'hidden lg:flex' : 'flex'}`}>
                            {/* Scrollable list area */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1 p-2">
                                {(data?.items || []).map(video => (
                                    <button
                                        key={video.source_id}
                                        className={`dash-notes-list-item flex items-start gap-3 p-2.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 ${selectedNoteVideo?.source_id === video.source_id ? 'active bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]/40' : ''}`}
                                        onClick={() => setSelectedNoteVideo(video)}
                                    >
                                        {video.cover && (
                                            <img src={video.cover} alt="" className="dash-notes-list-cover w-20 h-14 object-cover rounded bg-black/10 shrink-0" />
                                        )}
                                        <div className="dash-notes-list-info flex flex-col flex-1 min-w-0">
                                            <span className="dash-notes-list-title text-sm font-medium line-clamp-2 text-[var(--color-text)]">{video.title}</span>
                                            {video.ai_count > 0 && (
                                                <span className="dash-notes-list-badge mt-1 text-xs px-1.5 py-0.5 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)] w-max border border-[var(--color-primary)]/20">✨ {video.ai_count}</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            {/* Pagination pinned at bottom */}
                            {(data?.total ?? 0) > limit && (
                                <div className="shrink-0 border-t border-[var(--color-border)] p-2 bg-[var(--color-card)]">
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })}
                                            disabled={page === 1}
                                            className="px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)]/80 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        >‹</button>
                                        <span className="text-xs text-[var(--color-text-muted)] px-2">{page} / {totalPages}</span>
                                        <button
                                            onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })}
                                            disabled={page === totalPages}
                                            className="px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)]/80 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        >›</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: NoteView pane (scrolls independently) */}
                        <div className={`dash-notes-pane-wrapper flex-1 min-w-0 bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] overflow-hidden shadow-sm flex flex-col ${!selectedNoteVideo ? 'hidden lg:flex' : 'flex'}`}>
                            {selectedNoteVideo && (
                                <button
                                    className="lg:hidden p-3 border-b border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center gap-2 bg-black/5 dark:bg-white/5 font-medium hover:text-[var(--color-text)] transition-colors shrink-0"
                                    onClick={() => setSelectedNoteVideo(null)}
                                >
                                    <span>←</span> {t('common.back', 'Back')}
                                </button>
                            )}
                            <DashboardNotesPane video={selectedNoteVideo} />
                        </div>
                    </div>
                )
            }
            </div>

            {
                selectedVideo && (
                    <DetailPanel
                        video={selectedVideo}
                        onClose={() => setSelectedVideo(null)}
                        onRefresh={refetch}
                    />
                )
            }

            {/* Tag Manager Modal */}
            {
                showTagManager && (
                    <TagManager onClose={() => setShowTagManager(false)} />
                )
            }

            {/* Floating Batch Action Bar */}
            {
                selectionMode && (
                    <DashboardBatchActionBar
                        selectedCount={selectedIds.size}
                        includeArchived={includeArchived}
                        onShowBatchTagEditor={() => setShowBatchTagEditor(true)}
                        onShowBatchDeleteConfirm={() => setShowBatchDeleteConfirm(true)}
                        onBatchArchive={handleBatchArchive}
                        onCancelSelection={toggleSelectionMode}
                    />
                )
            }

            {/* Batch Delete Confirm */}
            {
                showBatchDeleteConfirm && (
                    <ConfirmModal
                        isOpen={showBatchDeleteConfirm}
                        title={t('dashboard.batch.delete')}
                        message={t('dashboard.batch.deleteConfirm', { count: selectedIds.size })}
                        confirmText={batchThinking ? t('common.loading') : t('common.delete')}
                        cancelText={t('common.cancel')}
                        variant="danger"
                        onConfirm={handleBatchDelete}
                        onCancel={() => setShowBatchDeleteConfirm(false)}
                    />
                )
            }

            {/* Batch Tag Editor */}
            {
                showBatchTagEditor && (
                    <BatchTagEditor
                        count={selectedIds.size}
                        onConfirm={handleBatchTags}
                        onClose={() => setShowBatchTagEditor(false)}
                    />
                )
            }
        </>
    )
}

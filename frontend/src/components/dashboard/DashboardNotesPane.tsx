/**
 * DashboardNotesPane
 * Right panel for the Dashboard "notes view" mode.
 * Loads segments for the selected video and renders NoteView.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getVideoSegments } from '../../api/client'
import NoteView from '../NoteView'
import SegmentCard from '../SegmentCard'
import Icons from '../ui/Icons'
import type { Video } from '../../api/types'
import { useTranslation } from 'react-i18next'

interface Props {
    video: Video | null
}

export default function DashboardNotesPane({ video }: Props) {
    const { t } = useTranslation()
    const navigate = useNavigate()

    const [viewMode, setViewModeRaw] = useState<'notes' | 'segments'>(() => {
        return (localStorage.getItem('dashboard-notes-viewmode') as 'notes' | 'segments') || 'notes'
    })

    const setViewMode = (mode: 'notes' | 'segments') => {
        setViewModeRaw(mode)
        localStorage.setItem('dashboard-notes-viewmode', mode)
    }

    const { data: segments = [], refetch: refetchSegments } = useQuery({
        queryKey: ['segments', video?.source_id],
        queryFn: () => getVideoSegments(video!.source_id),
        enabled: !!video?.source_id,
    })

    if (!video) {
        return (
            <div className="dash-notes-pane dash-notes-pane--empty flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] min-h-[500px] h-full">
                <div className="dash-notes-placeholder flex flex-col items-center gap-4">
                    <div className="dash-notes-placeholder-icon text-6xl opacity-50">📓</div>
                    <p className="dash-notes-placeholder-title text-lg font-medium text-[var(--color-text)] m-0">{t('dashboard.notesView.placeholder')}</p>
                    <p className="dash-notes-placeholder-desc text-sm max-w-[300px] text-[var(--color-text-muted)] m-0">{t('dashboard.notesView.placeholderDesc')}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="dash-notes-pane flex flex-col h-full w-full relative bg-[var(--color-bg)]">
            {/* Mini tab header */}
            <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-card-muted)] shrink-0">
                <span className="text-xs font-semibold text-[var(--color-text-muted)] tracking-wide truncate pr-4">
                    {video.title || video.source_id}
                </span>
                <div className="flex bg-[var(--color-bg)] p-0.5 rounded-md shrink-0">
                    <button
                        onClick={() => setViewMode('notes')}
                        className={`px-2.5 py-0.5 text-xs font-medium rounded transition-all flex items-center gap-1 ${viewMode === 'notes'
                            ? 'bg-[var(--color-card)] shadow-sm text-[var(--color-text)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                            }`}
                    >
                        <Icons.FileText className="w-3 h-3" />
                        {t('detail.notes.title', '笔记')}
                    </button>
                    <button
                        onClick={() => setViewMode('segments')}
                        className={`px-2.5 py-0.5 text-xs font-medium rounded transition-all flex items-center gap-1 ${viewMode === 'segments'
                            ? 'bg-[var(--color-card)] shadow-sm text-[var(--color-text)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                            }`}
                    >
                        <Icons.List className="w-3 h-3" />
                        {t('detail.transcription.listMode', '片段')}
                    </button>
                </div>
            </div>

            {/* Content — fills remaining space, scrolls internally */}
            <div className="dash-notes-content flex-1 min-h-0 overflow-hidden">
                {viewMode === 'notes' ? (
                    <div className="h-full px-4 pt-2 pb-4 lg:px-5 lg:pt-2 lg:pb-5 overflow-hidden">
                        <NoteView
                            sourceId={video.source_id}
                            segments={segments}
                            video={video}
                            onSeek={() => { }} // no player in dashboard
                            onOpenDetail={() => navigate(`/detail/${encodeURIComponent(video.source_id)}?tab=notes`)}
                        />
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto w-full p-4 lg:p-5">
                        {segments?.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
                                {t('detail.transcription.empty', '暂无转录文本')}
                            </div>
                        ) : (
                            <div className="space-y-4 max-w-4xl mx-auto pb-8">
                                {segments?.map((segment, index) => (
                                    <SegmentCard
                                        key={segment.id}
                                        segment={segment}
                                        isExpandedDefault={index === 0}
                                        onRefresh={refetchSegments}
                                        // onOpenAiModal purposely omitted for a read-only-ish view in Dashboard
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

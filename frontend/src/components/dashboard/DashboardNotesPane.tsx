/**
 * DashboardNotesPane
 * Right panel for the Dashboard "notes view" mode.
 * Loads segments for the selected video and renders NoteView.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getVideoSegments } from '../../api/client'
import NoteView from '../NoteView'
import type { Video } from '../../api/types'
import { useTranslation } from 'react-i18next'

interface Props {
    video: Video | null
}

export default function DashboardNotesPane({ video }: Props) {
    const { t } = useTranslation()
    const navigate = useNavigate()

    const { data: segments = [] } = useQuery({
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
        <div className="dash-notes-pane flex flex-col h-full w-full relative">
            {/* NoteView — fills remaining space, scrolls internally */}
            <div className="dash-notes-content flex-1 min-h-0 overflow-hidden px-4 pt-2 pb-4 lg:px-5 lg:pt-2 lg:pb-5">
                <NoteView
                    sourceId={video.source_id}
                    segments={segments}
                    video={video}
                    onSeek={() => { }} // no player in dashboard
                    onOpenDetail={() => navigate(`/detail/${encodeURIComponent(video.source_id)}?tab=notes`)}
                />
            </div>
        </div>
    )
}

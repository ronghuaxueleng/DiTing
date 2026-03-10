/**
 * DashboardNotesPane
 * Right panel for the Dashboard "notes view" mode.
 * Loads segments for the selected video and renders NoteView.
 */
import { useQuery } from '@tanstack/react-query'
import { getVideoSegments } from '../../api/client'
import NoteView from '../NoteView'
import type { Video } from '../../api/types'
import { useTranslation } from 'react-i18next'

interface Props {
    video: Video | null
}

export default function DashboardNotesPane({ video }: Props) {
    const { t } = useTranslation()

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
            {/* Header */}
            <div className="dash-notes-header flex items-center gap-4 p-4 lg:p-6 border-b border-[var(--color-border)] shrink-0 bg-black/5 dark:bg-white/5">
                <div className="dash-notes-header-cover w-24 h-16 lg:w-32 lg:h-20 shrink-0 rounded overflow-hidden bg-black/10 shadow-sm relative">
                    {video.cover && <img src={video.cover} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="dash-notes-header-info flex flex-col overflow-hidden">
                    <h2 className="dash-notes-header-title text-base lg:text-xl font-semibold text-[var(--color-text)] line-clamp-2 m-0">{video.title}</h2>
                    <span className="dash-notes-header-meta text-xs lg:text-sm text-[var(--color-text-muted)] mt-1">
                        {segments.length} {t('dashboard.notesView.segments')}
                    </span>
                </div>
            </div>

            {/* NoteView */}
            <div className="dash-notes-content flex-1 overflow-y-auto p-4 lg:p-6 min-h-[400px]">
                <NoteView
                    sourceId={video.source_id}
                    segments={segments}
                    onSeek={() => { }} // no player in dashboard
                />
            </div>
        </div>
    )
}

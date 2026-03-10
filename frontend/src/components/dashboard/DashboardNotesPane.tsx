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
            <div className="dash-notes-pane dash-notes-pane--empty">
                <div className="dash-notes-placeholder">
                    <div className="dash-notes-placeholder-icon">📓</div>
                    <p className="dash-notes-placeholder-title">{t('dashboard.notesView.placeholder')}</p>
                    <p className="dash-notes-placeholder-desc">{t('dashboard.notesView.placeholderDesc')}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="dash-notes-pane">
            {/* Header */}
            <div className="dash-notes-header">
                <div className="dash-notes-header-cover">
                    {video.cover && <img src={video.cover} alt="" />}
                </div>
                <div className="dash-notes-header-info">
                    <h2 className="dash-notes-header-title">{video.title}</h2>
                    <span className="dash-notes-header-meta">
                        {segments.length} {t('dashboard.notesView.segments')}
                    </span>
                </div>
            </div>

            {/* NoteView */}
            <div className="dash-notes-content">
                <NoteView
                    sourceId={video.source_id}
                    segments={segments}
                    onSeek={() => { }} // no player in dashboard
                />
            </div>
        </div>
    )
}

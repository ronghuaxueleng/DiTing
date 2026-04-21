import { useState, useEffect } from 'react'
import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
    onBack: () => void
}

const API_BASE = '/api'

export default function FFmpegStep({ onNext, onBack }: Props) {
    const { t } = useLocale()
    const [checking, setChecking] = useState(true)
    const [available, setAvailable] = useState<boolean | null>(null)
    const [version, setVersion] = useState('')

    const checkFFmpeg = async () => {
        setChecking(true)
        setAvailable(null)
        try {
            const resp = await fetch(`${API_BASE}/system/ffmpeg-check`)
            const data = await resp.json()
            setAvailable(data.available)
            setVersion(data.version || '')
        } catch {
            setAvailable(false)
        } finally {
            setChecking(false)
        }
    }

    useEffect(() => {
        checkFFmpeg()
    }, [])

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-bold">{t('ffmpeg.title')}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {t('ffmpeg.desc')}
                </p>
            </div>

            <div
                className="rounded-lg p-4 border"
                style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
            >
                {checking ? (
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {t('ffmpeg.checking')}
                    </p>
                ) : available ? (
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
                            {t('ffmpeg.found')}
                        </p>
                        {version && (
                            <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                                {version}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>
                            {t('ffmpeg.notFound')}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {t('ffmpeg.installHint')}
                        </p>
                    </div>
                )}
            </div>

            {!checking && !available && (
                <div
                    className="rounded-lg p-3 text-xs border"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                    <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{t('ffmpeg.guideTitle')}</p>
                    <p style={{ whiteSpace: 'pre-line' }}>{t('ffmpeg.guide')}</p>
                </div>
            )}

            {!checking && !available && (
                <button
                    onClick={checkFFmpeg}
                    className="self-start px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {t('ffmpeg.recheck')}
                </button>
            )}

            <div className="flex justify-between mt-auto pt-4">
                <button
                    onClick={onBack}
                    className="px-4 py-2 rounded-lg text-sm border transition-colors"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                    {t('common.back')}
                </button>
                <button
                    onClick={onNext}
                    className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {available ? t('common.next') : t('common.skip')}
                </button>
            </div>
        </div>
    )
}

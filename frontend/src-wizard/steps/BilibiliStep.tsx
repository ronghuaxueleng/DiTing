import { useState } from 'react'
import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
    onBack: () => void
}

const API_BASE = '/api'

export default function BilibiliStep({ onNext, onBack }: Props) {
    const { t } = useLocale()
    const [sessdata, setSessdata] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [success, setSuccess] = useState<boolean | null>(null)

    const saveCookie = async () => {
        if (!sessdata.trim()) return
        setSaving(true)
        setMessage('')
        try {
            const resp = await fetch(`${API_BASE}/system/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'bilibili_sessdata', value: sessdata.trim() }),
            })
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            setSuccess(true)
            setMessage(t('bili.saved'))
        } catch (e) {
            setSuccess(false)
            setMessage(`${t('common.failed')}${e instanceof Error ? e.message : 'Unknown error'}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-bold">{t('bili.title')}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {t('bili.desc')}
                </p>
            </div>

            {/* Tip box */}
            <div
                className="flex gap-2 px-3 py-2.5 rounded-lg text-xs leading-relaxed"
                style={{ background: 'var(--color-primary-bg, rgba(59,130,246,0.08))', color: 'var(--color-text-muted)' }}
            >
                <span className="shrink-0 mt-0.5">💡</span>
                <span>{t('bili.tip')}</span>
            </div>

            <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    SESSDATA
                </label>
                <input
                    type="password"
                    value={sessdata}
                    onChange={e => setSessdata(e.target.value)}
                    placeholder={t('bili.placeholder')}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('bili.hint')}
                </p>

                <button
                    onClick={saveCookie}
                    disabled={saving || !sessdata.trim()}
                    className="self-start px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {saving ? t('bili.saving') : t('bili.save')}
                </button>

                {message && (
                    <p className="text-sm" style={{ color: success ? 'var(--color-success)' : 'var(--color-error)' }}>
                        {message}
                    </p>
                )}
            </div>

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
                    {success ? t('common.next') : t('common.skip')}
                </button>
            </div>
        </div>
    )
}

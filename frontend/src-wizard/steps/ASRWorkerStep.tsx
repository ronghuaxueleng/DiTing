import { useState } from 'react'
import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
    onBack: () => void
}

interface WorkerStatus {
    testing: boolean
    success: boolean | null
    message: string
}

const API_BASE = '/api'

export default function ASRWorkerStep({ onNext, onBack }: Props) {
    const { t } = useLocale()
    const [engine, setEngine] = useState('sensevoice')
    const [workerUrl, setWorkerUrl] = useState('http://localhost:8001')
    const [status, setStatus] = useState<WorkerStatus>({ testing: false, success: null, message: '' })

    const testConnection = async () => {
        setStatus({ testing: true, success: null, message: t('asr.testingMsg') })
        try {
            // Send URL-keyed format (new): {workers: {url: {}}}
            const resp = await fetch(`${API_BASE}/asr/workers`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: [workerUrl] }),
            })
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

            const statusResp = await fetch(`${API_BASE}/asr/status?refresh=true`)
            const data = await statusResp.json()
            // Check if any worker is online
            const anyOnline = Object.values(data.workers || {}).some((w: any) => w.online)
            if (anyOnline) {
                setStatus({ testing: false, success: true, message: t('asr.success.online') })
            } else {
                setStatus({ testing: false, success: true, message: t('asr.success.configured') })
            }
        } catch (e) {
            setStatus({ testing: false, success: false, message: `${t('common.failed')}${e instanceof Error ? e.message : 'Unknown error'}` })
        }
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-bold">{t('asr.title')}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {t('asr.desc')}
                </p>
            </div>

            <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    {t('asr.engine')}
                </label>
                <select
                    value={engine}
                    onChange={e => setEngine(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                    <option value="sensevoice">{t('asr.engine.sensevoice')}</option>
                    <option value="whisper">{t('asr.engine.whisper')}</option>
                    <option value="qwen3asr">{t('asr.engine.qwen3asr')}</option>
                    <option value="bailian">{t('asr.engine.bailian')}</option>
                </select>

                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    {t('asr.workerUrl')}
                </label>
                <input
                    type="text"
                    value={workerUrl}
                    onChange={e => setWorkerUrl(e.target.value)}
                    placeholder="http://localhost:8001"
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />

                <button
                    onClick={testConnection}
                    disabled={status.testing || !workerUrl}
                    className="self-start px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {status.testing ? t('asr.testing') : t('asr.testSave')}
                </button>

                {status.message && (
                    <p className="text-sm" style={{ color: status.success ? 'var(--color-success)' : status.success === false ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                        {status.message}
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
                    {status.success ? t('common.next') : t('common.skip')}
                </button>
            </div>
        </div>
    )
}

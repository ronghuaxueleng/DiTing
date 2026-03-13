import { useState } from 'react'
import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
    onBack: () => void
}

const API_BASE = '/api'

export default function LLMSetupStep({ onNext, onBack }: Props) {
    const { t } = useLocale()
    const [name, setName] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [success, setSuccess] = useState<boolean | null>(null)

    const saveProvider = async () => {
        if (!name || !baseUrl || !apiKey) return
        setSaving(true)
        setMessage('')
        try {
            const resp = await fetch(`${API_BASE}/settings/llm/providers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, base_url: baseUrl, api_key: apiKey }),
            })
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            setSuccess(true)
            setMessage(t('llm.saved'))
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
                <h2 className="text-lg font-bold">{t('llm.title')}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {t('llm.desc')}
                </p>
            </div>

            <div className="flex flex-col gap-3">
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('llm.name')}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder={t('llm.baseUrl')}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={t('llm.apiKey')}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />

                <button
                    onClick={saveProvider}
                    disabled={saving || !name || !baseUrl || !apiKey}
                    className="self-start px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {saving ? t('llm.saving') : t('llm.save')}
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

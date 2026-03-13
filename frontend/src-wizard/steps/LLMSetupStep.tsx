import { useState } from 'react'

interface Props {
    onNext: () => void
    onBack: () => void
}

const API_BASE = '/api'

export default function LLMSetupStep({ onNext, onBack }: Props) {
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
            setMessage('LLM provider saved!')
        } catch (e) {
            setSuccess(false)
            setMessage(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-bold">LLM Configuration (Optional)</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    Add an OpenAI-compatible LLM provider for AI analysis. You can skip this and configure it later.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Provider name (e.g. OpenAI)"
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="Base URL (e.g. https://api.openai.com/v1)"
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="API Key"
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />

                <button
                    onClick={saveProvider}
                    disabled={saving || !name || !baseUrl || !apiKey}
                    className="self-start px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {saving ? 'Saving...' : 'Save Provider'}
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
                    Back
                </button>
                <button
                    onClick={onNext}
                    className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {success ? 'Next' : 'Skip'}
                </button>
            </div>
        </div>
    )
}

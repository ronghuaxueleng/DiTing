import { useState } from 'react'

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
    const [engine, setEngine] = useState('sensevoice')
    const [workerUrl, setWorkerUrl] = useState('http://localhost:8001')
    const [status, setStatus] = useState<WorkerStatus>({ testing: false, success: null, message: '' })

    const testConnection = async () => {
        setStatus({ testing: true, success: null, message: 'Testing connection...' })
        try {
            const resp = await fetch(`${API_BASE}/asr/workers`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workers: { [engine]: workerUrl } }),
            })
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

            // Check status
            const statusResp = await fetch(`${API_BASE}/asr/status?refresh=true`)
            const data = await statusResp.json()
            const worker = data.workers?.[engine]
            if (worker?.status === 'online') {
                setStatus({ testing: false, success: true, message: 'Worker connected successfully!' })
            } else {
                setStatus({ testing: false, success: true, message: 'Worker configured. It will connect when available.' })
            }
        } catch (e) {
            setStatus({ testing: false, success: false, message: `Failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
        }
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-bold">ASR Worker Setup</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    DiTing needs an ASR worker for speech recognition. Configure the worker address below,
                    or skip if you'll set it up later.
                </p>
            </div>

            <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    Engine
                </label>
                <select
                    value={engine}
                    onChange={e => setEngine(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                    <option value="sensevoice">SenseVoice (Recommended)</option>
                    <option value="whisper">Whisper</option>
                    <option value="qwen3asr">Qwen3-ASR</option>
                    <option value="bailian">Bailian (Cloud)</option>
                </select>

                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    Worker URL
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
                    {status.testing ? 'Testing...' : 'Test & Save'}
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
                    Back
                </button>
                <button
                    onClick={onNext}
                    className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: 'var(--color-primary)' }}
                >
                    {status.success ? 'Next' : 'Skip'}
                </button>
            </div>
        </div>
    )
}

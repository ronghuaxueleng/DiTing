import { useState } from 'react'
import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
    onBack: () => void
}

const API_BASE = '/api'

type Phase = 'provider' | 'models' | 'done'

interface RemoteModel {
    id: string
    owned_by?: string
    already_added?: boolean
}

export default function LLMSetupStep({ onNext, onBack }: Props) {
    const { t } = useLocale()
    const [name, setName] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [success, setSuccess] = useState<boolean | null>(null)

    // Model discovery state
    const [phase, setPhase] = useState<Phase>('provider')
    const [providerId, setProviderId] = useState<number | null>(null)
    const [models, setModels] = useState<RemoteModel[]>([])
    const [selectedModel, setSelectedModel] = useState('')
    const [manualModel, setManualModel] = useState('')
    const [isManual, setIsManual] = useState(false)
    const [activating, setActivating] = useState(false)
    const [fetchingModels, setFetchingModels] = useState(false)

    // Compute endpoint preview and validation
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    const previewUrl = trimmedBaseUrl ? `POST ${trimmedBaseUrl}/chat/completions` : ''
    const missingV1 = trimmedBaseUrl.length > 0 && !trimmedBaseUrl.endsWith('/v1')

    const fetchModels = async (pid: number) => {
        setFetchingModels(true)
        setMessage(t('llm.fetchingModels'))
        setSuccess(null)
        try {
            const resp = await fetch(`${API_BASE}/settings/llm/providers/${pid}/available-models`)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            const data = await resp.json()

            // Backend returns { success, models, message }
            if (!data.success) {
                throw new Error(data.message || 'Unknown error')
            }

            const modelList: RemoteModel[] = data.models || []
            if (modelList.length > 0) {
                setModels(modelList)
                setSelectedModel(modelList[0]?.id ?? '')
                setIsManual(false)
                setMessage('')
                setSuccess(null)
            } else {
                setModels([])
                setIsManual(true)
                setMessage(t('llm.noModels'))
                setSuccess(false)
            }
            setPhase('models')
        } catch (e) {
            // Fallback to manual entry
            setModels([])
            setIsManual(true)
            const errMsg = e instanceof Error ? e.message : 'Unknown error'
            setMessage(`${t('llm.noModels')} (${errMsg})`)
            setSuccess(false)
            setPhase('models')
        } finally {
            setFetchingModels(false)
        }
    }

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
            const data = await resp.json()
            const pid = data.id ?? data.provider?.id
            setProviderId(pid)
            setSuccess(true)
            setMessage(t('llm.saved'))
            // Auto-fetch models after short delay so user sees the success message
            if (pid) {
                setTimeout(() => fetchModels(pid), 500)
            }
        } catch (e) {
            setSuccess(false)
            setMessage(`${t('common.failed')}${e instanceof Error ? e.message : 'Unknown error'}`)
        } finally {
            setSaving(false)
        }
    }

    const activateModel = async () => {
        const modelName = isManual ? manualModel.trim() : selectedModel
        if (!modelName || !providerId) return
        setActivating(true)
        setMessage('')
        try {
            // Batch add model
            const addResp = await fetch(`${API_BASE}/settings/llm/providers/${providerId}/models/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_names: [modelName] }),
            })
            if (!addResp.ok) throw new Error(`Add model failed: HTTP ${addResp.status}`)
            const addData = await addResp.json()
            // Get the new model's ID from the response
            const newModelId = addData.models?.[0]?.id ?? addData[0]?.id
            if (!newModelId) throw new Error('No model ID returned')

            // Activate model
            const actResp = await fetch(`${API_BASE}/settings/llm/models/${newModelId}/activate`, {
                method: 'POST',
            })
            if (!actResp.ok) throw new Error(`Activate failed: HTTP ${actResp.status}`)

            setSuccess(true)
            setMessage(t('llm.activated'))
            setPhase('done')
        } catch (e) {
            setSuccess(false)
            setMessage(`${t('common.failed')}${e instanceof Error ? e.message : 'Unknown error'}`)
        } finally {
            setActivating(false)
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

            {/* Phase 1: Provider setup */}
            {phase === 'provider' && (
                <div className="flex flex-col gap-3">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={t('llm.name')}
                        className="px-3 py-2 rounded-lg text-sm border outline-none"
                        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="text"
                            value={baseUrl}
                            onChange={e => setBaseUrl(e.target.value)}
                            placeholder={t('llm.baseUrl')}
                            className="px-3 py-2 rounded-lg text-sm border outline-none"
                            style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        />
                        {/* Endpoint preview */}
                        {previewUrl && (
                            <div className="px-3 py-2 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                                <div className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
                                    <span>⚡</span>
                                    <span>{t('llm.endpointPreview') || 'Endpoint Preview'}</span>
                                </div>
                                <code className="text-xs font-mono break-all" style={{ color: 'var(--color-text)' }}>{previewUrl}</code>
                            </div>
                        )}
                        {missingV1 && (
                            <p className="flex items-center gap-1 text-[11px]" style={{ color: '#f59e0b' }}>
                                <span>⚠️</span>
                                <span>{t('llm.baseUrlHint') || 'Most OpenAI-compatible APIs require /v1 suffix (e.g., https://api.example.com/v1)'}</span>
                            </p>
                        )}
                    </div>
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
                        <p className="text-sm" style={{ color: success ? 'var(--color-success)' : success === false ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                            {message}
                        </p>
                    )}
                </div>
            )}

            {/* Phase 2: Model selection */}
            {phase === 'models' && (
                <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {t('llm.selectModel')}
                    </p>

                    {models.length > 0 && !isManual && (
                        <>
                            <div
                                className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border p-2"
                                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                            >
                                {models.map(m => (
                                    <label
                                        key={m.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors"
                                        style={{
                                            background: selectedModel === m.id ? 'var(--color-primary-light, rgba(99,102,241,0.1))' : 'transparent',
                                            color: 'var(--color-text)',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="model"
                                            checked={selectedModel === m.id}
                                            onChange={() => setSelectedModel(m.id)}
                                            className="accent-[var(--color-primary)]"
                                        />
                                        <span className="font-mono text-xs">{m.id}</span>
                                    </label>
                                ))}
                            </div>
                            <button
                                onClick={() => setIsManual(true)}
                                className="self-start text-xs underline"
                                style={{ color: 'var(--color-text-muted)' }}
                            >
                                {t('llm.modelManual')}
                            </button>
                        </>
                    )}

                    {isManual && (
                        <div className="flex flex-col gap-2">
                            {models.length === 0 && (
                                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('llm.noModels')}
                                </p>
                            )}
                            <input
                                type="text"
                                value={manualModel}
                                onChange={e => setManualModel(e.target.value)}
                                placeholder={t('llm.modelPlaceholder')}
                                className="px-3 py-2 rounded-lg text-sm border outline-none"
                                style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                            />
                            {models.length > 0 && (
                                <button
                                    onClick={() => { setIsManual(false); setManualModel('') }}
                                    className="self-start text-xs underline"
                                    style={{ color: 'var(--color-text-muted)' }}
                                >
                                    {t('llm.selectModel')}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            onClick={activateModel}
                            disabled={activating || (isManual ? !manualModel.trim() : !selectedModel)}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                            style={{ background: 'var(--color-primary)' }}
                        >
                            {activating ? t('llm.activating') : t('llm.addAndActivate')}
                        </button>
                        {/* Retry button */}
                        {providerId && (
                            <button
                                onClick={() => fetchModels(providerId)}
                                disabled={fetchingModels}
                                className="px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50"
                                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                            >
                                {fetchingModels ? t('llm.fetchingModels') : t('llm.retryFetch')}
                            </button>
                        )}
                    </div>

                    {message && (
                        <p className="text-sm" style={{ color: success ? 'var(--color-success)' : 'var(--color-error)' }}>
                            {message}
                        </p>
                    )}
                </div>
            )}

            {/* Phase 3: Done */}
            {phase === 'done' && (
                <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
                    {t('llm.activated')}
                </p>
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
                    {phase === 'done' || (phase === 'provider' && success) ? t('common.next') : t('common.skip')}
                </button>
            </div>
        </div>
    )
}

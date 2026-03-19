import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

type HardwareInfo = {
    cpu_name: string
    cpu_cores: number
    ram_gb: number
    has_cuda: boolean
    gpu_name: string
    vram_mb: number
    cuda_version?: string | null
    has_mps: boolean
    recommended_device: string
    compute_key: string
}

type EngineInfo = {
    engine_id: string
    display_name: string
    install_dir: string
    port: number
    installed_at: string
    last_started?: string | null
}

type ManagerState = {
    engines: Record<string, EngineInfo>
}

type WorkerStatus = {
    running: boolean
    healthy: boolean
    url: string
    engine: string
    loaded: boolean
    model_id?: string | null
    device?: string | null
    management: boolean
}

type InstallPathInfo = {
    default_base_install_dir: string
    default_engine_install_dir: string
}

type InstallProgressPayload = {
    engine_id: string
    step_key: string
    step_label: string
    step_index: number
    step_total: number
    completed_steps: number
    message: string
    install_dir: string
    done: boolean
    error?: string | null
}

type InstallLogEntry = {
    step_key: string
    step_index: number
    step_total: number
    message: string
    error?: string | null
}

type ManagedModel = {
    id: string
    engine: string
    model_id: string
    display_name: string
    download_size_mb: number
    vram_required_mb: number
    accuracy: number
    speed: number
    supports_mps: boolean
    description: string
    tags: string[]
    compatible: boolean
    reason: string
    installed: boolean
    active: boolean
    deps_installed: boolean
}

type WorkerModelsResponse = {
    models: ManagedModel[]
    active_model_id?: string | null
}

type WorkerOperationResponse = {
    operation_id?: string | null
    status?: string | null
    model_id?: string | null
    from?: string | null
    to?: string | null
}

type WorkerOperationStatus = {
    id: string
    type: string
    status: string
    detail: string
    progress: string[]
    result?: unknown
    error?: string | null
    created_at: number
    completed_at?: number | null
}

const DEFAULT_PORT = 8001
const buttonBaseClass =
    'px-3 py-1.5 rounded text-sm border transition-all duration-150 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:active:translate-y-0 disabled:active:scale-100'
const primaryButtonStyle = {
    borderColor: 'transparent',
    background: 'var(--color-primary)',
    color: 'white',
}
const secondaryButtonStyle = {
    borderColor: 'var(--color-border)',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
}
const dangerButtonStyle = {
    borderColor: 'transparent',
    background: 'var(--color-error)',
    color: 'white',
}
const activeButtonStyle = {
    borderColor: 'rgba(16,185,129,0.35)',
    background: 'rgba(16,185,129,0.08)',
    color: 'var(--color-success)',
}
const dangerOutlineButtonStyle = {
    borderColor: 'rgba(239,68,68,0.35)',
    background: 'var(--color-card)',
    color: 'var(--color-error)',
}

export default function WorkerManagerApp() {
    const { t, i18n } = useTranslation()
    const [hardware, setHardware] = useState<HardwareInfo | null>(null)
    const [state, setState] = useState<ManagerState | null>(null)
    const [installPathInfo, setInstallPathInfo] = useState<InstallPathInfo | null>(null)
    const [installing, setInstalling] = useState(false)
    const [installDir, setInstallDir] = useState('')
    const [installProgress, setInstallProgress] = useState<InstallProgressPayload | null>(null)
    const [installLog, setInstallLog] = useState<InstallLogEntry[]>([])
    const [modelId, setModelId] = useState('tiny')
    const [useMirror, setUseMirror] = useState(false)
    const [proxy, setProxy] = useState('')
    const [port, setPort] = useState(DEFAULT_PORT)
    const [status, setStatus] = useState<WorkerStatus | null>(null)
    const [models, setModels] = useState<ManagedModel[]>([])
    const [modelsError, setModelsError] = useState<string | null>(null)
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelActionMessage, setModelActionMessage] = useState<string | null>(null)
    const [operationStatus, setOperationStatus] = useState<WorkerOperationStatus | null>(null)
    const [operationPolling, setOperationPolling] = useState<string | null>(null)
    const [actionPending, setActionPending] = useState<string | null>(null)
    const [modelsExpanded, setModelsExpanded] = useState(true)

    const engineId = 'whisper-openai'
    const installedEngine = state?.engines?.[engineId] ?? null
    const installed = !!installedEngine

    const effectiveInstallDir = useMemo(() => {
        return installDir.trim() || installPathInfo?.default_engine_install_dir || ''
    }, [installDir, installPathInfo])

    const progressPercent = useMemo(() => {
        if (!installProgress) {
            return 0
        }
        if (installProgress.done && !installProgress.error) {
            return 100
        }
        return Math.max(0, Math.min(100, Math.round((installProgress.step_index / installProgress.step_total) * 100)))
    }, [installProgress])

    const installStepLabel = useMemo(() => {
        if (!installProgress) {
            return ''
        }
        return t(`workerManager.install.steps.${installProgress.step_key}`, {
            defaultValue: installProgress.step_label,
        })
    }, [installProgress, t, i18n.language])

    const installLogText = useMemo(() => {
        return installLog
            .map((entry) => {
                const stepLabel = t(`workerManager.install.steps.${entry.step_key}`, {
                    defaultValue: entry.step_key,
                })
                const prefix = `[${entry.step_index}/${entry.step_total}] ${stepLabel}`
                const suffix = entry.error ? ` ${t('common.error')}: ${entry.error}` : ''
                return `${prefix}: ${entry.message}${suffix}`
            })
            .join('\n')
    }, [installLog, t, i18n.language])

    const installedModelCount = useMemo(() => models.filter((model) => model.installed).length, [models])
    const currentLanguage = i18n.resolvedLanguage || i18n.language || 'zh'
    const hasBusyOperation = !!operationPolling || !!actionPending

    const yesNoLabel = (value: boolean) => (value ? 'Yes' : 'No')

    function renderStars(value: number) {
        const count = Math.max(0, Math.min(5, Math.round(value)))
        return (
            <span
                className="inline-flex items-center gap-0.5"
                aria-label={t('workerManager.modelManagement.accuracyAriaLabel', { value: count })}
            >
                {Array.from({ length: 5 }, (_, index) => (
                    <span
                        key={index}
                        style={{ color: index < count ? '#f59e0b' : 'var(--color-text-muted)' }}
                    >
                        {index < count ? '★' : '☆'}
                    </span>
                ))}
            </span>
        )
    }

    function renderSpeedBars(value: number) {
        const count = Math.max(0, Math.min(5, Math.round(value)))
        const heights = ['0.5rem', '0.65rem', '0.8rem', '0.95rem', '1.1rem']

        return (
            <span
                className="inline-flex items-end gap-0.5"
                aria-label={t('workerManager.modelManagement.speedAriaLabel', { value: count })}
            >
                {heights.map((height, index) => (
                    <span
                        key={index}
                        className="w-1 rounded-sm"
                        style={{
                            height,
                            background: index < count ? 'var(--color-primary)' : 'rgba(148, 163, 184, 0.35)',
                        }}
                    />
                ))}
            </span>
        )
    }

    function renderBooleanBadge(label: string, value: boolean) {
        return (
            <span
                className="px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 text-xs"
                style={
                    value
                        ? {
                              borderColor: 'rgba(16,185,129,0.28)',
                              background: 'rgba(16,185,129,0.10)',
                              color: 'var(--color-success)',
                          }
                        : {
                              borderColor: 'rgba(148,163,184,0.28)',
                              background: 'rgba(148,163,184,0.10)',
                              color: 'var(--color-text-muted)',
                          }
                }
            >
                <span>{label}</span>
                <span>{yesNoLabel(value)}</span>
            </span>
        )
    }

    async function changeLanguage(language: 'zh' | 'en') {
        await i18n.changeLanguage(language)
        localStorage.setItem('language', language)
    }

    async function refreshState() {
        const s = await invoke<ManagerState>('get_manager_state')
        setState(s)
    }

    async function refreshInstallPathInfo() {
        const info = await invoke<InstallPathInfo>('get_install_path_info')
        setInstallPathInfo(info)
        setInstallDir((prev) => prev.trim() || info.default_engine_install_dir)
    }

    async function refreshWorkerStatus() {
        try {
            const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
            setStatus(s)
            return s
        } catch {
            setStatus(null)
            return null
        }
    }

    async function refreshModels() {
        setLoadingModels(true)
        setModelsError(null)
        try {
            const response = await invoke<WorkerModelsResponse>('list_worker_models', { engineId })
            setModels(response.models)
            return response.models
        } catch (e) {
            const message = String(e)
            setModels([])
            setModelsError(message)
            return []
        } finally {
            setLoadingModels(false)
        }
    }

    useEffect(() => {
        document.title = t('workerManager.title')
    }, [t, i18n.language])

    useEffect(() => {
        void (async () => {
            const [hw] = await Promise.all([invoke<HardwareInfo>('detect_hardware'), refreshState(), refreshInstallPathInfo()])
            setHardware(hw)
        })()
    }, [])

    useEffect(() => {
        if (installedEngine?.install_dir) {
            setInstallDir(installedEngine.install_dir)
            setPort(installedEngine.port)
        }
    }, [installedEngine])

    useEffect(() => {
        if (!installed) {
            setModels([])
            setModelsError(null)
            setStatus(null)
            return
        }

        void refreshWorkerStatus()
    }, [installed])

    useEffect(() => {
        if (!status?.running || !status.management) {
            if (!status?.running) {
                setModels([])
            }
            return
        }

        void refreshModels()
    }, [status?.running, status?.management])

    useEffect(() => {
        if (!operationPolling) {
            return
        }

        const timer = window.setInterval(() => {
            void (async () => {
                try {
                    const op = await invoke<WorkerOperationStatus>('get_worker_operation_status', {
                        engineId,
                        operationId: operationPolling,
                    })
                    setOperationStatus(op)
                    if (op.status === 'completed' || op.status === 'failed') {
                        window.clearInterval(timer)
                        setOperationPolling(null)
                        setActionPending(null)
                        void refreshWorkerStatus()
                        if (op.status === 'completed') {
                            void refreshModels()
                        }
                    }
                } catch (e) {
                    setOperationStatus(null)
                    setOperationPolling(null)
                    setActionPending(null)
                    setModelActionMessage(
                        t('workerManager.modelManagement.messages.pollingFailed', { error: String(e) }),
                    )
                    window.clearInterval(timer)
                }
            })()
        }, 1000)

        return () => window.clearInterval(timer)
    }, [operationPolling, t, i18n.language])

    useEffect(() => {
        let unlisten: null | (() => void) = null
        void (async () => {
            const u = await listen<InstallProgressPayload>('install-progress', (e) => {
                const payload = e.payload

                setInstallProgress(payload)
                setInstallDir(payload.install_dir)
                setInstallLog((prev) => [
                    ...prev,
                    {
                        step_key: payload.step_key,
                        step_index: payload.step_index,
                        step_total: payload.step_total,
                        message: payload.message,
                        error: payload.error,
                    },
                ])

                if (payload.done) {
                    setInstalling(false)
                    void refreshState()
                }
            })
            unlisten = u
        })()
        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [])

    async function doBrowseInstallDir() {
        const selected = await open({
            directory: true,
            multiple: false,
            title: t('workerManager.install.browseDialogTitle'),
            defaultPath: effectiveInstallDir || installPathInfo?.default_base_install_dir,
        })
        const path = Array.isArray(selected) ? selected[0] : selected
        if (path) {
            setInstallDir(path)
        }
    }

    async function doInstall() {
        setInstalling(true)
        setInstallLog([])
        setInstallProgress(null)

        try {
            await invoke('install_whisper_engine', {
                port,
                modelId,
                useMirror,
                proxy,
                installDir: effectiveInstallDir,
            })
        } catch (e) {
            const message = String(e)
            setInstalling(false)
            setInstallProgress((prev) =>
                prev ?? {
                    engine_id: engineId,
                    step_key: 'failed',
                    step_label: t('workerManager.install.failed'),
                    step_index: 1,
                    step_total: 1,
                    completed_steps: 0,
                    message,
                    install_dir: effectiveInstallDir,
                    done: true,
                    error: message,
                },
            )
            setInstallLog((prev) => [
                ...prev,
                {
                    step_key: 'failed',
                    step_index: 1,
                    step_total: 1,
                    message,
                    error: message,
                },
            ])
        }
    }

    async function doUninstall() {
        setActionPending('uninstall')
        setModelActionMessage(null)
        try {
            await invoke('uninstall_engine', { engineId })
            await refreshState()
            setStatus(null)
            setModels([])
            setOperationStatus(null)
            setModelActionMessage(null)
        } finally {
            setActionPending(null)
        }
    }

    async function doStart() {
        setActionPending('start')
        setModelActionMessage(null)
        try {
            await invoke('start_worker', { engineId })
            const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
            setStatus(s)
        } finally {
            setActionPending(null)
        }
    }

    async function doStop() {
        setActionPending('stop')
        setModelActionMessage(null)
        try {
            await invoke('stop_worker', { engineId })
            const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
            setStatus(s)
            setModels([])
        } finally {
            setActionPending(null)
        }
    }

    async function doCheck() {
        setActionPending('check')
        setModelActionMessage(null)
        try {
            const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
            setStatus(s)
        } finally {
            setActionPending(null)
        }
    }

    async function trackOperation(response: WorkerOperationResponse, fallbackMessage: string) {
        setActionPending(null)
        if (response.operation_id) {
            setModelActionMessage(fallbackMessage)
            setOperationStatus(null)
            setOperationPolling(response.operation_id)
        } else {
            setModelActionMessage(response.status || fallbackMessage)
            void refreshWorkerStatus()
            void refreshModels()
        }
    }

    async function doDownloadModel(managedModelId: string) {
        setActionPending(`download:${managedModelId}`)
        try {
            const response = await invoke<WorkerOperationResponse>('download_worker_model', {
                engineId,
                modelId: managedModelId,
                useMirror,
                proxy,
            })
            await trackOperation(
                response,
                t('workerManager.modelManagement.messages.downloading', { modelId: managedModelId }),
            )
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(
                t('workerManager.modelManagement.messages.downloadFailed', { error: String(e) }),
            )
        }
    }

    async function doActivateModel(managedModelId: string) {
        setActionPending(`activate:${managedModelId}`)
        try {
            const response = await invoke<WorkerOperationResponse>('activate_worker_model', {
                engineId,
                modelId: managedModelId,
            })
            await trackOperation(
                response,
                t('workerManager.modelManagement.messages.activating', { modelId: managedModelId }),
            )
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(
                t('workerManager.modelManagement.messages.activateFailed', { error: String(e) }),
            )
        }
    }

    async function doDeleteModel(managedModelId: string) {
        setActionPending(`delete:${managedModelId}`)
        try {
            await invoke('delete_worker_model', {
                engineId,
                modelId: managedModelId,
            })
            setModelActionMessage(t('workerManager.modelManagement.messages.deleted', { modelId: managedModelId }))
            void refreshWorkerStatus()
            void refreshModels()
        } catch (e) {
            setModelActionMessage(t('workerManager.modelManagement.messages.deleteFailed', { error: String(e) }))
        } finally {
            setActionPending(null)
        }
    }

    async function doUnloadModel() {
        setActionPending('unload')
        try {
            await invoke('unload_worker_model', { engineId })
            setModelActionMessage(t('workerManager.modelManagement.messages.unloaded'))
            void refreshWorkerStatus()
            void refreshModels()
        } catch (e) {
            setModelActionMessage(t('workerManager.modelManagement.messages.unloadFailed', { error: String(e) }))
        } finally {
            setActionPending(null)
        }
    }

    return (
        <div className="min-h-screen p-6" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div className="max-w-5xl mx-auto flex flex-col gap-4">
                <header className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-xl font-semibold">{t('workerManager.title')}</h1>
                        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <div
                            className="inline-flex rounded-md overflow-hidden border"
                            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                        >
                            {(['zh', 'en'] as const).map((language) => {
                                const active = currentLanguage === language
                                return (
                                    <button
                                        key={language}
                                        className="px-3 py-1.5 text-sm transition-colors"
                                        style={
                                            active
                                                ? {
                                                      background: 'var(--color-primary)',
                                                      color: 'white',
                                                  }
                                                : {
                                                      background: 'transparent',
                                                      color: 'var(--color-text)',
                                                  }
                                        }
                                        onClick={() => void changeLanguage(language)}
                                    >
                                        {t(`workerManager.language.${language}`)}
                                    </button>
                                )
                            })}
                        </div>
                        <button
                            className={buttonBaseClass}
                            style={secondaryButtonStyle}
                            onClick={() => void refreshState()}
                        >
                            {t('workerManager.actions.refresh')}
                        </button>
                    </div>
                </header>

                <section
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                >
                    <h2 className="font-semibold">{t('workerManager.hardware.title')}</h2>
                    {!hardware ? (
                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.hardware.detecting')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                            <div>
                                {t('workerManager.hardware.cpu')}: {hardware.cpu_name} ({hardware.cpu_cores} cores)
                            </div>
                            <div>
                                {t('workerManager.hardware.ram')}: {hardware.ram_gb} GB
                            </div>
                            <div>
                                {t('workerManager.hardware.cuda')}: {yesNoLabel(hardware.has_cuda)}
                                {hardware.gpu_name ? ` (${hardware.gpu_name}, ${hardware.vram_mb}MB)` : ''}
                            </div>
                            <div>
                                {t('workerManager.hardware.mps')}: {yesNoLabel(hardware.has_mps)}
                            </div>
                            <div>
                                {t('workerManager.hardware.recommended')}: {hardware.recommended_device}
                            </div>
                            <div>
                                {t('workerManager.hardware.computeKey')}: {hardware.compute_key}
                            </div>
                        </div>
                    )}
                </section>

                <section
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                >
                    <h2 className="font-semibold">{t('workerManager.engine.title')}</h2>
                    <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        {t('workerManager.engine.installStatus')}: {installed
                            ? t('workerManager.engine.installedState')
                            : t('workerManager.engine.notInstalledState')}
                    </div>

                    {!installed ? (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                <div className="font-medium">{t('workerManager.install.locationTitle')}</div>
                                <div className="mt-2 flex gap-2">
                                    <input
                                        className="border rounded px-2 py-1 flex-1"
                                        style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                        value={installDir}
                                        disabled={installing}
                                        onChange={(e) => setInstallDir(e.target.value)}
                                    />
                                    <button
                                        className={buttonBaseClass}
                                        style={secondaryButtonStyle}
                                        disabled={installing}
                                        onClick={() => void doBrowseInstallDir()}
                                    >
                                        {t('workerManager.install.browse')}
                                    </button>
                                </div>
                                <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.install.locationHint')}
                                </div>
                                {installPathInfo ? (
                                    <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.install.defaultBase', {
                                            path: installPathInfo.default_base_install_dir,
                                        })}
                                    </div>
                                ) : null}
                                <div className="mt-2 text-sm break-all">
                                    <span style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.install.currentTarget')}:
                                    </span>{' '}
                                    {effectiveInstallDir || t('workerManager.common.notSet')}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <label className="text-sm flex flex-col gap-1">
                                    {t('workerManager.install.port')}
                                    <input
                                        type="number"
                                        className="border rounded px-2 py-1"
                                        style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                        value={port}
                                        disabled={installing}
                                        onChange={(e) => setPort(Number(e.target.value) || DEFAULT_PORT)}
                                    />
                                </label>
                                <label className="text-sm flex flex-col gap-1">
                                    {t('workerManager.install.initialModel')}
                                    <select
                                        className="border rounded px-2 py-1"
                                        style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                        value={modelId}
                                        disabled={installing}
                                        onChange={(e) => setModelId(e.target.value)}
                                    >
                                        <option value="tiny">tiny</option>
                                        <option value="small">small</option>
                                        <option value="medium">medium</option>
                                        <option value="large-v3-turbo">large-v3-turbo</option>
                                    </select>
                                </label>
                            </div>

                            <label className="text-sm flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={useMirror}
                                    disabled={installing}
                                    onChange={(e) => setUseMirror(e.target.checked)}
                                />
                                {t('workerManager.install.useMirror')}
                            </label>

                            <label className="text-sm flex flex-col gap-1">
                                {t('workerManager.install.proxy')}
                                <input
                                    className="border rounded px-2 py-1"
                                    style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                    placeholder={t('workerManager.install.proxyPlaceholder')}
                                    value={proxy}
                                    disabled={installing}
                                    onChange={(e) => setProxy(e.target.value)}
                                />
                            </label>

                            <div className="flex gap-2">
                                <button
                                    className={buttonBaseClass}
                                    style={primaryButtonStyle}
                                    disabled={installing || !effectiveInstallDir}
                                    onClick={() => void doInstall()}
                                >
                                    {installing ? t('workerManager.install.installing') : t('workerManager.install.install')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="text-sm break-all">
                                <span style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.engine.installDir')}:
                                </span>{' '}
                                {installedEngine.install_dir}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    className={buttonBaseClass}
                                    style={primaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={() => void doStart()}
                                >
                                    {actionPending === 'start'
                                        ? t('workerManager.actions.starting')
                                        : t('workerManager.actions.start')}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={() => void doStop()}
                                >
                                    {actionPending === 'stop'
                                        ? t('workerManager.actions.stopping')
                                        : t('workerManager.actions.stop')}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={() => void doCheck()}
                                >
                                    {actionPending === 'check'
                                        ? t('workerManager.actions.checking')
                                        : t('workerManager.actions.check')}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={!status?.running || !status?.loaded || hasBusyOperation}
                                    onClick={() => void doUnloadModel()}
                                >
                                    {actionPending === 'unload'
                                        ? t('workerManager.actions.unloading')
                                        : t('workerManager.actions.unloadModel')}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={dangerButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={() => void doUninstall()}
                                >
                                    {actionPending === 'uninstall'
                                        ? t('workerManager.actions.uninstalling')
                                        : t('workerManager.actions.uninstall')}
                                </button>
                            </div>

                            {status ? (
                                <div className="text-sm flex flex-col gap-3">
                                    <div className="flex flex-wrap gap-2">
                                        {renderBooleanBadge('Running', status.running)}
                                        {renderBooleanBadge('Healthy', status.healthy)}
                                        {renderBooleanBadge('Loaded', status.loaded)}
                                        {renderBooleanBadge('Management', status.management)}
                                    </div>
                                    <div>
                                        {t('workerManager.status.details', {
                                            url: status.url,
                                            model: status.model_id ?? t('workerManager.common.na'),
                                            device: status.device ?? t('workerManager.common.na'),
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.engine.noStatus')}
                                </div>
                            )}

                            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <div className="font-medium">{t('workerManager.modelManagement.title')}</div>
                                        <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                            {t('workerManager.modelManagement.summary', {
                                                installed: installedModelCount,
                                                total: models.length,
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap justify-end">
                                        {modelsExpanded ? (
                                            <button
                                                className={buttonBaseClass}
                                                style={secondaryButtonStyle}
                                                disabled={!status?.running || !status?.management || loadingModels || hasBusyOperation}
                                                onClick={() => void refreshModels()}
                                            >
                                                {loadingModels
                                                    ? t('workerManager.modelManagement.refreshing')
                                                    : t('workerManager.modelManagement.refresh')}
                                            </button>
                                        ) : null}
                                        <button
                                            className={buttonBaseClass}
                                            style={secondaryButtonStyle}
                                            aria-expanded={modelsExpanded}
                                            onClick={() => setModelsExpanded((prev) => !prev)}
                                        >
                                            {modelsExpanded
                                                ? t('workerManager.modelManagement.collapse')
                                                : t('workerManager.modelManagement.expand')}
                                        </button>
                                    </div>
                                </div>

                                {modelsExpanded ? (
                                    <div>
                                        {!status?.running ? (
                                            <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                                {t('workerManager.modelManagement.startWorkerHint')}
                                            </div>
                                        ) : !status.management ? (
                                            <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                                {t('workerManager.modelManagement.noManagementHint')}
                                            </div>
                                        ) : null}

                                        {modelActionMessage ? <div className="mt-3 text-sm">{modelActionMessage}</div> : null}

                                        {operationStatus ? (
                                            <div
                                                className="mt-3 rounded border p-3 text-sm"
                                                style={{ borderColor: 'var(--color-border)' }}
                                            >
                                                <div className="font-medium">
                                                    {t('workerManager.modelManagement.operation', {
                                                        type: operationStatus.type,
                                                        status: operationStatus.status,
                                                    })}
                                                </div>
                                                <div className="mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                                    {operationStatus.detail}
                                                </div>
                                                {operationStatus.error ? (
                                                    <div className="mt-2" style={{ color: 'var(--color-error)' }}>
                                                        {operationStatus.error}
                                                    </div>
                                                ) : null}
                                                {operationStatus.progress.length > 0 ? (
                                                    <ul className="mt-2 text-xs list-disc pl-5 space-y-1">
                                                        {operationStatus.progress.slice(-6).map((line, idx) => (
                                                            <li key={`${idx}-${line}`}>{line}</li>
                                                        ))}
                                                    </ul>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {modelsError ? (
                                            <div className="mt-3 text-sm" style={{ color: 'var(--color-error)' }}>
                                                {modelsError}
                                            </div>
                                        ) : null}

                                        {status?.running && status.management && models.length > 0 ? (
                                            <div className="mt-3 grid grid-cols-1 gap-3">
                                                {models.map((managedModel) => (
                                                    <div
                                                        key={managedModel.id}
                                                        className="rounded border p-3 text-sm"
                                                        style={{ borderColor: 'var(--color-border)' }}
                                                    >
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div>
                                                                <div className="font-medium">{managedModel.display_name}</div>
                                                                <div
                                                                    className="mt-1 text-xs flex flex-wrap items-center gap-x-3 gap-y-1"
                                                                    style={{ color: 'var(--color-text-muted)' }}
                                                                >
                                                                    <span>
                                                                        {t('workerManager.modelManagement.idMeta', {
                                                                            id: managedModel.id,
                                                                        })}
                                                                    </span>
                                                                    <span>
                                                                        {t('workerManager.modelManagement.sizeMeta', {
                                                                            size: managedModel.download_size_mb,
                                                                        })}
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <span>{t('workerManager.modelManagement.accuracy')}:</span>
                                                                        {renderStars(managedModel.accuracy)}
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <span>{t('workerManager.modelManagement.speed')}:</span>
                                                                        {renderSpeedBars(managedModel.speed)}
                                                                    </span>
                                                                </div>
                                                                <div className="mt-2">{managedModel.description}</div>
                                                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                                                    {managedModel.tags.map((tag) => (
                                                                        <span
                                                                            key={tag}
                                                                            className="px-2 py-0.5 rounded"
                                                                            style={{ background: 'rgba(0,0,0,0.06)' }}
                                                                        >
                                                                            {tag}
                                                                        </span>
                                                                    ))}
                                                                    {managedModel.installed ? (
                                                                        <span
                                                                            className="px-2 py-0.5 rounded"
                                                                            style={{ background: 'rgba(16,185,129,0.12)' }}
                                                                        >
                                                                            {t('workerManager.modelManagement.installed')}
                                                                        </span>
                                                                    ) : null}
                                                                    {managedModel.active ? (
                                                                        <span
                                                                            className="px-2 py-0.5 rounded inline-flex items-center gap-1"
                                                                            style={{
                                                                                background: 'rgba(16,185,129,0.12)',
                                                                                color: 'var(--color-success)',
                                                                            }}
                                                                        >
                                                                            <span aria-hidden="true">●</span>
                                                                            {t('workerManager.modelManagement.active')}
                                                                        </span>
                                                                    ) : null}
                                                                    {!managedModel.compatible ? (
                                                                        <span
                                                                            className="px-2 py-0.5 rounded"
                                                                            style={{ background: 'rgba(239,68,68,0.12)' }}
                                                                        >
                                                                            {t('workerManager.modelManagement.notCompatible')}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                {!managedModel.compatible && managedModel.reason ? (
                                                                    <div
                                                                        className="mt-2 text-xs"
                                                                        style={{ color: 'var(--color-error)' }}
                                                                    >
                                                                        {managedModel.reason}
                                                                    </div>
                                                                ) : null}
                                                            </div>

                                                            <div className="flex flex-col gap-2 min-w-[120px]">
                                                                {!managedModel.installed ? (
                                                                    <button
                                                                        className={buttonBaseClass}
                                                                        style={secondaryButtonStyle}
                                                                        disabled={hasBusyOperation}
                                                                        onClick={() => void doDownloadModel(managedModel.id)}
                                                                    >
                                                                        {actionPending === `download:${managedModel.id}`
                                                                            ? t('workerManager.modelManagement.downloading')
                                                                            : t('workerManager.modelManagement.download')}
                                                                    </button>
                                                                ) : !managedModel.active ? (
                                                                    <button
                                                                        className={buttonBaseClass}
                                                                        style={primaryButtonStyle}
                                                                        disabled={!status?.running || hasBusyOperation}
                                                                        onClick={() => void doActivateModel(managedModel.id)}
                                                                    >
                                                                        {actionPending === `activate:${managedModel.id}`
                                                                            ? t('workerManager.modelManagement.activating')
                                                                            : t('workerManager.modelManagement.activate')}
                                                                    </button>
                                                                ) : (
                                                                    <button
                                                                        className={buttonBaseClass}
                                                                        style={activeButtonStyle}
                                                                        disabled
                                                                    >
                                                                        {t('workerManager.modelManagement.active')}
                                                                    </button>
                                                                )}

                                                                {managedModel.installed && !managedModel.active ? (
                                                                    <button
                                                                        className={buttonBaseClass}
                                                                        style={dangerOutlineButtonStyle}
                                                                        disabled={hasBusyOperation}
                                                                        onClick={() => void doDeleteModel(managedModel.id)}
                                                                    >
                                                                        {actionPending === `delete:${managedModel.id}`
                                                                            ? t('workerManager.modelManagement.deleting')
                                                                            : t('workerManager.modelManagement.delete')}
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : status?.running && status.management && !loadingModels && !modelsError ? (
                                            <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                                {t('workerManager.modelManagement.empty')}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {installProgress ? (
                        <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="flex items-center justify-between gap-4 text-sm">
                                <div className="font-medium">
                                    {installProgress.error
                                        ? t('workerManager.install.failed')
                                        : installProgress.done
                                          ? t('workerManager.install.complete')
                                          : installStepLabel}
                                </div>
                                <div style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.install.step', {
                                        current: installProgress.step_index,
                                        total: installProgress.step_total,
                                    })}
                                </div>
                            </div>
                            <div className="mt-2 h-2 rounded" style={{ background: 'rgba(0,0,0,0.08)' }}>
                                <div
                                    className="h-2 rounded"
                                    style={{
                                        width: `${progressPercent}%`,
                                        background: installProgress.error
                                            ? 'var(--color-error)'
                                            : 'var(--color-primary)',
                                    }}
                                />
                            </div>
                            <div className="mt-2 text-sm">{installProgress.message}</div>
                            <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                {t('workerManager.install.targetDirectory', {
                                    path: installProgress.install_dir,
                                })}
                            </div>
                            {installProgress.error ? (
                                <div className="mt-2 text-sm" style={{ color: 'var(--color-error)' }}>
                                    {installProgress.error}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {installLog.length > 0 ? (
                        <pre
                            className="mt-4 text-xs rounded border p-2 overflow-auto max-h-64"
                            style={{ borderColor: 'var(--color-border)', background: 'rgba(0,0,0,0.03)' }}
                        >
                            {installLogText}
                        </pre>
                    ) : null}
                </section>

                <footer className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('workerManager.footer')}
                </footer>
            </div>
        </div>
    )
}

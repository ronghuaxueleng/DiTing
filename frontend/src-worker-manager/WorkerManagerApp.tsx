import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'

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
    const [hardware, setHardware] = useState<HardwareInfo | null>(null)
    const [state, setState] = useState<ManagerState | null>(null)
    const [installPathInfo, setInstallPathInfo] = useState<InstallPathInfo | null>(null)
    const [installing, setInstalling] = useState(false)
    const [installDir, setInstallDir] = useState('')
    const [installProgress, setInstallProgress] = useState<InstallProgressPayload | null>(null)
    const [installLog, setInstallLog] = useState<string[]>([])
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

    const hasBusyOperation = !!operationPolling || !!actionPending

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
        void (async () => {
            const [hw] = await Promise.all([
                invoke<HardwareInfo>('detect_hardware'),
                refreshState(),
                refreshInstallPathInfo(),
            ])
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
                    setModelActionMessage(`Operation polling failed: ${String(e)}`)
                    window.clearInterval(timer)
                }
            })()
        }, 1000)

        return () => window.clearInterval(timer)
    }, [operationPolling])

    useEffect(() => {
        let unlisten: null | (() => void) = null
        void (async () => {
            const u = await listen<InstallProgressPayload>('install-progress', (e) => {
                const payload = e.payload
                const prefix = `[${payload.step_index}/${payload.step_total}] ${payload.step_label}`
                const suffix = payload.error ? ` ERROR: ${payload.error}` : ''

                setInstallProgress(payload)
                setInstallDir(payload.install_dir)
                setInstallLog((prev) => [...prev, `${prefix}: ${payload.message}${suffix}`])

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
            title: 'Choose Whisper install directory',
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
                    step_label: 'Installation failed',
                    step_index: 1,
                    step_total: 1,
                    completed_steps: 0,
                    message,
                    install_dir: effectiveInstallDir,
                    done: true,
                    error: message,
                },
            )
            setInstallLog((prev) => [...prev, `ERROR: ${message}`])
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
            await trackOperation(response, `Downloading ${managedModelId}...`)
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(`Download failed: ${String(e)}`)
        }
    }

    async function doActivateModel(managedModelId: string) {
        setActionPending(`activate:${managedModelId}`)
        try {
            const response = await invoke<WorkerOperationResponse>('activate_worker_model', {
                engineId,
                modelId: managedModelId,
            })
            await trackOperation(response, `Activating ${managedModelId}...`)
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(`Activate failed: ${String(e)}`)
        }
    }

    async function doDeleteModel(managedModelId: string) {
        setActionPending(`delete:${managedModelId}`)
        try {
            await invoke('delete_worker_model', {
                engineId,
                modelId: managedModelId,
            })
            setModelActionMessage(`Deleted ${managedModelId}.`)
            void refreshWorkerStatus()
            void refreshModels()
        } catch (e) {
            setModelActionMessage(`Delete failed: ${String(e)}`)
        } finally {
            setActionPending(null)
        }
    }

    async function doUnloadModel() {
        setActionPending('unload')
        try {
            await invoke('unload_worker_model', { engineId })
            setModelActionMessage('Model unloaded.')
            void refreshWorkerStatus()
            void refreshModels()
        } catch (e) {
            setModelActionMessage(`Unload failed: ${String(e)}`)
        } finally {
            setActionPending(null)
        }
    }

    return (
        <div className="min-h-screen p-6" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div className="max-w-5xl mx-auto flex flex-col gap-4">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">DiTing Worker Manager</h1>
                        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            Whisper-first MVP (CPU)
                        </p>
                    </div>
                    <button
                        className={buttonBaseClass}
                        style={secondaryButtonStyle}
                        onClick={refreshState}
                    >
                        Refresh
                    </button>
                </header>

                <section className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                    <h2 className="font-semibold">Hardware</h2>
                    {!hardware ? (
                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            Detecting...
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                            <div>
                                CPU: {hardware.cpu_name} ({hardware.cpu_cores} cores)
                            </div>
                            <div>RAM: {hardware.ram_gb} GB</div>
                            <div>
                                CUDA: {hardware.has_cuda ? 'Yes' : 'No'}{' '}
                                {hardware.gpu_name ? `(${hardware.gpu_name}, ${hardware.vram_mb}MB)` : ''}
                            </div>
                            <div>MPS: {hardware.has_mps ? 'Yes' : 'No'}</div>
                            <div>Recommended: {hardware.recommended_device}</div>
                            <div>Compute key: {hardware.compute_key}</div>
                        </div>
                    )}
                </section>

                <section className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                    <h2 className="font-semibold">Engine: Whisper (OpenAI)</h2>
                    <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Installed: {installed ? 'Yes' : 'No'}
                    </div>

                    {!installed ? (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                <div className="font-medium">Install location</div>
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
                                        onClick={doBrowseInstallDir}
                                    >
                                        Browse…
                                    </button>
                                </div>
                                <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                    Worker files will be written directly into this folder: venv/, models/, asr_worker/, worker_config.yaml.
                                </div>
                                {installPathInfo ? (
                                    <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                        Default worker base: {installPathInfo.default_base_install_dir}
                                    </div>
                                ) : null}
                                <div className="mt-2 text-sm break-all">
                                    <span style={{ color: 'var(--color-text-muted)' }}>Current target:</span> {effectiveInstallDir || 'Not set'}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <label className="text-sm flex flex-col gap-1">
                                    Port
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
                                    Initial model
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
                                <input type="checkbox" checked={useMirror} disabled={installing} onChange={(e) => setUseMirror(e.target.checked)} />
                                Use China mirrors
                            </label>

                            <label className="text-sm flex flex-col gap-1">
                                Proxy (optional)
                                <input
                                    className="border rounded px-2 py-1"
                                    style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                    placeholder="http://127.0.0.1:7890"
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
                                    onClick={doInstall}
                                >
                                    {installing ? 'Installing…' : 'Install'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="text-sm break-all">
                                <span style={{ color: 'var(--color-text-muted)' }}>Install dir:</span> {installedEngine.install_dir}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    className={buttonBaseClass}
                                    style={primaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={doStart}
                                >
                                    {actionPending === 'start' ? 'Starting…' : 'Start'}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={doStop}
                                >
                                    {actionPending === 'stop' ? 'Stopping…' : 'Stop'}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={doCheck}
                                >
                                    {actionPending === 'check' ? 'Checking…' : 'Check'}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={secondaryButtonStyle}
                                    disabled={!status?.running || !status?.loaded || hasBusyOperation}
                                    onClick={doUnloadModel}
                                >
                                    {actionPending === 'unload' ? 'Unloading…' : 'Unload model'}
                                </button>
                                <button
                                    className={buttonBaseClass}
                                    style={dangerButtonStyle}
                                    disabled={hasBusyOperation}
                                    onClick={doUninstall}
                                >
                                    {actionPending === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
                                </button>
                            </div>

                            {status ? (
                                <div className="text-sm flex flex-col gap-1">
                                    <div>
                                        Status: running={String(status.running)} healthy={String(status.healthy)} loaded={String(status.loaded)}
                                    </div>
                                    <div>
                                        URL: {status.url} | model={status.model_id ?? 'n/a'} | device={status.device ?? 'n/a'} | management={String(status.management)}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    No status yet.
                                </div>
                            )}

                            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                                <div className="flex items-center justify-between gap-4">
                                    <div className="font-medium">Model management</div>
                                    <button
                                        className={buttonBaseClass}
                                        style={secondaryButtonStyle}
                                        disabled={!status?.running || !status?.management || loadingModels || hasBusyOperation}
                                        onClick={() => void refreshModels()}
                                    >
                                        {loadingModels ? 'Refreshing…' : 'Refresh models'}
                                    </button>
                                </div>

                                {!status?.running ? (
                                    <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        Start the worker to manage models.
                                    </div>
                                ) : !status.management ? (
                                    <div className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        This worker did not report management API support yet.
                                    </div>
                                ) : null}

                                {modelActionMessage ? (
                                    <div className="mt-3 text-sm">{modelActionMessage}</div>
                                ) : null}

                                {operationStatus ? (
                                    <div className="mt-3 rounded border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="font-medium">
                                            Operation: {operationStatus.type} ({operationStatus.status})
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
                                                        <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                                            id={managedModel.id} | size≈{managedModel.download_size_mb}MB | accuracy={managedModel.accuracy}/5 | speed={managedModel.speed}/5
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
                                                                <span className="px-2 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.12)' }}>
                                                                    Installed
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
                                                                    Active
                                                                </span>
                                                            ) : null}
                                                            {!managedModel.compatible ? (
                                                                <span className="px-2 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)' }}>
                                                                    Not compatible
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {!managedModel.compatible && managedModel.reason ? (
                                                            <div className="mt-2 text-xs" style={{ color: 'var(--color-error)' }}>
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
                                                                {actionPending === `download:${managedModel.id}` ? 'Downloading…' : 'Download'}
                                                            </button>
                                                        ) : !managedModel.active ? (
                                                            <button
                                                                className={buttonBaseClass}
                                                                style={primaryButtonStyle}
                                                                disabled={!status?.running || hasBusyOperation}
                                                                onClick={() => void doActivateModel(managedModel.id)}
                                                            >
                                                                {actionPending === `activate:${managedModel.id}` ? 'Activating…' : 'Activate'}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className={buttonBaseClass}
                                                                style={activeButtonStyle}
                                                                disabled
                                                            >
                                                                Active
                                                            </button>
                                                        )}

                                                        {managedModel.installed && !managedModel.active ? (
                                                            <button
                                                                className={buttonBaseClass}
                                                                style={dangerOutlineButtonStyle}
                                                                disabled={hasBusyOperation}
                                                                onClick={() => void doDeleteModel(managedModel.id)}
                                                            >
                                                                {actionPending === `delete:${managedModel.id}` ? 'Deleting…' : 'Delete'}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {installProgress ? (
                        <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="flex items-center justify-between gap-4 text-sm">
                                <div className="font-medium">{installProgress.error ? 'Install failed' : installProgress.done ? 'Install complete' : installProgress.step_label}</div>
                                <div style={{ color: 'var(--color-text-muted)' }}>
                                    Step {installProgress.step_index} / {installProgress.step_total}
                                </div>
                            </div>
                            <div className="mt-2 h-2 rounded" style={{ background: 'rgba(0,0,0,0.08)' }}>
                                <div
                                    className="h-2 rounded"
                                    style={{
                                        width: `${progressPercent}%`,
                                        background: installProgress.error ? 'var(--color-error)' : 'var(--color-primary)',
                                    }}
                                />
                            </div>
                            <div className="mt-2 text-sm">{installProgress.message}</div>
                            <div className="mt-2 text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                                Target directory: {installProgress.install_dir}
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
                            {installLog.join('\n')}
                        </pre>
                    ) : null}
                </section>

                <footer className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Bundled uv is resolved from src-tauri-worker/resources/uv during development and packaged resources at runtime.
                </footer>
            </div>
        </div>
    )
}

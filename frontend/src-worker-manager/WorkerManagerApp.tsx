import { type ReactNode, useEffect, useMemo, useState } from 'react'
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
    engine_name?: string
    device?: string
    server_url?: string | null
    initial_model_id?: string | null
}

type ManagerState = {
    selected_engine_id?: string | null
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

type InstallEngineRequest = {
    engineId: string
    port: number
    modelId: string
    device: string
    computeKey?: string
    useMirror: boolean
    proxy: string
    serverUrl?: string
    installDir: string
}

type ModelOption = {
    id: string
    label: string
}

type EngineDefinition = {
    id: string
    engineName: string
    displayName: string
    description: string
    defaultModelId: string
    models: ModelOption[]
}

type WizardStep = 'hardware' | 'engine' | 'install' | 'complete'

const DEFAULT_PORT = 8001
const WIZARD_STEPS: WizardStep[] = ['hardware', 'engine', 'install', 'complete']
const ENGINE_DEFINITIONS: EngineDefinition[] = [
    {
        id: 'whisper-openai',
        engineName: 'whisper',
        displayName: 'Whisper (OpenAI)',
        description: 'OpenAI Whisper local worker with flexible model choices.',
        defaultModelId: 'whisper_large_v3_turbo',
        models: [
            { id: 'whisper_tiny', label: 'Tiny' },
            { id: 'whisper_small', label: 'Small' },
            { id: 'whisper_medium', label: 'Medium' },
            { id: 'whisper_large_v3_turbo', label: 'Large V3 Turbo' },
        ],
    },
    {
        id: 'sensevoice',
        engineName: 'sensevoice',
        displayName: 'SenseVoice',
        description: 'FunASR SenseVoice with built-in VAD and fast multilingual speech recognition.',
        defaultModelId: 'sensevoice_small',
        models: [{ id: 'sensevoice_small', label: 'SenseVoice Small' }],
    },
]

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

function getEngineDefinition(engineId: string | null | undefined) {
    return ENGINE_DEFINITIONS.find((engine) => engine.id === engineId) ?? null
}

function getSuggestedDevice(hardware: HardwareInfo | null) {
    if (hardware?.has_cuda) {
        return 'cuda:0'
    }
    if (hardware?.has_mps) {
        return 'mps'
    }
    return 'cpu'
}

function getComputeKeyForDevice(device: string, hardware: HardwareInfo | null) {
    if (device.startsWith('cuda')) {
        return hardware?.compute_key || 'cpu'
    }
    if (device === 'mps') {
        return 'mps'
    }
    return 'cpu'
}

function getAvailableDevices(hardware: HardwareInfo | null) {
    const devices: Array<{ value: string; label: string }> = []

    if (hardware?.has_cuda) {
        devices.push({
            value: 'cuda:0',
            label: hardware.gpu_name ? `CUDA · ${hardware.gpu_name}` : 'CUDA',
        })
    }
    if (hardware?.has_mps) {
        devices.push({ value: 'mps', label: 'Apple MPS' })
    }
    devices.push({ value: 'cpu', label: 'CPU' })

    return devices
}

function getNextSuggestedPort(engines: EngineInfo[]) {
    const usedPorts = new Set(engines.map((engine) => engine.port))
    let port = DEFAULT_PORT
    while (usedPorts.has(port)) {
        port += 1
    }
    return port
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section
            className="rounded-lg border p-4"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        >
            <h2 className="font-semibold">{title}</h2>
            <div className="mt-3">{children}</div>
        </section>
    )
}

export default function WorkerManagerApp() {
    const { t, i18n } = useTranslation()
    const [hardware, setHardware] = useState<HardwareInfo | null>(null)
    const [state, setState] = useState<ManagerState | null>(null)
    const [installPathInfo, setInstallPathInfo] = useState<InstallPathInfo | null>(null)
    const [installing, setInstalling] = useState(false)
    const [installingEngineId, setInstallingEngineId] = useState<string | null>(null)
    const [installDir, setInstallDir] = useState('')
    const [installProgress, setInstallProgress] = useState<InstallProgressPayload | null>(null)
    const [installLog, setInstallLog] = useState<InstallLogEntry[]>([])
    const [useMirror, setUseMirror] = useState(false)
    const [proxy, setProxy] = useState('')
    const [status, setStatus] = useState<WorkerStatus | null>(null)
    const [models, setModels] = useState<ManagedModel[]>([])
    const [modelsError, setModelsError] = useState<string | null>(null)
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelActionMessage, setModelActionMessage] = useState<string | null>(null)
    const [operationStatus, setOperationStatus] = useState<WorkerOperationStatus | null>(null)
    const [operationPolling, setOperationPolling] = useState<string | null>(null)
    const [actionPending, setActionPending] = useState<string | null>(null)
    const [modelsExpanded, setModelsExpanded] = useState(true)
    const [wizardMode, setWizardMode] = useState(false)
    const [wizardStep, setWizardStep] = useState<WizardStep>('hardware')
    const [wizardEngineId, setWizardEngineId] = useState(ENGINE_DEFINITIONS[0].id)
    const [selectedInstalledEngineId, setSelectedInstalledEngineId] = useState<string | null>(null)
    const [wizardModelId, setWizardModelId] = useState(ENGINE_DEFINITIONS[0].defaultModelId)
    const [wizardDevice, setWizardDevice] = useState('cpu')
    const [wizardPort, setWizardPort] = useState(DEFAULT_PORT)
    const [serverUrl, setServerUrl] = useState('')

    const currentLanguage = i18n.resolvedLanguage || i18n.language || 'zh'
    const installedEngines = useMemo(() => Object.values(state?.engines ?? {}), [state])
    const installedEngineMap = state?.engines ?? {}
    const hasInstalledEngines = installedEngines.length > 0
    const wizardVisible = !hasInstalledEngines || wizardMode
    const selectedInstalledEngine = selectedInstalledEngineId
        ? installedEngineMap[selectedInstalledEngineId] ?? null
        : null
    const availableWizardEngines = useMemo(
        () => ENGINE_DEFINITIONS.filter((engine) => !installedEngineMap[engine.id]),
        [installedEngineMap],
    )
    const wizardEngine =
        availableWizardEngines.find((engine) => engine.id === wizardEngineId) ??
        availableWizardEngines[0] ??
        getEngineDefinition(wizardEngineId) ??
        ENGINE_DEFINITIONS[0]
    const wizardModels = wizardEngine.models
    const availableDevices = getAvailableDevices(hardware)
    const effectiveInstallDir = useMemo(
        () => installDir.trim() || installPathInfo?.default_engine_install_dir || '',
        [installDir, installPathInfo],
    )
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
                const suffix = entry.error ? ` Error: ${entry.error}` : ''
                return `${prefix}: ${entry.message}${suffix}`
            })
            .join('\n')
    }, [installLog, t, i18n.language])
    const installedModelCount = useMemo(() => models.filter((model) => model.installed).length, [models])
    const hasBusyOperation = !!operationPolling || !!actionPending
    const dashboardEngineDefinition = getEngineDefinition(selectedInstalledEngine?.engine_id)

    const yesNoLabel = (value: boolean) => (value ? t('workerManager.common.yes') : t('workerManager.common.no'))

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

    function pickWizardEngine(engineState: ManagerState | null, preferredEngineId?: string | null) {
        const installedIds = new Set(Object.keys(engineState?.engines ?? {}))
        const available = ENGINE_DEFINITIONS.filter((engine) => !installedIds.has(engine.id))

        if (preferredEngineId) {
            const preferred = available.find((engine) => engine.id === preferredEngineId)
            if (preferred) {
                return preferred
            }
        }

        return available[0] ?? ENGINE_DEFINITIONS[0]
    }

    function resetWizardState(nextEngine: EngineDefinition, nextState: ManagerState | null, startStep: WizardStep) {
        setWizardMode(true)
        setWizardStep(startStep)
        setWizardEngineId(nextEngine.id)
        setWizardModelId(nextEngine.defaultModelId)
        setWizardDevice(getSuggestedDevice(hardware))
        setWizardPort(getNextSuggestedPort(Object.values(nextState?.engines ?? {})))
        setServerUrl('')
        setInstallDir('')
        setInstallProgress(null)
        setInstallLog([])
        setInstalling(false)
        setInstallingEngineId(null)
    }

    function openWizard(preferredEngineId?: string | null, startStep: WizardStep = 'engine', nextState?: ManagerState | null) {
        const stateForWizard = nextState ?? state
        const nextEngine = pickWizardEngine(stateForWizard, preferredEngineId)
        resetWizardState(nextEngine, stateForWizard ?? null, startStep)
    }

    function goToDashboard() {
        setWizardMode(false)
        setWizardStep('hardware')
        setInstalling(false)
        setInstallingEngineId(null)
        setInstallProgress(null)
        setInstallLog([])
    }

    async function changeLanguage(language: 'zh' | 'en') {
        await i18n.changeLanguage(language)
        localStorage.setItem('language', language)
    }

    async function refreshState() {
        const nextState = await invoke<ManagerState>('get_manager_state')
        setState(nextState)
        return nextState
    }

    async function persistSelectedEngine(engineId: string | null) {
        const nextState = await invoke<ManagerState>('set_selected_engine', { engineId })
        setState(nextState)
        return nextState
    }

    async function refreshInstallPathInfo(engineId: string) {
        const info = await invoke<InstallPathInfo>('get_install_path_info', { engineId })
        setInstallPathInfo(info)
        setInstallDir(info.default_engine_install_dir)
        return info
    }

    async function refreshWorkerStatus(engineId: string | null = selectedInstalledEngineId) {
        if (!engineId) {
            setStatus(null)
            return null
        }

        try {
            const nextStatus = await invoke<WorkerStatus>('get_worker_status', { engineId })
            setStatus(nextStatus)
            return nextStatus
        } catch {
            setStatus(null)
            return null
        }
    }

    async function refreshModels(engineId: string | null = selectedInstalledEngineId) {
        if (!engineId) {
            setModels([])
            setModelsError(null)
            return []
        }

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
            const [nextHardware, nextState] = await Promise.all([invoke<HardwareInfo>('detect_hardware'), refreshState()])
            setHardware(nextHardware)

            const installedIds = Object.keys(nextState.engines)
            if (installedIds.length > 0) {
                setSelectedInstalledEngineId(nextState.selected_engine_id ?? installedIds[0])
                return
            }

            const nextEngine = pickWizardEngine(nextState)
            resetWizardState(nextEngine, nextState, 'hardware')
        })()
    }, [])

    useEffect(() => {
        if (!hardware) {
            return
        }
        setWizardDevice((prev) => (prev ? prev : getSuggestedDevice(hardware)))
    }, [hardware])

    useEffect(() => {
        if (availableWizardEngines.length === 0) {
            return
        }

        if (!availableWizardEngines.some((engine) => engine.id === wizardEngineId)) {
            setWizardEngineId(availableWizardEngines[0].id)
        }
    }, [availableWizardEngines, wizardEngineId])

    useEffect(() => {
        if (!wizardEngine) {
            return
        }

        setWizardModelId(wizardEngine.defaultModelId)
        void refreshInstallPathInfo(wizardEngine.id)
    }, [wizardEngine.id])

    useEffect(() => {
        if (installedEngines.length === 0) {
            setSelectedInstalledEngineId(null)
            setStatus(null)
            setModels([])
            setModelsError(null)
            return
        }

        const preferredEngineId = state?.selected_engine_id
        if (preferredEngineId && installedEngineMap[preferredEngineId] && preferredEngineId !== selectedInstalledEngineId) {
            setSelectedInstalledEngineId(preferredEngineId)
            return
        }

        if (!selectedInstalledEngineId || !installedEngineMap[selectedInstalledEngineId]) {
            setSelectedInstalledEngineId(installedEngines[0].engine_id)
        }
    }, [installedEngines, selectedInstalledEngineId, installedEngineMap, state?.selected_engine_id])

    useEffect(() => {
        if (!selectedInstalledEngineId) {
            return
        }

        const engine = installedEngineMap[selectedInstalledEngineId]
        if (!engine) {
            return
        }

        if (state?.selected_engine_id !== selectedInstalledEngineId) {
            void persistSelectedEngine(selectedInstalledEngineId)
        }

        setStatus(null)
        setModels([])
        setModelsError(null)
        setOperationStatus(null)
        setOperationPolling(null)
        setModelActionMessage(null)
        void refreshWorkerStatus(selectedInstalledEngineId)
    }, [selectedInstalledEngineId])

    useEffect(() => {
        if (!status?.running || !status.management || !selectedInstalledEngineId) {
            if (!status?.running) {
                setModels([])
            }
            return
        }

        void refreshModels(selectedInstalledEngineId)
    }, [status?.running, status?.management, selectedInstalledEngineId])

    useEffect(() => {
        if (!operationPolling || !selectedInstalledEngineId) {
            return
        }

        const timer = window.setInterval(() => {
            void (async () => {
                try {
                    const op = await invoke<WorkerOperationStatus>('get_worker_operation_status', {
                        engineId: selectedInstalledEngineId,
                        operationId: operationPolling,
                    })
                    setOperationStatus(op)
                    if (op.status === 'completed' || op.status === 'failed') {
                        window.clearInterval(timer)
                        setOperationPolling(null)
                        setActionPending(null)
                        void refreshWorkerStatus(selectedInstalledEngineId)
                        if (op.status === 'completed') {
                            void refreshModels(selectedInstalledEngineId)
                        }
                    }
                } catch (e) {
                    setOperationStatus(null)
                    setOperationPolling(null)
                    setActionPending(null)
                    setModelActionMessage(t('workerManager.modelManagement.messages.pollingFailed', { error: String(e) }))
                    window.clearInterval(timer)
                }
            })()
        }, 1000)

        return () => window.clearInterval(timer)
    }, [operationPolling, selectedInstalledEngineId, t, i18n.language])

    useEffect(() => {
        let unlisten: null | (() => void) = null
        void (async () => {
            const off = await listen<InstallProgressPayload>('install-progress', (event) => {
                const payload = event.payload
                if (installingEngineId && payload.engine_id !== installingEngineId) {
                    return
                }

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
                    setInstallingEngineId(null)
                    void (async () => {
                        const nextState = await refreshState()
                        if (!payload.error) {
                            setWizardStep('complete')
                            setSelectedInstalledEngineId(payload.engine_id)
                            if (Object.keys(nextState.engines).length > 0) {
                                setWizardMode(true)
                            }
                        }
                    })()
                }
            })
            unlisten = off
        })()

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [installingEngineId])

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
        const request: InstallEngineRequest = {
            engineId: wizardEngine.id,
            port: wizardPort,
            modelId: wizardModelId,
            device: wizardDevice,
            computeKey: getComputeKeyForDevice(wizardDevice, hardware),
            useMirror,
            proxy,
            serverUrl: serverUrl.trim() || undefined,
            installDir: effectiveInstallDir,
        }

        setInstalling(true)
        setInstallingEngineId(wizardEngine.id)
        setInstallLog([])
        setInstallProgress(null)
        setWizardStep('install')

        try {
            await invoke('install_engine', { request })
        } catch (e) {
            const message = String(e)
            setInstalling(false)
            setInstallingEngineId(null)
            setInstallProgress({
                engine_id: wizardEngine.id,
                step_key: 'failed',
                step_label: t('workerManager.install.failed'),
                step_index: 1,
                step_total: 1,
                completed_steps: 0,
                message,
                install_dir: effectiveInstallDir,
                done: true,
                error: message,
            })
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
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending('uninstall')
        setModelActionMessage(null)
        try {
            await invoke('uninstall_engine', { engineId: selectedInstalledEngineId })
            const nextState = await refreshState()
            const nextInstalledIds = Object.keys(nextState.engines)
            if (nextInstalledIds.length === 0) {
                openWizard(null, 'hardware', nextState)
                setSelectedInstalledEngineId(null)
                setStatus(null)
                setModels([])
                setOperationStatus(null)
                return
            }

            setSelectedInstalledEngineId(nextInstalledIds[0])
        } finally {
            setActionPending(null)
        }
    }

    async function doStart() {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending('start')
        setModelActionMessage(null)
        try {
            await invoke('start_worker', { engineId: selectedInstalledEngineId })
            const nextStatus = await invoke<WorkerStatus>('get_worker_status', { engineId: selectedInstalledEngineId })
            setStatus(nextStatus)
        } finally {
            setActionPending(null)
        }
    }

    async function doStop() {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending('stop')
        setModelActionMessage(null)
        try {
            await invoke('stop_worker', { engineId: selectedInstalledEngineId })
            const nextStatus = await invoke<WorkerStatus>('get_worker_status', { engineId: selectedInstalledEngineId })
            setStatus(nextStatus)
            setModels([])
        } finally {
            setActionPending(null)
        }
    }

    async function doCheck() {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending('check')
        setModelActionMessage(null)
        try {
            const nextStatus = await invoke<WorkerStatus>('get_worker_status', { engineId: selectedInstalledEngineId })
            setStatus(nextStatus)
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
            void refreshWorkerStatus(selectedInstalledEngineId)
            void refreshModels(selectedInstalledEngineId)
        }
    }

    async function doDownloadModel(managedModelId: string) {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending(`download:${managedModelId}`)
        try {
            const response = await invoke<WorkerOperationResponse>('download_worker_model', {
                engineId: selectedInstalledEngineId,
                modelId: managedModelId,
                useMirror,
                proxy,
            })
            await trackOperation(response, t('workerManager.modelManagement.messages.downloading', { modelId: managedModelId }))
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(t('workerManager.modelManagement.messages.downloadFailed', { error: String(e) }))
        }
    }

    async function doActivateModel(managedModelId: string) {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending(`activate:${managedModelId}`)
        try {
            const response = await invoke<WorkerOperationResponse>('activate_worker_model', {
                engineId: selectedInstalledEngineId,
                modelId: managedModelId,
            })
            await trackOperation(response, t('workerManager.modelManagement.messages.activating', { modelId: managedModelId }))
        } catch (e) {
            setActionPending(null)
            setModelActionMessage(t('workerManager.modelManagement.messages.activateFailed', { error: String(e) }))
        }
    }

    async function doDeleteModel(managedModelId: string) {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending(`delete:${managedModelId}`)
        try {
            await invoke('delete_worker_model', {
                engineId: selectedInstalledEngineId,
                modelId: managedModelId,
            })
            setModelActionMessage(t('workerManager.modelManagement.messages.deleted', { modelId: managedModelId }))
            void refreshWorkerStatus(selectedInstalledEngineId)
            void refreshModels(selectedInstalledEngineId)
        } catch (e) {
            setModelActionMessage(t('workerManager.modelManagement.messages.deleteFailed', { error: String(e) }))
        } finally {
            setActionPending(null)
        }
    }

    async function doUnloadModel() {
        if (!selectedInstalledEngineId) {
            return
        }

        setActionPending('unload')
        try {
            await invoke('unload_worker_model', { engineId: selectedInstalledEngineId })
            setModelActionMessage(t('workerManager.modelManagement.messages.unloaded'))
            void refreshWorkerStatus(selectedInstalledEngineId)
            void refreshModels(selectedInstalledEngineId)
        } catch (e) {
            setModelActionMessage(t('workerManager.modelManagement.messages.unloadFailed', { error: String(e) }))
        } finally {
            setActionPending(null)
        }
    }

    const renderHardwareSummary = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
                {t('workerManager.hardware.cpu')}: {hardware?.cpu_name || t('workerManager.common.notSet')} ({hardware?.cpu_cores ?? 0}{' '}
                cores)
            </div>
            <div>
                {t('workerManager.hardware.ram')}: {hardware?.ram_gb ?? 0} GB
            </div>
            <div>
                {t('workerManager.hardware.cuda')}: {yesNoLabel(!!hardware?.has_cuda)}
                {hardware?.gpu_name ? ` (${hardware.gpu_name}, ${hardware.vram_mb}MB)` : ''}
            </div>
            <div>
                {t('workerManager.hardware.mps')}: {yesNoLabel(!!hardware?.has_mps)}
            </div>
            <div>
                {t('workerManager.hardware.recommended')}: {getSuggestedDevice(hardware)}
            </div>
            <div>
                {t('workerManager.hardware.computeKey')}: {hardware?.compute_key || t('workerManager.common.notSet')}
            </div>
        </div>
    )

    return (
        <div className="min-h-screen p-6" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div className="max-w-6xl mx-auto flex flex-col gap-4">
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
                        {hasInstalledEngines && !wizardVisible ? (
                            <button
                                className={buttonBaseClass}
                                style={secondaryButtonStyle}
                                disabled={availableWizardEngines.length === 0}
                                onClick={() => openWizard(null, 'engine')}
                            >
                                {t('workerManager.actions.addEngine')}
                            </button>
                        ) : null}
                        <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={() => void refreshState()}>
                            {t('workerManager.actions.refresh')}
                        </button>
                    </div>
                </header>

                <SectionCard title={t('workerManager.hardware.title')}>
                    {!hardware ? (
                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.hardware.detecting')}
                        </div>
                    ) : (
                        renderHardwareSummary()
                    )}
                </SectionCard>

                {wizardVisible ? (
                    <SectionCard title={t('workerManager.wizard.title')}>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {WIZARD_STEPS.map((step, index) => {
                                const active = wizardStep === step
                                const completed = WIZARD_STEPS.indexOf(wizardStep) > index
                                return (
                                    <div
                                        key={step}
                                        className="px-3 py-2 rounded-full text-sm border inline-flex items-center gap-2"
                                        style={
                                            active
                                                ? {
                                                      borderColor: 'transparent',
                                                      background: 'var(--color-primary)',
                                                      color: 'white',
                                                  }
                                                : completed
                                                  ? {
                                                        borderColor: 'rgba(16,185,129,0.25)',
                                                        background: 'rgba(16,185,129,0.08)',
                                                        color: 'var(--color-success)',
                                                    }
                                                  : {
                                                        borderColor: 'var(--color-border)',
                                                        background: 'var(--color-card)',
                                                        color: 'var(--color-text-muted)',
                                                    }
                                        }
                                    >
                                        <span>{index + 1}</span>
                                        <span>{t(`workerManager.wizard.steps.${step}`)}</span>
                                    </div>
                                )
                            })}
                        </div>

                        {wizardStep === 'hardware' ? (
                            <div className="flex flex-col gap-4">
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.wizard.hardwareDescription')}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className={buttonBaseClass}
                                        style={primaryButtonStyle}
                                        disabled={!hardware}
                                        onClick={() => setWizardStep('engine')}
                                    >
                                        {t('workerManager.actions.next')}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {wizardStep === 'engine' ? (
                            <div className="flex flex-col gap-4">
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.wizard.engineDescription')}
                                </div>

                                {availableWizardEngines.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {availableWizardEngines.map((engine) => {
                                            const active = engine.id === wizardEngine.id
                                            return (
                                                <button
                                                    key={engine.id}
                                                    type="button"
                                                    className="text-left rounded-lg border p-4 transition-colors"
                                                    style={
                                                        active
                                                            ? {
                                                                  borderColor: 'var(--color-primary)',
                                                                  background: 'rgba(59,130,246,0.08)',
                                                              }
                                                            : {
                                                                  borderColor: 'var(--color-border)',
                                                                  background: 'var(--color-card)',
                                                              }
                                                    }
                                                    onClick={() => setWizardEngineId(engine.id)}
                                                >
                                                    <div className="font-medium">{engine.displayName}</div>
                                                    <div className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                                        {engine.description}
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.wizard.noAvailableEngines')}
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="text-sm flex flex-col gap-1">
                                        {t('workerManager.install.device')}
                                        <select
                                            className="border rounded px-2 py-1"
                                            style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                            value={wizardDevice}
                                            onChange={(e) => setWizardDevice(e.target.value)}
                                        >
                                            {availableDevices.map((device) => (
                                                <option key={device.value} value={device.value}>
                                                    {device.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="text-sm flex flex-col gap-1">
                                        {t('workerManager.install.port')}
                                        <input
                                            type="number"
                                            className="border rounded px-2 py-1"
                                            style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                            value={wizardPort}
                                            onChange={(e) => setWizardPort(Number(e.target.value) || DEFAULT_PORT)}
                                        />
                                    </label>

                                    <label className="text-sm flex flex-col gap-1">
                                        {t('workerManager.install.initialModel')}
                                        <select
                                            className="border rounded px-2 py-1"
                                            style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                            value={wizardModelId}
                                            onChange={(e) => setWizardModelId(e.target.value)}
                                        >
                                            {wizardModels.map((model) => (
                                                <option key={model.id} value={model.id}>
                                                    {model.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="text-sm flex flex-col gap-1">
                                        {t('workerManager.install.serverUrl')}
                                        <input
                                            className="border rounded px-2 py-1"
                                            style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                            placeholder={t('workerManager.install.serverUrlPlaceholder')}
                                            value={serverUrl}
                                            onChange={(e) => setServerUrl(e.target.value)}
                                        />
                                    </label>
                                </div>

                                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                    <div className="font-medium">{t('workerManager.install.locationTitle')}</div>
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            className="border rounded px-2 py-1 flex-1"
                                            style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                            value={installDir}
                                            onChange={(e) => setInstallDir(e.target.value)}
                                        />
                                        <button
                                            className={buttonBaseClass}
                                            style={secondaryButtonStyle}
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

                                <label className="text-sm flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={useMirror}
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
                                        onChange={(e) => setProxy(e.target.value)}
                                    />
                                </label>

                                <div className="flex gap-2 flex-wrap">
                                    {hasInstalledEngines ? (
                                        <button
                                            className={buttonBaseClass}
                                            style={secondaryButtonStyle}
                                            onClick={() => goToDashboard()}
                                        >
                                            {t('workerManager.actions.cancel')}
                                        </button>
                                    ) : null}
                                    <button
                                        className={buttonBaseClass}
                                        style={secondaryButtonStyle}
                                        disabled={!hardware}
                                        onClick={() => setWizardStep('hardware')}
                                    >
                                        {t('workerManager.actions.back')}
                                    </button>
                                    <button
                                        className={buttonBaseClass}
                                        style={primaryButtonStyle}
                                        disabled={!effectiveInstallDir || availableWizardEngines.length === 0}
                                        onClick={() => void doInstall()}
                                    >
                                        {t('workerManager.install.install')}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {wizardStep === 'install' ? (
                            <div className="flex flex-col gap-4">
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.wizard.installDescription', {
                                        engine: wizardEngine.displayName,
                                    })}
                                </div>

                                {installProgress ? (
                                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
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
                                ) : (
                                    <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.install.preparing')}
                                    </div>
                                )}

                                {installLog.length > 0 ? (
                                    <pre
                                        className="text-xs rounded border p-2 overflow-auto max-h-64"
                                        style={{ borderColor: 'var(--color-border)', background: 'rgba(0,0,0,0.03)' }}
                                    >
                                        {installLogText}
                                    </pre>
                                ) : null}

                                {installProgress?.error ? (
                                    <div className="flex gap-2">
                                        <button
                                            className={buttonBaseClass}
                                            style={secondaryButtonStyle}
                                            onClick={() => setWizardStep('engine')}
                                        >
                                            {t('workerManager.actions.back')}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {wizardStep === 'complete' ? (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(16,185,129,0.25)' }}>
                                    <div className="font-medium text-base">{t('workerManager.wizard.completeTitle')}</div>
                                    <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.wizard.completeDescription', {
                                            engine: installedEngineMap[installProgress?.engine_id || selectedInstalledEngineId || '']?.display_name ||
                                                wizardEngine.displayName,
                                        })}
                                    </div>
                                </div>

                                <div className="flex gap-2 flex-wrap">
                                    <button className={buttonBaseClass} style={primaryButtonStyle} onClick={() => goToDashboard()}>
                                        {t('workerManager.actions.openDashboard')}
                                    </button>
                                    {availableWizardEngines.length > 0 ? (
                                        <button
                                            className={buttonBaseClass}
                                            style={secondaryButtonStyle}
                                            onClick={() => openWizard(null, 'engine')}
                                        >
                                            {t('workerManager.actions.addAnotherEngine')}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                    </SectionCard>
                ) : null}

                {hasInstalledEngines && !wizardVisible ? (
                    <SectionCard title={t('workerManager.dashboard.title')}>
                        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
                            <div className="flex flex-col gap-2">
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('workerManager.dashboard.installedEngines')}
                                </div>
                                {installedEngines.map((engine) => {
                                    const active = engine.engine_id === selectedInstalledEngineId
                                    return (
                                        <button
                                            key={engine.engine_id}
                                            type="button"
                                            className="rounded-lg border p-3 text-left"
                                            style={
                                                active
                                                    ? {
                                                          borderColor: 'var(--color-primary)',
                                                          background: 'rgba(59,130,246,0.08)',
                                                      }
                                                    : {
                                                          borderColor: 'var(--color-border)',
                                                          background: 'var(--color-card)',
                                                      }
                                            }
                                            onClick={() => setSelectedInstalledEngineId(engine.engine_id)}
                                        >
                                            <div className="font-medium">{engine.display_name}</div>
                                            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                                {engine.device || t('workerManager.common.notSet')} · {engine.port}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>

                            <div className="flex flex-col gap-4 min-w-0">
                                {selectedInstalledEngine ? (
                                    <>
                                        <div className="flex items-start justify-between gap-4 flex-wrap">
                                            <div>
                                                <div className="text-lg font-medium">
                                                    {selectedInstalledEngine.display_name}
                                                </div>
                                                <div className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                                    {dashboardEngineDefinition?.description || t('workerManager.dashboard.engineDescription')}
                                                </div>
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
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                            <div>
                                                <span style={{ color: 'var(--color-text-muted)' }}>
                                                    {t('workerManager.engine.installDir')}:
                                                </span>{' '}
                                                <span className="break-all">{selectedInstalledEngine.install_dir}</span>
                                            </div>
                                            <div>
                                                <span style={{ color: 'var(--color-text-muted)' }}>
                                                    {t('workerManager.install.device')}:
                                                </span>{' '}
                                                {selectedInstalledEngine.device || t('workerManager.common.notSet')}
                                            </div>
                                            <div>
                                                <span style={{ color: 'var(--color-text-muted)' }}>
                                                    {t('workerManager.install.initialModel')}:
                                                </span>{' '}
                                                {selectedInstalledEngine.initial_model_id || t('workerManager.common.notSet')}
                                            </div>
                                            <div>
                                                <span style={{ color: 'var(--color-text-muted)' }}>
                                                    {t('workerManager.install.serverUrl')}:
                                                </span>{' '}
                                                {selectedInstalledEngine.server_url || t('workerManager.common.notSet')}
                                            </div>
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
                                    </>
                                ) : (
                                    <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                        {t('workerManager.dashboard.emptySelection')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </SectionCard>
                ) : null}

                <footer className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('workerManager.footer')}
                </footer>
            </div>
        </div>
    )
}

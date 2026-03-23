import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import Icons from '../src/components/ui/Icons'
import { buttonBaseClass, secondaryButtonStyle } from './constants'
import { DEFAULT_ENGINE_DEFINITION, DEFAULT_PORT, ENGINE_DEFINITIONS } from './constants'
import WorkerDashboard from './components/WorkerDashboard'
import WorkerWizard from './components/WorkerWizard'
import { getDefaultAdvertiseUrl, getEffectiveAdvertiseUrl } from './network'
import {
    formatInstallLogText,
    getAvailableDevices,
    getComputeKeyForDevice,
    getEngineDefinition,
    getHardwareFacts,
    getHardwareSummaryLabel,
    getLocalizedModelLabelById,
    getNextSuggestedPort,
    getStatusBadgeDefinitions,
    getSuggestedDevice,
} from './utils'
import type {
    EngineDefinition,
    HardwareInfo,
    InstallEngineRequest,
    InstallLogEntry,
    InstallPathInfo,
    InstallPathPreview,
    InstallProgressPayload,
    ManagedModel,
    ManagerState,
    SharedPathMapping,
    WorkerModelsResponse,
    WorkerOperationResponse,
    WorkerOperationStatus,
    WorkerStatus,
    WizardStep,
} from './types'

export default function WorkerManagerApp() {
    const { t, i18n } = useTranslation()
    const [hardware, setHardware] = useState<HardwareInfo | null>(null)
    const [state, setState] = useState<ManagerState | null>(null)
    const [installPathInfo, setInstallPathInfo] = useState<InstallPathInfo | null>(null)
    const [installPathPreview, setInstallPathPreview] = useState<InstallPathPreview | null>(null)
    const [installingEngineId, setInstallingEngineId] = useState<string | null>(null)
    const [installDir, setInstallDir] = useState('')
    const [installProgress, setInstallProgress] = useState<InstallProgressPayload | null>(null)
    const [installLog, setInstallLog] = useState<InstallLogEntry[]>([])
    const [useMirror, setUseMirror] = useState(false)
    const [useProxy, setUseProxy] = useState(false)
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
    const [wizardEngineId, setWizardEngineId] = useState(DEFAULT_ENGINE_DEFINITION.id)
    const [selectedInstalledEngineId, setSelectedInstalledEngineId] = useState<string | null>(null)
    const [wizardModelId, setWizardModelId] = useState(DEFAULT_ENGINE_DEFINITION.defaultModelId)
    const [wizardDevice, setWizardDevice] = useState('cpu')
    const [wizardPort, setWizardPort] = useState(DEFAULT_PORT)
    const [serverUrl, setServerUrl] = useState('')
    const [advertiseUrl, setAdvertiseUrl] = useState('')
    const [sharedPaths, setSharedPaths] = useState<SharedPathMapping[]>([])
    const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(
        (localStorage.getItem('theme') as 'auto' | 'light' | 'dark') || 'auto'
    )

    const currentLanguage = i18n.resolvedLanguage || i18n.language || 'zh'
    const installedEngineMap = useMemo(() => state?.engines ?? {}, [state])
    const installedEngines = useMemo(() => Object.values(installedEngineMap), [installedEngineMap])
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
        DEFAULT_ENGINE_DEFINITION
    const availableDevices = getAvailableDevices(hardware)
    const effectiveInstallDir = useMemo(
        () => installDir.trim() || installPathInfo?.default_runtime_root || '',
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
    const installLogText = useMemo(() => formatInstallLogText(installLog, t), [installLog, t, i18n.language])
    const installedModelCount = useMemo(() => models.filter((model) => model.installed).length, [models])
    const hasBusyOperation = !!operationPolling || !!actionPending
    const dashboardEngineDefinition = getEngineDefinition(selectedInstalledEngine?.engine_id)
    const headerHardwareSummary = hardware
        ? `${getHardwareSummaryLabel(hardware, t)} · ${t('workerManager.hardware.recommended')}: ${hardware.recommended_device || t('workerManager.common.notSet')}`
        : t('workerManager.hardware.detecting')
    const hardwareFacts = useMemo(() => getHardwareFacts(t, hardware), [hardware, t, i18n.language])
    const statusBadges = useMemo(() => getStatusBadgeDefinitions(t, status), [status, t, i18n.language])
    const latestProgressMessage = operationStatus?.progress.length
        ? operationStatus.progress[operationStatus.progress.length - 1]
        : null
    const latestOperationMessage = latestProgressMessage || operationStatus?.detail || modelActionMessage
    const dashboardView = useMemo(() => ({
        sidebar: {
            installedEngines,
            selectedInstalledEngineId,
        },
        command: {
            selectedInstalledEngine,
            dashboardEngineDefinition,
            status,
            statusBadges,
            hardwareSummary: headerHardwareSummary,
            latestOperationMessage,
            actionPending,
            hasBusyOperation,
        },
        runtime: {
            selectedInstalledEngine,
            status,
        },
        network: {
            selectedInstalledEngine,
            status,
        },
        models: {
            models,
            modelsError,
            loadingModels,
            modelActionMessage,
            operationStatus,
            modelsExpanded,
            installedModelCount,
            totalModelCount: models.length,
            canManageModels: !!status?.running && !!status.management,
            canUnloadModel: !!status?.running && !!status.loaded,
        },
    }), [
        installedEngines,
        selectedInstalledEngineId,
        selectedInstalledEngine,
        dashboardEngineDefinition,
        status,
        statusBadges,
        headerHardwareSummary,
        latestOperationMessage,
        actionPending,
        hasBusyOperation,
        models,
        modelsError,
        loadingModels,
        modelActionMessage,
        operationStatus,
        modelsExpanded,
        installedModelCount,
    ])
    const wizardView = useMemo(() => ({
        progress: {
            wizardStep,
            progressPercent,
            installProgress,
            installStepLabel,
            installLog,
            installLogText,
        },
        setup: {
            hasInstalledEngines,
            availableWizardEngines,
            wizardEngine,
            wizardModelId,
            wizardDevice,
            wizardPort,
            serverUrl,
            advertiseUrl,
            sharedPaths,
            effectiveAdvertiseUrl: getEffectiveAdvertiseUrl(advertiseUrl, wizardPort),
            installDir,
            effectiveInstallDir,
            installPathInfo,
            installPathPreview,
            availableDevices,
            computeKey: getComputeKeyForDevice(wizardDevice, hardware),
            useMirror,
            useProxy,
            proxy,
        },
        context: {
            hardware,
            hardwareFacts,
            hardwareSummary: headerHardwareSummary,
            selectedInstalledEngineId,
            installedEngineMap,
            completeEngineName:
                installedEngineMap[installProgress?.engine_id || selectedInstalledEngineId || '']?.display_name || wizardEngine.displayName,
            currentInstallTarget: installProgress?.install_dir || effectiveInstallDir || t('workerManager.common.notSet'),
            currentInstallModelLabel:
                getLocalizedModelLabelById(t, wizardEngine, wizardModelId) || t('workerManager.common.notSet'),
            showCurrentInstallModel: !!wizardEngine.showModelInSummary,
            currentServerUrl: serverUrl.trim() || t('workerManager.common.notSet'),
            currentWorkerUrl: getEffectiveAdvertiseUrl(advertiseUrl, wizardPort),
        },
    }), [
        wizardStep,
        progressPercent,
        installProgress,
        installStepLabel,
        installLog,
        installLogText,
        hasInstalledEngines,
        availableWizardEngines,
        wizardEngine,
        wizardModelId,
        wizardDevice,
        wizardPort,
        serverUrl,
        advertiseUrl,
        sharedPaths,
        installDir,
        effectiveInstallDir,
        installPathInfo,
        installPathPreview,
        availableDevices,
        useMirror,
        useProxy,
        proxy,
        hardware,
        hardwareFacts,
        headerHardwareSummary,
        selectedInstalledEngineId,
        installedEngineMap,
        t,
    ])

    function pickWizardEngine(engineState: ManagerState | null, preferredEngineId?: string | null) {
        const installedIds = new Set(Object.keys(engineState?.engines ?? {}))
        const available = ENGINE_DEFINITIONS.filter((engine) => !installedIds.has(engine.id))

        if (preferredEngineId) {
            const preferred = available.find((engine) => engine.id === preferredEngineId)
            if (preferred) {
                return preferred
            }
        }

        return available[0] ?? DEFAULT_ENGINE_DEFINITION
    }

    function resetWizardState(nextEngine: EngineDefinition, nextState: ManagerState | null, startStep: WizardStep) {
        setWizardMode(true)
        setWizardStep(startStep)
        setWizardEngineId(nextEngine.id)
        setWizardModelId(nextEngine.defaultModelId)
        setWizardDevice(getSuggestedDevice(hardware))
        const nextPort = getNextSuggestedPort(Object.values(nextState?.engines ?? {}))
        setWizardPort(nextPort)
        setServerUrl('')
        setAdvertiseUrl(getDefaultAdvertiseUrl(nextPort))
        setSharedPaths([])
        setInstallDir('')
        setInstallPathPreview(null)
        setUseMirror(false)
        setUseProxy(false)
        setProxy('')
        setInstallProgress(null)
        setInstallLog([])
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
        setInstallingEngineId(null)
        setInstallProgress(null)
        setInstallLog([])
    }

    async function saveEngineNetworkSettings(engineId: string, updates: { port: number; serverUrl: string; advertiseUrl: string; sharedPaths: SharedPathMapping[] }) {
        const nextState = await invoke<ManagerState>('update_engine_network_settings', {
            engineId,
            port: updates.port,
            serverUrl: updates.serverUrl.trim() || null,
            advertiseUrl: updates.advertiseUrl.trim() || null,
            sharedPaths: updates.sharedPaths,
        })
        setState(nextState)
        return nextState
    }

    async function changeLanguage(language: 'zh' | 'en') {
        await i18n.changeLanguage(language)
        localStorage.setItem('language', language)
    }

    function cycleTheme() {
        const themes: Array<'auto' | 'light' | 'dark'> = ['auto', 'light', 'dark']
        const index = themes.indexOf(theme)
        const nextTheme = themes[(index + 1) % themes.length] ?? 'auto'
        setTheme(nextTheme)
        localStorage.setItem('theme', nextTheme)
        document.documentElement.setAttribute('data-theme', nextTheme === 'auto' ? '' : nextTheme)
    }

    async function refreshHardware() {
        const nextHardware = await invoke<HardwareInfo>('detect_hardware')
        setHardware(nextHardware)
        return nextHardware
    }

    async function refreshState() {
        const nextState = await invoke<ManagerState>('get_manager_state')
        setState(nextState)
        return nextState
    }

    async function refreshAll() {
        const [, nextState] = await Promise.all([refreshHardware(), refreshState()])
        const nextSelectedEngineId = selectedInstalledEngineId && nextState.engines[selectedInstalledEngineId]
            ? selectedInstalledEngineId
            : nextState.selected_engine_id && nextState.engines[nextState.selected_engine_id]
                ? nextState.selected_engine_id
                : Object.keys(nextState.engines)[0] ?? null

        if (nextSelectedEngineId) {
            const nextStatus = await refreshWorkerStatus(nextSelectedEngineId)
            if (nextStatus?.running && nextStatus.management) {
                await refreshModels(nextSelectedEngineId)
            }
        }

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
        return info
    }

    async function refreshInstallPathPreview(engineId: string, nextInstallDir: string) {
        const preview = await invoke<InstallPathPreview>('preview_install_paths', {
            request: {
                engineId,
                installDir: nextInstallDir,
            },
        })
        setInstallPathPreview(preview)
        return preview
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
        } catch (error) {
            const message = String(error)
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
        document.documentElement.setAttribute('data-theme', theme === 'auto' ? '' : theme)
    }, [theme])

    useEffect(() => {
        void (async () => {
            const [nextHardware, nextState] = await Promise.all([refreshHardware(), refreshState()])
            setHardware(nextHardware)

            const installedIds = Object.keys(nextState.engines)
            if (installedIds.length > 0) {
                setSelectedInstalledEngineId(nextState.selected_engine_id ?? installedIds[0] ?? null)
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
        setWizardDevice((previous) => (previous ? previous : getSuggestedDevice(hardware)))
    }, [hardware])

    useEffect(() => {
        if (availableWizardEngines.length === 0) {
            return
        }

        const firstAvailableWizardEngine = availableWizardEngines[0]
        if (!availableWizardEngines.some((engine) => engine.id === wizardEngineId) && firstAvailableWizardEngine) {
            setWizardEngineId(firstAvailableWizardEngine.id)
        }
    }, [availableWizardEngines, wizardEngineId])

    useEffect(() => {
        if (!wizardEngine) {
            return
        }

        setWizardModelId(wizardEngine.defaultModelId)
        setWizardDevice(getSuggestedDevice(hardware))
        void refreshInstallPathInfo(wizardEngine.id)
    }, [wizardEngine.id, hardware])

    useEffect(() => {
        if (!installPathInfo || installDir.trim()) {
            return
        }

        setInstallDir(installPathInfo.default_runtime_root)
    }, [installPathInfo, installDir])

    useEffect(() => {
        if (!wizardEngine) {
            return
        }

        void refreshInstallPathPreview(wizardEngine.id, installDir)
    }, [wizardEngine.id, installDir])

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

        const firstInstalledEngine = installedEngines[0]
        if ((!selectedInstalledEngineId || !installedEngineMap[selectedInstalledEngineId]) && firstInstalledEngine) {
            setSelectedInstalledEngineId(firstInstalledEngine.engine_id)
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
                    const operation = await invoke<WorkerOperationStatus>('get_worker_operation_status', {
                        engineId: selectedInstalledEngineId,
                        operationId: operationPolling,
                    })
                    setOperationStatus(operation)
                    if (operation.status === 'completed' || operation.status === 'failed') {
                        window.clearInterval(timer)
                        setOperationPolling(null)
                        setActionPending(null)
                        void refreshWorkerStatus(selectedInstalledEngineId)
                        if (operation.status === 'completed') {
                            void refreshModels(selectedInstalledEngineId)
                        }
                    }
                } catch (error) {
                    setOperationStatus(null)
                    setOperationPolling(null)
                    setActionPending(null)
                    setModelActionMessage(t('workerManager.modelManagement.messages.pollingFailed', { error: String(error) }))
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
                setInstallLog((previous) => [
                    ...previous,
                    {
                        step_key: payload.step_key,
                        step_index: payload.step_index,
                        step_total: payload.step_total,
                        message: payload.message,
                        error: payload.error,
                    },
                ])

                if (payload.done) {
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
            defaultPath: effectiveInstallDir || installPathInfo?.default_runtime_root,
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
            proxy: useProxy ? proxy.trim() : '',
            serverUrl: serverUrl.trim() || undefined,
            advertiseUrl: advertiseUrl.trim() || undefined,
            sharedPaths: sharedPaths.length > 0 ? sharedPaths : undefined,
            installDir: effectiveInstallDir,
        }

        setInstallingEngineId(wizardEngine.id)
        setInstallLog([])
        setInstallProgress(null)
        setWizardStep('install')

        try {
            await invoke('install_engine', { request })
        } catch (error) {
            const message = String(error)
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
            setInstallLog((previous) => [
                ...previous,
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

            setSelectedInstalledEngineId(nextInstalledIds[0] ?? null)
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
                proxy: useProxy ? proxy.trim() : '',
            })
            await trackOperation(response, t('workerManager.modelManagement.messages.downloading', { modelId: managedModelId }))
        } catch (error) {
            setActionPending(null)
            setModelActionMessage(t('workerManager.modelManagement.messages.downloadFailed', { error: String(error) }))
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
        } catch (error) {
            setActionPending(null)
            setModelActionMessage(t('workerManager.modelManagement.messages.activateFailed', { error: String(error) }))
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
        } catch (error) {
            setModelActionMessage(t('workerManager.modelManagement.messages.deleteFailed', { error: String(error) }))
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
        } catch (error) {
            setModelActionMessage(t('workerManager.modelManagement.messages.unloadFailed', { error: String(error) }))
        } finally {
            setActionPending(null)
        }
    }

    return (
        <div
            className="min-h-screen"
            style={{
                background:
                    'radial-gradient(circle at top left, rgba(59,130,246,0.06), transparent 18%), radial-gradient(circle at top right, rgba(16,185,129,0.05), transparent 16%), var(--color-bg)',
                color: 'var(--color-text)',
            }}
        >
            <header className="border-b bg-[var(--color-card)]/96 backdrop-blur" style={{ borderColor: 'var(--color-border)' }}>
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-3 lg:px-5">
                    <div className="min-w-0 flex items-center gap-2.5">
                        <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]"
                            style={{
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(16,185,129,0.08))',
                                color: 'var(--color-primary)',
                            }}
                        >
                            <Icons.Database className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-lg font-semibold tracking-tight">{t('workerManager.title')}</h1>
                            {wizardVisible ? (
                                <p className="mt-0.5 text-xs break-words" style={{ color: 'var(--color-text-muted)' }}>
                                    {headerHardwareSummary}
                                </p>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                            type="button"
                            onClick={cycleTheme}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-200"
                            style={{
                                borderColor: 'var(--color-border)',
                                background: 'var(--color-card)',
                                color: 'var(--color-text-muted)',
                            }}
                            title={t('workerManager.theme.toggle', { theme: t(`workerManager.theme.options.${theme}`) })}
                            aria-label={t('workerManager.theme.toggle', { theme: t(`workerManager.theme.options.${theme}`) })}
                        >
                            {theme === 'auto' ? <Icons.Monitor className="w-4.5 h-4.5" /> : null}
                            {theme === 'light' ? <Icons.Sun className="w-4.5 h-4.5" /> : null}
                            {theme === 'dark' ? <Icons.Moon className="w-4.5 h-4.5" /> : null}
                        </button>
                        <div
                            className="inline-flex overflow-hidden rounded-xl border"
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
                        <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={() => void refreshAll()}>
                            {t('workerManager.actions.refresh')}
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1440px] px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-4">
                <div className="space-y-3 lg:space-y-4">
                    {wizardVisible ? (
                        <WorkerWizard
                            progress={wizardView.progress}
                            setup={wizardView.setup}
                            context={wizardView.context}
                            onChangeStep={setWizardStep}
                            onChangeAdvertiseUrl={setAdvertiseUrl}
                            onOpenDashboard={goToDashboard}
                            onOpenAnotherEngine={() => openWizard(null, 'engine')}
                            onSelectEngine={setWizardEngineId}
                            onChangeModel={setWizardModelId}
                            onChangeDevice={setWizardDevice}
                            onChangePort={setWizardPort}
                            onChangeServerUrl={setServerUrl}
                            onChangeSharedPaths={setSharedPaths}
                            onChangeInstallDir={setInstallDir}
                            onBrowseInstallDir={() => void doBrowseInstallDir()}
                            onChangeUseMirror={setUseMirror}
                            onChangeUseProxy={setUseProxy}
                            onChangeProxy={setProxy}
                            onInstall={() => void doInstall()}
                        />
                    ) : null}

                    {hasInstalledEngines && !wizardVisible ? (
                        <WorkerDashboard
                            sidebar={dashboardView.sidebar}
                            command={dashboardView.command}
                            runtime={dashboardView.runtime}
                            network={dashboardView.network}
                            modelManagement={dashboardView.models}
                            onSelectEngine={setSelectedInstalledEngineId}
                            onStart={() => void doStart()}
                            onStop={() => void doStop()}
                            onCheck={() => void doCheck()}
                            onUnloadModel={() => void doUnloadModel()}
                            onUninstall={() => void doUninstall()}
                            onSaveNetworkSettings={(engineId, updates) => void saveEngineNetworkSettings(engineId, updates)}
                            onRefreshModels={() => void refreshModels()}
                            onToggleModelsExpanded={() => setModelsExpanded((previous) => !previous)}
                            onDownloadModel={(modelId) => void doDownloadModel(modelId)}
                            onActivateModel={(modelId) => void doActivateModel(modelId)}
                            onDeleteModel={(modelId) => void doDeleteModel(modelId)}
                        />
                    ) : null}
                </div>
            </main>
        </div>
    )
}

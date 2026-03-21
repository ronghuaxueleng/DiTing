import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import OperationProgress from '../../src/components/OperationProgress'
import Icons from '../../src/components/ui/Icons'
import type { EngineDefinition, EngineInfo, ManagedModel, WorkerOperationStatus, WorkerStatus } from '../types'
import {
    activeButtonStyle,
    buttonBaseClass,
    dangerButtonStyle,
    dangerOutlineButtonStyle,
    primaryButtonStyle,
    secondaryButtonStyle,
} from '../constants'
import {
    getEngineDefinition,
    getLocalizedEngineDescription,
    getLocalizedManagedModelDescription,
    getLocalizedModelLabelById,
    getLocalizedModelTags,
    formatTimestamp,
} from '../utils'

const formControlStyle = {
    borderColor: 'var(--color-border)',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
}

interface DashboardSidebarView {
    installedEngines: EngineInfo[]
    selectedInstalledEngineId: string | null
}

interface DashboardCommandView {
    selectedInstalledEngine: EngineInfo | null
    dashboardEngineDefinition: EngineDefinition | null
    status: WorkerStatus | null
    statusBadges: Array<{ key: string; label: string; value: boolean }>
    hardwareSummary: string
    latestOperationMessage: string | null
    actionPending: string | null
    hasBusyOperation: boolean
}

interface DashboardRuntimeView {
    selectedInstalledEngine: EngineInfo | null
    status: WorkerStatus | null
}

interface DashboardNetworkView {
    selectedInstalledEngine: EngineInfo | null
    status: WorkerStatus | null
}

interface DashboardModelManagementView {
    models: ManagedModel[]
    modelsError: string | null
    loadingModels: boolean
    modelActionMessage: string | null
    operationStatus: WorkerOperationStatus | null
    modelsExpanded: boolean
    installedModelCount: number
    totalModelCount: number
    canManageModels: boolean
    canUnloadModel: boolean
}

interface WorkerDashboardProps {
    sidebar: DashboardSidebarView
    command: DashboardCommandView
    runtime: DashboardRuntimeView
    network: DashboardNetworkView
    modelManagement: DashboardModelManagementView
    onSelectEngine: (engineId: string) => void
    onStart: () => void
    onStop: () => void
    onCheck: () => void
    onUnloadModel: () => void
    onUninstall: () => void
    onSaveNetworkSettings: (engineId: string, updates: { port: number; serverUrl: string; advertiseUrl: string }) => void
    onRefreshModels: () => void
    onToggleModelsExpanded: () => void
    onDownloadModel: (modelId: string) => void
    onActivateModel: (modelId: string) => void
    onDeleteModel: (modelId: string) => void
}

type DashboardTab = 'overview' | 'models' | 'network' | 'advanced'

export default function WorkerDashboard({
    sidebar,
    command,
    runtime,
    network,
    modelManagement,
    onSelectEngine,
    onStart,
    onStop,
    onCheck,
    onUnloadModel,
    onUninstall,
    onSaveNetworkSettings,
    onRefreshModels,
    onToggleModelsExpanded,
    onDownloadModel,
    onActivateModel,
    onDeleteModel,
}: WorkerDashboardProps) {
    const { t } = useTranslation()
    const selectedEngine = command.selectedInstalledEngine
    const [activeTab, setActiveTab] = useState<DashboardTab>('overview')

    useEffect(() => {
        setActiveTab('overview')
    }, [selectedEngine?.engine_id])

    if (!selectedEngine) {
        return (
            <section
                className="rounded-[24px] border px-5 py-8"
                style={{
                    borderColor: 'rgba(148,163,184,0.16)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
                }}
            >
                <EmptyHint icon={<Icons.Database className="w-4 h-4" />} text={t('workerManager.dashboard.emptySelection')} />
            </section>
        )
    }

    const tabItems: Array<{ key: DashboardTab; label: string; count?: string }> = [
        { key: 'overview', label: t('workerManager.dashboard.tabs.overview') },
        { key: 'models', label: t('workerManager.dashboard.tabs.models'), count: String(modelManagement.installedModelCount) },
        { key: 'network', label: t('workerManager.dashboard.tabs.network') },
        { key: 'advanced', label: t('workerManager.dashboard.tabs.advanced') },
    ]

    return (
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <EngineSidebar
                engines={sidebar.installedEngines}
                selectedInstalledEngineId={sidebar.selectedInstalledEngineId}
                selectedStatus={command.status}
                onSelectEngine={onSelectEngine}
            />

            <div className="min-w-0 space-y-4">
                <EngineCommandBar
                    selectedEngine={selectedEngine}
                    engineDefinition={command.dashboardEngineDefinition}
                    statusBadges={command.statusBadges}
                    status={command.status}
                    actionPending={command.actionPending}
                    hasBusyOperation={command.hasBusyOperation}
                    onStart={onStart}
                    onStop={onStop}
                    onCheck={onCheck}
                />

                <DashboardTabs tabs={tabItems} activeTab={activeTab} onChange={setActiveTab} />

                {activeTab === 'overview' ? (
                    <div className="space-y-4">
                        <EngineOperationPanel
                            operationStatus={modelManagement.operationStatus}
                            latestOperationMessage={command.latestOperationMessage}
                            modelActionMessage={modelManagement.modelActionMessage}
                        />
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)] lg:items-start">
                            <EngineStatusPanel selectedEngine={runtime.selectedInstalledEngine} />
                            <EngineRuntimePanel
                                selectedEngine={runtime.selectedInstalledEngine}
                                status={runtime.status}
                            />
                        </div>
                    </div>
                ) : null}

                {activeTab === 'models' ? (
                    <div className="space-y-4">
                        <EngineOperationPanel
                            operationStatus={modelManagement.operationStatus}
                            latestOperationMessage={command.latestOperationMessage}
                            modelActionMessage={modelManagement.modelActionMessage}
                        />
                        <ModelInventoryPanel
                            modelManagement={modelManagement}
                            actionPending={command.actionPending}
                            hasBusyOperation={command.hasBusyOperation}
                            onUnloadModel={onUnloadModel}
                            onRefreshModels={onRefreshModels}
                            onToggleModelsExpanded={onToggleModelsExpanded}
                            onDownloadModel={onDownloadModel}
                            onActivateModel={onActivateModel}
                            onDeleteModel={onDeleteModel}
                        />
                    </div>
                ) : null}

                {activeTab === 'network' ? (
                    <NetworkSettingsPanel
                        selectedEngine={network.selectedInstalledEngine}
                        status={network.status}
                        hasBusyOperation={command.hasBusyOperation}
                        onSaveNetworkSettings={onSaveNetworkSettings}
                    />
                ) : null}

                {activeTab === 'advanced' ? (
                    <div className="space-y-4">
                        <SectionCard
                            title={t('workerManager.dashboard.advancedTitle')}
                            description={t('workerManager.dashboard.advancedDescription')}
                            icon={<Icons.AlertTriangle className="w-4 h-4" />}
                        >
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <InfoTile label={t('workerManager.dashboard.engineId')} value={selectedEngine.engine_id} />
                                <InfoTile label={t('workerManager.install.runtimeRoot')} value={selectedEngine.runtime_root} />
                                <InfoTile label={t('workerManager.engine.installDir')} value={selectedEngine.install_dir} />
                                <InfoTile
                                    label={t('workerManager.dashboard.lastStartedLabel')}
                                    value={formatTimestamp(selectedEngine.last_started) || t('workerManager.dashboard.neverStarted')}
                                />
                            </div>
                        </SectionCard>

                        <DangerZonePanel
                            hasBusyOperation={command.hasBusyOperation}
                            actionPending={command.actionPending}
                            onUninstall={onUninstall}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function EngineSidebar({
    engines,
    selectedInstalledEngineId,
    selectedStatus,
    onSelectEngine,
}: {
    engines: EngineInfo[]
    selectedInstalledEngineId: string | null
    selectedStatus: WorkerStatus | null
    onSelectEngine: (engineId: string) => void
}) {
    const { t } = useTranslation()

    return (
        <aside
            className="rounded-[24px] border px-3 py-3.5"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'linear-gradient(180deg, rgba(15,23,42,0.06), rgba(15,23,42,0.02))',
                boxShadow: '0 18px 48px rgba(15,23,42,0.08)',
            }}
        >
            <div className="border-b px-1 pb-3" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.dashboard.installedEngines')}
                        </div>
                        <div className="mt-1 text-base font-semibold">{engines.length}</div>
                    </div>
                    <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl border"
                        style={{
                            borderColor: 'rgba(148,163,184,0.14)',
                            background: 'rgba(59,130,246,0.08)',
                            color: 'var(--color-primary)',
                        }}
                    >
                        <Icons.LayoutDashboard className="w-4.5 h-4.5" />
                    </div>
                </div>
                <p className="mt-2 text-xs leading-5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('workerManager.dashboard.summaryDescription')}
                </p>
            </div>

            <nav className="mt-3 space-y-1.5">
                {engines.map((engine) => {
                    const active = engine.engine_id === selectedInstalledEngineId
                    const isRunning = active && !!selectedStatus?.running
                    const isHealthy = active && !!selectedStatus?.healthy
                    const dotTone = isRunning ? (isHealthy ? 'var(--color-success)' : 'var(--color-warning)') : 'rgba(148,163,184,0.7)'

                    return (
                        <button
                            key={engine.engine_id}
                            type="button"
                            onClick={() => onSelectEngine(engine.engine_id)}
                            className="w-full rounded-[18px] border px-3 py-3 text-left transition-all duration-150"
                            style={
                                active
                                    ? {
                                        borderColor: 'rgba(59,130,246,0.24)',
                                        background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(59,130,246,0.04))',
                                        boxShadow: '0 10px 24px rgba(37,99,235,0.08)',
                                    }
                                    : {
                                        borderColor: 'rgba(148,163,184,0.12)',
                                        background: 'rgba(255,255,255,0.02)',
                                    }
                            }
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dotTone }} />
                                        <span className="truncate text-sm font-semibold">{engine.display_name}</span>
                                    </div>
                                    <div className="mt-1 text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
                                        {engine.engine_id}
                                    </div>
                                </div>
                                {active ? (
                                    <span
                                        className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                                        style={{
                                            background: 'rgba(59,130,246,0.12)',
                                            color: 'var(--color-primary)',
                                        }}
                                    >
                                        {t('workerManager.dashboard.selected')}
                                    </span>
                                ) : null}
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <SidebarMetric label={t('workerManager.install.port')} value={String(engine.port)} />
                                <SidebarMetric label={t('workerManager.install.device')} value={engine.device || t('workerManager.common.notSet')} />
                            </div>
                        </button>
                    )
                })}
            </nav>
        </aside>
    )
}

function EngineCommandBar({
    selectedEngine,
    engineDefinition,
    statusBadges,
    status,
    actionPending,
    hasBusyOperation,
    onStart,
    onStop,
    onCheck,
}: {
    selectedEngine: EngineInfo
    engineDefinition: EngineDefinition | null
    statusBadges: Array<{ key: string; label: string; value: boolean }>
    status: WorkerStatus | null
    actionPending: string | null
    hasBusyOperation: boolean
    onStart: () => void
    onStop: () => void
    onCheck: () => void
}) {
    const { t } = useTranslation()
    const loadedModelLabel =
        getLocalizedModelLabelById(t, engineDefinition, status?.model_id || selectedEngine.initial_model_id) ||
        t('workerManager.common.na')

    return (
        <section
            className="overflow-hidden rounded-[26px] border"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background:
                    'linear-gradient(135deg, rgba(15,23,42,0.06), rgba(15,23,42,0.02)), radial-gradient(circle at top right, rgba(59,130,246,0.12), transparent 28%)',
                boxShadow: '0 20px 52px rgba(15,23,42,0.10)',
            }}
        >
            <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.dashboard.summaryTitle')}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <h2 className="text-2xl font-semibold tracking-tight">{selectedEngine.display_name}</h2>
                            <span
                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                                style={{
                                    borderColor: 'rgba(148,163,184,0.14)',
                                    background: 'rgba(255,255,255,0.04)',
                                    color: 'var(--color-text-muted)',
                                }}
                            >
                                <Icons.Database className="w-3.5 h-3.5" />
                                {selectedEngine.engine_id}
                            </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
                            {getLocalizedEngineDescription(t, engineDefinition) || t('workerManager.dashboard.engineDescription')}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                        <button className={buttonBaseClass} style={primaryButtonStyle} disabled={hasBusyOperation} onClick={onStart}>
                            {actionPending === 'start' ? t('workerManager.actions.starting') : t('workerManager.actions.start')}
                        </button>
                        <button className={buttonBaseClass} style={secondaryButtonStyle} disabled={hasBusyOperation} onClick={onStop}>
                            {actionPending === 'stop' ? t('workerManager.actions.stopping') : t('workerManager.actions.stop')}
                        </button>
                        <button className={buttonBaseClass} style={secondaryButtonStyle} disabled={hasBusyOperation} onClick={onCheck}>
                            {actionPending === 'check' ? t('workerManager.actions.checking') : t('workerManager.actions.check')}
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-4 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap gap-2">
                    {statusBadges.map((badge) => (
                        <StatusBadge key={badge.key} label={badge.label} value={badge.value} />
                    ))}
                </div>

                <div
                    className="rounded-[20px] border px-4 py-3.5"
                    style={{
                        borderColor: 'rgba(148,163,184,0.14)',
                        background: 'rgba(255,255,255,0.03)',
                    }}
                >
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
                        <Icons.Activity className="w-3.5 h-3.5" />
                        {t('workerManager.dashboard.quickFactsTitle')}
                    </div>
                    <div className="mt-3 space-y-2.5 text-sm">
                        <QuickFactRow label={t('workerManager.dashboard.loadedModel')} value={loadedModelLabel} />
                        <QuickFactRow label={t('workerManager.dashboard.loadedDevice')} value={status?.device || selectedEngine.device || t('workerManager.common.na')} />
                        <QuickFactRow label={t('workerManager.dashboard.workerUrl')} value={status?.url || selectedEngine.advertise_url || `http://127.0.0.1:${selectedEngine.port}`} />
                        <QuickFactRow label={t('workerManager.install.serverUrl')} value={selectedEngine.server_url || t('workerManager.common.notSet')} />
                        <QuickFactRow label={t('workerManager.dashboard.lastStartedLabel')} value={formatTimestamp(selectedEngine.last_started) || t('workerManager.dashboard.neverStarted')} />
                    </div>
                </div>
            </div>
        </section>
    )
}

function DashboardTabs({
    tabs,
    activeTab,
    onChange,
}: {
    tabs: Array<{ key: DashboardTab; label: string; count?: string }>
    activeTab: DashboardTab
    onChange: (tab: DashboardTab) => void
}) {
    return (
        <div
            className="flex flex-wrap gap-2 rounded-[22px] border p-2"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))',
            }}
        >
            {tabs.map((tab) => {
                const active = tab.key === activeTab
                return (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => onChange(tab.key)}
                        className="inline-flex items-center gap-2 rounded-[16px] px-3.5 py-2 text-sm font-medium transition-all"
                        style={
                            active
                                ? {
                                    background: 'linear-gradient(135deg, rgba(59,130,246,0.14), rgba(59,130,246,0.06))',
                                    color: 'var(--color-primary)',
                                    boxShadow: '0 8px 18px rgba(37,99,235,0.08)',
                                }
                                : {
                                    background: 'transparent',
                                    color: 'var(--color-text-muted)',
                                }
                        }
                    >
                        <span>{tab.label}</span>
                        {tab.count ? (
                            <span
                                className="rounded-full px-2 py-0.5 text-[11px]"
                                style={{
                                    background: active ? 'rgba(59,130,246,0.12)' : 'rgba(148,163,184,0.10)',
                                    color: active ? 'var(--color-primary)' : 'inherit',
                                }}
                            >
                                {tab.count}
                            </span>
                        ) : null}
                    </button>
                )
            })}
        </div>
    )
}

function EngineOperationPanel({
    operationStatus,
    latestOperationMessage,
    modelActionMessage,
}: {
    operationStatus: WorkerOperationStatus | null
    latestOperationMessage: string | null
    modelActionMessage: string | null
}) {
    const { t } = useTranslation()

    if (!operationStatus && !latestOperationMessage && !modelActionMessage) {
        return null
    }

    const operation = operationStatus
        ? {
            id: operationStatus.id,
            status: normalizeOperationState(operationStatus.status),
            progress: operationStatus.progress,
            result: operationStatus.result,
            error: operationStatus.error || null,
        }
        : null

    return (
        <section
            className="rounded-[20px] border px-4 py-3.5"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'rgba(255,255,255,0.03)',
            }}
        >
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
                <Icons.Activity className="w-3.5 h-3.5" />
                {t('workerManager.dashboard.recentActivityTitle')}
            </div>

            {operation ? (
                <div className="space-y-3">
                    <OperationProgress
                        operation={operation}
                        label={t('workerManager.modelManagement.operation', {
                            type: operationStatus?.type,
                            status: operationStatus?.status,
                        })}
                    />
                    {operationStatus?.progress.length ? (
                        <div className="rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                            {operationStatus.progress.slice(-4).map((line: string, index: number) => (
                                <div key={`${index}-${line}`} className="truncate">{line}</div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : (
                <div
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm"
                    style={{
                        borderColor: 'rgba(148,163,184,0.14)',
                        background: 'rgba(15,23,42,0.04)',
                        color: 'var(--color-text-muted)',
                    }}
                >
                    <Icons.Info className="w-4 h-4" />
                    <span>{latestOperationMessage || modelActionMessage}</span>
                </div>
            )}
        </section>
    )
}

function EngineStatusPanel({ selectedEngine }: { selectedEngine: EngineInfo | null }) {
    const { t } = useTranslation()
    const engineDefinition = getEngineDefinition(selectedEngine?.engine_id)
    const initialModelLabel =
        getLocalizedModelLabelById(t, engineDefinition, selectedEngine?.initial_model_id) || t('workerManager.common.notSet')

    if (!selectedEngine) {
        return null
    }

    return (
        <SectionCard
            title={t('workerManager.dashboard.installRuntimeTitle')}
            description={t('workerManager.dashboard.installRuntimeDescription')}
            icon={<Icons.Settings className="w-4 h-4" />}
        >
            <dl className="grid gap-3 md:grid-cols-2">
                <InfoTile label={t('workerManager.engine.installDir')} value={selectedEngine.install_dir} />
                <InfoTile label={t('workerManager.install.runtimeRoot')} value={selectedEngine.runtime_root} />
                <InfoTile label={t('workerManager.install.port')} value={String(selectedEngine.port)} />
                <InfoTile label={t('workerManager.install.device')} value={selectedEngine.device || t('workerManager.common.notSet')} />
                <InfoTile label={t('workerManager.install.initialModel')} value={initialModelLabel} />
                <InfoTile label={t('workerManager.install.workerUrl')} value={selectedEngine.advertise_url || `http://127.0.0.1:${selectedEngine.port}`} />
                <InfoTile label={t('workerManager.install.serverUrl')} value={selectedEngine.server_url || t('workerManager.common.notSet')} />
                <InfoTile label={t('workerManager.dashboard.engineId')} value={selectedEngine.engine_id} />
            </dl>
        </SectionCard>
    )
}

function EngineRuntimePanel({
    selectedEngine,
    status,
}: {
    selectedEngine: EngineInfo | null
    status: WorkerStatus | null
}) {
    const { t } = useTranslation()
    const engineDefinition = getEngineDefinition(selectedEngine?.engine_id)
    const runtimeModelLabel = getLocalizedModelLabelById(t, engineDefinition, status?.model_id) || t('workerManager.common.na')

    return (
        <SectionCard
            title={t('workerManager.dashboard.workerStatusTitle')}
            description={t('workerManager.dashboard.workerStatusDescription')}
            icon={<Icons.Activity className="w-4 h-4" />}
        >
            {status ? (
                <dl className="grid gap-3 md:grid-cols-2">
                    <InfoTile label={t('workerManager.dashboard.workerUrl')} value={status.url} />
                    <InfoTile label={t('workerManager.dashboard.loadedModel')} value={runtimeModelLabel} />
                    <InfoTile label={t('workerManager.dashboard.loadedDevice')} value={status.device || t('workerManager.common.na')} />
                    <InfoTile label={t('workerManager.dashboard.badges.management')} value={status.management ? t('workerManager.common.yes') : t('workerManager.common.no')} />
                </dl>
            ) : (
                <EmptyHint icon={<Icons.AlertCircle className="w-4 h-4" />} text={t('workerManager.engine.noStatus')} />
            )}
        </SectionCard>
    )
}

function NetworkSettingsPanel({
    selectedEngine,
    status,
    hasBusyOperation,
    onSaveNetworkSettings,
}: {
    selectedEngine: EngineInfo | null
    status: WorkerStatus | null
    hasBusyOperation: boolean
    onSaveNetworkSettings: (engineId: string, updates: { port: number; serverUrl: string; advertiseUrl: string }) => void
}) {
    const { t } = useTranslation()
    const [port, setPort] = useState('')
    const [serverUrl, setServerUrl] = useState('')
    const [advertiseUrl, setAdvertiseUrl] = useState('')
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        setPort(selectedEngine ? String(selectedEngine.port) : '')
        setServerUrl(selectedEngine?.server_url || '')
        setAdvertiseUrl(selectedEngine?.advertise_url || (selectedEngine ? `http://127.0.0.1:${selectedEngine.port}` : ''))
        setSaveState('idle')
        setErrorMessage(null)
    }, [selectedEngine?.engine_id, selectedEngine?.port, selectedEngine?.server_url, selectedEngine?.advertise_url])

    if (!selectedEngine) {
        return null
    }

    const canSave = !hasBusyOperation && saveState !== 'saving' && Number(port) > 0

    return (
        <SectionCard
            title={t('workerManager.dashboard.networkSettingsTitle')}
            description={t('workerManager.dashboard.networkSettingsDescription')}
            icon={<Icons.Globe className="w-4 h-4" />}
        >
            <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                    <Field label={t('workerManager.install.port')}>
                        <input
                            type="number"
                            className="w-full rounded-xl border px-3 py-2.5 text-sm"
                            style={formControlStyle}
                            value={port}
                            onChange={(event) => setPort(event.target.value)}
                        />
                    </Field>
                    <Field label={t('workerManager.install.serverUrl')}>
                        <input
                            className="w-full rounded-xl border px-3 py-2.5 text-sm"
                            style={formControlStyle}
                            value={serverUrl}
                            placeholder={t('workerManager.install.serverUrlPlaceholder')}
                            onChange={(event) => setServerUrl(event.target.value)}
                        />
                    </Field>
                    <Field label={t('workerManager.install.workerUrl')}>
                        <input
                            className="w-full rounded-xl border px-3 py-2.5 text-sm"
                            style={formControlStyle}
                            value={advertiseUrl}
                            placeholder={t('workerManager.install.workerUrlPlaceholder')}
                            onChange={(event) => setAdvertiseUrl(event.target.value)}
                        />
                    </Field>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_auto] lg:items-start">
                    <div className="rounded-xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                        <div>{t('workerManager.install.workerUrlHint')}</div>
                        <div className="mt-1 break-all">
                            <span>{t('workerManager.install.effectiveWorkerUrl')}:</span> {advertiseUrl.trim() || `http://127.0.0.1:${port || selectedEngine.port}`}
                        </div>
                        <div className="mt-1 break-all">
                            <span>{t('workerManager.dashboard.workerStatusTitle')}:</span> {status?.url || t('workerManager.common.notSet')}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 lg:items-end">
                        <button
                            className={buttonBaseClass}
                            style={primaryButtonStyle}
                            disabled={!canSave}
                            onClick={async () => {
                                setSaveState('saving')
                                setErrorMessage(null)
                                try {
                                    await onSaveNetworkSettings(selectedEngine.engine_id, {
                                        port: Number(port) || selectedEngine.port,
                                        serverUrl,
                                        advertiseUrl,
                                    })
                                    setSaveState('saved')
                                } catch (error) {
                                    setSaveState('failed')
                                    setErrorMessage(String(error))
                                }
                            }}
                        >
                            {saveState === 'saving' ? t('workerManager.dashboard.networkSaving') : t('common.save')}
                        </button>
                        {saveState === 'saved' ? (
                            <div className="text-xs" style={{ color: 'var(--color-success)' }}>
                                {t('workerManager.dashboard.networkSaved')}
                            </div>
                        ) : null}
                        {errorMessage ? (
                            <div className="max-w-sm text-xs" style={{ color: 'var(--color-error)' }}>
                                {t('workerManager.dashboard.networkSaveFailed', { error: errorMessage })}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </SectionCard>
    )
}

function ModelInventoryPanel({
    modelManagement,
    actionPending,
    hasBusyOperation,
    onUnloadModel,
    onRefreshModels,
    onToggleModelsExpanded,
    onDownloadModel,
    onActivateModel,
    onDeleteModel,
}: {
    modelManagement: DashboardModelManagementView
    actionPending: string | null
    hasBusyOperation: boolean
    onUnloadModel: () => void
    onRefreshModels: () => void
    onToggleModelsExpanded: () => void
    onDownloadModel: (modelId: string) => void
    onActivateModel: (modelId: string) => void
    onDeleteModel: (modelId: string) => void
}) {
    const { t } = useTranslation()

    return (
        <SectionCard
            title={t('workerManager.modelManagement.title')}
            description={t('workerManager.dashboard.modelManagementDescription')}
            icon={<Icons.HardDrive className="w-4 h-4" />}
        >
            <div className="flex flex-col gap-3 border-b pb-3 md:flex-row md:items-start md:justify-between" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
                <div>
                    <div className="text-lg font-semibold">
                        {t('workerManager.modelManagement.summary', {
                            installed: modelManagement.installedModelCount,
                            total: modelManagement.totalModelCount,
                        })}
                    </div>
                    <div className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {modelManagement.canManageModels
                            ? t('workerManager.dashboard.inventoryReady')
                            : t('workerManager.modelManagement.startWorkerHint')}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 md:justify-end">
                    <button
                        className={buttonBaseClass}
                        style={secondaryButtonStyle}
                        disabled={!modelManagement.canManageModels || modelManagement.loadingModels || hasBusyOperation}
                        onClick={onRefreshModels}
                    >
                        {modelManagement.loadingModels ? t('workerManager.modelManagement.refreshing') : t('workerManager.modelManagement.refresh')}
                    </button>
                    <button
                        className={buttonBaseClass}
                        style={secondaryButtonStyle}
                        disabled={!modelManagement.canUnloadModel || hasBusyOperation}
                        onClick={onUnloadModel}
                    >
                        {actionPending === 'unload' ? t('workerManager.actions.unloading') : t('workerManager.actions.unloadModel')}
                    </button>
                    <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onToggleModelsExpanded}>
                        {modelManagement.modelsExpanded ? t('workerManager.modelManagement.collapse') : t('workerManager.modelManagement.expand')}
                    </button>
                </div>
            </div>

            {modelManagement.modelsExpanded ? (
                <div className="mt-4 space-y-3">
                    {modelManagement.modelsError ? (
                        <div className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.22)', background: 'rgba(239,68,68,0.08)', color: 'var(--color-error)' }}>
                            {modelManagement.modelsError}
                        </div>
                    ) : null}

                    {!modelManagement.canManageModels ? (
                        <EmptyHint
                            icon={<Icons.AlertTriangle className="w-4 h-4" />}
                            text={modelManagement.totalModelCount > 0 ? t('workerManager.modelManagement.noManagementHint') : t('workerManager.modelManagement.startWorkerHint')}
                        />
                    ) : null}

                    {modelManagement.canManageModels && modelManagement.models.length === 0 && !modelManagement.loadingModels && !modelManagement.modelsError ? (
                        <EmptyHint icon={<Icons.Database className="w-4 h-4" />} text={t('workerManager.modelManagement.empty')} />
                    ) : null}

                    {modelManagement.canManageModels && modelManagement.models.length > 0 ? (
                        <div className="overflow-hidden rounded-[18px] border" style={{ borderColor: 'rgba(148,163,184,0.14)' }}>
                            <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(260px,0.95fr)_190px] gap-3 border-b px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] lg:grid" style={{ borderColor: 'rgba(148,163,184,0.12)', color: 'var(--color-text-muted)', background: 'rgba(15,23,42,0.04)' }}>
                                <span>{t('workerManager.dashboard.inventoryColumns.model')}</span>
                                <span>{t('workerManager.dashboard.inventoryColumns.status')}</span>
                                <span>{t('workerManager.dashboard.inventoryColumns.actions')}</span>
                            </div>
                            <div className="divide-y" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
                                {modelManagement.models.map((managedModel) => (
                                    <ModelRow
                                        key={managedModel.id}
                                        managedModel={managedModel}
                                        actionPending={actionPending}
                                        hasBusyOperation={hasBusyOperation}
                                        onDownload={() => onDownloadModel(managedModel.id)}
                                        onActivate={() => onActivateModel(managedModel.id)}
                                        onDelete={() => onDeleteModel(managedModel.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </SectionCard>
    )
}

function ModelRow({
    managedModel,
    actionPending,
    hasBusyOperation,
    onDownload,
    onActivate,
    onDelete,
}: {
    managedModel: ManagedModel
    actionPending: string | null
    hasBusyOperation: boolean
    onDownload: () => void
    onActivate: () => void
    onDelete: () => void
}) {
    const { t } = useTranslation()
    const localizedTags = getLocalizedModelTags(t, managedModel.tags)

    return (
        <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.95fr)_190px] lg:items-start">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold">{managedModel.display_name}</div>
                    {managedModel.installed ? <Chip tone="success" label={t('workerManager.modelManagement.installed')} /> : null}
                    {managedModel.active ? <Chip tone="primary" label={t('workerManager.modelManagement.active')} /> : null}
                    {!managedModel.compatible ? <Chip tone="danger" label={t('workerManager.modelManagement.notCompatible')} /> : null}
                </div>
                <div className="mt-1 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('workerManager.modelManagement.idMeta', { id: managedModel.id })}
                </div>
                <p className="mt-1.5 text-sm leading-5" style={{ color: 'var(--color-text-muted)' }}>
                    {getLocalizedManagedModelDescription(t, managedModel)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {localizedTags.map((tag) => (
                        <span
                            key={`${managedModel.id}-${tag.key}`}
                            className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                            style={
                                tag.tone === 'recommended'
                                    ? {
                                        borderColor: 'rgba(245,158,11,0.28)',
                                        background: 'rgba(245,158,11,0.14)',
                                        color: '#b45309',
                                        fontWeight: 700,
                                    }
                                    : {
                                        borderColor: 'rgba(148,163,184,0.16)',
                                        background: 'rgba(15,23,42,0.06)',
                                        color: 'var(--color-text-muted)',
                                    }
                            }
                        >
                            {tag.label}
                        </span>
                    ))}
                </div>
                {!managedModel.compatible && managedModel.reason ? (
                    <div className="mt-2 text-xs" style={{ color: 'var(--color-error)' }}>{managedModel.reason}</div>
                ) : null}
            </div>

            <div className="space-y-2.5">
                <div
                    className="rounded-[16px] border px-3 py-3"
                    style={{
                        borderColor: 'rgba(148,163,184,0.14)',
                        background: 'linear-gradient(180deg, rgba(15,23,42,0.05), rgba(15,23,42,0.03))',
                    }}
                >
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        <CompactFact label={t('workerManager.dashboard.modelMeta.size')} value={`${managedModel.download_size_mb} MB`} />
                        <CompactFact label={t('workerManager.dashboard.modelMeta.vram')} value={`${managedModel.vram_required_mb || 0} MB`} />
                        <CompactScale
                            label={t('workerManager.modelManagement.accuracy')}
                            value={managedModel.accuracy}
                            tone="amber"
                            ariaLabel={t('workerManager.modelManagement.accuracyAriaLabel', { value: Math.max(0, Math.min(5, Math.round(managedModel.accuracy))) })}
                        />
                        <CompactScale
                            label={t('workerManager.modelManagement.speed')}
                            value={managedModel.speed}
                            tone="primary"
                            ariaLabel={t('workerManager.modelManagement.speedAriaLabel', { value: Math.max(0, Math.min(5, Math.round(managedModel.speed))) })}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    <StatePill label={t('workerManager.dashboard.modelState.compatibility')} value={managedModel.compatible ? t('workerManager.common.yes') : t('workerManager.common.no')} tone={managedModel.compatible ? 'neutral' : 'danger'} />
                    <StatePill label={t('workerManager.dashboard.modelState.mps')} value={managedModel.supports_mps ? 'MPS' : '—'} tone={managedModel.supports_mps ? 'primary' : 'muted'} />
                    <StatePill label={t('workerManager.dashboard.modelState.dependencies')} value={managedModel.deps_installed ? t('workerManager.common.yes') : t('workerManager.common.no')} tone={managedModel.deps_installed ? 'success' : 'muted'} />
                </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
                {!managedModel.installed ? (
                    <button className={buttonBaseClass} style={secondaryButtonStyle} disabled={hasBusyOperation || !managedModel.compatible} onClick={onDownload}>
                        {actionPending === `download:${managedModel.id}` ? t('workerManager.modelManagement.downloading') : t('workerManager.modelManagement.download')}
                    </button>
                ) : !managedModel.active ? (
                    <>
                        <button className={buttonBaseClass} style={primaryButtonStyle} disabled={hasBusyOperation} onClick={onActivate}>
                            {actionPending === `activate:${managedModel.id}` ? t('workerManager.modelManagement.activating') : t('workerManager.modelManagement.activate')}
                        </button>
                        <button className={buttonBaseClass} style={dangerOutlineButtonStyle} disabled={hasBusyOperation} onClick={onDelete}>
                            {actionPending === `delete:${managedModel.id}` ? t('workerManager.modelManagement.deleting') : t('workerManager.modelManagement.delete')}
                        </button>
                    </>
                ) : (
                    <button className={buttonBaseClass} style={activeButtonStyle} disabled>
                        {t('workerManager.modelManagement.active')}
                    </button>
                )}
            </div>
        </div>
    )
}

function DangerZonePanel({
    hasBusyOperation,
    actionPending,
    onUninstall,
}: {
    hasBusyOperation: boolean
    actionPending: string | null
    onUninstall: () => void
}) {
    const { t } = useTranslation()
    const [confirming, setConfirming] = useState(false)

    useEffect(() => {
        if (!confirming) return
        const timer = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(timer)
    }, [confirming])

    const handleClick = () => {
        if (!confirming) {
            setConfirming(true)
            return
        }
        setConfirming(false)
        onUninstall()
    }

    const isUninstalling = actionPending === 'uninstall'
    const label = isUninstalling
        ? t('workerManager.actions.uninstalling')
        : confirming
            ? t('workerManager.actions.confirmUninstall')
            : t('workerManager.actions.uninstall')

    return (
        <section
            className="rounded-[22px] border px-4 py-4"
            style={{
                borderColor: 'rgba(239,68,68,0.18)',
                background: 'linear-gradient(180deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03))',
            }}
        >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-error)' }}>
                        {t('workerManager.dashboard.dangerZoneTitle')}
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6">{t('workerManager.dashboard.uninstallHint')}</p>
                </div>
                <button className={buttonBaseClass} style={dangerButtonStyle} disabled={hasBusyOperation || isUninstalling} onClick={handleClick}>
                    {label}
                </button>
            </div>
        </section>
    )
}

function SectionCard({
    title,
    description,
    icon,
    children,
}: {
    title: string
    description?: string
    icon: ReactNode
    children: ReactNode
}) {
    return (
        <section
            className="rounded-[22px] border px-4 py-4 sm:px-5"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
                boxShadow: '0 12px 36px rgba(15,23,42,0.06)',
            }}
        >
            <div className="mb-4 flex items-start gap-3">
                <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
                    style={{
                        borderColor: 'rgba(148,163,184,0.14)',
                        background: 'rgba(59,130,246,0.08)',
                        color: 'var(--color-primary)',
                    }}
                >
                    {icon}
                </div>
                <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    {description ? (
                        <p className="mt-1 text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
                            {description}
                        </p>
                    ) : null}
                </div>
            </div>
            {children}
        </section>
    )
}

function SidebarMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border px-2.5 py-2" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(15,23,42,0.04)' }}>
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="mt-1 truncate text-xs font-medium">{value}</div>
        </div>
    )
}

function QuickFactRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0" style={{ borderColor: 'rgba(148,163,184,0.10)' }}>
            <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="break-words font-medium">{value}</div>
        </div>
    )
}

function StatusBadge({ label, value }: { label: string; value: boolean }) {
    return (
        <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
            style={
                value
                    ? {
                        borderColor: 'rgba(16,185,129,0.24)',
                        background: 'rgba(16,185,129,0.10)',
                        color: 'var(--color-success)',
                    }
                    : {
                        borderColor: 'rgba(148,163,184,0.16)',
                        background: 'rgba(148,163,184,0.08)',
                        color: 'var(--color-text-muted)',
                    }
            }
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            {label}
        </span>
    )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5 text-sm">
            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            {children}
        </label>
    )
}

function InfoTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border px-3 py-3" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)' }}>
            <dt className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
            <dd className="mt-1.5 break-words text-sm font-medium">{value}</dd>
        </div>
    )
}

function CompactFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="mt-1 truncate text-sm font-semibold">{value}</div>
        </div>
    )
}

function CompactScale({
    label,
    value,
    tone,
    ariaLabel,
}: {
    label: string
    value: number
    tone: 'amber' | 'primary'
    ariaLabel?: string
}) {
    const count = Math.max(0, Math.min(5, Math.round(value)))
    const activeColor = tone === 'amber' ? '#f59e0b' : 'var(--color-primary)'

    return (
        <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
                <span>{label}</span>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{count}/5</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1" aria-label={ariaLabel || `${label} ${count}/5`}>
                {Array.from({ length: 5 }, (_, index) => (
                    <span
                        key={index}
                        className="h-1.5 flex-1 rounded-full"
                        style={{
                            background: index < count ? activeColor : 'rgba(148,163,184,0.26)',
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

function StatePill({
    label,
    value,
    tone,
}: {
    label: string
    value: string
    tone: 'primary' | 'success' | 'danger' | 'neutral' | 'muted'
}) {
    const toneStyle =
        tone === 'primary'
            ? { borderColor: 'rgba(59,130,246,0.18)', background: 'rgba(59,130,246,0.10)', color: 'var(--color-primary)' }
            : tone === 'success'
                ? { borderColor: 'rgba(16,185,129,0.18)', background: 'rgba(16,185,129,0.10)', color: 'var(--color-success)' }
                : tone === 'danger'
                    ? { borderColor: 'rgba(239,68,68,0.18)', background: 'rgba(239,68,68,0.10)', color: 'var(--color-error)' }
                    : tone === 'neutral'
                        ? { borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.05)', color: 'var(--color-text)' }
                        : { borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(148,163,184,0.08)', color: 'var(--color-text-muted)' }

    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
            style={toneStyle}
        >
            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            <span>{value}</span>
        </span>
    )
}

function Chip({ label, tone }: { label: string; tone: 'success' | 'primary' | 'danger' }) {
    const toneStyle =
        tone === 'success'
            ? { background: 'rgba(16,185,129,0.12)', color: 'var(--color-success)' }
            : tone === 'primary'
                ? { background: 'rgba(59,130,246,0.12)', color: 'var(--color-primary)' }
                : { background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)' }

    return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={toneStyle}>
            {label}
        </span>
    )
}

function EmptyHint({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
            {icon}
            <span>{text}</span>
        </div>
    )
}

function normalizeOperationState(status: string): 'idle' | 'started' | 'running' | 'completed' | 'failed' {
    if (status === 'completed' || status === 'failed' || status === 'started' || status === 'running') {
        return status
    }

    return 'running'
}

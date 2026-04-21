import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Icons from '../../src/components/ui/Icons'
import { buttonBaseClass, primaryButtonStyle, secondaryButtonStyle, WIZARD_STEPS } from '../constants'
import {
    getLocalizedEngineDescription,
    getLocalizedModelOptionLabel,
} from '../utils'
import type {
    DeviceOption,
    EngineDefinition,
    EngineInfo,
    HardwareInfo,
    InstallLogEntry,
    InstallPathInfo,
    InstallPathPreview,
    InstallProgressPayload,
    SharedPathMapping,
    WizardStep,
} from '../types'

const formControlStyle = {
    borderColor: 'var(--color-border)',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
}

interface WizardProgressView {
    wizardStep: WizardStep
    progressPercent: number
    installProgress: InstallProgressPayload | null
    installStepLabel: string
    installLog: InstallLogEntry[]
    installLogText: string
}

interface WizardSetupView {
    hasInstalledEngines: boolean
    availableWizardEngines: EngineDefinition[]
    wizardEngine: EngineDefinition
    wizardModelId: string
    wizardDevice: string
    wizardPort: number
    serverUrl: string
    advertiseUrl: string
    sharedPaths: SharedPathMapping[]
    effectiveAdvertiseUrl: string
    installDir: string
    effectiveInstallDir: string
    installPathInfo: InstallPathInfo | null
    installPathPreview: InstallPathPreview | null
    availableDevices: DeviceOption[]
    computeKey: string
    useMirror: boolean
    useProxy: boolean
    proxy: string
}

interface WizardContextView {
    hardware: HardwareInfo | null
    hardwareFacts: Array<{ key: string; label: string; value: string; meta?: string }>
    hardwareSummary: string
    selectedInstalledEngineId: string | null
    installedEngineMap: Record<string, EngineInfo>
    completeEngineName: string
    currentInstallTarget: string
    currentInstallModelLabel: string
    showCurrentInstallModel: boolean
    currentServerUrl: string
    currentWorkerUrl: string
}

interface WorkerWizardProps {
    progress: WizardProgressView
    setup: WizardSetupView
    context: WizardContextView
    onChangeStep: (step: WizardStep) => void
    onChangeAdvertiseUrl: (value: string) => void
    onOpenDashboard: () => void
    onOpenAnotherEngine: () => void
    onSelectEngine: (engineId: string) => void
    onChangeModel: (modelId: string) => void
    onChangeDevice: (device: string) => void
    onChangePort: (port: number) => void
    onChangeServerUrl: (value: string) => void
    onChangeSharedPaths: (paths: SharedPathMapping[]) => void
    onChangeInstallDir: (value: string) => void
    onBrowseInstallDir: () => void
    onChangeUseMirror: (value: boolean) => void
    onChangeUseProxy: (value: boolean) => void
    onChangeProxy: (value: string) => void
    onInstall: () => void
}

function normalizeInstallPath(path: string) {
    return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isProtectedWindowsInstallPath(path: string) {
    const normalized = normalizeInstallPath(path)
    if (!normalized) {
        return false
    }

    return [
        /^([a-z]:)?\/program files(?:\/|$)/,
        /^([a-z]:)?\/program files \(x86\)(?:\/|$)/,
        /^([a-z]:)?\/windows(?:\/|$)/,
    ].some((pattern) => pattern.test(normalized))
}

export default function WorkerWizard({
    progress,
    setup,
    context,
    onChangeStep,
    onChangeAdvertiseUrl,
    onOpenDashboard,
    onOpenAnotherEngine,
    onSelectEngine,
    onChangeModel,
    onChangeDevice,
    onChangePort,
    onChangeServerUrl,
    onChangeSharedPaths,
    onChangeInstallDir,
    onBrowseInstallDir,
    onChangeUseMirror,
    onChangeUseProxy,
    onChangeProxy,
    onInstall,
}: WorkerWizardProps) {
    const { t } = useTranslation()
    const currentStepIndex = WIZARD_STEPS.indexOf(progress.wizardStep)
    const completedEngine = context.installedEngineMap[progress.installProgress?.engine_id || context.selectedInstalledEngineId || ''] || null
    const stepDescription =
        progress.wizardStep === 'hardware'
            ? t('workerManager.wizard.hardwareDescription')
            : progress.wizardStep === 'engine'
                ? t('workerManager.wizard.engineDescription')
                : progress.wizardStep === 'install'
                    ? t('workerManager.wizard.installDescription', {
                        engine: setup.wizardEngine.displayName,
                    })
                    : t('workerManager.wizard.completeDescription', {
                        engine: context.completeEngineName,
                    })

    const footerActions =
        progress.wizardStep === 'hardware' ? (
            <div className="flex flex-wrap gap-2">
                {setup.hasInstalledEngines ? (
                    <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenDashboard}>
                        {t('workerManager.actions.cancel')}
                    </button>
                ) : null}
                <button
                    className={buttonBaseClass}
                    style={primaryButtonStyle}
                    disabled={!context.hardware}
                    onClick={() => onChangeStep('engine')}
                >
                    {t('workerManager.actions.next')}
                </button>
            </div>
        ) : progress.wizardStep === 'engine' ? (
            setup.availableWizardEngines.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {setup.hasInstalledEngines ? (
                        <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenDashboard}>
                            {t('workerManager.actions.cancel')}
                        </button>
                    ) : null}
                    <button className={buttonBaseClass} style={secondaryButtonStyle} disabled={!context.hardware} onClick={() => onChangeStep('hardware')}>
                        {t('workerManager.actions.back')}
                    </button>
                    <button
                        className={buttonBaseClass}
                        style={primaryButtonStyle}
                        disabled={!setup.effectiveInstallDir || setup.availableWizardEngines.length === 0}
                        onClick={onInstall}
                    >
                        {t('workerManager.install.install')}
                    </button>
                </div>
            ) : setup.hasInstalledEngines ? (
                <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenDashboard}>
                    {t('workerManager.actions.openDashboard')}
                </button>
            ) : null
        ) : progress.wizardStep === 'install' ? (
            progress.installProgress?.error ? (
                <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={() => onChangeStep('engine')}>
                    {t('workerManager.actions.back')}
                </button>
            ) : null
        ) : (
            <div className="flex flex-wrap gap-2">
                <button className={buttonBaseClass} style={primaryButtonStyle} onClick={onOpenDashboard}>
                    {t('workerManager.actions.openDashboard')}
                </button>
                {setup.availableWizardEngines.length > 0 ? (
                    <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenAnotherEngine}>
                        {t('workerManager.actions.addAnotherEngine')}
                    </button>
                ) : null}
            </div>
        )

    return (
        <div
            className="flex max-h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden rounded-[26px] border"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background:
                    'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)), radial-gradient(circle at top left, rgba(59,130,246,0.10), transparent 26%)',
                boxShadow: '0 20px 56px rgba(15,23,42,0.12)',
            }}
        >
            <div className="border-b px-4 py-3.5 sm:px-5" style={{ borderColor: 'rgba(148,163,184,0.12)' }}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.wizard.title')}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t(`workerManager.wizard.steps.${progress.wizardStep}`)}</h2>
                            <span
                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                                style={{
                                    borderColor: 'rgba(148,163,184,0.14)',
                                    background: 'rgba(255,255,255,0.03)',
                                    color: 'var(--color-text-muted)',
                                }}
                            >
                                <Icons.Clock className="w-3.5 h-3.5" />
                                {t('workerManager.install.step', { current: currentStepIndex + 1, total: WIZARD_STEPS.length })}
                            </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
                            {stepDescription}
                        </p>
                    </div>

                    {setup.hasInstalledEngines ? (
                        <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenDashboard}>
                            {t('workerManager.actions.openDashboard')}
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <WizardStepRail currentStepIndex={currentStepIndex} wizardStep={progress.wizardStep} />

                    <div className="min-w-0 space-y-4">
                        {progress.wizardStep === 'hardware' ? (
                            <HardwareStepPanel context={context} />
                        ) : null}

                        {progress.wizardStep === 'engine' ? (
                            <EngineSetupStepPanel
                                setup={setup}
                                onSelectEngine={onSelectEngine}
                                onChangeModel={onChangeModel}
                                onChangeDevice={onChangeDevice}
                                onChangePort={onChangePort}
                                onChangeServerUrl={onChangeServerUrl}
                                onChangeAdvertiseUrl={onChangeAdvertiseUrl}
                                onChangeSharedPaths={onChangeSharedPaths}
                                onChangeInstallDir={onChangeInstallDir}
                                onBrowseInstallDir={onBrowseInstallDir}
                                onChangeUseMirror={onChangeUseMirror}
                                onChangeUseProxy={onChangeUseProxy}
                                onChangeProxy={onChangeProxy}
                                onOpenDashboard={onOpenDashboard}
                            />
                        ) : null}

                        {progress.wizardStep === 'install' ? (
                            <InstallProgressStepPanel progress={progress} context={context} />
                        ) : null}

                        {progress.wizardStep === 'complete' ? (
                            <CompleteStepPanel
                                completedEngine={completedEngine}
                                completeEngineName={context.completeEngineName}
                                onOpenDashboard={onOpenDashboard}
                                onOpenAnotherEngine={onOpenAnotherEngine}
                                canAddAnother={setup.availableWizardEngines.length > 0}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            {footerActions ? (
                <div
                    className="sticky bottom-0 z-10 border-t px-4 py-2.5 sm:px-5"
                    style={{
                        borderColor: 'rgba(148,163,184,0.12)',
                        background: 'color-mix(in srgb, var(--color-card) 94%, transparent)',
                        backdropFilter: 'blur(10px)',
                    }}
                >
                    {footerActions}
                </div>
            ) : null}
        </div>
    )
}

function WizardStepRail({ currentStepIndex, wizardStep }: { currentStepIndex: number; wizardStep: WizardStep }) {
    const { t } = useTranslation()

    return (
        <aside
            className="min-w-0 rounded-[22px] border px-3 py-3.5 xl:sticky xl:top-0 xl:self-start"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'linear-gradient(180deg, rgba(15,23,42,0.05), rgba(15,23,42,0.02))',
            }}
        >
            <div className="px-1 pb-3 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
                {t('workerManager.wizard.stepRailTitle')}
            </div>
            <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-1">
                {WIZARD_STEPS.map((step, index) => {
                    const active = step === wizardStep
                    const completed = index < currentStepIndex

                    return (
                        <div
                            key={step}
                            className="rounded-[18px] border px-3 py-3"
                            style={
                                active
                                    ? {
                                        borderColor: 'rgba(59,130,246,0.24)',
                                        background: 'rgba(59,130,246,0.10)',
                                    }
                                    : completed
                                        ? {
                                            borderColor: 'rgba(16,185,129,0.22)',
                                            background: 'rgba(16,185,129,0.08)',
                                        }
                                        : {
                                            borderColor: 'rgba(148,163,184,0.12)',
                                            background: 'rgba(255,255,255,0.03)',
                                        }
                            }
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                                    style={
                                        active
                                            ? { borderColor: 'transparent', background: 'var(--color-primary)', color: 'white' }
                                            : completed
                                                ? { borderColor: 'rgba(16,185,129,0.22)', background: 'rgba(16,185,129,0.10)', color: 'var(--color-success)' }
                                                : { borderColor: 'rgba(148,163,184,0.18)', color: 'var(--color-text-muted)' }
                                    }
                                >
                                    {completed ? <Icons.Check className="w-4 h-4" /> : index + 1}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold">{t(`workerManager.wizard.steps.${step}`)}</div>
                                    <div className="mt-0.5 text-[11px] uppercase tracking-[0.12em]" style={{ color: active ? 'var(--color-primary)' : completed ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                        {active
                                            ? t('workerManager.wizard.stepStates.current')
                                            : completed
                                                ? t('workerManager.wizard.stepStates.done')
                                                : t('workerManager.wizard.stepStates.upcoming')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </aside>
    )
}

function HardwareStepPanel({ context }: { context: WizardContextView }) {
    const { t } = useTranslation()

    return (
        <>
            <SectionCard
                title={t('workerManager.wizard.hardwareSummaryTitle')}
                description={t('workerManager.wizard.hardwareLead')}
                icon={<Icons.Monitor className="w-4 h-4" />}
            >
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {context.hardwareFacts.map((fact) => (
                        <FactCard key={fact.key} label={fact.label} value={fact.value} meta={fact.meta} />
                    ))}
                </div>
            </SectionCard>

            <SectionCard
                title={t('workerManager.wizard.hardwareRecommendationTitle')}
                description={t('workerManager.wizard.hardwareRecommendationDescription')}
                icon={<Icons.Lightbulb className="w-4 h-4" />}
            >
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <RecommendationStrip label={t('workerManager.hardware.recommended')} value={context.hardware?.recommended_device || t('workerManager.common.notSet')} />
                    <RecommendationStrip label={t('workerManager.hardware.computeKey')} value={context.hardware?.compute_key || t('workerManager.common.notSet')} />
                </div>
            </SectionCard>
        </>
    )
}

function EngineSetupStepPanel({
    setup,
    onSelectEngine,
    onChangeModel,
    onChangeDevice,
    onChangePort,
    onChangeServerUrl,
    onChangeAdvertiseUrl,
    onChangeSharedPaths,
    onChangeInstallDir,
    onBrowseInstallDir,
    onChangeUseMirror,
    onChangeUseProxy,
    onChangeProxy,
    onOpenDashboard,
}: {
    setup: WizardSetupView
    onSelectEngine: (engineId: string) => void
    onChangeModel: (modelId: string) => void
    onChangeDevice: (device: string) => void
    onChangePort: (port: number) => void
    onChangeServerUrl: (value: string) => void
    onChangeAdvertiseUrl: (value: string) => void
    onChangeSharedPaths: (paths: SharedPathMapping[]) => void
    onChangeInstallDir: (value: string) => void
    onBrowseInstallDir: () => void
    onChangeUseMirror: (value: boolean) => void
    onChangeUseProxy: (value: boolean) => void
    onChangeProxy: (value: string) => void
    onOpenDashboard: () => void
}) {
    const { t } = useTranslation()
    const protectedInstallPath = isProtectedWindowsInstallPath(setup.effectiveInstallDir)

    if (setup.availableWizardEngines.length === 0) {
        return (
            <SectionCard
                title={t('workerManager.wizard.title')}
                description={t('workerManager.wizard.noAvailableEngines')}
                icon={<Icons.Layers className="w-4 h-4" />}
            >
                {setup.hasInstalledEngines ? (
                    <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenDashboard}>
                        {t('workerManager.actions.openDashboard')}
                    </button>
                ) : null}
            </SectionCard>
        )
    }

    return (
        <>
            <SectionCard
                title={t('workerManager.wizard.enginePrimaryTitle')}
                description={t('workerManager.wizard.enginePrimaryDescription')}
                icon={<Icons.Cpu className="w-4 h-4" />}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 xl:grid-cols-2">
                        {setup.availableWizardEngines.map((engine) => {
                            const active = engine.id === setup.wizardEngine.id
                            return (
                                <button
                                    key={engine.id}
                                    type="button"
                                    className="rounded-[18px] border px-4 py-3.5 text-left transition-all duration-150"
                                    style={
                                        active
                                            ? {
                                                borderColor: 'rgba(59,130,246,0.24)',
                                                background: 'rgba(59,130,246,0.10)',
                                                boxShadow: '0 10px 26px rgba(37,99,235,0.10)',
                                            }
                                            : {
                                                borderColor: 'rgba(148,163,184,0.14)',
                                                background: 'rgba(255,255,255,0.03)',
                                            }
                                    }
                                    onClick={() => onSelectEngine(engine.id)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-base font-semibold">{engine.displayName}</div>
                                            <div className="mt-1.5 text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
                                                {getLocalizedEngineDescription(t, engine)}
                                            </div>
                                        </div>
                                        {active ? (
                                            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--color-primary)' }}>
                                                <Icons.Check className="w-3.5 h-3.5" />
                                                {t('workerManager.wizard.selected')}
                                            </span>
                                        ) : null}
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <Field label={t('workerManager.install.device')}>
                            <select
                                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                style={formControlStyle}
                                value={setup.wizardDevice}
                                onChange={(event) => onChangeDevice(event.target.value)}
                            >
                                {setup.availableDevices.map((device) => (
                                    <option key={device.value} value={device.value}>
                                        {device.label}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label={t('workerManager.install.initialModel')}>
                            <select
                                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                style={formControlStyle}
                                value={setup.wizardModelId}
                                onChange={(event) => onChangeModel(event.target.value)}
                            >
                                {setup.wizardEngine.models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {getLocalizedModelOptionLabel(t, model)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title={t('workerManager.wizard.engineSecondaryTitle')}
                description={t('workerManager.wizard.engineSecondaryDescription')}
                icon={<Icons.SlidersHorizontal className="w-4 h-4" />}
            >
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="space-y-3">
                        <Field label={t('workerManager.install.port')}>
                            <input
                                type="number"
                                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                style={formControlStyle}
                                value={setup.wizardPort}
                                onChange={(event) => onChangePort(Number(event.target.value) || 8001)}
                            />
                        </Field>

                        <Field label={t('workerManager.install.serverUrl')}>
                            <input
                                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                style={formControlStyle}
                                value={setup.serverUrl}
                                placeholder={t('workerManager.install.serverUrlPlaceholder')}
                                onChange={(event) => onChangeServerUrl(event.target.value)}
                            />
                        </Field>

                        <Field label={t('workerManager.install.workerUrl')}>
                            <input
                                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                style={formControlStyle}
                                value={setup.advertiseUrl}
                                placeholder={t('workerManager.install.workerUrlPlaceholder')}
                                onChange={(event) => onChangeAdvertiseUrl(event.target.value)}
                            />
                        </Field>

                        <div className="rounded-xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                            <div>{t('workerManager.install.workerUrlHint')}</div>
                            <div className="mt-1 break-all">
                                <span>{t('workerManager.install.effectiveWorkerUrl')}:</span> {setup.effectiveAdvertiseUrl}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Field label={t('workerManager.install.locationTitle')}>
                            <div className="flex gap-2">
                                <input
                                    className="min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm"
                                    style={formControlStyle}
                                    value={setup.installDir}
                                    onChange={(event) => onChangeInstallDir(event.target.value)}
                                />
                                <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onBrowseInstallDir}>
                                    {t('workerManager.install.browse')}
                                </button>
                            </div>
                        </Field>

                        <div className="rounded-xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                            <div>{t('workerManager.install.locationHint')}</div>
                            {protectedInstallPath ? (
                                <div className="mt-3 rounded-lg border px-3 py-2.5 text-sm leading-6" style={{ borderColor: 'rgba(245,158,11,0.28)', background: 'rgba(245,158,11,0.08)', color: 'rgb(180, 83, 9)' }}>
                                    <div className="font-medium">{t('workerManager.install.protectedLocationWarning')}</div>
                                    <div className="mt-1 text-xs">{t('workerManager.install.protectedLocationExamples')}</div>
                                </div>
                            ) : null}
                            {setup.installPathInfo ? (
                                <div className="mt-2 space-y-1 text-xs">
                                    <div className="break-all">{t('workerManager.install.defaultBase', { path: setup.installPathInfo.default_runtime_root })}</div>
                                    <div className="break-all">{t('workerManager.install.appInstallDir', { path: setup.installPathInfo.app_install_dir })}</div>
                                </div>
                            ) : null}
                            {setup.installPathPreview ? (
                                <div className="mt-3 grid gap-2 text-xs">
                                    <PreviewRow label={t('workerManager.install.runtimeRoot')} value={setup.installPathPreview.runtime_root} />
                                    <PreviewRow label={t('workerManager.install.engineInstallDir')} value={setup.installPathPreview.engine_install_dir} />
                                    <PreviewRow label={t('workerManager.install.uvPath')} value={setup.installPathPreview.uv_path} />
                                    <PreviewRow label={t('workerManager.install.managerStatePath')} value={setup.installPathPreview.manager_state_path} />
                                </div>
                            ) : (
                                <div className="mt-1 break-all">
                                    <span>{t('workerManager.install.currentTarget')}:</span> {setup.effectiveInstallDir || t('workerManager.common.notSet')}
                                </div>
                            )}
                        </div>

                        <label className="flex items-center gap-3 text-sm">
                            <input type="checkbox" checked={setup.useMirror} onChange={(event) => onChangeUseMirror(event.target.checked)} />
                            <span>{t('workerManager.install.useMirror')}</span>
                        </label>

                        {setup.useMirror ? (
                            <div className="rounded-xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                                <div className="font-medium" style={{ color: 'var(--color-text)' }}>{t('workerManager.install.mirrorDetailsTitle')}</div>
                                <div className="mt-1 text-xs">{t('workerManager.install.mirrorDetailsHint')}</div>
                                <div className="mt-3 grid gap-2 text-xs">
                                    <PreviewRow label={t('workerManager.install.mirrorPython')} value="https://ghp.ci/https://github.com" />
                                    <PreviewRow label={t('workerManager.install.mirrorPyPI')} value="https://mirrors.aliyun.com/pypi/simple/" />
                                    <PreviewRow label={t('workerManager.install.mirrorHuggingFace')} value="https://hf-mirror.com" />
                                    <PreviewRow label={t('workerManager.install.mirrorPyTorch')} value={resolvePyTorchMirrorValue(setup.computeKey, t)} />
                                </div>
                            </div>
                        ) : null}

                        <label className="flex items-center gap-3 text-sm">
                            <input type="checkbox" checked={setup.useProxy} onChange={(event) => onChangeUseProxy(event.target.checked)} />
                            <span>{t('workerManager.install.useProxy')}</span>
                        </label>

                        {setup.useProxy ? (
                            <Field label={t('workerManager.install.proxy')}>
                                <input
                                    className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                    style={formControlStyle}
                                    value={setup.proxy}
                                    placeholder={t('workerManager.install.proxyPlaceholder')}
                                    onChange={(event) => onChangeProxy(event.target.value)}
                                />
                            </Field>
                        ) : null}
                    </div>
                </div>

                {setup.serverUrl.trim() ? (
                    <div className="mt-4 space-y-3">
                        <div className="text-sm font-medium">{t('workerManager.install.sharedPaths')}</div>
                        <div className="rounded-xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)', color: 'var(--color-text-muted)' }}>
                            {t('workerManager.install.sharedPathsHint')}
                        </div>
                        {setup.sharedPaths.map((mapping, index) => (
                            <div key={index} className="grid gap-2 items-end" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                                <Field label={index === 0 ? t('workerManager.install.sharedPathServer') : '\u00A0'}>
                                    <input
                                        className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                        style={formControlStyle}
                                        value={mapping.server}
                                        placeholder={t('workerManager.install.sharedPathServerPlaceholder')}
                                        onChange={(event) => {
                                            const next = [...setup.sharedPaths]
                                            next[index] = { ...mapping, server: event.target.value }
                                            onChangeSharedPaths(next)
                                        }}
                                    />
                                </Field>
                                <Field label={index === 0 ? t('workerManager.install.sharedPathWorker') : '\u00A0'}>
                                    <input
                                        className="w-full rounded-xl border px-3 py-2.5 text-sm"
                                        style={formControlStyle}
                                        value={mapping.worker}
                                        placeholder={t('workerManager.install.sharedPathWorkerPlaceholder')}
                                        onChange={(event) => {
                                            const next = [...setup.sharedPaths]
                                            next[index] = { ...mapping, worker: event.target.value }
                                            onChangeSharedPaths(next)
                                        }}
                                    />
                                </Field>
                                <button
                                    type="button"
                                    className={buttonBaseClass}
                                    style={{ ...secondaryButtonStyle, color: 'var(--color-error)' }}
                                    onClick={() => onChangeSharedPaths(setup.sharedPaths.filter((_, i) => i !== index))}
                                >
                                    {t('workerManager.install.sharedPathRemove')}
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className={buttonBaseClass}
                            style={secondaryButtonStyle}
                            onClick={() => onChangeSharedPaths([...setup.sharedPaths, { server: '', worker: '' }])}
                        >
                            {t('workerManager.install.sharedPathAdd')}
                        </button>
                    </div>
                ) : null}
            </SectionCard>
        </>
    )
}

function InstallProgressStepPanel({ progress, context }: { progress: WizardProgressView; context: WizardContextView }) {
    const { t } = useTranslation()
    const latestLogs = progress.installLog.slice(-6)

    return (
        <>
            <SectionCard
                title={t('workerManager.install.latestStage')}
                description={t('workerManager.wizard.installLead')}
                icon={<Icons.Activity className="w-4 h-4" />}
            >
                <div className="grid gap-4 2xl:grid-cols-[180px_minmax(0,1fr)]">
                    <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.05)' }}>
                        <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
                            {t('workerManager.install.progressLabel')}
                        </div>
                        <div className="mt-2 text-4xl font-semibold tracking-tight">{progress.progressPercent}%</div>
                    </div>

                    <div className="space-y-3">
                        <div className="grid gap-3 md:grid-cols-3">
                            <MetricCard
                                label={t('workerManager.install.phaseLabel')}
                                value={progress.installProgress?.error ? t('workerManager.install.failed') : progress.installProgress?.done ? t('workerManager.install.complete') : progress.installStepLabel || t('workerManager.install.preparing')}
                            />
                            <MetricCard
                                label={t('workerManager.install.progressLabel')}
                                value={progress.installProgress ? t('workerManager.install.step', { current: progress.installProgress.step_index, total: progress.installProgress.step_total }) : '—'}
                            />
                            <MetricCard label={t('workerManager.install.targetLabel')} value={context.currentInstallTarget} />
                        </div>

                        <div>
                            <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'rgba(15,23,42,0.10)' }}>
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${progress.progressPercent}%`,
                                        background: progress.installProgress?.error ? 'var(--color-error)' : 'var(--color-primary)',
                                    }}
                                />
                            </div>
                            <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                {progress.installProgress?.message || t('workerManager.install.preparing')}
                            </div>
                        </div>

                        {progress.installProgress?.error ? (
                            <div className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.24)', background: 'rgba(239,68,68,0.08)', color: 'var(--color-error)' }}>
                                {progress.installProgress.error}
                            </div>
                        ) : null}
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title={t('workerManager.wizard.installRecentLogsTitle')}
                description={t('workerManager.install.logHint')}
                icon={<Icons.FileText className="w-4 h-4" />}
            >
                {latestLogs.length > 0 ? (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            {latestLogs.map((entry, index) => (
                                <div key={`${entry.step_key}-${index}`} className="rounded-xl border px-3 py-2.5 text-sm leading-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)' }}>
                                    <div className="font-medium">{entry.message}</div>
                                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                        {t(`workerManager.install.steps.${entry.step_key}`, { defaultValue: entry.step_key })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <details className="group rounded-xl border" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(255,255,255,0.03)' }} open={!!progress.installProgress?.error}>
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
                                <div>
                                    <div className="text-sm font-medium">{t('workerManager.install.logTitle')}</div>
                                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                        {progress.installLog.length} {t('workerManager.install.logEntries')}
                                    </div>
                                </div>
                                <Icons.ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                            </summary>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2.5 text-xs" style={{ borderColor: 'rgba(148,163,184,0.14)', color: 'var(--color-text-muted)' }}>
                                {progress.installLogText}
                            </pre>
                        </details>
                    </div>
                ) : (
                    <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {t('workerManager.install.preparing')}
                    </div>
                )}
            </SectionCard>
        </>
    )
}

function CompleteStepPanel({
    completedEngine,
    completeEngineName,
    onOpenDashboard,
    onOpenAnotherEngine,
    canAddAnother,
}: {
    completedEngine: EngineInfo | null
    completeEngineName: string
    onOpenDashboard: () => void
    onOpenAnotherEngine: () => void
    canAddAnother: boolean
}) {
    const { t } = useTranslation()

    return (
        <>
            <SectionCard
                title={t('workerManager.wizard.completeTitle')}
                description={t('workerManager.wizard.completeDescription', { engine: completeEngineName })}
                icon={<Icons.CheckCircle className="w-4 h-4" />}
            >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label={t('workerManager.dashboard.engineId')} value={completedEngine?.engine_id || completeEngineName} />
                    <MetricCard label={t('workerManager.install.port')} value={String(completedEngine?.port ?? '—')} />
                    <MetricCard label={t('workerManager.install.workerUrl')} value={completedEngine?.advertise_url || `http://127.0.0.1:${completedEngine?.port ?? '—'}`} />
                    <MetricCard label={t('workerManager.install.serverUrl')} value={completedEngine?.server_url || t('workerManager.common.notSet')} />
                </div>
            </SectionCard>

            <SectionCard
                title={t('workerManager.wizard.completeNextTitle')}
                description={t('workerManager.wizard.completeNextDescription')}
                icon={<Icons.ChevronRight className="w-4 h-4" />}
            >
                <div className="flex flex-wrap gap-2">
                    <button className={buttonBaseClass} style={primaryButtonStyle} onClick={onOpenDashboard}>
                        {t('workerManager.wizard.completePrimaryAction')}
                    </button>
                    {canAddAnother ? (
                        <button className={buttonBaseClass} style={secondaryButtonStyle} onClick={onOpenAnotherEngine}>
                            {t('workerManager.wizard.completeSecondaryAction')}
                        </button>
                    ) : null}
                </div>
            </SectionCard>
        </>
    )
}

function SectionCard({ title, description, icon, children }: { title: string; description?: string; icon: ReactNode; children: ReactNode }) {
    return (
        <section
            className="rounded-[22px] border px-4 py-4 sm:px-5"
            style={{
                borderColor: 'rgba(148,163,184,0.16)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
            }}
        >
            <div className="mb-4 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(59,130,246,0.08)', color: 'var(--color-primary)' }}>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5 text-sm">
            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            {children}
        </label>
    )
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border px-3 py-3" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)' }}>
            <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
                {label}
            </div>
            <div className="mt-1.5 break-words text-sm font-semibold">{value}</div>
        </div>
    )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="mt-1 break-all text-sm font-medium" style={{ color: 'var(--color-text)' }}>{value}</div>
        </div>
    )
}

function resolvePyTorchMirrorValue(computeKey: string, t: ReturnType<typeof useTranslation>['t']) {
    if (computeKey === 'cu121') {
        return 'https://mirror.sjtu.edu.cn/pytorch-wheels/cu121'
    }
    if (computeKey === 'cu124') {
        return 'https://mirror.sjtu.edu.cn/pytorch-wheels/cu124'
    }
    if (computeKey === 'cpu') {
        return 'https://mirror.sjtu.edu.cn/pytorch-wheels/cpu'
    }
    return t('workerManager.install.mirrorPyTorchDefault')
}

function FactCard({ label, value, meta }: { label: string; value: string; meta?: string }) {
    return (
        <div className="rounded-xl border px-3 py-3" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.04)' }}>
            <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="mt-1.5 break-words text-sm font-semibold">{value}</div>
            {meta ? <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{meta}</div> : null}
        </div>
    )
}

function RecommendationStrip({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(59,130,246,0.06)' }}>
            <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
            <div className="mt-1.5 text-base font-semibold">{value}</div>
        </div>
    )
}

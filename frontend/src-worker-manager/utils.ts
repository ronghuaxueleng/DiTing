import type { TFunction } from 'i18next'
import { DEFAULT_PORT, ENGINE_DEFINITIONS } from './constants'
import type { DeviceOption, EngineDefinition, EngineInfo, HardwareInfo, InstallLogEntry, ManagedModel, ModelOption, WorkerStatus } from './types'

export function getEngineDefinition(engineId: string | null | undefined) {
    return ENGINE_DEFINITIONS.find((engine) => engine.id === engineId) ?? null
}

export function getSuggestedDevice(hardware: HardwareInfo | null) {
    if (hardware?.has_cuda) {
        return 'cuda:0'
    }
    if (hardware?.has_mps) {
        return 'mps'
    }
    return 'cpu'
}

export function getComputeKeyForDevice(device: string, hardware: HardwareInfo | null) {
    if (device.startsWith('cuda')) {
        return hardware?.compute_key || 'cpu'
    }
    if (device === 'mps') {
        return 'mps'
    }
    return 'cpu'
}

export function getAvailableDevices(hardware: HardwareInfo | null): DeviceOption[] {
    const devices: DeviceOption[] = []

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

export function getLocalizedEngineDescription(t: TFunction, engine: EngineDefinition | null | undefined) {
    if (!engine) {
        return ''
    }
    return engine.descriptionKey
        ? t(engine.descriptionKey, { defaultValue: engine.description })
        : engine.description
}

export function getLocalizedModelOptionLabel(t: TFunction, model: ModelOption | null | undefined) {
    if (!model) {
        return ''
    }
    return model.translationKey
        ? t(model.translationKey, { defaultValue: model.label })
        : model.label
}

export function getLocalizedModelLabelById(t: TFunction, engine: EngineDefinition | null | undefined, modelId: string | null | undefined) {
    if (!modelId) {
        return ''
    }
    const model = engine?.models.find((item) => item.id === modelId)
    if (model) {
        return getLocalizedModelOptionLabel(t, model)
    }
    return t(`workerManager.catalog.models.${modelId}.label`, { defaultValue: modelId })
}

type ModelTagTone = 'recommended' | 'neutral'

export type LocalizedModelTag = {
    key: string
    label: string
    tone: ModelTagTone
}

function normalizeModelTag(tag: string) {
    const normalized = tag.trim().toLowerCase().replace(/[\s_-]+/g, '-')
    if (normalized === 'recommend' || normalized === 'recommended') {
        return 'recommended'
    }
    if (normalized === 'multilingual' || normalized === 'multi-language') {
        return 'multilingual'
    }
    if (normalized === 'fast') {
        return 'fast'
    }
    if (normalized === 'balanced') {
        return 'balanced'
    }
    if (normalized === 'accurate' || normalized === 'accuracy') {
        return 'accurate'
    }
    if (normalized === 'lightweight' || normalized === 'light-weight') {
        return 'lightweight'
    }
    return normalized
}

export function getLocalizedManagedModelDescription(t: TFunction, managedModel: ManagedModel | null | undefined) {
    if (!managedModel) {
        return ''
    }
    return t(`workerManager.catalog.models.${managedModel.id}.description`, {
        defaultValue: managedModel.description,
    })
}

export function getLocalizedModelTags(t: TFunction, tags: string[]) {
    return tags.map<LocalizedModelTag>((tag) => {
        const key = normalizeModelTag(tag)
        return {
            key,
            label: t(`workerManager.tags.${key}`, { defaultValue: tag }),
            tone: key === 'recommended' ? 'recommended' : 'neutral',
        }
    })
}

export function getNextSuggestedPort(engines: EngineInfo[]) {
    const usedPorts = new Set(engines.map((engine) => engine.port))
    let port = DEFAULT_PORT
    while (usedPorts.has(port)) {
        port += 1
    }
    return port
}

export function formatInstallLogText(installLog: InstallLogEntry[], t: TFunction) {
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
}

export function getStatusBadgeDefinitions(t: TFunction, status: WorkerStatus | null) {
    return [
        {
            key: 'running',
            label: t('workerManager.dashboard.badges.running'),
            value: !!status?.running,
        },
        {
            key: 'healthy',
            label: t('workerManager.dashboard.badges.healthy'),
            value: !!status?.healthy,
        },
        {
            key: 'loaded',
            label: t('workerManager.dashboard.badges.loaded'),
            value: !!status?.loaded,
        },
        {
            key: 'management',
            label: t('workerManager.dashboard.badges.management'),
            value: !!status?.management,
        },
    ]
}

export function getHardwareFacts(t: TFunction, hardware: HardwareInfo | null) {
    return [
        {
            key: 'cpu',
            label: t('workerManager.hardware.cpu'),
            value: hardware?.cpu_name || t('workerManager.common.notSet'),
            meta: hardware ? `${hardware.cpu_cores} ${t('workerManager.hardware.cores')}` : undefined,
        },
        {
            key: 'ram',
            label: t('workerManager.hardware.ram'),
            value: `${hardware?.ram_gb ?? 0} GB`,
        },
        {
            key: 'cuda',
            label: t('workerManager.hardware.cuda'),
            value: hardware?.has_cuda ? t('workerManager.common.yes') : t('workerManager.common.no'),
            meta: hardware?.gpu_name ? `${hardware.gpu_name}${hardware.vram_mb ? ` · ${hardware.vram_mb}MB` : ''}` : undefined,
        },
        {
            key: 'mps',
            label: t('workerManager.hardware.mps'),
            value: hardware?.has_mps ? t('workerManager.common.yes') : t('workerManager.common.no'),
        },
        {
            key: 'recommended',
            label: t('workerManager.hardware.recommended'),
            value: getSuggestedDevice(hardware),
        },
        {
            key: 'computeKey',
            label: t('workerManager.hardware.computeKey'),
            value: hardware?.compute_key || t('workerManager.common.notSet'),
        },
    ]
}

export function formatTimestamp(value: string | null | undefined): string {
    if (!value) {
        return ''
    }
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return value
    }
    const date = new Date(seconds * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function getHardwareSummaryLabel(hardware: HardwareInfo | null, t: TFunction) {
    if (!hardware) {
        return t('workerManager.hardware.detecting')
    }

    if (hardware.has_cuda && hardware.gpu_name) {
        return `${t('workerManager.hardware.cuda')} · ${hardware.gpu_name}`
    }

    if (hardware.has_mps) {
        return 'Apple MPS'
    }

    return t('workerManager.hardware.cpuOnly')
}


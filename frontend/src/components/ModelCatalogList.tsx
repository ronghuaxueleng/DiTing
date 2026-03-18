import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'
import { useWorkerModels } from '../hooks/useWorkerManagement'
import { useDownloadModel, useActivateModel, useUnloadModel, useDeleteModel } from '../hooks/useModelManagement'
import { useOperationPolling } from '../hooks/useOperationPolling'
import OperationProgress from './OperationProgress'

interface Props {
    workerKey: string
}

interface ModelInfo {
    id: string
    engine: string
    model_id: string
    display_name: string
    download_size_mb: number
    vram_required_mb: number
    accuracy: number
    speed: number
    description: string
    tags: string[]
    compatible: boolean
    reason: string
    installed: boolean
    active: boolean
    deps_installed: boolean
}

export default function ModelCatalogList({ workerKey }: Props) {
    const { t } = useTranslation()
    const { data, isLoading } = useWorkerModels(workerKey)
    const downloadModel = useDownloadModel()
    const activateModel = useActivateModel()
    const unloadModel = useUnloadModel()
    const deleteModel = useDeleteModel()
    const [activeOpId, setActiveOpId] = useState<string | null>(null)
    const operation = useOperationPolling(workerKey, activeOpId)

    const models: ModelInfo[] = data?.models ?? []

    const handleDownload = async (modelId: string) => {
        try {
            const result = await downloadModel.mutateAsync({ workerKey, modelId })
            if (result.operation_id) {
                setActiveOpId(result.operation_id)
            }
        } catch { /* handled by mutation */ }
    }

    const handleActivate = async (modelId: string) => {
        try {
            const result = await activateModel.mutateAsync({ workerKey, modelId })
            if (result.operation_id) {
                setActiveOpId(result.operation_id)
            }
        } catch { /* handled by mutation */ }
    }

    const handleUnload = async () => {
        try {
            await unloadModel.mutateAsync({ workerKey })
        } catch { /* handled by mutation */ }
    }

    const handleDelete = async (modelId: string) => {
        try {
            await deleteModel.mutateAsync({ workerKey, modelId })
        } catch { /* handled by mutation */ }
    }

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] py-4">
                <Icons.Loader className="w-4 h-4 animate-spin" />
                {t('common.loading')}
            </div>
        )
    }

    if (models.length === 0) {
        return (
            <div className="text-sm text-[var(--color-text-muted)] py-4">
                {t('workers.models.empty', { defaultValue: 'No models available for this worker.' })}
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                    {t('workers.models.title', { defaultValue: 'Model Catalog' })}
                </h4>
                {data?.active_model_id && (
                    <button
                        onClick={handleUnload}
                        disabled={unloadModel.isPending}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 disabled:opacity-50"
                    >
                        <Icons.XCircle className="w-3 h-3" />
                        {t('workers.models.unload', { defaultValue: 'Unload Current' })}
                    </button>
                )}
            </div>

            {activeOpId && (
                <OperationProgress
                    operation={operation}
                    onDismiss={() => { setActiveOpId(null); operation.reset() }}
                />
            )}

            <div className="grid grid-cols-1 gap-2">
                {models.map((model) => (
                    <ModelCard
                        key={model.id}
                        model={model}
                        onDownload={() => handleDownload(model.id)}
                        onActivate={() => handleActivate(model.id)}
                        onDelete={() => handleDelete(model.id)}
                        isDownloading={downloadModel.isPending}
                        isActivating={activateModel.isPending}
                        isDeleting={deleteModel.isPending}
                        t={t}
                    />
                ))}
            </div>
        </div>
    )
}

function ModelCard({ model, onDownload, onActivate, onDelete, isDownloading, isActivating, isDeleting, t }: {
    model: ModelInfo
    onDownload: () => void
    onActivate: () => void
    onDelete: () => void
    isDownloading: boolean
    isActivating: boolean
    isDeleting: boolean
    t: any
}) {
    return (
        <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${model.active
            ? 'border-indigo-500/30 bg-indigo-500/5'
            : model.installed
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : !model.compatible
                    ? 'border-[var(--color-border)] opacity-60'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-bg)]'
            }`}>
            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{model.display_name}</span>
                    {model.active && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-600">
                            <Icons.Check className="w-3 h-3" />
                            {t('workers.models.active', { defaultValue: 'Active' })}
                        </span>
                    )}
                    {model.installed && !model.active && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600">
                            {t('workers.models.installed', { defaultValue: 'Installed' })}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)] mt-0.5">
                    <span>{model.engine}</span>
                    {model.download_size_mb > 0 && <span>{model.download_size_mb} MB</span>}
                    {model.vram_required_mb > 0 && <span>VRAM: {model.vram_required_mb} MB</span>}
                    {model.tags.map(tag => (
                        <span key={tag} className="px-1 py-0.5 rounded bg-[var(--color-border)] text-[10px]">{tag}</span>
                    ))}
                </div>
                {!model.compatible && model.reason && (
                    <p className="text-xs text-amber-600 mt-1">{model.reason}</p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
                {!model.installed && model.compatible && (
                    <button
                        onClick={onDownload}
                        disabled={isDownloading || !model.deps_installed}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        title={!model.deps_installed ? t('workers.models.depsRequired', { defaultValue: 'Install engine dependencies first' }) : undefined}
                    >
                        {isDownloading ? <Icons.Loader className="w-3 h-3 animate-spin" /> : <Icons.Download className="w-3 h-3" />}
                        {t('workers.models.download', { defaultValue: 'Download' })}
                    </button>
                )}
                {model.installed && !model.active && (
                    <>
                        <button
                            onClick={onActivate}
                            disabled={isActivating}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                            {isActivating ? <Icons.Loader className="w-3 h-3 animate-spin" /> : <Icons.Check className="w-3 h-3" />}
                            {t('workers.models.activate', { defaultValue: 'Activate' })}
                        </button>
                        <button
                            onClick={onDelete}
                            disabled={isDeleting}
                            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                            {isDeleting ? <Icons.Loader className="w-3 h-3 animate-spin" /> : <Icons.Trash className="w-3 h-3" />}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

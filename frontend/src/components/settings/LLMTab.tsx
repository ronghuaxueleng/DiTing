import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
    getLLMProviders,
    deleteLLMProvider,
    deleteLLMModel,
    setActiveModel,
    addLLMModel,
    updateLLMModel,
    testLLMModel,
} from '../../api'
import type { LLMProvider } from '../../api/types'
import { useToast } from '../../contexts/ToastContext'
import Icons from '../ui/Icons'
import ConfirmModal from '../ConfirmModal'
import ProviderFormModal from './ProviderFormModal'
import ModelDiscoveryModal from './ModelDiscoveryModal'

export default function LLMTab() {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { showUndoableDelete, showToast } = useToast()

    const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null)
    const [hiddenModels, setHiddenModels] = useState<Set<number>>(new Set())

    const [addingModelProviderId, setAddingModelProviderId] = useState<number | null>(null)
    const [newModelName, setNewModelName] = useState('')

    const [editingModelId, setEditingModelId] = useState<number | null>(null)
    const [editModelName, setEditModelName] = useState('')
    const [testResults, setTestResults] = useState<Record<number, { loading: boolean; success?: boolean; message?: string; latency_ms?: number }>>({})

    // Modal state
    const [providerModal, setProviderModal] = useState<{ isOpen: boolean; provider: LLMProvider | null }>({ isOpen: false, provider: null })
    const [discoveryModal, setDiscoveryModal] = useState<{ isOpen: boolean; provider: LLMProvider | null }>({ isOpen: false, provider: null })

    const { data: providers, isLoading } = useQuery({
        queryKey: ['llm-providers'],
        queryFn: getLLMProviders,
    })

    const selectedProvider = providers?.find(p => p.id === selectedProviderId) ?? null

    // Auto-select first provider; reset if selected was deleted
    useEffect(() => {
        const first = providers?.[0]
        if (first && selectedProviderId === null) {
            setSelectedProviderId(first.id)
        }
        if (selectedProviderId && providers && !providers.find(p => p.id === selectedProviderId)) {
            setSelectedProviderId(first?.id ?? null)
        }
    }, [providers]) // eslint-disable-line react-hooks/exhaustive-deps

    const deleteProviderMutation = useMutation({
        mutationFn: deleteLLMProvider,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            showToast('success', t('settings.llm.deleteSuccess'))
        },
        onError: (e) => showToast('error', t('settings.llm.deleteFailed') + ': ' + e.message),
    })

    const deleteModelMutation = useMutation({
        mutationFn: deleteLLMModel,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-providers'] }),
    })

    const activateModelMutation = useMutation({
        mutationFn: setActiveModel,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-providers'] }),
    })

    const addModelMutation = useMutation({
        mutationFn: ({ providerId, modelName }: { providerId: number, modelName: string }) => addLLMModel(providerId, modelName),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            setAddingModelProviderId(null)
            setNewModelName('')
            showToast('success', t('common.success'))
        },
        onError: (e) => showToast('error', t('common.error') + ': ' + e.message),
    })

    const updateModelMutation = useMutation({
        mutationFn: ({ modelId, modelName }: { modelId: number, modelName: string }) => updateLLMModel(modelId, modelName),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            setEditingModelId(null)
            setEditModelName('')
            showToast('success', t('common.success'))
        },
        onError: (e) => showToast('error', t('common.error') + ': ' + e.message),
    })

    const handleDeleteModel = (modelId: number) => {
        setHiddenModels(prev => new Set(prev).add(modelId))
        showUndoableDelete(
            t('settings.llm.deletingModel'),
            async () => {
                await deleteModelMutation.mutateAsync(modelId)
            },
            () => {
                setHiddenModels(prev => {
                    const next = new Set(prev)
                    next.delete(modelId)
                    return next
                })
            }
        )
    }

    const handleAddModelSubmit = (providerId: number) => {
        if (!newModelName.trim()) {
            setAddingModelProviderId(null)
            return
        }
        addModelMutation.mutate({ providerId, modelName: newModelName.trim() })
    }

    const handleEditModelSubmit = (modelId: number) => {
        if (!editModelName.trim()) {
            setEditingModelId(null)
            return
        }
        updateModelMutation.mutate({ modelId, modelName: editModelName.trim() })
    }

    const handleTestModel = async (providerId: number, modelId: number) => {
        setTestResults(prev => ({ ...prev, [modelId]: { loading: true } }))
        try {
            const result = await testLLMModel(providerId, modelId)
            setTestResults(prev => ({ ...prev, [modelId]: { loading: false, ...result } }))
            if (result.success) {
                showToast('success', t('settings.llm.testSuccess', { ms: result.latency_ms }))
            } else {
                showToast('error', t('settings.llm.testFailed') + ': ' + result.message)
            }
        } catch (e: any) {
            setTestResults(prev => ({ ...prev, [modelId]: { loading: false, success: false, message: e.message } }))
            showToast('error', t('settings.llm.testFailed') + ': ' + e.message)
        }
    }

    const handleTestAll = async (provider: LLMProvider) => {
        const models = provider.models.filter(m => !hiddenModels.has(m.id))
        if (models.length === 0) return

        const loadingState: Record<number, { loading: boolean }> = {}
        models.forEach(m => { loadingState[m.id] = { loading: true } })
        setTestResults(prev => ({ ...prev, ...loadingState }))

        const results = await Promise.allSettled(
            models.map(async m => {
                try {
                    const result = await testLLMModel(provider.id, m.id)
                    setTestResults(prev => ({ ...prev, [m.id]: { loading: false, ...result } }))
                    return result.success
                } catch (e: any) {
                    setTestResults(prev => ({ ...prev, [m.id]: { loading: false, success: false, message: e.message } }))
                    return false
                }
            })
        )

        const passed = results.filter(r => r.status === 'fulfilled' && r.value).length
        showToast(passed === models.length ? 'success' : 'error',
            t('settings.llm.batchTestResult', { passed, total: models.length })
        )
    }

    return (
        <div className="flex gap-4 h-full">
            {/* Left: Provider List */}
            <div className={`w-56 shrink-0 flex flex-col border-r border-[var(--color-border)] pr-4 ${selectedProviderId !== null ? 'hidden md:flex' : 'flex'}`}>
                <button
                    onClick={() => setProviderModal({ isOpen: true, provider: null })}
                    className="flex items-center justify-center gap-1.5 w-full text-sm text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 rounded-lg py-2 mb-2 transition-colors"
                >
                    <Icons.Plus className="w-4 h-4" />
                    {t('settings.llm.addProvider')}
                </button>
                <div className="flex-1 overflow-y-auto -mr-4 pr-4">
                    {isLoading ? (
                        <div className="text-center py-10 text-[var(--color-text-muted)] text-sm">{t('common.loading')}</div>
                    ) : providers?.length === 0 ? (
                        <div className="text-center py-10 text-[var(--color-text-muted)] text-sm">{t('settings.llm.noProviders')}</div>
                    ) : (
                        <div className="space-y-1">
                            {providers?.map((provider) => (
                                <button
                                    key={provider.id}
                                    onClick={() => setSelectedProviderId(provider.id)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                                        selectedProviderId === provider.id
                                            ? 'bg-[var(--color-primary)] text-white'
                                            : 'text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]'
                                    }`}
                                >
                                    <span className="truncate">{provider.name}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ml-2 shrink-0 ${
                                        selectedProviderId === provider.id
                                            ? 'bg-white/20'
                                            : 'bg-[var(--color-border)]'
                                    }`}>
                                        {provider.models.length}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Provider Detail */}
            <div className={`flex-1 min-w-0 flex flex-col ${selectedProviderId === null ? 'hidden md:flex' : 'flex'}`}>
                {selectedProvider ? (
                    <div className="flex-1 overflow-y-auto">
                        {/* Mobile back button */}
                        <button
                            onClick={() => setSelectedProviderId(null)}
                            className="md:hidden flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-3"
                        >
                            <Icons.ArrowLeft className="w-4 h-4" />
                            {t('common.back')}
                        </button>

                        {/* Provider header */}
                        <div className="flex justify-between items-center mb-3">
                            <span className="font-medium">{selectedProvider.name}</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => handleTestAll(selectedProvider)}
                                    className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                                    title={t('settings.llm.testAll')}
                                >
                                    <Icons.Zap className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setProviderModal({ isOpen: true, provider: selectedProvider })}
                                    className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors"
                                    title={t('settings.llm.edit')}
                                >
                                    <Icons.Edit className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setDeleteConfirm({ id: selectedProvider.id, name: selectedProvider.name })}
                                    className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                    title={t('settings.llm.delete')}
                                >
                                    <Icons.Trash className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Info line */}
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-4">
                            <span className="truncate">{selectedProvider.base_url}</span>
                            <span className="px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[10px] font-mono shrink-0">
                                {selectedProvider.api_type === 'responses' ? 'Responses' : 'Chat Completions'}
                            </span>
                        </div>

                        {/* Models area */}
                        <div className="flex flex-wrap gap-2 items-center">
                            {selectedProvider.models.filter(m => !hiddenModels.has(m.id)).map(model => (
                                <div key={model.id} className="group relative">
                                    {editingModelId === model.id ? (
                                        <input
                                            type="text"
                                            autoFocus
                                            value={editModelName}
                                            onChange={e => setEditModelName(e.target.value)}
                                            onBlur={() => handleEditModelSubmit(model.id)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleEditModelSubmit(model.id)
                                                if (e.key === 'Escape') setEditingModelId(null)
                                            }}
                                            className="px-3 py-1 text-xs rounded-full border border-[var(--color-primary)] bg-[var(--color-bg)] outline-none min-w-[120px]"
                                        />
                                    ) : (
                                        <div className={`flex items-center rounded-full transition-colors ${model.is_active
                                            ? 'bg-[var(--color-primary)] text-white'
                                            : 'bg-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-primary)]/20'
                                            }`}>
                                            <button
                                                onClick={() => activateModelMutation.mutate(model.id)}
                                                className="px-3 py-1 text-xs rounded-full transition-colors flex items-center justify-center gap-1"
                                            >
                                                {model.model_name}
                                                {Boolean(model.is_active) && ' ✓'}
                                                {testResults[model.id] && !testResults[model.id]?.loading && (
                                                    testResults[model.id]?.success
                                                        ? <span className="text-[10px] text-green-400 ml-0.5">{testResults[model.id]?.latency_ms}ms</span>
                                                        : <Icons.XCircle className="w-3 h-3 text-red-400" />
                                                )}
                                            </button>
                                            {!model.is_active && (
                                                <div className="flex items-center pr-1 gap-0.5">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setEditModelName(model.model_name)
                                                            setEditingModelId(model.id)
                                                        }}
                                                        className="p-0.5 rounded-full text-[var(--color-text-muted)]/50 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                                                        title={t('settings.llm.editModel')}
                                                    >
                                                        <Icons.Edit className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleDeleteModel(model.id)
                                                        }}
                                                        className="p-0.5 rounded-full text-[var(--color-text-muted)]/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                        title={t('settings.llm.deleteModel')}
                                                    >
                                                        <Icons.X className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleTestModel(selectedProvider.id, model.id)
                                                        }}
                                                        disabled={testResults[model.id]?.loading}
                                                        className="p-0.5 rounded-full text-[var(--color-text-muted)]/50 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                                                        title={t('settings.llm.testConnection')}
                                                    >
                                                        {testResults[model.id]?.loading
                                                            ? <Icons.Loader className="w-3 h-3 animate-spin" />
                                                            : <Icons.Zap className="w-3 h-3" />
                                                        }
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {addingModelProviderId === selectedProvider.id ? (
                                <input
                                    type="text"
                                    autoFocus
                                    placeholder={t('settings.llm.modelNamePlaceholder')}
                                    value={newModelName}
                                    onChange={e => setNewModelName(e.target.value)}
                                    onBlur={() => handleAddModelSubmit(selectedProvider.id)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleAddModelSubmit(selectedProvider.id)
                                        if (e.key === 'Escape') setAddingModelProviderId(null)
                                    }}
                                    className="px-3 py-1 text-xs rounded-full border border-[var(--color-primary)] bg-[var(--color-bg)] outline-none min-w-[150px]"
                                />
                            ) : (
                                <>
                                    <button
                                        onClick={() => {
                                            setAddingModelProviderId(selectedProvider.id)
                                            setNewModelName('')
                                        }}
                                        className="px-3 py-1.5 text-xs rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors flex items-center gap-1"
                                        title={t('settings.llm.addModel')}
                                    >
                                        <Icons.Plus className="w-3 h-3" />
                                        <span>{t('settings.llm.addModel')}</span>
                                    </button>
                                    <button
                                        onClick={() => setDiscoveryModal({ isOpen: true, provider: selectedProvider })}
                                        className="px-3 py-1.5 text-xs rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors flex items-center gap-1"
                                        title={t('settings.llm.discoverModels')}
                                    >
                                        <Icons.Refresh className="w-3 h-3" />
                                        <span>{t('settings.llm.discoverModels')}</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                        {providers?.length ? t('settings.llm.selectProvider') : t('settings.llm.noProviders')}
                    </div>
                )}
            </div>

            {/* Provider Add/Edit Modal */}
            <ProviderFormModal
                isOpen={providerModal.isOpen}
                onClose={() => setProviderModal({ isOpen: false, provider: null })}
                provider={providerModal.provider}
            />

            {/* Model Discovery Modal */}
            <ModelDiscoveryModal
                isOpen={discoveryModal.isOpen}
                onClose={() => setDiscoveryModal({ isOpen: false, provider: null })}
                provider={discoveryModal.provider}
            />

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={deleteConfirm !== null}
                title={t('settings.llm.deleteModalTitle')}
                message={t('settings.llm.deleteModalMessage', { name: deleteConfirm?.name })}
                confirmText={t('common.delete')}
                cancelText={t('common.cancel')}
                variant="danger"
                onConfirm={() => {
                    if (deleteConfirm) {
                        deleteProviderMutation.mutate(deleteConfirm.id)
                        setDeleteConfirm(null)
                    }
                }}
                onCancel={() => setDeleteConfirm(null)}
            />
        </div>
    )
}

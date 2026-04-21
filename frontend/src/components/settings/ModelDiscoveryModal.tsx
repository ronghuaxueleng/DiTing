import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchAvailableModels, batchAddModels } from '../../api'
import type { LLMProvider } from '../../api/types'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useToast } from '../../contexts/ToastContext'
import Icons from '../ui/Icons'

interface ModelDiscoveryModalProps {
    isOpen: boolean
    onClose: () => void
    provider: LLMProvider | null
}

interface DiscoveredModel {
    id: string
    owned_by: string
    already_added: boolean
}

export default function ModelDiscoveryModal({ isOpen, onClose, provider }: ModelDiscoveryModalProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { showToast } = useToast()

    const [loading, setLoading] = useState(false)
    const [models, setModels] = useState<DiscoveredModel[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [importing, setImporting] = useState(false)

    useEscapeKey(onClose, isOpen)

    useEffect(() => {
        if (isOpen && provider) {
            setLoading(true)
            setModels([])
            setSelected(new Set())
            setError(null)
            setSearch('')
            fetchAvailableModels(provider.id)
                .then(result => {
                    if (result.success) {
                        setModels(result.models)
                        const preSelected = new Set(result.models.filter((m: DiscoveredModel) => !m.already_added).map((m: DiscoveredModel) => m.id))
                        setSelected(preSelected)
                    } else {
                        setError(result.message)
                    }
                })
                .catch(e => setError(e.message))
                .finally(() => setLoading(false))
        }
    }, [isOpen, provider])

    const filtered = models.filter(m => m.id.toLowerCase().includes(search.toLowerCase()))
    const selectableFiltered = filtered.filter(m => !m.already_added)
    const totalSelectable = models.filter(m => !m.already_added).length

    const handleSelectAll = () => {
        const allIds = new Set(selected)
        selectableFiltered.forEach(m => allIds.add(m.id))
        setSelected(allIds)
    }

    const handleDeselectAll = () => {
        const remaining = new Set(selected)
        selectableFiltered.forEach(m => remaining.delete(m.id))
        setSelected(remaining)
    }

    const toggleModel = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const handleImport = async () => {
        if (!provider || selected.size === 0) return
        setImporting(true)
        try {
            const result = await batchAddModels(provider.id, Array.from(selected))
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            showToast('success', t('settings.llm.fetchModelsSuccess', { count: result.added }))
            onClose()
        } catch (e: any) {
            showToast('error', e.message)
        } finally {
            setImporting(false)
        }
    }

    if (!isOpen || !provider) return null

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
            <div
                className="bg-[var(--color-card)] w-full max-w-lg rounded-xl shadow-2xl border border-[var(--color-border)] animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-semibold text-[var(--color-text)]">{t('settings.llm.discoverModels')}</h3>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{provider.name}</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors">
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Icons.Loader className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                    </div>
                ) : error ? (
                    <div className="p-6 text-center">
                        <p className="text-sm text-red-400">{error}</p>
                    </div>
                ) : models.length === 0 ? (
                    <div className="p-6 text-center">
                        <p className="text-sm text-[var(--color-text-muted)]">{t('settings.llm.noModelsFound')}</p>
                    </div>
                ) : (
                    <>
                        {/* Search + Select actions */}
                        <div className="px-6 pt-4 pb-2 space-y-2 flex-shrink-0">
                            <div className="relative">
                                <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                                <input
                                    type="text"
                                    placeholder={t('settings.llm.searchModelsPlaceholder')}
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleSelectAll}
                                    className="text-xs text-[var(--color-primary)] hover:underline"
                                >
                                    {t('settings.llm.selectAll')}
                                </button>
                                <span className="text-xs text-[var(--color-text-muted)]">|</span>
                                <button
                                    onClick={handleDeselectAll}
                                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
                                >
                                    {t('settings.llm.deselectAll')}
                                </button>
                            </div>
                        </div>

                        {/* Model list */}
                        <div className="flex-1 overflow-y-auto px-6 min-h-0 max-h-[50vh]">
                            <div className="space-y-0.5">
                                {filtered.map(model => (
                                    <label
                                        key={model.id}
                                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                                            model.already_added ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--color-bg-hover)]'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={model.already_added || selected.has(model.id)}
                                            disabled={model.already_added}
                                            onChange={() => toggleModel(model.id)}
                                            className="rounded flex-shrink-0"
                                        />
                                        <span className="flex-1 font-mono text-xs break-all">{model.id}</span>
                                        {model.already_added && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-muted)] flex-shrink-0">
                                                {t('settings.llm.alreadyAdded')}
                                            </span>
                                        )}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Sticky footer */}
                        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg)]/50 rounded-b-xl flex-shrink-0">
                            <span className="text-xs text-[var(--color-text-muted)]">
                                {t('settings.llm.selectedCount', { selected: selected.size, total: totalSelectable })}
                            </span>
                            <button
                                onClick={handleImport}
                                disabled={selected.size === 0 || importing}
                                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                            >
                                {importing && <Icons.Loader className="w-3.5 h-3.5 animate-spin" />}
                                {t('settings.llm.addSelected')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    )
}

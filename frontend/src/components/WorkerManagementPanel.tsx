import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'
import { useASRStatus, useAddWorker, useRemoveWorker } from '../hooks/useWorkerManagement'
import type { WorkerInfo } from '../api/types'

interface Props {
    onSelectWorker?: (workerId: string) => void
    selectedWorkerId?: string | null
}

export default function WorkerManagementPanel({ onSelectWorker, selectedWorkerId }: Props) {
    const { t } = useTranslation()
    const { data: status, isLoading } = useASRStatus()
    const addWorker = useAddWorker()
    const removeWorker = useRemoveWorker()
    const [newUrl, setNewUrl] = useState('')
    const [removingId, setRemovingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleAdd = async () => {
        const url = newUrl.trim()
        if (!url) return
        setError(null)
        try {
            await addWorker.mutateAsync(url)
            setNewUrl('')
        } catch (e: any) {
            setError(e?.message || 'Failed to add worker')
        }
    }

    const handleRemove = async (workerId: string) => {
        setRemovingId(workerId)
        setError(null)
        try {
            await removeWorker.mutateAsync(workerId)
        } catch (e: any) {
            setError(e?.message || 'Failed to remove worker')
        } finally {
            setRemovingId(null)
        }
    }

    const workers = status?.workers ?? {}
    const workerEntries = Object.entries(workers)

    if (isLoading) {
        return (
            <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-6">
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <Icons.Loader className="w-4 h-4 animate-spin" />
                    {t('common.loading')}
                </div>
            </div>
        )
    }

    return (
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] shadow-sm">
            {/* Add Worker */}
            <div className="p-4 border-b border-[var(--color-border)]">
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder={t('workers.addPlaceholder', { defaultValue: 'http://host:port' })}
                        value={newUrl}
                        onChange={e => setNewUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!newUrl.trim() || addWorker.isPending}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        {addWorker.isPending ? (
                            <Icons.Loader className="w-4 h-4 animate-spin" />
                        ) : (
                            <Icons.Plus className="w-4 h-4" />
                        )}
                        {t('workers.add', { defaultValue: 'Add' })}
                    </button>
                </div>
                {error && (
                    <p className="mt-2 text-xs text-red-500">{error}</p>
                )}
            </div>
            {workerEntries.length === 0 ? (
                <div className="p-8 text-center text-[var(--color-text-muted)]">
                    <Icons.Server className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{t('workers.empty', { defaultValue: 'No workers configured. Add a worker URL above.' })}</p>
                </div>
            ) : (
                <div className="divide-y divide-[var(--color-border)]">
                    {workerEntries.map(([id, info]) => (
                        <WorkerRow
                            key={id}
                            id={id}
                            info={info as WorkerInfo}
                            selected={selectedWorkerId === id}
                            removing={removingId === id}
                            onSelect={() => onSelectWorker?.(id)}
                            onRemove={() => handleRemove(id)}
                            t={t}
                        />
                    ))}
                </div>
            )}

            {/* Footer stats */}
            {workerEntries.length > 0 && (
                <div className="px-4 py-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] flex items-center gap-4">
                    <span>{t('workers.total', { defaultValue: '{{count}} workers', count: workerEntries.length })}</span>
                    <span>{t('workers.online', { defaultValue: '{{count}} online', count: workerEntries.filter(([, w]) => (w as WorkerInfo).online).length })}</span>
                </div>
            )}
        </div>
    )
}

function WorkerRow({ id, info, selected, removing, onSelect, onRemove, t }: {
    id: string
    info: WorkerInfo
    selected: boolean
    removing: boolean
    onSelect: () => void
    onRemove: () => void
    t: any
}) {
    return (
        <div
            className={`flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-bg)] transition-colors cursor-pointer ${selected ? 'bg-indigo-500/5 border-l-2 border-l-indigo-500' : ''}`}
            onClick={onSelect}
        >
            {/* Status indicator */}
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${info.online ? 'bg-emerald-500' : 'bg-red-400'}`} />

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{id}</span>
                    {info.management && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600">
                            {t('workers.managed', { defaultValue: 'Managed' })}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)] mt-0.5">
                    <span>{info.url}</span>
                    {info.engine && <span className="px-1.5 py-0.5 rounded bg-[var(--color-border)] font-medium">{info.engine}</span>}
                    {info.model_id && <span>{info.model_id}</span>}
                    {info.gpu && <span>{info.gpu.name}</span>}
                    {info.latency > 0 && <span>{info.latency}ms</span>}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onRemove}
                    disabled={removing}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title={t('common.delete')}
                >
                    {removing ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Trash className="w-4 h-4" />}
                </button>
            </div>
        </div>
    )
}

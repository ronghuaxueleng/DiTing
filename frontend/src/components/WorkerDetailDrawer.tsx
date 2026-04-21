import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import Icons from './ui/Icons'
import HardwareInfoCard from './HardwareInfoCard'
import ModelCatalogList from './ModelCatalogList'
import { useWorkerHardware } from '../hooks/useWorkerManagement'
import type { WorkerInfo } from '../api/types'

interface Props {
    workerId: string | null
    workerInfo: WorkerInfo | null
    onClose: () => void
}

// Error boundary to prevent drawer crashes from killing the whole app
class DrawerErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { hasError: boolean }> {
    state = { hasError: false }
    static getDerivedStateFromError() { return { hasError: true } }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-6 text-center">
                    <Icons.AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-400" />
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">Failed to load worker details.</p>
                    <button
                        onClick={() => { this.setState({ hasError: false }); this.props.onClose() }}
                        className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-border)] hover:opacity-80"
                    >Close</button>
                </div>
            )
        }
        return this.props.children
    }
}

export default function WorkerDetailDrawer({ workerId, workerInfo, onClose }: Props) {
    const { t } = useTranslation()
    const { data: hwData, isLoading: hwLoading, isError: hwError } = useWorkerHardware(
        workerId && workerInfo?.management ? workerId : null
    )

    if (!workerId || !workerInfo) return null

    return createPortal(
        <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-[var(--color-card)] border-l border-[var(--color-border)] shadow-2xl overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-[var(--color-card)] border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${workerInfo.online ? 'bg-emerald-500' : 'bg-red-400'}`} />
                        <div className="min-w-0">
                            <h3 className="text-lg font-semibold truncate">{workerId}</h3>
                            <p className="text-xs text-[var(--color-text-muted)] truncate">{workerInfo.url}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-[var(--color-bg)] transition-colors"
                    >
                        <Icons.XCircle className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <DrawerErrorBoundary onClose={onClose}>
                    <div className="p-6 space-y-6">
                        {/* Worker Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <InfoItem
                                label={t('workers.detail.status', { defaultValue: 'Status' })}
                                value={workerInfo.online
                                    ? t('workers.detail.online', { defaultValue: 'Online' })
                                    : t('workers.detail.offline', { defaultValue: 'Offline' })
                                }
                                color={workerInfo.online ? 'text-emerald-600' : 'text-red-500'}
                            />
                            <InfoItem
                                label={t('workers.detail.engine', { defaultValue: 'Engine' })}
                                value={workerInfo.engine || '-'}
                            />
                            <InfoItem
                                label={t('workers.detail.model', { defaultValue: 'Model' })}
                                value={workerInfo.model_id || '-'}
                            />
                            <InfoItem
                                label={t('workers.detail.latency', { defaultValue: 'Latency' })}
                                value={workerInfo.latency > 0 ? `${workerInfo.latency}ms` : '-'}
                            />
                            <InfoItem
                                label={t('workers.detail.device', { defaultValue: 'Device' })}
                                value={workerInfo.device || '-'}
                            />
                            <InfoItem
                                label={t('workers.detail.management', { defaultValue: 'Management' })}
                                value={workerInfo.management
                                    ? t('workers.detail.enabled', { defaultValue: 'Enabled' })
                                    : t('workers.detail.disabled', { defaultValue: 'Disabled' })
                                }
                                color={workerInfo.management ? 'text-blue-600' : 'text-[var(--color-text-muted)]'}
                            />
                        </div>

                        {/* Hardware (only if management enabled) */}
                        {workerInfo.management && (
                            <HardwareInfoCard data={hwData} isLoading={hwLoading} isError={hwError} />
                        )}

                        {/* Model Catalog (only if management enabled) */}
                        {workerInfo.management && (
                            <ModelCatalogList workerKey={workerId} />
                        )}

                        {/* No management */}
                        {!workerInfo.management && (
                            <div className="rounded-lg border border-[var(--color-border)] p-4 text-center">
                                <Icons.AlertCircle className="w-6 h-6 mx-auto mb-2 text-[var(--color-text-muted)]" />
                                <p className="text-sm text-[var(--color-text-muted)]">
                                    {t('workers.detail.noManagement', { defaultValue: 'This worker does not have management API enabled. Start the worker with management support to manage models remotely.' })}
                                </p>
                            </div>
                        )}
                    </div>
                </DrawerErrorBoundary>
            </div>
        </div>,
        document.body
    )
}

function InfoItem({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div>
            <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
            <dd className={`text-sm font-medium mt-0.5 ${color || ''}`}>{value}</dd>
        </div>
    )
}

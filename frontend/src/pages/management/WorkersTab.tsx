import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkerManagementPanel from '../../components/WorkerManagementPanel'
import BulkActionToolbar from '../../components/BulkActionToolbar'
import WorkerDetailDrawer from '../../components/WorkerDetailDrawer'
import { useASRStatus } from '../../hooks/useWorkerManagement'
import type { WorkerInfo } from '../../api/types'

export default function WorkersTab() {
    const { t } = useTranslation()
    const { data: status } = useASRStatus()
    const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)

    const workers = status?.workers ?? {}
    const selectedWorkerInfo = selectedWorkerId ? (workers[selectedWorkerId] as WorkerInfo | undefined) ?? null : null

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--color-text-muted)]">
                    {t('workers.description', { defaultValue: 'Manage ASR worker connections and models.' })}
                </p>
                <BulkActionToolbar />
            </div>

            <WorkerManagementPanel
                onSelectWorker={setSelectedWorkerId}
                selectedWorkerId={selectedWorkerId}
            />

            <WorkerDetailDrawer
                workerId={selectedWorkerId}
                workerInfo={selectedWorkerInfo}
                onClose={() => setSelectedWorkerId(null)}
            />
        </div>
    )
}

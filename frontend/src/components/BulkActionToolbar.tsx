import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'
import { getASRStatus } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export default function BulkActionToolbar() {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [refreshing, setRefreshing] = useState(false)

    const handleRefresh = async () => {
        setRefreshing(true)
        try {
            const data = await getASRStatus(true)
            queryClient.setQueryData(['asr-status'], data)
        } finally {
            setRefreshing(false)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-sm font-medium hover:bg-[var(--color-bg)] transition-colors disabled:opacity-50"
            >
                <Icons.Refresh className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {t('workers.refreshAll', { defaultValue: 'Refresh All' })}
            </button>
        </div>
    )
}

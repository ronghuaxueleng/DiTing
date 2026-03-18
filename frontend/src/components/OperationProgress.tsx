import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'
import type { OperationState } from '../hooks/useOperationPolling'

interface Props {
    operation: OperationState
    label?: string
    onDismiss?: () => void
}

export default function OperationProgress({ operation, label, onDismiss }: Props) {
    const { t } = useTranslation()

    if (operation.status === 'idle') return null

    const isActive = operation.status === 'started' || operation.status === 'running'
    const isDone = operation.status === 'completed'
    const isFailed = operation.status === 'failed'

    const latestMessage = operation.progress.length > 0
        ? operation.progress[operation.progress.length - 1]
        : label || t('workers.operation.working', { defaultValue: 'Processing...' })

    return (
        <div className={`rounded-lg border p-3 text-sm ${isDone
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : isFailed
                ? 'bg-red-500/5 border-red-500/20'
                : 'bg-blue-500/5 border-blue-500/20'
            }`}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    {isActive && <Icons.Loader className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
                    {isDone && <Icons.Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                    {isFailed && <Icons.XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                    <span className="truncate">{latestMessage}</span>
                </div>
                {!isActive && onDismiss && (
                    <button onClick={onDismiss} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <Icons.XCircle className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isActive && (
                <div className="mt-2 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
            )}

            {isFailed && operation.error && (
                <p className="mt-1 text-xs text-red-600 truncate">{operation.error}</p>
            )}
        </div>
    )
}

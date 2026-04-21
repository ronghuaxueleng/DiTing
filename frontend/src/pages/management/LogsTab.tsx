import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Icons from '../../components/ui/Icons'
import { getSystemLogs } from '../../api/client'
import type { LogEntry } from '../../api/types'

type LogFile = 'info' | 'error' | 'access'
type LogLevel = '' | 'INFO' | 'WARNING' | 'ERROR'

const LEVEL_STYLES: Record<string, { bg: string; text: string }> = {
    'INFO': { bg: 'bg-blue-500/15', text: 'text-blue-400' },
    'WARNING': { bg: 'bg-amber-500/15', text: 'text-amber-400' },
    'ERROR': { bg: 'bg-red-500/15', text: 'text-red-400' },
    'DEBUG': { bg: 'bg-gray-500/15', text: 'text-gray-400' },
}

const LOG_FILE_OPTIONS: { id: LogFile; labelKey: string; icon: string }[] = [
    { id: 'info', labelKey: 'management.logs.fileInfo', icon: '📋' },
    { id: 'error', labelKey: 'management.logs.fileError', icon: '❌' },
    { id: 'access', labelKey: 'management.logs.fileAccess', icon: '🌐' },
]

export default function LogsTab() {
    const { t } = useTranslation()
    const [logFile, setLogFile] = useState<LogFile>('info')
    const [levelFilter, setLevelFilter] = useState<LogLevel>('')
    const [autoRefresh, setAutoRefresh] = useState(true)
    const [lineCount, setLineCount] = useState(100)
    const [highlightTraceId, setHighlightTraceId] = useState<string | null>(null)
    const logContainerRef = useRef<HTMLDivElement>(null)
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true)

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['system-logs', logFile, lineCount, levelFilter],
        queryFn: () => getSystemLogs({
            file: logFile,
            lines: lineCount,
            level: levelFilter || undefined
        }),
        refetchInterval: autoRefresh ? 3000 : false,
    })

    const entries = data?.entries ?? []

    // Auto-scroll to bottom when new entries arrive
    useEffect(() => {
        if (shouldAutoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
    }, [entries, shouldAutoScroll])

    // Detect manual scroll to pause auto-scroll
    const handleScroll = () => {
        if (!logContainerRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
        // If scrolled within 50px of bottom, re-enable auto-scroll
        setShouldAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
    }

    const formatTimestamp = (ts: string) => {
        try {
            const d = new Date(ts)
            return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                + '.' + String(d.getMilliseconds()).padStart(3, '0')
        } catch {
            return ts
        }
    }

    const formatDate = (ts: string) => {
        try {
            return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        } catch {
            return ''
        }
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 bg-[var(--color-card)] p-4 rounded-xl border border-[var(--color-border)]">
                {/* Log Source Tabs */}
                <div className="flex bg-[var(--color-bg)] rounded-lg p-1 gap-1">
                    {LOG_FILE_OPTIONS.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setLogFile(opt.id)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${logFile === opt.id
                                ? 'bg-indigo-500 text-white shadow-sm'
                                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'
                                }`}
                        >
                            <span className="mr-1.5">{opt.icon}</span>
                            {t(opt.labelKey)}
                        </button>
                    ))}
                </div>

                {/* Level Filter */}
                <select
                    value={levelFilter}
                    onChange={e => setLevelFilter(e.target.value as LogLevel)}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)]"
                >
                    <option value="">{t('management.logs.allLevels')}</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                </select>

                {/* Line Count */}
                <select
                    value={lineCount}
                    onChange={e => setLineCount(Number(e.target.value))}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)]"
                >
                    <option value={50}>50 {t('management.logs.lines')}</option>
                    <option value={100}>100 {t('management.logs.lines')}</option>
                    <option value={200}>200 {t('management.logs.lines')}</option>
                    <option value={500}>500 {t('management.logs.lines')}</option>
                </select>

                <div className="flex-1" />

                {/* Auto Refresh Toggle */}
                <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${autoRefresh
                        ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                        : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                        }`}
                    title={autoRefresh ? t('management.logs.pauseRefresh') : t('management.logs.resumeRefresh')}
                >
                    {autoRefresh ? (
                        <>
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            {t('management.logs.live')}
                        </>
                    ) : (
                        <>
                            <span className="h-2 w-2 rounded-full bg-gray-400" />
                            {t('management.logs.paused')}
                        </>
                    )}
                </button>

                {/* Manual Refresh */}
                <button
                    onClick={() => refetch()}
                    className="p-2 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    title={t('common.refresh')}
                >
                    <Icons.Refresh className="w-4 h-4" />
                </button>
            </div>

            {/* Log Panel */}
            <div className="bg-[#0d1117] rounded-xl border border-[#30363d] overflow-hidden shadow-lg">
                {/* Panel Header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-[#30363d]">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Icons.FileText className="w-3.5 h-3.5" />
                        <span className="font-mono">{logFile}.log.json</span>
                        <span className="text-gray-600">—</span>
                        <span>{entries.length} {t('management.logs.entries')}</span>
                    </div>
                    {highlightTraceId && (
                        <button
                            onClick={() => setHighlightTraceId(null)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                            <Icons.X className="w-3 h-3" />
                            {t('management.logs.clearHighlight')}
                        </button>
                    )}
                </div>

                {/* Log Content */}
                <div
                    ref={logContainerRef}
                    onScroll={handleScroll}
                    className="overflow-auto font-mono text-[13px] leading-relaxed"
                    style={{ maxHeight: 'calc(100vh - 340px)', minHeight: '400px' }}
                >
                    {isLoading && entries.length === 0 ? (
                        <div className="flex items-center justify-center py-20 text-gray-500">
                            <Icons.Loader className="w-5 h-5 animate-spin mr-2" />
                            {t('common.loading')}
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                            <Icons.FileText className="w-8 h-8 mb-2 opacity-30" />
                            <p>{t('management.logs.empty')}</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <tbody>
                                {entries.map((entry: LogEntry, i: number) => {
                                    const levelStyle = LEVEL_STYLES[entry.level] || LEVEL_STYLES.DEBUG
                                    const isHighlighted = highlightTraceId && entry.trace_id === highlightTraceId
                                    const showDate = i === 0 || formatDate(entry.timestamp) !== formatDate(entries[i - 1]?.timestamp ?? '')
                                    return (
                                        <tr key={i}>
                                            <td colSpan={4} className="p-0">
                                                {showDate && (
                                                    <div className="px-4 py-1 text-[10px] text-gray-600 bg-[#0d1117] border-b border-[#1c2333] text-center tracking-widest uppercase">
                                                        — {formatDate(entry.timestamp)} —
                                                    </div>
                                                )}
                                                <div
                                                    className={`flex items-start gap-3 px-4 py-1 border-b border-[#1c2333] hover:bg-[#161b22] transition-colors ${isHighlighted ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''
                                                        }`}
                                                >
                                                    {/* Timestamp */}
                                                    <span className="text-gray-500 whitespace-nowrap shrink-0 tabular-nums select-all">
                                                        {formatTimestamp(entry.timestamp)}
                                                    </span>

                                                    {/* Level Badge */}
                                                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold ${levelStyle?.bg ?? ''} ${levelStyle?.text ?? ''}`}>
                                                        {entry.level.padEnd(7)}
                                                    </span>

                                                    {/* Module */}
                                                    <span className="text-purple-400/70 shrink-0 min-w-[80px] text-right">
                                                        {entry.module}
                                                    </span>

                                                    {/* Message */}
                                                    <span className={`text-gray-300 break-all flex-1 ${entry.level === 'ERROR' ? 'text-red-300' : ''}`}>
                                                        {entry.message}
                                                        {entry.exception && (
                                                            <pre className="mt-1 text-red-400/80 text-xs whitespace-pre-wrap">{entry.exception}</pre>
                                                        )}
                                                    </span>

                                                    {/* Trace ID */}
                                                    {entry.trace_id && (
                                                        <button
                                                            onClick={() => setHighlightTraceId(
                                                                highlightTraceId === entry.trace_id ? null : entry.trace_id
                                                            )}
                                                            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${highlightTraceId === entry.trace_id
                                                                ? 'bg-indigo-500/30 text-indigo-300'
                                                                : 'text-gray-600 hover:text-indigo-400 hover:bg-indigo-500/10'
                                                                }`}
                                                            title={`Trace: ${entry.trace_id}`}
                                                        >
                                                            {entry.trace_id.slice(0, 8)}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Bottom Status Bar */}
                <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-t border-[#30363d] text-[11px] text-gray-500">
                    <span>
                        {autoRefresh
                            ? t('management.logs.refreshingEvery', { seconds: 3 })
                            : t('management.logs.refreshPaused')
                        }
                    </span>
                    <span>
                        {shouldAutoScroll
                            ? t('management.logs.autoScrollOn')
                            : t('management.logs.autoScrollOff')
                        }
                    </span>
                </div>
            </div>
        </div>
    )
}

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Icons from '../ui/Icons'
import DashboardFilterBar, { type DashboardFilterBarProps } from './DashboardFilterBar'
import DashboardDisplayToolbar, { type DashboardDisplayToolbarProps } from './DashboardDisplayToolbar'
import DashboardActiveFilters, { type DashboardActiveFiltersProps } from './DashboardActiveFilters'
import DashboardSelectionToolbar from './DashboardSelectionToolbar'
import { Tag } from '../../api/types'

// ── Shared filter summary helpers ─────────────────────────────────────────
interface SummaryProps {
    sourceType: string
    status: string
    selectedTagId?: number
    tagExclude?: boolean
    hasSegments?: boolean
    hasAI?: boolean
    hasNotes?: boolean
    hasCached?: boolean
    isSubtitle?: boolean
    includeArchived: string | null
    searchQuery: string
    sortBy: string
    viewMode: string
    tags?: Tag[]
}

function FilterSummaryStrip(props: SummaryProps) {
    const { t } = useTranslation()
    const chips: { label: string; color: string }[] = []

    if (props.sourceType)
        chips.push({ label: t(`dashboard.sourceType.${props.sourceType}`), color: 'text-[var(--color-primary)]' })
    if (props.status)
        chips.push({ label: t(`dashboard.status.${props.status}`), color: 'text-orange-500' })
    if (props.selectedTagId && props.tags) {
        const tag = props.tags.find(t => t.id === props.selectedTagId)
        if (tag) chips.push({ label: (props.tagExclude ? '≠ ' : '# ') + tag.name, color: props.tagExclude ? 'text-red-500' : 'text-[var(--color-primary)]' })
    }
    if (props.hasSegments !== undefined)
        chips.push({ label: props.hasSegments ? t('dashboard.filters.hasSegments') : t('dashboard.filters.noSegments'), color: 'text-purple-500' })
    if (props.hasAI !== undefined)
        chips.push({ label: props.hasAI ? t('dashboard.filters.hasAI') : t('dashboard.filters.noAI'), color: 'text-emerald-500' })
    if (props.hasNotes !== undefined)
        chips.push({ label: props.hasNotes ? t('dashboard.filters.hasNotes') : t('dashboard.filters.noNotes'), color: 'text-teal-500' })
    if (props.hasCached !== undefined)
        chips.push({ label: props.hasCached ? t('dashboard.filters.hasCached') : t('dashboard.filters.noCached'), color: 'text-blue-500' })
    if (props.isSubtitle !== undefined)
        chips.push({ label: props.isSubtitle ? t('dashboard.filters.isSubtitle') : t('dashboard.filters.noSubtitle'), color: 'text-pink-500' })
    if (props.includeArchived === '1')
        chips.push({ label: t('dashboard.filters.showArchived'), color: 'text-amber-500' })
    if (props.includeArchived === 'all')
        chips.push({ label: t('dashboard.filters.allArchived'), color: 'text-indigo-500' })
    if (props.searchQuery)
        chips.push({ label: `"${props.searchQuery}"`, color: 'text-[var(--color-primary)]' })

    const sortLabel = props.sortBy === 'time'
        ? t('dashboard.filters.sortTime')
        : props.sortBy === 'title'
            ? t('dashboard.filters.sortTitle')
            : t('dashboard.filters.sortSegments')

    return (
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
            {chips.length === 0 ? (
                <span className="text-xs text-[var(--color-text-muted)] italic">{t('dashboard.filters.noActiveFilters', 'No active filters')}</span>
            ) : (
                chips.map((c, i) => (
                    <span key={i} className={`text-xs font-medium ${c.color} shrink-0`}>{c.label}</span>
                )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-[var(--color-border)] text-xs shrink-0">·</span>, el], [])
            )}
            <span className="text-[var(--color-border)] text-xs mx-1 shrink-0">|</span>
            <span className="text-xs text-[var(--color-text-muted)] shrink-0">{sortLabel}</span>
        </div>
    )
}

// ── Main Ribbon ───────────────────────────────────────────────────────────
interface RibbonProps {
    filterBarProps: DashboardFilterBarProps
    toolbarProps: DashboardDisplayToolbarProps
    activeFiltersProps: DashboardActiveFiltersProps
    selectionMode: boolean
    selectedCount: number
    onSelectAll: () => void
    onDeselectAll: () => void
    // Summary data
    sourceType: string
    status: string
    selectedTagId?: number
    tagExclude?: boolean
    hasSegments?: boolean
    hasAI?: boolean
    hasNotes?: boolean
    hasCached?: boolean
    isSubtitle?: boolean
    includeArchived: string | null
    searchQuery: string
    sortBy: string
    viewMode: string
    tags?: Tag[]
}

export default function DashboardFilterRibbon({
    filterBarProps,
    toolbarProps,
    activeFiltersProps,
    selectionMode,
    selectedCount,
    onSelectAll,
    onDeselectAll,
    ...summaryProps
}: RibbonProps) {
    const { t } = useTranslation()

    // Pinned = full bar always visible; unpinned = collapsed strip, click to temporarily expand
    const [pinned, setPinned] = useState(() =>
        localStorage.getItem('dash-filter-pinned') !== 'false'
    )
    const [tempExpanded, setTempExpanded] = useState(false)
    const expandedRef = useRef<HTMLDivElement>(null)

    const togglePin = () => {
        const next = !pinned
        setPinned(next)
        localStorage.setItem('dash-filter-pinned', String(next))
        if (next) setTempExpanded(false)
    }

    // Close temp expansion when clicking outside
    useEffect(() => {
        if (!tempExpanded) return
        const handler = (e: MouseEvent) => {
            if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
                setTempExpanded(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [tempExpanded])

    const showFull = pinned || tempExpanded

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            {/* ── Collapsed strip (unpinned + not expanded) ── */}
            {!showFull && (
                <div
                    className="flex items-center gap-2 h-9 px-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-card-muted)] transition-all group select-none"
                    onClick={() => setTempExpanded(true)}
                    title={t('dashboard.filters.clickToExpand', 'Click to show filters')}
                >
                    <Icons.SlidersHorizontal className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 group-hover:text-[var(--color-primary)] transition-colors" />
                    <FilterSummaryStrip {...summaryProps} />
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                        <Icons.ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
                        <button
                            onClick={(e) => { e.stopPropagation(); togglePin() }}
                            className="p-1 rounded hover:bg-[var(--color-border)] transition-colors opacity-0 group-hover:opacity-100"
                            title={t('dashboard.filters.pin', 'Pin filter bar')}
                        >
                            <Icons.Pin className="w-3 h-3 text-[var(--color-text-muted)]" />
                        </button>
                    </div>
                </div>
            )}

            {/* ── Full filter panel ── */}
            {showFull && (
                <div
                    ref={expandedRef}
                    className={`space-y-3 py-3 px-3 rounded-lg border transition-all ${tempExpanded ? 'bg-[var(--color-card)] border-[var(--color-primary)]/30 shadow-lg' : 'bg-transparent border-transparent'}`}
                >
                    <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-3">
                            <DashboardFilterBar {...filterBarProps} />
                        </div>

                        {/* Pin / Unpin button */}
                        <button
                            onClick={togglePin}
                            className={`mt-1 p-1.5 rounded-lg border transition-all shrink-0 ${pinned
                                ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
                                : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]/30'
                                }`}
                            title={pinned ? t('dashboard.filters.unpin', 'Unpin — auto-hide filter bar') : t('dashboard.filters.pin', 'Pin — always show filter bar')}
                        >
                            <Icons.Pin className={`w-4 h-4 transition-transform ${pinned ? 'rotate-45' : ''}`} />
                        </button>
                    </div>

                    <DashboardDisplayToolbar {...toolbarProps} />

                    {selectionMode && (
                        <DashboardSelectionToolbar
                            selectedCount={selectedCount}
                            onSelectAll={onSelectAll}
                            onDeselectAll={onDeselectAll}
                        />
                    )}

                    <DashboardActiveFilters {...activeFiltersProps} />
                </div>
            )}
        </div>
    )
}

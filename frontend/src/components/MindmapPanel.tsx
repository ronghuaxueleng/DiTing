import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'

interface MindmapPanelProps {
    noteContent: string
    onSeek?: (seconds: number) => void
}

const transformer = new Transformer()

/**
 * Parse timestamp strings like "06:14" or "01:23:45" into total seconds.
 */
function parseTimestamp(raw: string): number | null {
    const clean = raw.trim()
    const parts = clean.split(':').map(Number)
    if (parts.some(isNaN)) return null
    if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!
    if (parts.length === 2) return (parts[0]! * 60) + parts[1]!
    return null
}

/**
 * Matches timestamps in note content (both formats):
 *   - Bracketed:  [06:14]  [01:23:45]
 *   - Emoji:      ⏱ 06:14   ⏱ 01:23:45   ⏱06:14
 */
const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\u23f1\s*(\d{1,2}:\d{2}(?::\d{2})?)/g

export default function MindmapPanel({ noteContent, onSeek }: MindmapPanelProps) {
    const { t } = useTranslation()
    const svgRef = useRef<SVGSVGElement>(null)
    const mmRef = useRef<Markmap | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isEmpty, setIsEmpty] = useState(false)

    // Prevent content-reference-change from triggering re-renders
    // by memoising on the actual string value
    const stableContent = useMemo(() => noteContent, [noteContent])

    // Track the last-rendered content to avoid setData on same content
    const renderedContentRef = useRef<string>('')

    // Build markmap data from markdown
    const buildData = useCallback((content: string) => {
        // Strip screenshot images — they add noise to the mindmap
        const cleaned = content.replace(/!\[.*?\]\(.*?\)/g, '')
        const { root } = transformer.transform(cleaned)
        return root
    }, [])

    // Walk foreignObject HTML divs and inject clickable timestamp <span>s
    const injectTimestampLinks = useCallback(() => {
        if (!svgRef.current || !onSeek) return
        const svg = svgRef.current

        // Markmap renders text inside: <foreignObject> → <div> → <div>
        const divs = svg.querySelectorAll<HTMLDivElement>('foreignObject div div')
        divs.forEach((div) => {
            const html = div.innerHTML
            if (!TIMESTAMP_RE.test(html)) return
            TIMESTAMP_RE.lastIndex = 0

            // Replace timestamp text with clickable HTML spans
            const newHtml = html.replace(TIMESTAMP_RE, (fullMatch, bracketTime?: string, emojiTime?: string) => {
                const timeStr = bracketTime ?? emojiTime
                if (!timeStr) return fullMatch
                const seconds = parseTimestamp(timeStr)
                if (seconds === null) return fullMatch
                return `<span class="mindmap-ts-link" data-seek-seconds="${seconds}" style="color:var(--color-primary,#6366f1);font-weight:600;cursor:pointer;text-decoration:underline;border-radius:2px;padding:0 2px;">${fullMatch}</span>`
            })

            if (newHtml !== html) {
                div.innerHTML = newHtml
            }
        })
    }, [onSeek])

    // Event delegation: capture clicks on timestamp spans anywhere in the SVG
    useEffect(() => {
        const svg = svgRef.current
        if (!svg || !onSeek) return

        const handleClick = (e: Event) => {
            const target = e.target as HTMLElement
            if (!target.classList?.contains('mindmap-ts-link')) return
            e.stopPropagation()
            const seconds = Number(target.getAttribute('data-seek-seconds'))
            if (!isNaN(seconds)) {
                onSeek(seconds)
            }
        }

        svg.addEventListener('click', handleClick, true)
        return () => svg.removeEventListener('click', handleClick, true)
    }, [onSeek])

    // Initialize markmap on mount (only once)
    useEffect(() => {
        if (!svgRef.current) return
        mmRef.current = Markmap.create(svgRef.current, {
            duration: 300,
            maxWidth: 300,
            zoom: true,
            pan: true,
        })
        return () => {
            mmRef.current?.destroy()
            mmRef.current = null
        }
    }, [])

    // Update data ONLY when the actual content text changes
    useEffect(() => {
        if (!mmRef.current) return
        // Skip if content hasn't actually changed
        if (renderedContentRef.current === stableContent) return
        renderedContentRef.current = stableContent

        const hasHeadings = /^#{1,6}\s/m.test(stableContent)
        setIsEmpty(!hasHeadings)
        if (hasHeadings) {
            const root = buildData(stableContent)
            mmRef.current.setData(root)
            // Fit + inject links after render completes
            setTimeout(() => {
                mmRef.current?.fit()
                injectTimestampLinks()
            }, 400)
        }
    }, [stableContent, buildData, injectTimestampLinks])

    // Re-fit when container resizes (but do NOT re-setData)
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            mmRef.current?.fit()
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const handleFit = () => {
        mmRef.current?.fit()
    }

    const handleExportSvg = () => {
        if (!svgRef.current) return
        const svgEl = svgRef.current
        const clone = svgEl.cloneNode(true) as SVGSVGElement
        const bbox = svgEl.getBBox()
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('width', String(bbox.width + 40))
        clone.setAttribute('height', String(bbox.height + 40))
        clone.setAttribute('viewBox', `${bbox.x - 20} ${bbox.y - 20} ${bbox.width + 40} ${bbox.height + 40}`)

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bg.setAttribute('x', String(bbox.x - 20))
        bg.setAttribute('y', String(bbox.y - 20))
        bg.setAttribute('width', String(bbox.width + 40))
        bg.setAttribute('height', String(bbox.height + 40))
        bg.setAttribute('fill', '#ffffff')
        clone.insertBefore(bg, clone.firstChild)

        const xml = new XMLSerializer().serializeToString(clone)
        const blob = new Blob([xml], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'mindmap.svg'
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="mindmap-panel" ref={containerRef}>
            {/* Toolbar */}
            <div className="mindmap-toolbar">
                <button
                    className="mindmap-tool-btn"
                    onClick={handleFit}
                    title={t('detail.aiNotes.mindmapFit', '适应视图')}
                >
                    <Icons.Maximize className="w-3.5 h-3.5" />
                </button>
                <button
                    className="mindmap-tool-btn"
                    onClick={handleExportSvg}
                    title={t('detail.aiNotes.mindmapExport', '导出 SVG')}
                >
                    <Icons.Download className="w-3.5 h-3.5" />
                </button>
                {/* AI Optimize — reserved, not yet implemented */}
                <button
                    className="mindmap-tool-btn mindmap-tool-btn--ai"
                    disabled
                    title={t('detail.aiNotes.mindmapAiComingSoon', 'AI 优化导图（即将推出）')}
                >
                    <Icons.Sparkles className="w-3.5 h-3.5" />
                    <span className="mindmap-tool-label">{t('detail.aiNotes.mindmapAiOptimize', 'AI 优化')}</span>
                </button>
                {onSeek && (
                    <span className="mindmap-ts-hint">
                        {t('detail.aiNotes.mindmapTsHint', '点击时间戳跳转')}
                    </span>
                )}
            </div>

            {/* SVG Canvas */}
            <div className="mindmap-svg-wrap">
                {isEmpty && (
                    <div className="mindmap-empty">
                        <span className="mindmap-empty-icon">🧭</span>
                        <p>{t('detail.aiNotes.mindmapEmpty', '笔记中暂无标题层级，无法生成思维导图')}</p>
                    </div>
                )}
                <svg ref={svgRef} className="mindmap-svg" />
            </div>
        </div>
    )
}

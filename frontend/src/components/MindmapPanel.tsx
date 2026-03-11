import { useEffect, useRef, useState, useCallback } from 'react'
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
 * Parse timestamp strings of common formats into total seconds.
 *   [HH:MM:SS]  [MM:SS]  00:01:23  01:23
 */
function parseTimestamp(raw: string): number | null {
    const clean = raw.replace(/[\[\]]/g, '').trim()
    const parts = clean.split(':').map(Number)
    if (parts.some(isNaN)) return null
    if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!
    if (parts.length === 2) return (parts[0]! * 60) + parts[1]!
    return null
}

/**
 * Matches timestamps in two common note formats:
 *   - Bracketed:  [06:14]  [01:23:45]
 *   - Emoji:      ⏱ 06:14   ⏱ 01:23:45   (with optional space after emoji)
 *
 * Capture group 1 = time string from bracketed form
 * Capture group 2 = time string from emoji form
 */
const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\u23f1\s*(\d{1,2}:\d{2}(?::\d{2})?)/g

export default function MindmapPanel({ noteContent, onSeek }: MindmapPanelProps) {
    const { t } = useTranslation()
    const svgRef = useRef<SVGSVGElement>(null)
    const mmRef = useRef<Markmap | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isEmpty, setIsEmpty] = useState(false)

    // Build markmap data from markdown
    const buildData = useCallback((content: string) => {
        // Strip screenshot images — they add noise to the mindmap
        const cleaned = content.replace(/!\[.*?\]\(.*?\)/g, '')
        const { root } = transformer.transform(cleaned)
        return root
    }, [])

    // Walk SVG text nodes and inject clickable timestamp spans
    const injectTimestampLinks = useCallback(() => {
        if (!svgRef.current || !onSeek) return
        const svg = svgRef.current

        // Find all <text> elements with foreignObject or plain <text> elements
        const textEls = svg.querySelectorAll<SVGTextElement>('text')
        textEls.forEach((textEl) => {
            const raw = textEl.textContent || ''
            if (!TIMESTAMP_RE.test(raw)) return
            TIMESTAMP_RE.lastIndex = 0

            // Build a new tspan-based structure replacing timestamps with styled spans
            // We operate on the DOM directly as SVG text doesn't support innerHTML well
            const parent = textEl.parentElement
            if (!parent) return

            // Clone to preserve attributes
            const newText = textEl.cloneNode(false) as SVGTextElement

            let lastIndex = 0
            let match: RegExpExecArray | null
            TIMESTAMP_RE.lastIndex = 0

            while ((match = TIMESTAMP_RE.exec(raw)) !== null) {
                // Text before the timestamp
                if (match.index > lastIndex) {
                    const before = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
                    before.textContent = raw.slice(lastIndex, match.index)
                    newText.appendChild(before)
                }

                // Timestamp tspan — styled and clickable
                // match[1] = bracketed form, match[2] = emoji form
                const timeStr = match[1] ?? match[2]
                const seconds = timeStr != null ? parseTimestamp(timeStr) : null
                const tsSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
                tsSpan.textContent = match[0]
                tsSpan.setAttribute('class', 'mindmap-ts-link')
                tsSpan.style.fill = 'var(--color-primary, #6366f1)'
                tsSpan.style.fontWeight = '600'
                tsSpan.style.cursor = 'pointer'
                tsSpan.style.textDecoration = 'underline'
                if (seconds !== null) {
                    tsSpan.addEventListener('click', (e) => {
                        e.stopPropagation()
                        onSeek(seconds)
                    })
                }
                newText.appendChild(tsSpan)
                lastIndex = match.index + match[0].length
            }

            // Remaining text after last timestamp
            if (lastIndex < raw.length) {
                const after = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
                after.textContent = raw.slice(lastIndex)
                newText.appendChild(after)
            }

            // Only replace if we actually added tspans
            if (newText.childNodes.length > 0) {
                textEl.replaceWith(newText)
            }
        })
    }, [onSeek])

    // Initialize markmap on mount
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

    // Update data when noteContent changes
    useEffect(() => {
        if (!mmRef.current) return
        const root = buildData(noteContent)
        const hasHeadings = /^#{1,6}\s/m.test(noteContent)
        setIsEmpty(!hasHeadings)
        if (hasHeadings) {
            mmRef.current.setData(root)
            // Fit + inject links after render
            setTimeout(() => {
                mmRef.current?.fit()
                injectTimestampLinks()
            }, 350) // slightly longer than animation duration
        }
    }, [noteContent, buildData, injectTimestampLinks])

    // Re-fit when container resizes
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

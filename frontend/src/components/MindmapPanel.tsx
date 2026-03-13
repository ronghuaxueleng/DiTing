import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import type { IPureNode } from 'markmap-common'
import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'

interface MindmapPanelProps {
    noteContent: string
    onSeek?: (seconds: number) => void
    onNodeClick?: (headingText: string) => void
    activeHeadingText?: string | null
}

const transformer = new Transformer()

/** Parse "MM:SS" or "HH:MM:SS" into seconds */
function parseTimestamp(raw: string): number | null {
    const parts = raw.trim().split(':').map(Number)
    if (parts.some(isNaN)) return null
    if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!
    if (parts.length === 2) return (parts[0]! * 60) + parts[1]!
    return null
}

/** Matches ⏱ 06:14  or  [06:14]  (both MM:SS and HH:MM:SS) */
const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\u23f1\s*(\d{1,2}:\d{2}(?::\d{2})?)/g

/** Get the maximum depth present in a markmap tree */
function getMaxDepth(node: IPureNode, current = 0): number {
    if (!node.children?.length) return current
    return Math.max(...node.children.map(c => getMaxDepth(c, current + 1)))
}

/** Clone tree and fold nodes at depth >= foldDepth */
function applyFoldDepth(node: IPureNode, foldDepth: number, current = 0): IPureNode {
    const fold = current >= foldDepth ? 1 : 0
    return {
        ...node,
        payload: { ...(node.payload ?? {}), fold },
        children: node.children?.map(c => applyFoldDepth(c, foldDepth, current + 1)) ?? [],
    } as IPureNode
}

export default function MindmapPanel({ noteContent, onSeek, onNodeClick, activeHeadingText }: MindmapPanelProps) {
    const { t } = useTranslation()
    const svgRef = useRef<SVGSVGElement>(null)
    const mmRef = useRef<Markmap | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isEmpty, setIsEmpty] = useState(false)
    const [syncEnabled, setSyncEnabled] = useState(() => {
        const saved = localStorage.getItem('mindmap-sync-enabled')
        return saved ? saved === 'true' : true // Default to true if not set
    })

    const toggleSync = useCallback(() => {
        setSyncEnabled(prev => {
            const next = !prev
            localStorage.setItem('mindmap-sync-enabled', String(next))
            return next
        })
    }, [])

    // Depth control
    const [maxDepth, setMaxDepth] = useState(() => {
        const saved = localStorage.getItem('mindmap-saved-depth')
        return saved ? parseInt(saved, 10) : 2 // Default to H2 (depth = 2)
    })     // currently selected max depth to show
    const [treeMaxDepth, setTreeMaxDepth] = useState(6) // actual depth found in note
    const [depthTriggerId, setDepthTriggerId] = useState(0) // Forces filter re-apply even on same depth

    // Prevent reset on same-content renders
    const renderedContentRef = useRef<string>('')
    // Track when only depth changed (to skip fit/re-inject)
    const depthOnlyChangeRef = useRef(false)

    // Keyboard navigation state
    const focusedGRef = useRef<SVGGElement | null>(null)
    const isKbActiveRef = useRef(false)

    const panToNode = useCallback((targetG: SVGGElement, forceCenter = false) => {
        const svg = svgRef.current
        if (!svg) return

        const fo = targetG.querySelector('foreignObject') || targetG
        const foRect = fo.getBoundingClientRect()
        const svgRect = svg.getBoundingClientRect()

        // Target center in screen pixels
        const cx = foRect.left + foRect.width / 2 - svgRect.left
        const cy = foRect.top + foRect.height / 2 - svgRect.top

        // Exact center of svg in screen pixels
        const centerX = svgRect.width / 2
        const centerY = svgRect.height / 2

        let dx_screen = 0
        let dy_screen = 0

        if (forceCenter) {
            // Aggressively center the node
            dx_screen = centerX - cx
            dy_screen = centerY - cy
        } else {
            // Smart panning: only pan if node is outside the "safe zone" (middle 60% of viewport)
            const marginX = svgRect.width * 0.2
            const marginY = svgRect.height * 0.2

            if (cx < marginX) dx_screen = marginX - cx
            else if (cx > svgRect.width - marginX) dx_screen = (svgRect.width - marginX) - cx

            if (cy < marginY) dy_screen = marginY - cy
            else if (cy > svgRect.height - marginY) dy_screen = (svgRect.height - marginY) - cy

            if (dx_screen === 0 && dy_screen === 0) return
        }

        const g = svg.querySelector('g') as SVGGElement | null
        if (g) {
            // Parse existing transform
            const currentTransform = g.getAttribute('transform') || ''
            // Markmap typically sets: translate(x, y) scale(k)
            // Regex handles optional space between translate and scale, and optional scale.
            const m = currentTransform.match(/translate\(([^,]+)[, ]+([^)]+)\)(?:\s*scale\(([^)]+)\))?/)

            let tx = 0, ty = 0, currentScale = 1
            if (m) {
                tx = parseFloat(m[1]!)
                ty = parseFloat(m[2]!)
                currentScale = m[3] ? parseFloat(m[3]!) : 1
            }

            let targetScale = currentScale
            if (forceCenter && currentScale < 1.0) {
                targetScale = 1.0
            }

            // 1. Find the internal SVG coordinates of the node's center
            const sx = (cx - tx) / currentScale
            const sy = (cy - ty) / currentScale

            // 2. We want the node's center (sx, sy) to end up at (cx + dx_screen, cy + dy_screen) after applying targetScale
            const targetScreenX = cx + dx_screen
            const targetScreenY = cy + dy_screen

            const new_tx = targetScreenX - sx * targetScale
            const new_ty = targetScreenY - sy * targetScale

            g.style.transition = 'transform 0.3s ease-out'
            g.setAttribute('transform', `translate(${new_tx}, ${new_ty}) scale(${targetScale})`)
            setTimeout(() => { g.style.transition = '' }, 300)

            const zoomState = (svg as any).__zoom
            if (zoomState) {
                zoomState.x = new_tx
                zoomState.y = new_ty
                zoomState.k = targetScale
            }
        }
    }, [])

    // Helper to visually update focus
    const updateFocusRing = useCallback((targetG: SVGGElement | null, forceCenter = false) => {
        if (!svgRef.current) return
        svgRef.current.querySelectorAll('.mindmap-node-kb-focus').forEach(el => el.classList.remove('mindmap-node-kb-focus'))
        focusedGRef.current = targetG
        if (targetG) {
            targetG.classList.add('mindmap-node-kb-focus')
            panToNode(targetG, forceCenter)
        }
    }, [panToNode])

    // Native keyboard handler (not React synthetic — D3 zoom blocks div focus)
    // __data__ on markmap's <g> elements is raw IPureNode: { content, children, payload, state }
    // There is NO .parent and NO D3 hierarchy wrapper.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!isKbActiveRef.current) return
            if (!mmRef.current || !svgRef.current) return
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) return

            e.preventDefault()
            e.stopPropagation()

            // Depth control (1-9)
            if (e.key >= '1' && e.key <= '9') {
                const requestedDepth = parseInt(e.key, 10)
                // Cap at the maximum depth the tree actually has
                const newDepth = Math.min(requestedDepth, Math.max(1, treeMaxDepth))
                setMaxDepth(newDepth)
                localStorage.setItem('mindmap-saved-depth', newDepth.toString())
                setDepthTriggerId(prev => prev + 1) // Always trigger even if depth number is the same
                return
            }

            const svg = svgRef.current
            const allG = () => Array.from(svg.querySelectorAll('g.markmap-node')) as SVGGElement[]

            // If nothing focused, focus root
            if (!focusedGRef.current || !svg.contains(focusedGRef.current)) {
                const rootG = svg.querySelector('g.markmap-node') as SVGGElement | null
                if (rootG) updateFocusRing(rootG)
                return
            }

            const currentG = focusedGRef.current
            const currentNode = (currentG as any).__data__
            if (!currentNode) return

            // Build parent lookup: for each <g>, check if its __data__.children contains the target node
            const findParentG = (targetNode: any): SVGGElement | null => {
                for (const g of allG()) {
                    const nd = (g as any).__data__
                    if (nd?.children && nd.children.includes(targetNode)) return g
                }
                return null
            }

            // Find which <g> renders a given __data__ object
            const findGForNode = (nodeData: any): SVGGElement | undefined => {
                return allG().find(g => (g as any).__data__ === nodeData)
            }

            if (e.key === ' ') {
                // Toggle expand/collapse
                const circle = currentG.querySelector('circle') as SVGCircleElement | null
                if (circle) circle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
                // After markmap re-renders, the <g> element for current node may be new
                setTimeout(() => {
                    // Re-find by matching the same __data__ object reference
                    const newG = findGForNode(currentNode)
                    if (newG) updateFocusRing(newG) // Default fast pan
                }, 400)
                return
            }

            if (e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey) {
                    // Fit to screen and overview everything
                    mmRef.current?.fit()
                } else {
                    // Force center and zoom on current node instead of toggling
                    updateFocusRing(currentG, true)
                }
                return
            }

            if (e.key === 'ArrowRight') {
                const childList = (currentNode.children?.length > 0) ? currentNode.children :
                    (currentNode._children?.length > 0) ? currentNode._children : null

                if (childList) {
                    // HAS CHILDREN: Go deeper
                    const firstChild = childList[0]
                    const childG = findGForNode(firstChild)
                    if (childG) {
                        // Already expanded, go to first child
                        updateFocusRing(childG)
                    } else {
                        // Has children, but not rendered -> collapsed. Expand it first.
                        const circle = currentG.querySelector('circle') as SVGCircleElement | null
                        if (circle) circle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))

                        // Wait for DOM to update, then navigate to the first child
                        setTimeout(() => {
                            const newChildG = findGForNode(firstChild)
                            if (newChildG) updateFocusRing(newChildG)
                        }, 400)
                    }
                } else {
                    // LEAF NODE: Simulate DFS by moving to the next sibling, or parent's next sibling, etc.
                    let targetData = currentNode
                    while (true) {
                        const parentG = findParentG(targetData)
                        if (!parentG) break // Reached root, nowhere else to go

                        const parentNode = (parentG as any).__data__
                        if (!parentNode?.children) break // Shouldn't happen if parent exists

                        const siblings = parentNode.children as any[]
                        const idx = siblings.indexOf(targetData)
                        if (idx !== -1 && idx + 1 < siblings.length) {
                            // Found next sibling
                            const nextSibling = siblings[idx + 1]
                            const nextG = findGForNode(nextSibling)
                            if (nextG) updateFocusRing(nextG)
                            break
                        } else {
                            // Current node was the last child, so move up and look for parent's next sibling
                            targetData = parentNode
                        }
                    }
                }
            }
            else if (e.key === 'ArrowLeft') {
                // Go to parent
                const parentG = findParentG(currentNode)
                if (parentG) updateFocusRing(parentG)
            }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (e.ctrlKey || e.metaKey) {
                    // Zoom In/Out
                    const g = svg.querySelector('g') as SVGGElement | null
                    if (g) {
                        const currentTransform = g.getAttribute('transform') || ''
                        const m = currentTransform.match(/translate\(([^,]+)[, ]+([^)]+)\)(?:\s*scale\(([^)]+)\))?/)

                        let tx = 0, ty = 0, scale = 1
                        if (m) {
                            tx = parseFloat(m[1]!)
                            ty = parseFloat(m[2]!)
                            scale = m[3] ? parseFloat(m[3]!) : 1
                        }

                        // ArrowUp = zoom out, ArrowDown = zoom in (standard browser behavior is often reversed, 
                        // but let's map ArrowUp -> zoom in, ArrowDown -> zoom out like scrolling)
                        const zoomFactor = e.key === 'ArrowUp' ? 1.2 : (1 / 1.2)
                        const targetScale = scale * zoomFactor

                        const svgRect = svg.getBoundingClientRect()

                        // Default to screen center if no focused node
                        let focalX = svgRect.width / 2
                        let focalY = svgRect.height / 2

                        // If we have a focused node, use its exact position as the zoom anchor
                        if (currentG) {
                            const fo = currentG.querySelector('foreignObject') || currentG
                            const foRect = fo.getBoundingClientRect()
                            focalX = foRect.left + foRect.width / 2 - svgRect.left
                            focalY = foRect.top + foRect.height / 2 - svgRect.top
                        }

                        // Scale around the focal point
                        const ratio = targetScale / scale
                        const new_tx = (focalX / scale) - (focalX / scale - tx) * ratio
                        const new_ty = (focalY / scale) - (focalY / scale - ty) * ratio

                        g.style.transition = 'transform 0.1s ease-out'
                        g.setAttribute('transform', `translate(${new_tx}, ${new_ty}) scale(${targetScale})`)
                        setTimeout(() => { g.style.transition = '' }, 150)

                        const zoomState = (svg as any).__zoom
                        if (zoomState) {
                            zoomState.x = new_tx
                            zoomState.y = new_ty
                            zoomState.k = targetScale
                        }
                    }
                    return
                }

                // Navigate to next/prev sibling, or parent's sibling if at the edge
                const isDown = e.key === 'ArrowDown'
                let targetData = currentNode

                while (true) {
                    const parentG = findParentG(targetData)
                    if (!parentG) break // Reached root, nowhere else to go

                    const parentNode = (parentG as any).__data__
                    if (!parentNode?.children) break

                    const siblings = parentNode.children as any[]
                    const idx = siblings.indexOf(targetData)
                    if (idx === -1) break

                    const nextIdx = isDown ? idx + 1 : idx - 1

                    if (nextIdx >= 0 && nextIdx < siblings.length) {
                        // Found a valid sibling (or uncle)
                        const nextG = findGForNode(siblings[nextIdx])
                        if (nextG) updateFocusRing(nextG)
                        break
                    } else {
                        // Reached the end of this sibling group. Move up to parent
                        // and look for its next sibling in the next loop iteration.
                        targetData = parentNode
                    }
                }
            }
        }

        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [updateFocusRing, treeMaxDepth]) // Added treeMaxDepth to dependencies

    // Activate/deactivate keyboard mode on mousedown inside/outside mindmap
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const onMouseDownInside = (e: MouseEvent) => {
            isKbActiveRef.current = true
            // Also set focus ring on clicked node
            const target = e.target as HTMLElement
            const gNode = target.closest?.('g.markmap-node') as SVGGElement | null
            if (gNode) {
                if (svgRef.current) {
                    svgRef.current.querySelectorAll('.mindmap-node-kb-focus').forEach(el => el.classList.remove('mindmap-node-kb-focus'))
                }
                focusedGRef.current = gNode
                gNode.classList.add('mindmap-node-kb-focus')
            }
        }

        const onMouseDownOutside = (e: MouseEvent) => {
            if (!container.contains(e.target as Node)) {
                isKbActiveRef.current = false
                if (svgRef.current) {
                    svgRef.current.querySelectorAll('.mindmap-node-kb-focus').forEach(el => el.classList.remove('mindmap-node-kb-focus'))
                }
                focusedGRef.current = null
            }
        }

        container.addEventListener('mousedown', onMouseDownInside, true)
        document.addEventListener('mousedown', onMouseDownOutside)
        return () => {
            container.removeEventListener('mousedown', onMouseDownInside, true)
            document.removeEventListener('mousedown', onMouseDownOutside)
        }
    }, [updateFocusRing])

    const buildRoot = useCallback((content: string) => {
        const cleaned = content.replace(/!\[.*?\]\(.*?\)/g, '')
        const { root } = transformer.transform(cleaned)
        return root
    }, [])

    const rootCacheRef = useRef<IPureNode | null>(null)

    // Inject timestamp click spans into Markmap's foreignObject divs
    const injectTimestampLinks = useCallback(() => {
        if (!svgRef.current || !onSeek) return
        const svg = svgRef.current
        const divs = svg.querySelectorAll<HTMLDivElement>('foreignObject div div')
        divs.forEach((div) => {
            const html = div.innerHTML
            if (!TIMESTAMP_RE.test(html)) return
            
            // If already processed, don't process again to avoid accumulating wrapper gaps
            if (html.includes('mindmap-ts-link')) return

            TIMESTAMP_RE.lastIndex = 0
            const newHtml = html.replace(TIMESTAMP_RE, (fullMatch, bracketTime?: string, emojiTime?: string) => {
                const timeStr = bracketTime ?? emojiTime
                if (!timeStr) return fullMatch
                const seconds = parseTimestamp(timeStr)
                if (seconds === null) return fullMatch
                // Extract just the core match (e.g., "[06:14]" or "⏱ 06:14") and wrap it purely without adding outer whitespace
                const cleanMatch = fullMatch.trim() 
                return `<span class="mindmap-ts-link" data-seek-seconds="${seconds}" style="color:var(--color-primary,#6366f1);font-weight:600;cursor:pointer;text-decoration:underline;border-radius:2px;padding:0 2px;margin-left:4px;">${cleanMatch}</span>`
            })
            if (newHtml !== html) div.innerHTML = newHtml
        })
    }, [onSeek])

    // Event delegation for timestamp clicks
    useEffect(() => {
        const svg = svgRef.current
        if (!svg || !onSeek) return
        const handleClick = (e: Event) => {
            const target = e.target as HTMLElement
            if (!target?.classList?.contains('mindmap-ts-link')) return
            e.stopPropagation()
            const seconds = Number(target.getAttribute('data-seek-seconds'))
            if (!isNaN(seconds)) onSeek(seconds)
        }
        svg.addEventListener('click', handleClick, true)
        return () => svg.removeEventListener('click', handleClick, true)
    }, [onSeek])

    // Event delegation for node-heading clicks (navigate to note section)
    useEffect(() => {
        const svg = svgRef.current
        if (!svg || !onNodeClick) return
        const handleClick = (e: Event) => {
            const target = e.target as HTMLElement
            // Ignore timestamp link clicks (they stopPropagation)
            if (target?.classList?.contains('mindmap-ts-link')) return
            // Find closest foreignObject div that markmap renders
            const fo = (target as HTMLElement).closest?.('foreignObject')
            if (!fo) return
            const div = fo.querySelector('div')
            if (!div) return
            // Get plain text, stripping any injected HTML spans
            const text = div.innerText?.trim() || div.textContent?.trim() || ''
            // Strip timestamp patterns from text
            const cleaned = text.replace(/\u23f1\s*\d{1,2}:\d{2}(?::\d{2})?/g, '').replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').trim()
            if (cleaned) onNodeClick(cleaned)
        }
        svg.addEventListener('click', handleClick, true)
        return () => svg.removeEventListener('click', handleClick, true)
    }, [onNodeClick])

    // Initialize markmap once
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

    // Memoize content string to avoid re-renders from parent's refetch
    const stableContent = useMemo(() => noteContent, [noteContent])

    // Update markmap when content changes
    useEffect(() => {
        if (!mmRef.current) return
        if (renderedContentRef.current === stableContent) return
        renderedContentRef.current = stableContent

        const hasHeadings = /^#{1,6}\s/m.test(stableContent)
        setIsEmpty(!hasHeadings)
        if (!hasHeadings) return

        const root = buildRoot(stableContent)
        rootCacheRef.current = root
        const maxD = getMaxDepth(root)
        setTreeMaxDepth(maxD)

        // Apply saved depth preference, capped by the actual max depth of the current note
        const savedPrefStr = localStorage.getItem('mindmap-saved-depth')
        const savedPref = savedPrefStr ? parseInt(savedPrefStr, 10) : 2
        const initialTargetDepth = Math.min(savedPref, maxD)
        const resolvedDepth = Math.max(1, initialTargetDepth) // Ensure depth is at least 1 (H1)

        // Only update maxDepth state if it's different, to avoid unnecessary re-renders
        if (maxDepth !== resolvedDepth) {
            setMaxDepth(resolvedDepth)
            // Persist this resolved depth if it changed, to ensure consistency
            localStorage.setItem('mindmap-saved-depth', resolvedDepth.toString())
        }

        const foldedRoot = applyFoldDepth(root, resolvedDepth)
        mmRef.current.setData(foldedRoot)
        setTimeout(() => {
            mmRef.current?.fit()
            injectTimestampLinks()
        }, 400)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stableContent, buildRoot]) // Removed maxDepth from dependencies to prevent loop

    // Apply depth filter when slider changes (no fit reset, no re-inject delay)
    useEffect(() => {
        if (!mmRef.current || !rootCacheRef.current) return
        depthOnlyChangeRef.current = true
        const foldedRoot = applyFoldDepth(rootCacheRef.current, maxDepth)
        mmRef.current.setData(foldedRoot)
        // Optionally center it after folding
        setTimeout(() => {
            if (focusedGRef.current) {
                const updatedG = Array.from(svgRef.current?.querySelectorAll('g.markmap-node') || []).find(
                    g => (g as any).__data__ === (focusedGRef.current as any)?.__data__
                )
                if (updatedG) panToNode(updatedG as SVGGElement)
                else mmRef.current?.fit()
            } else {
                mmRef.current?.fit()
            }
        }, 100)
        // Wait for render then re-inject links (nodes may have been toggled)
        setTimeout(injectTimestampLinks, 350)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maxDepth, depthTriggerId])

    // Re-fit on container resize (without resetting data/zoom fully)
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(() => { mmRef.current?.fit() })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const handleFit = () => mmRef.current?.fit()

    // Reverse sync: highlight + zoom to active heading node
    const prevSyncHeadingRef = useRef<string | null>(null)
    useEffect(() => {
        const svg = svgRef.current
        if (!svg) return
        // Clear previous highlights
        svg.querySelectorAll('.mindmap-node-active').forEach(el => el.classList.remove('mindmap-node-active'))
        if (!syncEnabled || !activeHeadingText) { prevSyncHeadingRef.current = null; return }

        const normalize = (s: string) =>
            s.replace(/\*\*/g, '').replace(/\u23f1\s*[\d:]+/g, '').replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').trim().toLowerCase()
        const needle = normalize(activeHeadingText)
        if (!needle) return

        // Find matching foreignObject
        let targetFo: Element | null = null
        const fos = svg.querySelectorAll('foreignObject')
        for (const fo of fos) {
            const div = fo.querySelector('div')
            if (!div) continue
            const text = normalize(div.innerText || div.textContent || '')
            if (text === needle || text.includes(needle) || needle.includes(text)) {
                targetFo = fo
                break
            }
        }
        if (!targetFo) return

        // Add highlight class to the g.markmap-node ancestor
        const gNode = targetFo.closest('g.markmap-node') || targetFo.parentElement
        if (gNode) gNode.classList.add('mindmap-node-active')

        // Only pan when the heading actually changes (avoid re-pan on same heading)
        if (activeHeadingText === prevSyncHeadingRef.current) return
        prevSyncHeadingRef.current = activeHeadingText

        // Pan the viewport to center the active node
        const foRect = targetFo.getBoundingClientRect()
        const svgRect = svg.getBoundingClientRect()
        const cx = foRect.left + foRect.width / 2 - svgRect.left
        const cy = foRect.top + foRect.height / 2 - svgRect.top
        const dx = svgRect.width / 2 - cx
        const dy = svgRect.height / 2 - cy
        const g = svg.querySelector('g') as SVGGElement | null
        if (g) {
            const currentTransform = g.getAttribute('transform') || ''
            const m = currentTransform.match(/translate\(([^,]+),\s*([^)]+)\)\s*scale\(([^)]+)\)/)
            if (m) {
                const tx = parseFloat(m[1]!) + dx
                const ty = parseFloat(m[2]!) + dy
                const scale = parseFloat(m[3]!)
                // Smooth transition
                g.style.transition = 'transform 0.3s ease'
                g.setAttribute('transform', `translate(${tx}, ${ty}) scale(${scale})`)
                setTimeout(() => { g.style.transition = '' }, 350)
                // Sync d3-zoom internal state so user pan/drag starts from new position
                const zoomState = (svg as any).__zoom
                if (zoomState) {
                    zoomState.x = tx
                    zoomState.y = ty
                    zoomState.k = scale
                }
            }
        }
    }, [syncEnabled, activeHeadingText])

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
        a.href = url; a.download = 'mindmap.svg'; a.click()
        URL.revokeObjectURL(url)
    }



    return (
        <div className="mindmap-panel" ref={containerRef}>
            {/* Toolbar */}
            <div className="mindmap-toolbar">
                <button className="mindmap-tool-btn" onClick={handleFit}
                    title={t('detail.aiNotes.mindmapFit', '适应视图')}>
                    <Icons.Maximize className="w-3.5 h-3.5" />
                </button>
                <button className="mindmap-tool-btn" onClick={handleExportSvg}
                    title={t('detail.aiNotes.mindmapExport', '导出 SVG')}>
                    <Icons.Download className="w-3.5 h-3.5" />
                </button>

                {/* Depth slider — only shown when tree has multiple levels */}
                {treeMaxDepth > 1 && (
                    <div className="mindmap-depth-control">
                        <span className="mindmap-depth-label">H{maxDepth}</span>
                        <input
                            type="range"
                            min={1}
                            max={Math.max(1, treeMaxDepth)} // Prevent slider from breaking if treeMaxDepth is 0
                            value={maxDepth}
                            onChange={e => {
                                const val = Number(e.target.value);
                                depthOnlyChangeRef.current = true;
                                setMaxDepth(val);
                                localStorage.setItem('mindmap-saved-depth', val.toString());
                            }}
                            className="note-toc-slider mindmap-depth-slider"
                            title={t('detail.aiNotes.mindmapDepthHint', `显示到第 ${maxDepth} 级`)}
                        />
                    </div>
                )}

                {/* AI Optimize — reserved */}
                <button className="mindmap-tool-btn mindmap-tool-btn--ai" disabled
                    title={t('detail.aiNotes.mindmapAiComingSoon', 'AI 优化导图（即将推出）')}>
                    <Icons.Sparkles className="w-3.5 h-3.5" />
                    <span className="mindmap-tool-label">{t('detail.aiNotes.mindmapAiOptimize', 'AI 优化')}</span>
                </button>

                {/* Sync toggle */}
                {activeHeadingText !== undefined && (
                    <button
                        className={`mindmap-tool-btn ${syncEnabled ? 'mindmap-tool-btn--active' : ''}`}
                        onClick={toggleSync}
                        title={syncEnabled
                            ? t('detail.aiNotes.mindmapSyncOff', '关闭笔记同步定位')
                            : t('detail.aiNotes.mindmapSyncOn', '开启笔记同步定位')
                        }
                    >
                        <Icons.Eye className="w-3.5 h-3.5" />
                    </button>
                )}

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

import { useEffect, useRef } from 'react'
import { useStreamingStore, type StreamEntry } from '../stores/useStreamingStore'

const API_BASE = '/api'

export function useStreamObserver(transcriptionId: number): StreamEntry | undefined {
    const entry = useStreamingStore((s) => s.streams[transcriptionId])
    const { setModel, appendChunk, finishStream, errorStream } = useStreamingStore()
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        if (!entry) return
        if (entry.status !== 'connecting' && entry.status !== 'streaming') return

        const controller = new AbortController()
        abortRef.current = controller

        const observe = async () => {
            try {
                const response = await fetch(`${API_BASE}/analyze/stream/${entry.taskId}`, {
                    signal: controller.signal,
                })

                if (!response.ok) {
                    const err = await response.json().catch(() => ({ detail: 'Stream observation failed' }))
                    errorStream(transcriptionId, err.detail || `HTTP ${response.status}`)
                    return
                }

                const reader = response.body!.getReader()
                const decoder = new TextDecoder()
                let buffer = ''

                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    buffer += decoder.decode(value, { stream: true })
                    const parts = buffer.split('\n\n')
                    buffer = parts.pop()!

                    for (const part of parts) {
                        const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
                        if (!dataLine) continue
                        try {
                            const data = JSON.parse(dataLine.slice(6))
                            switch (data.type) {
                                case 'start':
                                    setModel(transcriptionId, data.model)
                                    break
                                case 'chunk':
                                    appendChunk(transcriptionId, data.text)
                                    break
                                case 'done':
                                    finishStream(transcriptionId, data.duration)
                                    break
                                case 'error':
                                    errorStream(transcriptionId, data.message)
                                    break
                            }
                        } catch {
                            /* skip malformed events */
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    errorStream(transcriptionId, e.message)
                }
            }
        }

        observe()

        return () => {
            controller.abort()
            abortRef.current = null
        }
    // Re-run when taskId changes or when status transitions to an active state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry?.taskId, transcriptionId])

    return entry
}

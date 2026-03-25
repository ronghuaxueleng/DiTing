import { useEffect, useRef, useState } from 'react'

const API_BASE = '/api'

export interface NoteStreamState {
    text: string
    model: string
    status: 'connecting' | 'streaming' | 'done' | 'error'
    error: string
    duration: number
}

/**
 * Observe a running note generation task via the existing SSE endpoint.
 * Returns streaming state while taskId is non-null, or undefined otherwise.
 */
export function useNoteStreamObserver(taskId: number | null): NoteStreamState | undefined {
    const [state, setState] = useState<NoteStreamState | undefined>(undefined)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        if (taskId === null) {
            setState(undefined)
            return
        }

        setState({ text: '', model: '', status: 'connecting', error: '', duration: 0 })

        const controller = new AbortController()
        abortRef.current = controller

        const observe = async () => {
            try {
                const response = await fetch(`${API_BASE}/analyze/stream/${taskId}`, {
                    signal: controller.signal,
                })

                if (!response.ok) {
                    const err = await response.json().catch(() => ({ detail: 'Stream observation failed' }))
                    setState(prev => prev ? { ...prev, status: 'error', error: err.detail || `HTTP ${response.status}` } : prev)
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
                                    setState(prev => prev ? { ...prev, model: data.model, status: 'streaming' } : prev)
                                    break
                                case 'chunk':
                                    setState(prev => prev ? { ...prev, text: prev.text + data.text, status: 'streaming' } : prev)
                                    break
                                case 'done':
                                    setState(prev => prev ? { ...prev, status: 'done', duration: data.duration } : prev)
                                    break
                                case 'error':
                                    setState(prev => prev ? { ...prev, status: 'error', error: data.message } : prev)
                                    break
                            }
                        } catch {
                            /* skip malformed events */
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    setState(prev => prev ? { ...prev, status: 'error', error: e.message } : prev)
                }
            }
        }

        observe()

        return () => {
            controller.abort()
            abortRef.current = null
        }
    }, [taskId])

    return state
}

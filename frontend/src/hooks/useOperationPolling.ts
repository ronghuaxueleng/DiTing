import { useState, useEffect, useCallback } from 'react'
import { proxyWorkerManagement } from '../api/client'

export interface OperationState {
    id: string | null
    status: 'idle' | 'started' | 'running' | 'completed' | 'failed'
    progress: string[]
    result: any
    error: string | null
}

const INITIAL_STATE: OperationState = {
    id: null,
    status: 'idle',
    progress: [],
    result: null,
    error: null,
}

export function useOperationPolling(workerKey: string | null, operationId: string | null, interval = 1000) {
    const [state, setState] = useState<OperationState>(INITIAL_STATE)

    useEffect(() => {
        if (!workerKey || !operationId) {
            setState(INITIAL_STATE)
            return
        }

        let cancelled = false

        const poll = async () => {
            try {
                const data = await proxyWorkerManagement(workerKey, `operations/${operationId}`)
                if (cancelled) return
                setState({
                    id: operationId,
                    status: data.status,
                    progress: data.progress || [],
                    result: data.result,
                    error: data.error,
                })
                if (data.status !== 'completed' && data.status !== 'failed') {
                    setTimeout(poll, interval)
                }
            } catch (e) {
                if (!cancelled) {
                    setState(prev => ({
                        ...prev,
                        id: operationId,
                        status: 'failed',
                        error: e instanceof Error ? e.message : String(e),
                    }))
                }
            }
        }

        setState({ ...INITIAL_STATE, id: operationId, status: 'started' })
        poll()

        return () => { cancelled = true }
    }, [workerKey, operationId, interval])

    const reset = useCallback(() => setState(INITIAL_STATE), [])

    return { ...state, reset }
}

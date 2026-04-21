import { create } from 'zustand'

export interface StreamEntry {
    taskId: number
    text: string
    model: string
    status: 'connecting' | 'streaming' | 'done' | 'error'
    error: string
    duration: number
}

interface StreamingState {
    streams: Record<number, StreamEntry>
    startStream: (transcriptionId: number, taskId: number) => void
    setModel: (transcriptionId: number, model: string) => void
    appendChunk: (transcriptionId: number, text: string) => void
    finishStream: (transcriptionId: number, duration: number) => void
    errorStream: (transcriptionId: number, error: string) => void
    clearStream: (transcriptionId: number) => void
}

export const useStreamingStore = create<StreamingState>((set) => ({
    streams: {},
    startStream: (transcriptionId, taskId) => set((state) => ({
        streams: {
            ...state.streams,
            [transcriptionId]: { taskId, text: '', model: '', status: 'connecting', error: '', duration: 0 },
        },
    })),
    setModel: (transcriptionId, model) => set((state) => {
        const entry = state.streams[transcriptionId]
        if (!entry) return state
        return { streams: { ...state.streams, [transcriptionId]: { ...entry, model, status: 'streaming' } } }
    }),
    appendChunk: (transcriptionId, text) => set((state) => {
        const entry = state.streams[transcriptionId]
        if (!entry) return state
        return { streams: { ...state.streams, [transcriptionId]: { ...entry, text: entry.text + text, status: 'streaming' } } }
    }),
    finishStream: (transcriptionId, duration) => set((state) => {
        const entry = state.streams[transcriptionId]
        if (!entry) return state
        return { streams: { ...state.streams, [transcriptionId]: { ...entry, status: 'done', duration } } }
    }),
    errorStream: (transcriptionId, error) => set((state) => {
        const entry = state.streams[transcriptionId]
        if (!entry) return state
        return { streams: { ...state.streams, [transcriptionId]: { ...entry, status: 'error', error } } }
    }),
    clearStream: (transcriptionId) => set((state) => {
        const { [transcriptionId]: _, ...rest } = state.streams
        return { streams: rest }
    }),
}))

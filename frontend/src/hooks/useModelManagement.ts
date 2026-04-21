import { useMutation, useQueryClient } from '@tanstack/react-query'
import { proxyWorkerManagement } from '../api/client'

export function useDownloadModel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ workerKey, modelId, useMirror = false, proxy = '' }: {
            workerKey: string; modelId: string; useMirror?: boolean; proxy?: string
        }) => proxyWorkerManagement(workerKey, `models/${modelId}/download`, 'POST', { use_mirror: useMirror, proxy }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['workerModels', variables.workerKey] })
        },
    })
}

export function useActivateModel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ workerKey, modelId }: { workerKey: string; modelId: string }) =>
            proxyWorkerManagement(workerKey, `models/${modelId}/activate`, 'POST'),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['workerModels', variables.workerKey] })
        },
    })
}

export function useUnloadModel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ workerKey }: { workerKey: string }) =>
            proxyWorkerManagement(workerKey, 'models/unload', 'POST'),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['workerModels', variables.workerKey] })
        },
    })
}

export function useDeleteModel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ workerKey, modelId }: { workerKey: string; modelId: string }) =>
            proxyWorkerManagement(workerKey, `models/${modelId}`, 'DELETE'),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['workerModels', variables.workerKey] })
        },
    })
}

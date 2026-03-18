import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getASRStatus, updateASRConfig, bulkUpdateASRWorkers, addASRWorkerUrl, deleteASRWorker, proxyWorkerManagement } from '../api/client'

export function useASRStatus(refreshInterval = 15000) {
    return useQuery({
        queryKey: ['asrStatus'],
        queryFn: () => getASRStatus(true),
        refetchInterval: refreshInterval,
        staleTime: 0,
    })
}

export function useAddWorker() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (url: string) => addASRWorkerUrl(url),
        onSuccess: (data) => {
            queryClient.setQueryData(['asrStatus'], data)
        },
    })
}

export function useRemoveWorker() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (workerId: string) => deleteASRWorker(workerId),
        onSuccess: (data) => {
            queryClient.setQueryData(['asrStatus'], data)
        },
    })
}

export function useBulkUpdateWorkers() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: bulkUpdateASRWorkers,
        onSuccess: (data) => {
            queryClient.setQueryData(['asrStatus'], data)
        },
    })
}

export function useUpdateASRConfig() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: updateASRConfig,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['asrStatus'] })
        },
    })
}

export function useProxyManagement() {
    return useMutation({
        mutationFn: ({ workerKey, path, method = 'GET', body }: { workerKey: string; path: string; method?: string; body?: any }) =>
            proxyWorkerManagement(workerKey, path, method, body),
    })
}

export function useWorkerHardware(workerKey: string | null) {
    return useQuery({
        queryKey: ['workerHardware', workerKey],
        queryFn: () => proxyWorkerManagement(workerKey!, 'hardware'),
        enabled: !!workerKey,
        staleTime: 30000,
    })
}

export function useWorkerModels(workerKey: string | null) {
    return useQuery({
        queryKey: ['workerModels', workerKey],
        queryFn: () => proxyWorkerManagement(workerKey!, 'models'),
        enabled: !!workerKey,
        staleTime: 15000,
    })
}

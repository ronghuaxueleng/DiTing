import { useTranslation } from 'react-i18next'
import Icons from './ui/Icons'

interface HardwareData {
    hardware: {
        cpu: { brand: string; cores: number; threads: number }
        memory: { total_gb: number; available_gb: number }
        gpu: { name: string; vram_total_mb: number; vram_free_mb: number; cuda_version: string } | null
        mps: { available: boolean } | null
        platform: string
    }
    pytorch: {
        installed: boolean
        version: string | null
        cuda_available: boolean
        mps_available: boolean
        device: string | null
    }
}

interface Props {
    data: HardwareData | undefined
    isLoading?: boolean
    compact?: boolean
}

export default function HardwareInfoCard({ data, isLoading, compact }: Props) {
    const { t } = useTranslation()

    if (isLoading) {
        return (
            <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4 animate-pulse">
                <div className="h-4 bg-[var(--color-border)] rounded w-1/3 mb-3" />
                <div className="h-3 bg-[var(--color-border)] rounded w-2/3 mb-2" />
                <div className="h-3 bg-[var(--color-border)] rounded w-1/2" />
            </div>
        )
    }

    if (!data) return null

    const { hardware, pytorch } = data
    const gpu = hardware.gpu
    const vramUsed = gpu ? (gpu.vram_total_mb - gpu.vram_free_mb) : 0
    const vramPercent = gpu ? Math.round((vramUsed / gpu.vram_total_mb) * 100) : 0

    return (
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <Icons.Cpu className="w-4 h-4 text-blue-500" />
                {t('workers.hardware.title', { defaultValue: 'Hardware' })}
            </h4>

            <div className={compact ? 'grid grid-cols-2 gap-2 text-xs' : 'grid grid-cols-1 md:grid-cols-3 gap-3 text-sm'}>
                {/* CPU */}
                <div className="space-y-1">
                    <span className="text-[var(--color-text-muted)]">{t('workers.hardware.cpu', { defaultValue: 'CPU' })}</span>
                    <p className="font-medium truncate">{hardware.cpu.brand}</p>
                    <p className="text-[var(--color-text-muted)]">{hardware.cpu.cores}C / {hardware.cpu.threads}T</p>
                </div>

                {/* Memory */}
                <div className="space-y-1">
                    <span className="text-[var(--color-text-muted)]">{t('workers.hardware.memory', { defaultValue: 'Memory' })}</span>
                    <p className="font-medium">{hardware.memory.available_gb.toFixed(1)} / {hardware.memory.total_gb.toFixed(1)} GB</p>
                </div>

                {/* GPU */}
                <div className="space-y-1">
                    <span className="text-[var(--color-text-muted)]">{t('workers.hardware.gpu', { defaultValue: 'GPU' })}</span>
                    {gpu ? (
                        <>
                            <p className="font-medium truncate">{gpu.name}</p>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${vramPercent > 80 ? 'bg-red-500' : vramPercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${vramPercent}%` }}
                                    />
                                </div>
                                <span className="text-xs text-[var(--color-text-muted)]">
                                    {(vramUsed / 1024).toFixed(1)}/{(gpu.vram_total_mb / 1024).toFixed(1)} GB
                                </span>
                            </div>
                        </>
                    ) : hardware.mps?.available ? (
                        <p className="font-medium">Apple MPS</p>
                    ) : (
                        <p className="text-[var(--color-text-muted)]">{t('workers.hardware.noGpu', { defaultValue: 'CPU only' })}</p>
                    )}
                </div>
            </div>

            {/* PyTorch */}
            {!compact && pytorch && (
                <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)] text-xs">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${pytorch.installed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
                        {pytorch.installed ? <Icons.Check className="w-3 h-3" /> : <Icons.XCircle className="w-3 h-3" />}
                        PyTorch {pytorch.version || 'N/A'}
                    </span>
                    {pytorch.cuda_available && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                            CUDA
                        </span>
                    )}
                    {pytorch.mps_available && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600">
                            MPS
                        </span>
                    )}
                    {pytorch.device && (
                        <span className="text-[var(--color-text-muted)]">Device: {pytorch.device}</span>
                    )}
                </div>
            )}
        </div>
    )
}

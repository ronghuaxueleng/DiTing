import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type HardwareInfo = {
    cpu_name: string
    cpu_cores: number
    ram_gb: number
    has_cuda: boolean
    gpu_name: string
    vram_mb: number
    cuda_version?: string | null
    has_mps: boolean
    recommended_device: string
    compute_key: string
}

type EngineInfo = {
    engine_id: string
    display_name: string
    install_dir: string
    port: number
    installed_at: string
    last_started?: string | null
}

type ManagerState = {
    engines: Record<string, EngineInfo>
}

type WorkerStatus = {
    running: boolean
    healthy: boolean
    url: string
    engine: string
}

type InstallProgressPayload = {
    engine_id: string
    step: string
    message: string
}

const DEFAULT_PORT = 8001

export default function WorkerManagerApp() {
    const [hardware, setHardware] = useState<HardwareInfo | null>(null)
    const [state, setState] = useState<ManagerState | null>(null)
    const [installing, setInstalling] = useState(false)
    const [installLog, setInstallLog] = useState<string[]>([])
    const [modelId, setModelId] = useState('tiny')
    const [useMirror, setUseMirror] = useState(false)
    const [proxy, setProxy] = useState('')
    const [port, setPort] = useState(DEFAULT_PORT)
    const [status, setStatus] = useState<WorkerStatus | null>(null)

    const engineId = 'whisper-openai'

    const installed = useMemo(() => {
        return !!state?.engines?.[engineId]
    }, [state])

    async function refreshState() {
        const s = await invoke<ManagerState>('get_manager_state')
        setState(s)
    }

    useEffect(() => {
        ;(async () => {
            const hw = await invoke<HardwareInfo>('detect_hardware')
            setHardware(hw)
            await refreshState()
        })()
    }, [])

    useEffect(() => {
        let unlisten: null | (() => void) = null
        ;(async () => {
            const u = await listen<InstallProgressPayload>('install-progress', (e) => {
                setInstallLog((prev) => [...prev, `[${e.payload.step}] ${e.payload.message}`])
                if (e.payload.step === 'done') {
                    setInstalling(false)
                    refreshState()
                }
            })
            unlisten = u
        })()
        return () => {
            if (unlisten) unlisten()
        }
    }, [])

    async function doInstall() {
        setInstalling(true)
        setInstallLog([])
        try {
            await invoke('install_whisper_engine', {
                port,
                modelId,
                useMirror,
                proxy,
            })
        } catch (e) {
            setInstalling(false)
            setInstallLog((prev) => [...prev, `ERROR: ${String(e)}`])
        }
    }

    async function doUninstall() {
        await invoke('uninstall_engine', { engineId })
        await refreshState()
        setStatus(null)
    }

    async function doStart() {
        await invoke('start_worker', { engineId })
        const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
        setStatus(s)
    }

    async function doStop() {
        await invoke('stop_worker', { engineId })
        const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
        setStatus(s)
    }

    async function doCheck() {
        const s = await invoke<WorkerStatus>('get_worker_status', { engineId })
        setStatus(s)
    }

    return (
        <div className="min-h-screen p-6" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div className="max-w-4xl mx-auto flex flex-col gap-4">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">DiTing Worker Manager</h1>
                        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Whisper-first MVP (CPU)</p>
                    </div>
                    <button
                        className="text-sm px-3 py-1.5 rounded border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                        onClick={refreshState}
                    >
                        Refresh
                    </button>
                </header>

                <section className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                    <h2 className="font-semibold">Hardware</h2>
                    {!hardware ? (
                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Detecting...</div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                            <div>CPU: {hardware.cpu_name} ({hardware.cpu_cores} cores)</div>
                            <div>RAM: {hardware.ram_gb} GB</div>
                            <div>CUDA: {hardware.has_cuda ? 'Yes' : 'No'} {hardware.gpu_name ? `(${hardware.gpu_name}, ${hardware.vram_mb}MB)` : ''}</div>
                            <div>MPS: {hardware.has_mps ? 'Yes' : 'No'}</div>
                            <div>Recommended: {hardware.recommended_device}</div>
                            <div>Compute key: {hardware.compute_key}</div>
                        </div>
                    )}
                </section>

                <section className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                    <h2 className="font-semibold">Engine: Whisper (OpenAI)</h2>
                    <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Installed: {installed ? 'Yes' : 'No'}
                    </div>

                    {!installed ? (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="text-sm flex flex-col gap-1">
                                    Port
                                    <input
                                        className="border rounded px-2 py-1"
                                        style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                        value={port}
                                        onChange={(e) => setPort(Number(e.target.value) || DEFAULT_PORT)}
                                    />
                                </label>
                                <label className="text-sm flex flex-col gap-1">
                                    Model
                                    <select
                                        className="border rounded px-2 py-1"
                                        style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                        value={modelId}
                                        onChange={(e) => setModelId(e.target.value)}
                                    >
                                        <option value="tiny">tiny</option>
                                        <option value="small">small</option>
                                        <option value="medium">medium</option>
                                        <option value="large-v3-turbo">large-v3-turbo</option>
                                    </select>
                                </label>
                            </div>

                            <label className="text-sm flex items-center gap-2">
                                <input type="checkbox" checked={useMirror} onChange={(e) => setUseMirror(e.target.checked)} />
                                Use China mirrors
                            </label>

                            <label className="text-sm flex flex-col gap-1">
                                Proxy (optional)
                                <input
                                    className="border rounded px-2 py-1"
                                    style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                                    placeholder="http://127.0.0.1:7890"
                                    value={proxy}
                                    onChange={(e) => setProxy(e.target.value)}
                                />
                            </label>

                            <div className="flex gap-2">
                                <button
                                    className="px-3 py-1.5 rounded text-sm"
                                    style={{ background: 'var(--color-primary)', color: 'white' }}
                                    disabled={installing}
                                    onClick={doInstall}
                                >
                                    {installing ? 'Installing…' : 'Install'}
                                </button>
                            </div>

                            {installLog.length > 0 ? (
                                <pre
                                    className="text-xs rounded border p-2 overflow-auto max-h-64"
                                    style={{ borderColor: 'var(--color-border)', background: 'rgba(0,0,0,0.03)' }}
                                >
                                    {installLog.join('\n')}
                                </pre>
                            ) : null}
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-col gap-3">
                            <div className="flex gap-2">
                                <button
                                    className="px-3 py-1.5 rounded text-sm"
                                    style={{ background: 'var(--color-primary)', color: 'white' }}
                                    onClick={doStart}
                                >
                                    Start
                                </button>
                                <button
                                    className="px-3 py-1.5 rounded text-sm border"
                                    style={{ borderColor: 'var(--color-border)' }}
                                    onClick={doStop}
                                >
                                    Stop
                                </button>
                                <button
                                    className="px-3 py-1.5 rounded text-sm border"
                                    style={{ borderColor: 'var(--color-border)' }}
                                    onClick={doCheck}
                                >
                                    Check
                                </button>
                                <button
                                    className="px-3 py-1.5 rounded text-sm"
                                    style={{ background: 'var(--color-error)', color: 'white' }}
                                    onClick={doUninstall}
                                >
                                    Uninstall
                                </button>
                            </div>


{status ? (
                                <div className="text-sm">
                                    Status: running={String(status.running)} healthy={String(status.healthy)} url={status.url}
                                </div>
                            ) : (
                                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No status yet.</div>
                            )}
                        </div>
                    )}
                </section>

                <footer className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Note: MVP currently expects uv binary at src-tauri-worker/resources/uv/uv.exe.
                </footer>
            </div>
        </div>
    )
}

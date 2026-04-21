export type HardwareInfo = {
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

export type SharedPathMapping = {
    server: string
    worker: string
}

export type EngineInfo = {
    engine_id: string
    display_name: string
    install_dir: string
    runtime_root: string
    port: number
    installed_at: string
    last_started?: string | null
    engine_name?: string
    device?: string
    server_url?: string | null
    advertise_url?: string | null
    initial_model_id?: string | null
    shared_paths?: SharedPathMapping[]
}

export type ManagerState = {
    selected_engine_id?: string | null
    engines: Record<string, EngineInfo>
}

export type WorkerStatus = {
    running: boolean
    healthy: boolean
    url: string
    engine: string
    loaded: boolean
    model_id?: string | null
    device?: string | null
    management: boolean
}

export type InstallPathInfo = {
    default_runtime_root: string
    default_engine_install_dir: string
    default_uv_path: string
    default_manager_state_path: string
    app_install_dir: string
}

export type InstallPathPreview = {
    runtime_root: string
    engine_install_dir: string
    uv_path: string
    manager_state_path: string
}

export type InstallProgressPayload = {
    engine_id: string
    step_key: string
    step_label: string
    step_index: number
    step_total: number
    completed_steps: number
    message: string
    install_dir: string
    done: boolean
    error?: string | null
}

export type InstallLogEntry = {
    step_key: string
    step_index: number
    step_total: number
    message: string
    error?: string | null
}

export type ManagedModel = {
    id: string
    engine: string
    model_id: string
    display_name: string
    download_size_mb: number
    vram_required_mb: number
    accuracy: number
    speed: number
    supports_mps: boolean
    description: string
    tags: string[]
    compatible: boolean
    reason: string
    installed: boolean
    active: boolean
    deps_installed: boolean
}

export type WorkerModelsResponse = {
    models: ManagedModel[]
    active_model_id?: string | null
}

export type WorkerOperationResponse = {
    operation_id?: string | null
    status?: string | null
    model_id?: string | null
    from?: string | null
    to?: string | null
}

export type WorkerOperationStatus = {
    id: string
    type: string
    status: string
    detail: string
    progress: string[]
    result?: unknown
    error?: string | null
    created_at: number
    completed_at?: number | null
}

export type InstallEngineRequest = {
    engineId: string
    port: number
    modelId: string
    device: string
    computeKey?: string
    useMirror: boolean
    proxy: string
    serverUrl?: string
    advertiseUrl?: string
    sharedPaths?: SharedPathMapping[]
    installDir: string
}

export type ModelOption = {
    id: string
    label: string
    translationKey?: string
}

export type EngineDefinition = {
    id: string
    engineName: string
    displayName: string
    description: string
    descriptionKey?: string
    defaultModelId: string
    models: ModelOption[]
    showModelInSummary?: boolean
}

export type DeviceOption = {
    value: string
    label: string
}

export type WizardStep = 'hardware' | 'engine' | 'install' | 'complete'

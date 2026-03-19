import type { CSSProperties } from 'react'
import type { EngineDefinition, WizardStep } from './types'

export const DEFAULT_PORT = 8001

export const WIZARD_STEPS: WizardStep[] = ['hardware', 'engine', 'install', 'complete']

export const ENGINE_DEFINITIONS: EngineDefinition[] = [
    {
        id: 'whisper-openai',
        engineName: 'whisper',
        displayName: 'Whisper (OpenAI)',
        description: 'OpenAI Whisper local worker with flexible model choices.',
        descriptionKey: 'workerManager.catalog.engines.whisper-openai.description',
        defaultModelId: 'whisper_large_v3_turbo',
        showModelInSummary: true,
        models: [
            { id: '__none__', label: 'Skip (manual)', translationKey: 'workerManager.catalog.models.__none__.label' },
            { id: 'whisper_tiny', label: 'Tiny', translationKey: 'workerManager.catalog.models.whisper_tiny.label' },
            { id: 'whisper_small', label: 'Small', translationKey: 'workerManager.catalog.models.whisper_small.label' },
            { id: 'whisper_medium', label: 'Medium', translationKey: 'workerManager.catalog.models.whisper_medium.label' },
            { id: 'whisper_large_v3', label: 'Large V3', translationKey: 'workerManager.catalog.models.whisper_large_v3.label' },
            { id: 'whisper_large_v3_turbo', label: 'Large V3 Turbo', translationKey: 'workerManager.catalog.models.whisper_large_v3_turbo.label' },
        ],
    },
    {
        id: 'sensevoice',
        engineName: 'sensevoice',
        displayName: 'SenseVoice',
        description: 'FunASR SenseVoice with built-in VAD and fast multilingual speech recognition.',
        descriptionKey: 'workerManager.catalog.engines.sensevoice.description',
        defaultModelId: 'sensevoice_small',
        showModelInSummary: false,
        models: [
            { id: '__none__', label: 'Skip (manual)', translationKey: 'workerManager.catalog.models.__none__.label' },
            { id: 'sensevoice_small', label: 'SenseVoice Small', translationKey: 'workerManager.catalog.models.sensevoice_small.label' },
        ],
    },
    {
        id: 'qwen3asr',
        engineName: 'qwen3asr',
        displayName: 'Qwen3-ASR',
        description: 'Qwen3-ASR with forced alignment for high-quality timestamps.',
        descriptionKey: 'workerManager.catalog.engines.qwen3asr.description',
        defaultModelId: 'qwen3_asr',
        showModelInSummary: false,
        models: [
            { id: '__none__', label: 'Skip (manual)', translationKey: 'workerManager.catalog.models.__none__.label' },
            { id: 'qwen3_asr', label: 'Qwen3-ASR 1.7B', translationKey: 'workerManager.catalog.models.qwen3_asr.label' },
        ],
    },
]

export const DEFAULT_ENGINE_DEFINITION = ENGINE_DEFINITIONS[0]!

export const buttonBaseClass =
    'px-3 py-1.5 rounded text-sm border transition-all duration-150 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:active:translate-y-0 disabled:active:scale-100'

export const primaryButtonStyle: CSSProperties = {
    borderColor: 'transparent',
    background: 'var(--color-primary)',
    color: 'white',
}

export const secondaryButtonStyle: CSSProperties = {
    borderColor: 'var(--color-border)',
    background: 'var(--color-card)',
    color: 'var(--color-text)',
}

export const dangerButtonStyle: CSSProperties = {
    borderColor: 'transparent',
    background: 'var(--color-error)',
    color: 'white',
}

export const activeButtonStyle: CSSProperties = {
    borderColor: 'rgba(16,185,129,0.35)',
    background: 'rgba(16,185,129,0.08)',
    color: 'var(--color-success)',
}

export const dangerOutlineButtonStyle: CSSProperties = {
    borderColor: 'rgba(239,68,68,0.35)',
    background: 'var(--color-card)',
    color: 'var(--color-error)',
}

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { addLLMProvider, updateLLMProvider } from '../../api'
import type { LLMProvider } from '../../api/types'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useToast } from '../../contexts/ToastContext'
import Icons from '../ui/Icons'

interface ProviderFormModalProps {
    isOpen: boolean
    onClose: () => void
    provider?: LLMProvider | null
}

export default function ProviderFormModal({ isOpen, onClose, provider }: ProviderFormModalProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { showToast } = useToast()
    const isEditMode = !!provider

    const [formData, setFormData] = useState({ name: '', base_url: '', api_key: '', api_type: 'chat_completions' })
    const [showApiKey, setShowApiKey] = useState(false)

    useEscapeKey(onClose, isOpen)

    useEffect(() => {
        if (isOpen) {
            if (provider) {
                setFormData({ name: provider.name, base_url: provider.base_url, api_key: '', api_type: provider.api_type || 'chat_completions' })
            } else {
                setFormData({ name: '', base_url: '', api_key: '', api_type: 'chat_completions' })
            }
            setShowApiKey(false)
        }
    }, [isOpen, provider])

    const addMutation = useMutation({
        mutationFn: addLLMProvider,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            showToast('success', t('settings.llm.addSuccess'))
            onClose()
        },
        onError: (e) => showToast('error', t('settings.llm.addFailed') + ': ' + e.message),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: { name: string; base_url: string; api_key: string; api_type: string } }) =>
            updateLLMProvider(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] })
            showToast('success', t('settings.llm.updateSuccess'))
            onClose()
        },
        onError: (e) => showToast('error', t('settings.llm.updateFailed') + ': ' + e.message),
    })

    const handleSave = () => {
        if (isEditMode && provider) {
            updateMutation.mutate({ id: provider.id, data: formData })
        } else {
            addMutation.mutate(formData)
        }
    }

    const isPending = addMutation.isPending || updateMutation.isPending

    // Compute endpoint preview
    const baseUrl = formData.base_url.trim().replace(/\/+$/, '')
    const endpoint = formData.api_type === 'responses' ? '/responses' : '/chat/completions'
    const previewUrl = baseUrl ? `POST ${baseUrl}${endpoint}` : ''
    const missingV1 = baseUrl.length > 0 && !baseUrl.endsWith('/v1')

    if (!isOpen) return null

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
            <div
                className="bg-[var(--color-card)] w-full max-w-lg rounded-xl shadow-2xl border border-[var(--color-border)] animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                    <h3 className="text-lg font-semibold text-[var(--color-text)]">
                        {isEditMode ? t('settings.llm.editProvider') : t('settings.llm.addProviderTitle')}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors">
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <div className="p-6 space-y-4">
                    {/* Name */}
                    <div>
                        <input
                            type="text"
                            placeholder={t('settings.llm.namePlaceholder')}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm"
                        />
                    </div>

                    {/* Base URL */}
                    <div className="space-y-1.5">
                        <input
                            type="text"
                            placeholder={t('settings.llm.urlPlaceholder')}
                            value={formData.base_url}
                            onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                            className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm"
                        />
                        {/* Endpoint preview */}
                        {previewUrl && (
                            <div className="px-3 py-2 bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)]">
                                <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] mb-1">
                                    <Icons.Zap className="w-3 h-3" />
                                    <span>{t('settings.llm.endpointPreview')}</span>
                                </div>
                                <code className="text-xs font-mono text-[var(--color-text)] break-all">{previewUrl}</code>
                            </div>
                        )}
                        {missingV1 && (
                            <p className="flex items-center gap-1 text-[11px] text-amber-500">
                                <Icons.AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                {t('settings.llm.baseUrlHint')}
                            </p>
                        )}
                    </div>

                    {/* API Key */}
                    <div className="relative">
                        <input
                            type={showApiKey ? 'text' : 'password'}
                            placeholder={isEditMode ? t('settings.llm.apiKeyPlaceholderEdit') : t('settings.llm.apiKeyPlaceholder')}
                            value={formData.api_key}
                            onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                            className="w-full px-3 py-2 pr-10 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        >
                            {showApiKey ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                        </button>
                    </div>

                    {/* API Type */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{t('settings.llm.apiType')}</label>
                        <select
                            value={formData.api_type}
                            onChange={(e) => setFormData({ ...formData, api_type: e.target.value })}
                            className="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm"
                        >
                            <option value="chat_completions">{t('settings.llm.apiTypeChatCompletions')}</option>
                            <option value="responses">{t('settings.llm.apiTypeResponses')}</option>
                        </select>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg)]/50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]/80 transition-colors"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isPending || !formData.name.trim() || !formData.base_url.trim() || (!isEditMode && !formData.api_key.trim())}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-colors"
                    >
                        {isEditMode ? t('settings.llm.update') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

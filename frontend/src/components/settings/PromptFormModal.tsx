import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createPrompt, updatePrompt, getCategories } from '../../api'
import type { Prompt } from '../../api/types'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useToast } from '../../contexts/ToastContext'
import Icons from '../ui/Icons'

interface PromptFormModalProps {
    isOpen: boolean
    onClose: () => void
    prompt?: Prompt | null
}

export default function PromptFormModal({ isOpen, onClose, prompt }: PromptFormModalProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { showToast } = useToast()
    const isEditMode = !!prompt

    const [formData, setFormData] = useState({ name: '', content: '', category_id: null as number | null })

    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: getCategories,
        enabled: isOpen,
    })

    useEscapeKey(onClose, isOpen)

    useEffect(() => {
        if (isOpen) {
            if (prompt) {
                setFormData({ name: prompt.name, content: prompt.content, category_id: prompt.category_id })
            } else {
                setFormData({ name: '', content: '', category_id: null })
            }
        }
    }, [isOpen, prompt])

    const createMutation = useMutation({
        mutationFn: ({ name, content, category_id }: { name: string; content: string; category_id: number | null }) =>
            createPrompt(name, content, category_id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompts'] })
            showToast('success', t('settings.prompt.createSuccess'))
            onClose()
        },
        onError: (e) => showToast('error', t('settings.prompt.createFailed') + ': ' + e.message),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, name, content, category_id }: { id: number; name: string; content: string; category_id: number | null }) =>
            updatePrompt(id, name, content, category_id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompts'] })
            showToast('success', t('settings.prompt.updateSuccess'))
            onClose()
        },
        onError: (e) => showToast('error', t('settings.prompt.updateFailed') + ': ' + e.message),
    })

    const handleSave = () => {
        if (isEditMode && prompt) {
            updateMutation.mutate({ id: prompt.id, ...formData })
        } else {
            createMutation.mutate(formData)
        }
    }

    const isPending = createMutation.isPending || updateMutation.isPending

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
                        {isEditMode ? t('settings.prompt.editPromptTitle') : t('settings.prompt.addPromptTitle')}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors">
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <div className="p-6 space-y-4">
                    <input
                        type="text"
                        placeholder={t('settings.prompt.promptNamePlaceholder')}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg"
                    />
                    <textarea
                        placeholder={t('settings.prompt.promptContentPlaceholder')}
                        value={formData.content}
                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                        rows={6}
                        className="w-full px-3 py-2 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg resize-none"
                    />
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{t('settings.prompt.noCategory')}</label>
                        <select
                            value={formData.category_id ?? ''}
                            onChange={(e) => setFormData({ ...formData, category_id: e.target.value ? Number(e.target.value) : null })}
                            className="flex-1 px-3 py-2 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg"
                        >
                            <option value="">{t('settings.prompt.noCategory')}</option>
                            {categories?.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
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
                        disabled={isPending || !formData.name.trim() || !formData.content.trim()}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-colors"
                    >
                        {t('common.save')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

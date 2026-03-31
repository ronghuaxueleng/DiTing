import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import {
    createQAConversation, getQAConversations, deleteQAConversation,
    getQAMessages, askQuestion,
} from '../api/client'
import { getLLMProviders } from '../api/client'
import type { QAMessage } from '../api/types'
import Icons from './ui/Icons'

const API_BASE = '/api'

interface QAPanelProps {
    sourceId: string
    onSeek?: (time: number) => void
}

export default function QAPanel({ sourceId, onSeek }: QAPanelProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [activeConvId, setActiveConvId] = useState<number | null>(null)
    const [input, setInput] = useState('')
    const [streamingText, setStreamingText] = useState('')
    const [streamingModel, setStreamingModel] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const [selectedModelId, setSelectedModelId] = useState<number | undefined>(undefined)
    const [showConvList, setShowConvList] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    // Fetch conversations
    const { data: conversations = [] } = useQuery({
        queryKey: ['qa-conversations', sourceId],
        queryFn: () => getQAConversations(sourceId),
    })

    // Fetch messages for active conversation
    const { data: messages = [], refetch: refetchMessages } = useQuery({
        queryKey: ['qa-messages', activeConvId],
        queryFn: () => activeConvId ? getQAMessages(activeConvId) : Promise.resolve([]),
        enabled: !!activeConvId,
    })

    // Fetch LLM providers for model selector
    const { data: providers = [] } = useQuery({
        queryKey: ['llm-providers'],
        queryFn: getLLMProviders,
    })

    // Auto-select first conversation or create one
    useEffect(() => {
        if (conversations.length > 0 && !activeConvId) {
            setActiveConvId(conversations[0]?.id ?? null)
        }
    }, [conversations, activeConvId])

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamingText])

    // Create conversation
    const createConv = useMutation({
        mutationFn: () => createQAConversation(sourceId),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['qa-conversations', sourceId] })
            setActiveConvId(data.id)
            setShowConvList(false)
        },
    })

    // Delete conversation
    const deleteConv = useMutation({
        mutationFn: (id: number) => deleteQAConversation(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['qa-conversations', sourceId] })
            if (activeConvId) {
                const remaining = conversations.filter(c => c.id !== activeConvId)
                setActiveConvId(remaining.length > 0 ? remaining[0]?.id ?? null : null)
            }
        },
    })

    // SSE stream observer
    const observeStream = useCallback(async (taskId: number) => {
        const controller = new AbortController()
        abortRef.current = controller
        setIsStreaming(true)
        setStreamingText('')
        setStreamingModel('')

        try {
            const response = await fetch(`${API_BASE}/qa/stream/${taskId}`, {
                signal: controller.signal,
            })
            if (!response.ok) {
                setIsStreaming(false)
                return
            }

            const reader = response.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split('\n\n')
                buffer = parts.pop()!

                for (const part of parts) {
                    const dataLine = part.split('\n').find(l => l.startsWith('data: '))
                    if (!dataLine) continue
                    try {
                        const data = JSON.parse(dataLine.slice(6))
                        switch (data.type) {
                            case 'start':
                                setStreamingModel(data.model)
                                break
                            case 'chunk':
                                setStreamingText(prev => prev + data.text)
                                break
                            case 'done':
                                setIsStreaming(false)
                                setStreamingText('')
                                refetchMessages()
                                queryClient.invalidateQueries({ queryKey: ['qa-conversations', sourceId] })
                                break
                            case 'error':
                                setIsStreaming(false)
                                setStreamingText('')
                                break
                        }
                    } catch { /* skip */ }
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setIsStreaming(false)
                setStreamingText('')
            }
        }
    }, [refetchMessages, queryClient, sourceId])

    // Send question
    const handleSend = async () => {
        const question = input.trim()
        if (!question || isStreaming) return

        // Auto-create conversation if none exists
        let convId = activeConvId
        if (!convId) {
            const result = await createQAConversation(sourceId)
            convId = result.id
            setActiveConvId(convId)
            queryClient.invalidateQueries({ queryKey: ['qa-conversations', sourceId] })
        }

        setInput('')
        // Optimistically show user message
        const optimisticMsg: QAMessage = {
            id: -Date.now(),
            conversation_id: convId,
            role: 'user',
            content: question,
            model: null,
            response_time: null,
            created_at: new Date().toISOString(),
        }
        queryClient.setQueryData<QAMessage[]>(['qa-messages', convId], prev => [...(prev || []), optimisticMsg])

        try {
            const { task_id } = await askQuestion(convId, question, selectedModelId)
            observeStream(task_id)
        } catch (err) {
            refetchMessages()
        }
    }

    // Parse [MM:SS] timestamps in text and make them clickable
    const renderTimestamps = (text: string) => {
        if (!onSeek) return text
        const parts = text.split(/(\[\d{1,2}:\d{2}\])/)
        return parts.map((part, i) => {
            const match = part.match(/^\[(\d{1,2}):(\d{2})\]$/)
            if (match) {
                const seconds = parseInt(match[1]!) * 60 + parseInt(match[2]!)
                return (
                    <button
                        key={i}
                        onClick={() => onSeek(seconds)}
                        className="inline-flex items-center px-1 py-0.5 text-xs font-mono rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer"
                    >
                        {part}
                    </button>
                )
            }
            return <span key={i}>{part}</span>
        })
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const allModels = providers.flatMap(p => p.models.map(m => ({ ...m, providerName: p.name })))
    const activeModel = allModels.find(m => m.is_active)

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Icons.MessageCircle className="w-4 h-4 text-[var(--color-primary)] shrink-0" />
                    <span className="text-sm font-medium truncate">
                        {activeConvId
                            ? (conversations.find(c => c.id === activeConvId)?.title || t('detail.qa.newConversation', '新对话'))
                            : t('detail.qa.title', 'AI 问答')}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Conversation list toggle */}
                    <button
                        onClick={() => setShowConvList(!showConvList)}
                        className="p-1.5 rounded-md hover:bg-[var(--color-card-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title={t('detail.qa.conversations', '会话列表')}
                    >
                        <Icons.List className="w-3.5 h-3.5" />
                    </button>
                    {/* New conversation */}
                    <button
                        onClick={() => createConv.mutate()}
                        className="p-1.5 rounded-md hover:bg-[var(--color-card-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title={t('detail.qa.newConversation', '新对话')}
                    >
                        <Icons.Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Conversation list dropdown */}
            {showConvList && conversations.length > 0 && (
                <div className="border-b border-[var(--color-border)] bg-[var(--color-card-muted)] max-h-48 overflow-y-auto">
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`flex items-center justify-between px-4 py-2 text-sm cursor-pointer hover:bg-[var(--color-card)] transition-colors ${
                                conv.id === activeConvId ? 'bg-[var(--color-card)] text-[var(--color-primary)]' : 'text-[var(--color-text)]'
                            }`}
                            onClick={() => { setActiveConvId(conv.id); setShowConvList(false) }}
                        >
                            <span className="truncate">{conv.title || t('detail.qa.newConversation', '新对话')}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); deleteConv.mutate(conv.id) }}
                                className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-500 transition-colors shrink-0"
                            >
                                <Icons.Trash className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {messages.length === 0 && !isStreaming && (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-sm gap-2">
                        <Icons.MessageCircle className="w-8 h-8 opacity-30" />
                        <p>{t('detail.qa.emptyHint', '针对视频内容提出你的问题')}</p>
                    </div>
                )}
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            msg.role === 'user'
                                ? 'bg-[var(--color-primary)] text-white rounded-br-md'
                                : 'bg-[var(--color-card-muted)] text-[var(--color-text)] rounded-bl-md'
                        }`}>
                            {msg.role === 'assistant' ? (
                                <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                                    <Markdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            // Make timestamps clickable
                                            p: ({ children }) => <p>{typeof children === 'string' ? renderTimestamps(children) : children}</p>,
                                        }}
                                    >
                                        {msg.content}
                                    </Markdown>
                                </div>
                            ) : (
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                            {msg.role === 'assistant' && msg.model && (
                                <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)] opacity-60">
                                    {msg.model}{msg.response_time ? ` · ${msg.response_time}s` : ''}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {/* Streaming message */}
                {isStreaming && (
                    <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm bg-[var(--color-card-muted)] text-[var(--color-text)] leading-relaxed">
                            {streamingText ? (
                                <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                                    <Markdown remarkPlugins={[remarkGfm]}>{streamingText}</Markdown>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                                    <div className="flex gap-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                                    </div>
                                    {streamingModel && <span className="text-[10px] ml-1">{streamingModel}</span>}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-[var(--color-border)] px-3 py-2.5 shrink-0">
                {/* Model selector */}
                <div className="flex items-center gap-2 mb-2">
                    <select
                        value={selectedModelId ?? ''}
                        onChange={e => setSelectedModelId(e.target.value ? Number(e.target.value) : undefined)}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--color-card-muted)] border border-[var(--color-border)] text-[var(--color-text-muted)] outline-none"
                    >
                        <option value="">{activeModel ? `${activeModel.model_name} (${t('common.default', '默认')})` : t('detail.qa.selectModel', '选择模型')}</option>
                        {allModels.filter(m => !m.is_active).map(m => (
                            <option key={m.id} value={m.id}>{m.model_name} ({m.providerName})</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('detail.qa.inputPlaceholder', '输入问题...')}
                        rows={1}
                        className="flex-1 resize-none rounded-xl px-3 py-2 text-sm bg-[var(--color-card-muted)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-1 focus:ring-[var(--color-primary)] max-h-32 overflow-y-auto"
                        style={{ minHeight: '36px' }}
                        onInput={e => {
                            const el = e.target as HTMLTextAreaElement
                            el.style.height = 'auto'
                            el.style.height = Math.min(el.scrollHeight, 128) + 'px'
                        }}
                        disabled={isStreaming}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isStreaming}
                        className="p-2 rounded-xl bg-[var(--color-primary)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shrink-0"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    )
}

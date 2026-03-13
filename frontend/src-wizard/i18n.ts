import { useState, useCallback } from 'react'

const translations = {
    zh: {
        // WelcomeStep
        'welcome.title': '欢迎使用 DiTing',
        'welcome.desc': 'DiTing 将视频转化为可搜索、可标注的文本。接下来几步快速完成初始配置。',
        'welcome.start': '开始设置',
        // ASRWorkerStep
        'asr.title': 'ASR 语音识别配置',
        'asr.desc': 'DiTing 需要 ASR Worker 进行语音识别。请配置 Worker 地址，或跳过稍后设置。',
        'asr.engine': '识别引擎',
        'asr.engine.sensevoice': 'SenseVoice（推荐）',
        'asr.engine.whisper': 'Whisper',
        'asr.engine.qwen3asr': 'Qwen3-ASR',
        'asr.engine.bailian': '百炼（云端）',
        'asr.workerUrl': 'Worker 地址',
        'asr.testing': '测试中...',
        'asr.testSave': '测试并保存',
        'asr.success.online': 'Worker 连接成功！',
        'asr.success.configured': 'Worker 已配置，启动后将自动连接。',
        'asr.testingMsg': '正在测试连接...',
        // BilibiliStep
        'bili.title': 'B站 Cookie（推荐）',
        'bili.desc': '设置 B站 Cookie 后，DiTing 可以直接获取视频的 AI 字幕，大幅减少本地 ASR 转写需求。',
        'bili.tip': '大部分B站视频都有 AI 生成字幕，设置 Cookie 后可直接获取，无需本地语音识别，速度更快、效果更好。即使没有配置 ASR Worker，也能处理大部分B站视频。',
        'bili.placeholder': '粘贴 SESSDATA 值...',
        'bili.hint': '打开 bilibili.com → F12 开发者工具 → Application → Cookies → 复制 SESSDATA 的值。',
        'bili.saving': '保存中...',
        'bili.save': '保存',
        'bili.saved': 'B站 Cookie 已保存！',
        // LLMSetupStep
        'llm.title': 'LLM 配置（可选）',
        'llm.desc': '添加 OpenAI 兼容的 LLM 服务商用于 AI 分析。可跳过稍后配置。',
        'llm.name': '服务商名称（如 OpenAI）',
        'llm.baseUrl': 'Base URL（如 https://api.openai.com/v1）',
        'llm.apiKey': 'API Key',
        'llm.saving': '保存中...',
        'llm.save': '保存',
        'llm.saved': 'LLM 服务商已保存！',
        // DoneStep
        'done.title': '设置完成！',
        'done.desc': 'DiTing 已准备就绪。你可以随时在管理页面调整设置。',
        'done.opening': '正在打开...',
        'done.open': '打开主界面',
        // Common
        'common.back': '返回',
        'common.next': '下一步',
        'common.skip': '跳过',
        'common.failed': '失败：',
    },
    en: {
        'welcome.title': 'Welcome to DiTing',
        'welcome.desc': 'DiTing transforms videos into searchable, annotated text. Let\'s get you set up in a few quick steps.',
        'welcome.start': 'Get Started',
        'asr.title': 'ASR Worker Setup',
        'asr.desc': 'DiTing needs an ASR worker for speech recognition. Configure the worker address below, or skip if you\'ll set it up later.',
        'asr.engine': 'Engine',
        'asr.engine.sensevoice': 'SenseVoice (Recommended)',
        'asr.engine.whisper': 'Whisper',
        'asr.engine.qwen3asr': 'Qwen3-ASR',
        'asr.engine.bailian': 'Bailian (Cloud)',
        'asr.workerUrl': 'Worker URL',
        'asr.testing': 'Testing...',
        'asr.testSave': 'Test & Save',
        'asr.success.online': 'Worker connected successfully!',
        'asr.success.configured': 'Worker configured. It will connect when available.',
        'asr.testingMsg': 'Testing connection...',
        // BilibiliStep
        'bili.title': 'Bilibili Cookie (Recommended)',
        'bili.desc': 'With a Bilibili cookie, DiTing can fetch AI-generated subtitles directly, greatly reducing the need for local ASR transcription.',
        'bili.tip': 'Most Bilibili videos have AI-generated subtitles. With a cookie set, DiTing fetches them directly — faster and more accurate than local ASR. You can handle most Bilibili videos even without an ASR Worker.',
        'bili.placeholder': 'Paste SESSDATA value...',
        'bili.hint': 'Open bilibili.com → F12 DevTools → Application → Cookies → copy the SESSDATA value.',
        'bili.saving': 'Saving...',
        'bili.save': 'Save',
        'bili.saved': 'Bilibili cookie saved!',
        'llm.title': 'LLM Configuration (Optional)',
        'llm.desc': 'Add an OpenAI-compatible LLM provider for AI analysis. You can skip this and configure it later.',
        'llm.name': 'Provider name (e.g. OpenAI)',
        'llm.baseUrl': 'Base URL (e.g. https://api.openai.com/v1)',
        'llm.apiKey': 'API Key',
        'llm.saving': 'Saving...',
        'llm.save': 'Save Provider',
        'llm.saved': 'LLM provider saved!',
        'done.title': "You're All Set!",
        'done.desc': 'DiTing is ready to use. You can always adjust settings from the Management page later.',
        'done.opening': 'Opening...',
        'done.open': 'Open Dashboard',
        'common.back': 'Back',
        'common.next': 'Next',
        'common.skip': 'Skip',
        'common.failed': 'Failed: ',
    },
} as const

export type Locale = keyof typeof translations
type Key = keyof typeof translations['zh']

let currentLocale: Locale = 'zh'
const listeners = new Set<() => void>()

export function t(key: Key): string {
    return translations[currentLocale][key] ?? key
}

export function setLocale(locale: Locale) {
    currentLocale = locale
    listeners.forEach(fn => fn())
}

export function getLocale(): Locale {
    return currentLocale
}

export function useLocale() {
    const [, setTick] = useState(0)
    const rerender = useCallback(() => setTick(n => n + 1), [])

    // Subscribe on first render, unsubscribe on unmount
    useState(() => {
        listeners.add(rerender)
        return () => listeners.delete(rerender)
    })

    return { t, locale: currentLocale, setLocale }
}

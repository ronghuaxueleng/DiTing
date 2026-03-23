import { useState, useCallback } from 'react'

const translations = {
    zh: {
        // WelcomeStep
        'welcome.title': '欢迎使用 DiTing',
        'welcome.desc': 'DiTing 将视频转化为可搜索、可标注的文本。接下来几步快速完成初始配置。',
        'welcome.start': '开始设置',
        // FFmpegStep
        'ffmpeg.title': 'FFmpeg 环境检测',
        'ffmpeg.desc': 'FFmpeg 是处理音视频的核心依赖，用于下载、转码和截图。DiTing 需要系统已安装 FFmpeg。',
        'ffmpeg.checking': '正在检测 FFmpeg...',
        'ffmpeg.found': 'FFmpeg 已就绪',
        'ffmpeg.notFound': '未检测到 FFmpeg',
        'ffmpeg.installHint': '请安装 FFmpeg 并确保其在系统 PATH 中，然后点击重新检测。',
        'ffmpeg.guideTitle': '安装指引',
        'ffmpeg.guide': 'Windows：从 https://www.gyan.dev/ffmpeg/builds/ 下载 release full 版本，解压后将 bin 目录添加到系统 PATH 环境变量。\nmacOS：运行 brew install ffmpeg\nLinux：运行 sudo apt install ffmpeg 或对应包管理器命令',
        'ffmpeg.recheck': '重新检测',
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
        'llm.endpointPreview': '端点预览',
        'llm.baseUrlHint': '大多数 OpenAI 兼容 API 需要 /v1 后缀（如 https://api.example.com/v1）',
        'llm.fetchingModels': '正在获取可用模型...',
        'llm.selectModel': '选择一个模型并激活',
        'llm.noModels': '未发现可用模型，请手动输入模型名称。',
        'llm.modelPlaceholder': '模型名称（如 gpt-4o）',
        'llm.activating': '激活中...',
        'llm.activated': '模型已激活！',
        'llm.modelManual': '手动输入',
        'llm.addAndActivate': '添加并激活',
        'llm.retryFetch': '重新获取',
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
        // FFmpegStep
        'ffmpeg.title': 'FFmpeg Check',
        'ffmpeg.desc': 'FFmpeg is required for downloading, transcoding, and processing media files. DiTing needs it installed on your system.',
        'ffmpeg.checking': 'Checking for FFmpeg...',
        'ffmpeg.found': 'FFmpeg is ready',
        'ffmpeg.notFound': 'FFmpeg not found',
        'ffmpeg.installHint': 'Please install FFmpeg and make sure it\'s in your system PATH, then click recheck.',
        'ffmpeg.guideTitle': 'Installation Guide',
        'ffmpeg.guide': 'Windows: Download from https://www.gyan.dev/ffmpeg/builds/ (release full), extract and add the bin folder to your system PATH.\nmacOS: Run brew install ffmpeg\nLinux: Run sudo apt install ffmpeg or your distro\'s package manager',
        'ffmpeg.recheck': 'Recheck',
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
        'llm.endpointPreview': 'Endpoint Preview',
        'llm.baseUrlHint': 'Most OpenAI-compatible APIs require /v1 suffix (e.g., https://api.example.com/v1)',
        'llm.fetchingModels': 'Fetching available models...',
        'llm.selectModel': 'Select a model to activate',
        'llm.noModels': 'No models found. Enter model name manually.',
        'llm.modelPlaceholder': 'Model name (e.g. gpt-4o)',
        'llm.activating': 'Activating...',
        'llm.activated': 'Model activated!',
        'llm.modelManual': 'Enter manually',
        'llm.addAndActivate': 'Add & Activate',
        'llm.retryFetch': 'Retry',
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

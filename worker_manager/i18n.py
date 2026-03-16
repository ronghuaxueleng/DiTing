"""Internationalization (i18n) for Worker Manager GUI."""

from typing import Dict

# Current language
_current_lang = "zh"

# Translation dictionaries
_translations: Dict[str, Dict[str, str]] = {
    "zh": {
        # ── App ──
        "app.title": "DiTing Worker Manager",
        "step.hardware": "硬件检测",
        "step.engine": "引擎选择",
        "step.install": "安装",
        "step.complete": "完成",

        # ── Tags ──
        "tag.recommended": "推荐",
        "tag.best_accuracy": "最佳精度",
        "tag.lightweight": "轻量级",

        # ── Step 1: Hardware ──
        "hw.title": "硬件检测",
        "hw.subtitle": "正在检测您的硬件，以推荐最佳语音识别引擎...",
        "hw.detecting": "正在检测硬件...",
        "hw.panel_title": "检测到的硬件",
        "hw.select_accel": "选择加速方式",
        "hw.cpu": "CPU",
        "hw.ram": "内存",
        "hw.gpu": "GPU",
        "hw.vram": "显存",
        "hw.cuda": "CUDA",
        "hw.unified_memory": "统一内存",
        "hw.recommended": "推荐",
        "hw.none_detected": "未检测到",
        "hw.device.cuda": "NVIDIA CUDA (GPU)",
        "hw.device.mps": "Apple MPS (GPU)",
        "hw.device.cpu": "仅 CPU",
        "hw.card.cuda.title": "NVIDIA CUDA",
        "hw.card.cuda.desc": "适用于 NVIDIA 显卡，性能最佳",
        "hw.card.mps.title": "Apple MPS",
        "hw.card.mps.desc": "Apple Silicon 芯片硬件加速",
        "hw.card.cpu.title": "仅 CPU",
        "hw.card.cpu.desc": "无 GPU 加速，速度较慢但兼容性最好",
        "hw.apple_silicon": "Apple Silicon",

        # ── Step 2: Engine ──
        "engine.title": "选择语音识别引擎",
        "engine.subtitle": "选择要安装的语音识别引擎和模型。",
        "engine.install_dir": "安装位置：",
        "engine.port": "Worker 端口：",
        "engine.cloud_subtitle": "云端服务（无需下载）",
        "engine.download": "下载大小",
        "engine.accuracy": "精度",
        "engine.speed": "速度",

        # ── Step 3: Install ──
        "install.title": "正在安装",
        "install.subtitle": "正在搭建 ASR Worker 运行环境...",
        "install.preparing": "准备中...",
        "install.complete": "安装完成！",
        "install.error": "错误",
        "install.cancel": "取消",
        "install.cancelling": "正在取消...",

        # ── Install Steps ──
        "istep.uv": "准备 uv 工具",
        "istep.python": "安装 Python",
        "istep.venv": "创建虚拟环境",
        "istep.pytorch": "安装 PyTorch",
        "istep.base_deps": "安装基础依赖",
        "istep.engine_deps": "安装引擎依赖",
        "istep.model": "下载模型",
        "istep.worker_files": "配置 Worker 文件",
        "istep.config": "生成配置文件",
        "istep.scripts": "创建启动脚本",
        "istep.verify": "验证安装",

        # ── Step 4: Complete ──
        "complete.title": "安装完成！",
        "complete.engine": "引擎",
        "complete.worker_url": "Worker 地址",
        "complete.install_dir": "安装目录",
        "complete.tip": "在 DiTing 服务端设置中添加此 Worker 地址即可连接。",
        "complete.start_now": "立即启动 Worker",
        "complete.run_tray": "常驻系统托盘",
        "complete.launch": "启动 Worker",

        # ── Tray ──
        "tray.title": "DiTing ASR Worker",
        "tray.running": "运行中",
        "tray.stopped": "已停止",
        "tray.start": "启动 Worker",
        "tray.stop": "停止 Worker",
        "tray.show_logs": "查看日志",
        "tray.reconfigure": "重新配置...",
        "tray.exit": "退出",

        # ── Log Window ──
        "log.title": "ASR Worker 日志",

        # ── Common ──
        "btn.next": "下一步",
        "btn.back": "上一步",
        "btn.install": "开始安装",

        # ── Model descriptions ──
        "model.sensevoice_small.desc": "阿里 FunASR 中文语音识别，速度与精度的最佳平衡。",
        "model.whisper_tiny.desc": "最小的 Whisper 模型，适合测试或低配机器。",
        "model.whisper_small.desc": "多语言识别精度良好，适用于 4GB+ 显存。",
        "model.whisper_medium.desc": "高精度多语言识别，需要 4GB+ 显存。",
        "model.whisper_large_v3_turbo.desc": "最佳 Whisper 模型，极高精度 + Turbo 加速。",
        "model.qwen3_asr.desc": "通义千问最新语音识别，最高精度，支持逐字级时间戳。注意：超过10分钟的音频可能 OOM。",
        "model.bailian.desc": "阿里云百炼语音识别服务，无需 GPU，需要 API Key 和网络。",

        # ── Recommender reasons ──
        "reason.no_mps": "不支持 Apple Silicon (MPS)",
        "reason.vram": "需要 {required}MB 显存，当前仅 {available}MB",
        "reason.too_large_cpu": "模型过大，不适合纯 CPU 模式",
    },

    "en": {
        # ── App ──
        "app.title": "DiTing Worker Manager",
        "step.hardware": "Hardware",
        "step.engine": "Engine",
        "step.install": "Install",
        "step.complete": "Complete",

        # ── Tags ──
        "tag.recommended": "Recommended",
        "tag.best_accuracy": "Best Accuracy",
        "tag.lightweight": "Lightweight",

        # ── Step 1: Hardware ──
        "hw.title": "Hardware Detection",
        "hw.subtitle": "Detecting your hardware to recommend the best ASR engine...",
        "hw.detecting": "Detecting hardware...",
        "hw.panel_title": "Detected Hardware",
        "hw.select_accel": "Select Acceleration Method",
        "hw.cpu": "CPU",
        "hw.ram": "RAM",
        "hw.gpu": "GPU",
        "hw.vram": "VRAM",
        "hw.cuda": "CUDA",
        "hw.unified_memory": "Unified Memory",
        "hw.recommended": "Recommended",
        "hw.none_detected": "None detected",
        "hw.device.cuda": "NVIDIA CUDA (GPU)",
        "hw.device.mps": "Apple MPS (GPU)",
        "hw.device.cpu": "CPU Only",
        "hw.card.cuda.title": "NVIDIA CUDA",
        "hw.card.cuda.desc": "Best performance for NVIDIA GPUs",
        "hw.card.mps.title": "Apple MPS",
        "hw.card.mps.desc": "Hardware acceleration for Apple Silicon",
        "hw.card.cpu.title": "CPU Only",
        "hw.card.cpu.desc": "No GPU acceleration. Slower but works everywhere.",
        "hw.apple_silicon": "Apple Silicon",

        # ── Step 2: Engine ──
        "engine.title": "Select ASR Engine",
        "engine.subtitle": "Choose the speech recognition engine to install.",
        "engine.install_dir": "Install Location:",
        "engine.port": "Worker Port:",
        "engine.cloud_subtitle": "Cloud Service (no download)",
        "engine.download": "Download",
        "engine.accuracy": "Accuracy",
        "engine.speed": "Speed",

        # ── Step 3: Install ──
        "install.title": "Installing",
        "install.subtitle": "Setting up your ASR worker environment...",
        "install.preparing": "Preparing...",
        "install.complete": "Installation complete!",
        "install.error": "Error",
        "install.cancel": "Cancel",
        "install.cancelling": "Cancelling...",

        # ── Install Steps ──
        "istep.uv": "Preparing uv",
        "istep.python": "Installing Python",
        "istep.venv": "Creating environment",
        "istep.pytorch": "Installing PyTorch",
        "istep.base_deps": "Installing base dependencies",
        "istep.engine_deps": "Installing engine dependencies",
        "istep.model": "Downloading model",
        "istep.worker_files": "Setting up worker files",
        "istep.config": "Generating configuration",
        "istep.scripts": "Creating startup scripts",
        "istep.verify": "Verifying installation",

        # ── Step 4: Complete ──
        "complete.title": "Installation Complete!",
        "complete.engine": "Engine",
        "complete.worker_url": "Worker URL",
        "complete.install_dir": "Install Dir",
        "complete.tip": "Add this Worker URL in DiTing Server settings to connect.",
        "complete.start_now": "Start Worker now",
        "complete.run_tray": "Run in system tray",
        "complete.launch": "Launch Worker",

        # ── Tray ──
        "tray.title": "DiTing ASR Worker",
        "tray.running": "Running",
        "tray.stopped": "Stopped",
        "tray.start": "Start Worker",
        "tray.stop": "Stop Worker",
        "tray.show_logs": "Show Logs",
        "tray.reconfigure": "Reconfigure...",
        "tray.exit": "Exit",

        # ── Log Window ──
        "log.title": "ASR Worker Logs",

        # ── Common ──
        "btn.next": "Next",
        "btn.back": "Back",
        "btn.install": "Install",

        # ── Model descriptions ──
        "model.sensevoice_small.desc": "Fast Chinese ASR by Alibaba FunASR. Best balance of speed and accuracy for Chinese content.",
        "model.whisper_tiny.desc": "Smallest Whisper model. Good for testing or low-resource machines.",
        "model.whisper_small.desc": "Good accuracy for most languages. Works well on 4GB+ GPUs.",
        "model.whisper_medium.desc": "High accuracy multi-language ASR. Needs 4GB+ VRAM.",
        "model.whisper_large_v3_turbo.desc": "Best Whisper model. Excellent accuracy with turbo speed optimization.",
        "model.qwen3_asr.desc": "State-of-the-art ASR by Qwen. Best accuracy, supports character-level timestamps. Warning: may OOM on audio >10min.",
        "model.bailian.desc": "Alibaba Cloud ASR service. No GPU needed, requires API key and internet.",

        # ── Recommender reasons ──
        "reason.no_mps": "Not supported on Apple Silicon (MPS)",
        "reason.vram": "Needs {required}MB VRAM, you have {available}MB",
        "reason.too_large_cpu": "Too large for CPU-only mode",
    },
}


def set_language(lang: str):
    """Set the current language. Supported: 'zh', 'en'."""
    global _current_lang
    if lang in _translations:
        _current_lang = lang


def get_language() -> str:
    """Get the current language code."""
    return _current_lang


def t(key: str, **kwargs) -> str:
    """
    Translate a key to the current language.
    Supports format placeholders: t("reason.vram", required=4000, available=2000)
    Falls back to English, then to the key itself.
    """
    text = _translations.get(_current_lang, {}).get(key)
    if text is None:
        text = _translations.get("en", {}).get(key)
    if text is None:
        return key
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError):
            return text
    return text

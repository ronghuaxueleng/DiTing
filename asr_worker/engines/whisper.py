import logging
import os
import re
from .base import ASREngine, format_timestamp

logger = logging.getLogger("ASR Worker")

class WhisperEngine(ASREngine):
    def __init__(self, model_path=None, model_name=None):
        from config import get_config, get_engine_config
        cfg = get_config()
        ecfg = get_engine_config("whisper")

        # Priority: constructor arg > config > env > default
        self.model_name = model_name or ecfg.get("model_name", "large-v3-turbo")
        self.model_path = model_path or ecfg.get("download_root") or os.getenv("WHISPER_MODEL_PATH")
        device_cfg = cfg.get("device", "cuda:0")

        logger.info(f"🚀 Loading Whisper: {self.model_name} from {self.model_path}")
        try:
            import whisper
        except ImportError:
            raise ImportError("Whisper dependency 'openai-whisper' not installed.")

        if self.model_path:
            os.makedirs(self.model_path, exist_ok=True)

        # Determine device (respect config, fallback to auto-detect)
        import torch
        if device_cfg.startswith("cuda") and not torch.cuda.is_available():
            device = "cpu"
        else:
            device = device_cfg.split(":")[0]  # whisper uses "cuda" not "cuda:0"
        logger.info(f"🖥️ Using Device: {device}")

        self.model = whisper.load_model(self.model_name, download_root=self.model_path, device=device)
        self._device = device

    def unload(self):
        """Release model and free VRAM."""
        import gc
        if hasattr(self, "model"):
            del self.model
            self.model = None
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def _post_process_text(self, text: str) -> str:
        if re.search(r'[\u4e00-\u9fff]', text):
            text = text.replace(",", "，").replace("?", "？").replace("!", "！")
            text = re.sub(r'(?<=[\u4e00-\u9fff])\.', '。', text)
            text = re.sub(r'\.(?=\s|$)', '。', text)
        return text

    def predict(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None):
        logger.info(f"📂 [Whisper] Processing: {audio_path}")

        if check_cancel_func: check_cancel_func()
        audio_data = self.load_audio(audio_path)
        chunks = self.chunk_audio(audio_data)
        total_chunks = len(chunks)
        logger.info(f"🔪 [Whisper] Split into {total_chunks} chunk(s), total {len(audio_data)/16000:.1f}s")

        all_text = []
        for idx, (start_sec, chunk) in enumerate(chunks):
            if check_cancel_func: check_cancel_func()
            logger.info(f"🔄 [Whisper] Processing chunk {idx+1}/{total_chunks} (offset {start_sec:.0f}s, {len(chunk)/16000:.1f}s)")

            result = self.model.transcribe(
                chunk,
                language=language or "zh",
                initial_prompt=initial_prompt or "这是一段普通话录音。请在转写时使用标准的中文标点符号，例如：逗号，句号。",
                beam_size=5
            )

            text = self._post_process_text(result["text"])
            all_text.append(text)

            # Free VRAM between chunks
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

        if check_cancel_func: check_cancel_func()
        return "".join(all_text)

    def generate_srt(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None) -> str:
        logger.info(f"📂 [Whisper] Generating SRT: {audio_path}")

        if check_cancel_func: check_cancel_func()
        audio_data = self.load_audio(audio_path)
        chunks = self.chunk_audio(audio_data)
        total_chunks = len(chunks)
        logger.info(f"🔪 [Whisper] Split into {total_chunks} chunk(s) for SRT")

        srt_content = ""
        global_idx = 0

        for chunk_idx, (start_sec, chunk) in enumerate(chunks):
            if check_cancel_func: check_cancel_func()
            logger.info(f"🔄 [Whisper] SRT chunk {chunk_idx+1}/{total_chunks} (offset {start_sec:.0f}s)")

            result = self.model.transcribe(
                chunk,
                language=language or "zh",
                initial_prompt=initial_prompt or "这是一段普通话录音。请在转写时使用标准的中文标点符号，例如：逗号，句号。",
                beam_size=5
            )

            segments = result.get('segments', [])
            for seg in segments:
                if check_cancel_func: check_cancel_func()
                global_idx += 1
                start = format_timestamp(seg['start'] + start_sec)
                end = format_timestamp(seg['end'] + start_sec)
                text = self._post_process_text(seg['text'].strip())
                srt_content += f"{global_idx}\n{start} --> {end}\n{text}\n\n"

            # Free VRAM between chunks
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

        return srt_content

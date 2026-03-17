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

    def predict(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None):
        logger.info(f"📂 [Whisper] Processing: {audio_path}")
        
        if check_cancel_func: check_cancel_func()
        audio_data = self.load_audio(audio_path)
        
        if check_cancel_func: check_cancel_func()
        
        result = self.model.transcribe(
            audio_data, 
            language=language or "zh",
            initial_prompt=initial_prompt or "这是一段普通话录音。请在转写时使用标准的中文标点符号，例如：逗号，句号。",
            beam_size=5
        )
        
        text = result["text"]
        
        if check_cancel_func: check_cancel_func()

        # Post-processing
        if re.search(r'[\u4e00-\u9fff]', text):
            text = text.replace(",", "，").replace("?", "？").replace("!", "！")
            text = re.sub(r'(?<=[\u4e00-\u9fff])\.', '。', text)
            text = re.sub(r'\.(?=\s|$)', '。', text)
            
        return text

    def generate_srt(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None) -> str:
        logger.info(f"📂 [Whisper] Generating SRT: {audio_path}")
        
        if check_cancel_func: check_cancel_func()
        audio_data = self.load_audio(audio_path)
        
        if check_cancel_func: check_cancel_func()
        
        result = self.model.transcribe(
            audio_data, 
            language=language or "zh",
            initial_prompt=initial_prompt or "这是一段普通话录音。请在转写时使用标准的中文标点符号，例如：逗号，句号。",
            beam_size=5
        )
        
        srt_content = ""
        segments = result.get('segments', [])
        
        for i, seg in enumerate(segments):
            if check_cancel_func: check_cancel_func()
            start = format_timestamp(seg['start'])
            end = format_timestamp(seg['end'])
            text = seg['text'].strip()
            
            if re.search(r'[\u4e00-\u9fff]', text):
                text = text.replace(",", "，").replace("?", "？").replace("!", "！")
                text = re.sub(r'(?<=[\u4e00-\u9fff])\.', '。', text)
                text = re.sub(r'\.(?=\s|$)', '。', text)
                
            srt_content += f"{i+1}\n{start} --> {end}\n{text}\n\n"
            
        return srt_content

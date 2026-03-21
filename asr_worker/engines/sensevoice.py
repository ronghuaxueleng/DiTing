import logging
import os
import re
from .base import ASREngine, format_timestamp

logger = logging.getLogger("ASR Worker")

class SenseVoiceEngine(ASREngine):
    def __init__(self, model_id=None, device=None, cache_dir=None):
        from config import get_config, get_engine_config
        cfg = get_config()
        ecfg = get_engine_config("sensevoice")

        device = device or cfg.get("device", "cuda:0")
        model_id = model_id or ecfg.get("model_id", "iic/SenseVoiceSmall")
        vad_model = ecfg.get("vad_model", "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch")
        vad_max_seg = ecfg.get("vad_max_segment_time", 30000)
        cache_dir = cache_dir or ecfg.get("cache_dir") or os.getenv("MODELSCOPE_CACHE")

        logger.info(f"🚀 Loading SenseVoice model: {model_id} (device={device}, cache={cache_dir})")
        try:
            from funasr import AutoModel
        except ImportError:
            raise ImportError("SenseVoice dependency 'funasr' not installed. Please install 'funasr modelscope'.")

        self.model = AutoModel(
            model=model_id,
            vad_model=vad_model,
            vad_kwargs={"max_single_segment_time": vad_max_seg},
            device=device,
            trust_remote_code=True,
            disable_update=True,
        )
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

    def clean_text(self, text: str) -> str:
        # 1. Keep SenseVoice tags (<|HAPPY|>, <|zh|>, etc.) but remove sound events
        text = re.sub(r'<\|(BGM|Speech|Applause|Laughter|Cry|Music|Bird|Bell)\|>', '', text, flags=re.IGNORECASE)

        # 2. Remove emojis
        text = re.sub(r'[\U00010000-\U0010ffff]', '', text)

        # 3. Remove square brackets
        text = re.sub(r'\[.*?\]', '', text)

        return text.strip()

    def predict(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None):
        logger.info(f"📂 [SenseVoice] Processing: {audio_path}")

        if check_cancel_func: check_cancel_func()

        audio_data = self.load_audio(audio_path)

        if len(audio_data) < 1600: # Less than 0.1s
             logger.warning(f"⚠️ Audio too short: {audio_path}")
             return ""

        chunks = self.chunk_audio(audio_data)
        total_chunks = len(chunks)
        logger.info(f"🔪 [SenseVoice] Split into {total_chunks} chunk(s), total {len(audio_data)/16000:.1f}s")

        full_text = ""
        for idx, (start_sec, chunk) in enumerate(chunks):
            if check_cancel_func: check_cancel_func()
            logger.info(f"🔄 [SenseVoice] Processing chunk {idx+1}/{total_chunks} (offset {start_sec:.0f}s, {len(chunk)/16000:.1f}s)")

            res = self.model.generate(
                input=chunk,
                cache={},
                language=language,
                use_itn=True,
                batch_size_s=60,
                merge_vad=True,
                merge_length_s=15,
            )
            for item in res:
                full_text += self.clean_text(item.get('text', ''))

        return full_text

    def generate_srt(self, audio_path: str, language: str = "zh", initial_prompt: str = None, check_cancel_func=None) -> str:
        logger.info(f"📂 [SenseVoice] Generating SRT: {audio_path}")

        if check_cancel_func: check_cancel_func()
        audio_data = self.load_audio(audio_path)

        chunks = self.chunk_audio(audio_data)
        total_chunks = len(chunks)
        logger.info(f"🔪 [SenseVoice] Split into {total_chunks} chunk(s) for SRT")

        srt_content = ""
        global_idx = 0

        for chunk_idx, (start_sec, chunk) in enumerate(chunks):
            if check_cancel_func: check_cancel_func()
            logger.info(f"🔄 [SenseVoice] SRT chunk {chunk_idx+1}/{total_chunks} (offset {start_sec:.0f}s)")

            res = self.model.generate(
                input=chunk,
                cache={},
                language=language,
                use_itn=True,
                batch_size_s=60,
                merge_vad=True,
                merge_length_s=15,
            )

            for item in res:
                if check_cancel_func: check_cancel_func()
                global_idx += 1
                text = self.clean_text(item.get('text', ''))
                ts_list = item.get('timestamp', [])

                start_ms = ts_list[0][0] if ts_list else 0
                end_ms = ts_list[-1][1] if ts_list else 0

                # Add chunk offset to timestamps
                offset_ms = start_sec * 1000
                start_str = format_timestamp((start_ms + offset_ms) / 1000.0)
                end_str = format_timestamp((end_ms + offset_ms) / 1000.0)

                srt_content += f"{global_idx}\n{start_str} --> {end_str}\n{text}\n\n"

        return srt_content

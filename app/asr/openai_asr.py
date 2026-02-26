"""
Cloud ASR Engine — OpenAI-Compatible API

Supports any provider that implements the OpenAI Audio Transcriptions API:
    POST /v1/audio/transcriptions
    - file: audio file (multipart)
    - model: model name (e.g. "whisper-1")
    - language: ISO-639-1 code
    - response_format: "text", "srt", "vtt", "json", "verbose_json"

Compatible providers: OpenAI, Groq, Deepgram, SiliconFlow, InfiniteAI, etc.

Config (stored in asr_models.config as JSON):
    {
        "api_key": "sk-...",
        "base_url": "https://api.openai.com/v1",
        "model_name": "whisper-1"
    }
"""

import os
import httpx
from typing import Optional

from app.asr.wrapper import ASREngine
from app.core.logger import logger


class OpenAIASREngine(ASREngine):
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1", model_name: str = "whisper-1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name

    def _get_url(self) -> str:
        return f"{self.base_url}/audio/transcriptions"

    def _call_api(self, audio_path: str, language: str = "zh",
                  initial_prompt: Optional[str] = None,
                  response_format: str = "text",
                  check_cancel_func=None) -> str:
        if check_cancel_func:
            check_cancel_func()

        if not self.api_key:
            raise RuntimeError("OpenAI ASR: API key not configured")

        url = self._get_url()
        filename = os.path.basename(audio_path)

        data = {
            "response_format": response_format,
        }
        if self.model_name:
            data["model"] = self.model_name
        if language:
            data["language"] = language
        if initial_prompt:
            data["prompt"] = initial_prompt

        logger.info(f"☁️ [OpenAI ASR] Calling {url} (model={self.model_name or '(default)'}, format={response_format}, file={filename})")

        with httpx.Client(timeout=600.0) as client:
            with open(audio_path, "rb") as f:
                resp = client.post(
                    url,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    files={"file": (filename, f, "application/octet-stream")},
                    data=data,
                )

        if check_cancel_func:
            check_cancel_func()

        if resp.status_code != 200:
            logger.error(f"☁️ [OpenAI ASR] Error {resp.status_code}: {resp.text}")
            raise RuntimeError(f"OpenAI ASR Error {resp.status_code}: {resp.text}")

        # text/srt formats return plain text; json returns object
        if response_format in ("json", "verbose_json"):
            return resp.json().get("text", "")
        return resp.text

    def predict(self, audio_path: str, language: str = "zh",
                initial_prompt: str = None, check_cancel_func=None) -> str:
        return self._call_api(audio_path, language, initial_prompt, "text", check_cancel_func)

    def generate_srt(self, audio_path: str, language: str = "zh",
                     initial_prompt: str = None, check_cancel_func=None) -> str:
        return self._call_api(audio_path, language, initial_prompt, "srt", check_cancel_func)

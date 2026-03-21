"""
Cloud ASR Engine — OpenAI-Compatible API

Supports any provider that implements the OpenAI Audio Transcriptions API:
    POST /v1/audio/transcriptions
    - file: audio file (multipart)
    - model: model name (e.g. "whisper-1")
    - language: ISO-639-1 code
    - response_format: "text", "srt", "vtt", "json", "verbose_json"

Compatible providers: OpenAI, Groq, Deepgram, SiliconFlow, etc.

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

from app.asr.wrapper import ASREngine, format_timestamp
from app.core.logger import logger


class OpenAIASREngine(ASREngine):
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1", model_name: str = "whisper-1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name

    def _get_url(self) -> str:
        return f"{self.base_url}/audio/transcriptions"

    def _request(self, audio_path: str, language: str = "zh",
                 initial_prompt: Optional[str] = None,
                 response_format: str = "text",
                 check_cancel_func=None) -> httpx.Response:
        """Make the HTTP request to the transcription API and return the raw response."""
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

        return resp

    def predict(self, audio_path: str, language: str = "zh",
                initial_prompt: str = None, check_cancel_func=None) -> str:
        resp = self._request(audio_path, language, initial_prompt, "text", check_cancel_func)
        return resp.text

    def generate_srt(self, audio_path: str, language: str = "zh",
                     initial_prompt: str = None, check_cancel_func=None) -> str:
        """Generate SRT by requesting verbose_json and converting segments to SRT format.

        Uses verbose_json instead of srt response_format for broader provider compatibility.
        Providers that don't support verbose_json will fall back to json → single-entry SRT.
        """
        resp = self._request(audio_path, language, initial_prompt, "verbose_json", check_cancel_func)

        try:
            result = resp.json()
        except Exception:
            # Response is not JSON (provider may have returned plain text)
            text = resp.text.strip()
            if text:
                return f"1\n{format_timestamp(0)} --> {format_timestamp(9999)}\n{text}\n"
            return ""

        segments = result.get("segments", [])

        if segments:
            srt_lines = []
            for idx, seg in enumerate(segments, 1):
                start = seg.get("start", 0)
                end = seg.get("end", 0)
                text = seg.get("text", "").strip()
                if text:
                    srt_lines.append(
                        f"{idx}\n{format_timestamp(start)} --> {format_timestamp(end)}\n{text}\n"
                    )
            return "\n".join(srt_lines)

        # No segments — fall back to full text as single-entry SRT
        text = result.get("text", "").strip()
        if text:
            duration = result.get("duration", 9999)
            return f"1\n{format_timestamp(0)} --> {format_timestamp(duration)}\n{text}\n"
        return ""

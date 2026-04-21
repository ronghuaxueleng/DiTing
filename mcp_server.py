#!/usr/bin/env python3
"""
DiTing MCP server (stdio).

This server provides MCP tools that call the existing DiTing REST API using
Python's standard library HTTP client. It is designed to run with the system
Python and does not depend on the repo's uv environment.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from typing import Any, Dict, Optional, Tuple
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

from pydantic import BaseModel, ConfigDict, Field
from mcp.server.fastmcp import FastMCP

API_BASE = os.environ.get("DITING_API_BASE", "http://localhost:5023").rstrip("/")
DEFAULT_TIMEOUT = 30

logger = logging.getLogger("diting_mcp")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


def _create_mcp() -> FastMCP:
    try:
        return FastMCP("diting_mcp", json_response=True)
    except TypeError:
        return FastMCP("diting_mcp")


mcp = _create_mcp()


def _build_url(path: str) -> str:
    return f"{API_BASE}/{path.lstrip('/')}"


def _safe_json(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Tuple[int, Any]:
    url = _build_url(path)
    if params:
        query = urllib_parse.urlencode(params, doseq=True)
        url = f"{url}?{query}"

    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "diting-mcp",
    }
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib_request.Request(url, data=data, method=method, headers=headers)

    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            text = raw.decode("utf-8", errors="replace")
            if "application/json" in content_type.lower():
                parsed = _safe_json(text)
            else:
                parsed = _safe_json(text)
            return resp.status, parsed
    except HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        return e.code, _safe_json(text)
    except URLError as e:
        raise RuntimeError(f"Failed to reach DiTing API at {API_BASE}: {e.reason}") from e


async def api_request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
) -> Tuple[int, Any]:
    return await asyncio.to_thread(_request, method, path, params, json_body)


def _error_from_response(status: int, data: Any) -> str:
    detail = data
    if isinstance(data, dict):
        detail = data.get("detail") or data.get("message") or data.get("error") or data
    return f"HTTP {status}: {detail}"


def _ok(data: Any) -> Dict[str, Any]:
    return {"ok": True, "data": data}


def _err(message: str) -> Dict[str, Any]:
    return {"ok": False, "error": message}


def _normalize_url(url: str) -> str:
    if "://" not in url:
        return f"https://{url}"
    return url


def _strip_subtitle_metadata(text: str) -> str:
    """Remove subtitle timestamps, sequence numbers, and inline markers."""
    lines = text.splitlines()
    result = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if re.fullmatch(r'\d+', s):
            continue
        if re.fullmatch(r'\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}.*', s):
            continue
        if re.fullmatch(r'\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}.*', s):
            continue
        if s.upper().startswith('WEBVTT') or s.upper().startswith('NOTE'):
            continue
        s = re.sub(r'<\|[\d.]+\|>', '', s).strip()
        s = re.sub(r'[\[\(]\d{1,5}:\d{2}(:\d{2})?\s*[\]\)]', '', s).strip()
        if s:
            result.append(s)
    return '\n'.join(result)


def _preprocess_transcript(data: Any) -> Any:
    """Strip subtitle metadata and heavyweight fields from transcript response."""
    if not isinstance(data, dict):
        return data
    for key in ('raw_text', 'text'):
        if key in data and isinstance(data[key], str) and data[key]:
            data[key] = _strip_subtitle_metadata(data[key])
    # Remove fields the AI doesn't need to save tokens
    for key in ('media_path', 'cache_versions', 'embed_url',
                'stream_url', 'stream_expired', 'cache_expires_at',
                'cache_policy', 'effective_expires_at'):
        data.pop(key, None)
    return data


def _compact_summaries(summaries: list) -> list:
    """Return summaries with metadata only (no full text) to save tokens."""
    return [
        {k: s[k] for k in ("id", "model", "timestamp", "prompt", "parent_id") if k in s}
        for s in summaries
    ]


def _detect_platform(url: str) -> str:
    parsed = urllib_parse.urlparse(url)
    host = (parsed.netloc or "").lower()
    if "bilibili.com" in host or "b23.tv" in host:
        return "bilibili"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    if "douyin.com" in host or "v.douyin.com" in host or "iesdouyin.com" in host:
        return "douyin"
    return "network"


def _encode_path_segment(value: str) -> str:
    return urllib_parse.quote(value, safe="")


class CreateSourceFromUrlInput(BaseModel):
    """Input for creating a source record from a URL."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    url: str = Field(..., description="Video URL (Bilibili/YouTube/Douyin/other)", min_length=1)
    task_type: Optional[str] = Field(None, description="Task type (e.g., transcribe, subtitle, cache_only)")
    language: Optional[str] = Field(None, description="Target language code (zh, en, ja, ko)")
    quality: Optional[str] = Field(None, description="Download quality (best, medium, worst, audio)")
    prompt: Optional[str] = Field(None, description="Custom prompt for transcription")

    output_format: Optional[str] = Field(None, description="Output format: text, srt, srt_char")
    direct_url: Optional[str] = Field(None, description="Direct stream URL (Douyin only)")
    bookmark_only: bool = Field(True, description="Save metadata only, do not trigger transcription")


class RetranscribeInput(BaseModel):
    """Input for re-transcribing an existing source."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    source_id: str = Field(..., description="Source ID of the video to re-transcribe", min_length=1)
    language: Optional[str] = Field(None, description="Target language code")
    prompt: Optional[str] = Field(None, description="Custom prompt for transcription")

    output_format: Optional[str] = Field(None, description="Output format: text, srt, srt_char")
    only_get_subtitles: Optional[bool] = Field(None, description="Fail if subtitles are not available")
    force_transcription: Optional[bool] = Field(None, description="Ignore subtitles and force ASR")


class TaskStatusInput(BaseModel):
    """Input for checking task status."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    task_id: Optional[int] = Field(None, description="Task ID to filter")


class TranscriptInput(BaseModel):
    """Input for fetching a transcript by source ID."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    source_id: str = Field(..., description="Video source_id", min_length=1)


class SummariesInput(BaseModel):
    """Input for fetching AI summaries."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    source_id: str = Field(..., description="Video source_id", min_length=1)
    transcription_id: Optional[int] = Field(None, description="Specific segment/transcription ID. Omit to get the latest segment's summaries.")


class SearchInput(BaseModel):
    """Input for transcript search."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    q: str = Field(..., description="Search query — matches transcript text, video title, source_id, or original URL", min_length=1)
    limit: Optional[int] = Field(50, description="Max results (1-200)", ge=1, le=200)


class ListVideosInput(BaseModel):
    """Input for listing videos (recent by default)."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    page: Optional[int] = Field(1, description="Page number", ge=1)
    limit: Optional[int] = Field(20, description="Page size", ge=1, le=200)
    source_type: Optional[str] = Field(None, description="Source platform filter")
    status: Optional[str] = Field(None, description="Status filter")
    tag_id: Optional[int] = Field(None, description="Include tag ID")
    exclude_tag_id: Optional[int] = Field(None, description="Exclude tag ID")
    sort_by: Optional[str] = Field("time", description="Sort field (default: time)")
    has_segments: Optional[bool] = Field(None, description="Has transcript segments")
    has_ai: Optional[bool] = Field(None, description="Has AI summary")
    has_cached: Optional[bool] = Field(None, description="Has cached media")
    is_subtitle: Optional[bool] = Field(None, description="Is subtitle-only")
    include_archived: Optional[str] = Field(None, description="Include archived (server-specific)")
    search: Optional[str] = Field(None, description="Search text")


class AnalyzeInput(BaseModel):
    """Input for AI analysis (prompted summary)."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    transcription_id: Optional[int] = Field(None, description="Transcription ID (segment id)")
    source_id: Optional[str] = Field(None, description="Source ID (video/source_id)")
    prompt: Optional[str] = Field(None, description="Prompt content to use for analysis")
    prompt_id: Optional[int] = Field(None, description="Prompt ID (for usage tracking)")
    llm_model_id: Optional[int] = Field(None, description="LLM model ID; omit to use active default model")
    confirm_default: Optional[bool] = Field(None, description="Confirm using default LLM when llm_model_id is omitted")
    overwrite: Optional[bool] = Field(None, description="Overwrite existing summaries")
    overwrite_id: Optional[int] = Field(None, description="Overwrite a specific summary ID")
    parent_id: Optional[int] = Field(None, description="Parent summary ID (refine)")
    input_text: Optional[str] = Field(None, description="Custom input text to analyze")
    strip_subtitle: Optional[bool] = Field(None, description="Strip subtitle metadata before analysis")


@mcp.tool(
    name="diting_health",
    annotations={
        "title": "DiTing Health Check",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_health() -> Dict[str, Any]:
    """
    Check DiTing system version and ASR engine status.

    Returns:
        dict: {"ok": true, "data": {"version": ..., "asr": ...}} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        version_status, version_data = await api_request("GET", "/api/system/version")
        if version_status < 200 or version_status >= 300:
            return _err(_error_from_response(version_status, version_data))

        asr_status, asr_data = await api_request(
            "GET",
            "/api/asr/status",
            params={"refresh": "true"},
        )
        if asr_status < 200 or asr_status >= 300:
            return _err(_error_from_response(asr_status, asr_data))

        return _ok({"version": version_data, "asr": asr_data, "api_base": API_BASE})
    except Exception as e:
        logger.error(f"diting_health failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_create_source_from_url",
    annotations={
        "title": "Create Source From URL",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def diting_create_source_from_url(params: CreateSourceFromUrlInput) -> Dict[str, Any]:
    """
    Create a source record from a URL and optionally start transcription.

    This tool detects the platform from the URL and routes to the correct
    DiTing API endpoint. It defaults to bookmark_only=True to avoid automatic
    transcription.

    This tool does NOT trigger AI analysis. If the user wants AI analysis
    after transcription completes, ask them separately.

    Args:
        params (CreateSourceFromUrlInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <api_response>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        normalized_url = _normalize_url(params.url)
        platform = _detect_platform(normalized_url)
        payload = params.model_dump(exclude_none=True)
        payload["url"] = normalized_url
        direct_url = payload.pop("direct_url", None)

        if platform == "bilibili":
            endpoint = "/api/transcribe/bilibili"
        elif platform == "youtube":
            endpoint = "/api/transcribe/youtube"
        elif platform == "douyin":
            endpoint = "/api/transcribe/douyin"
            if direct_url is not None:
                payload["direct_url"] = direct_url
        else:
            endpoint = "/api/transcribe/network"

        status, data = await api_request("POST", endpoint, json_body=payload)
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_create_source_from_url failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_start_transcription",
    annotations={
        "title": "Start Transcription",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def diting_start_transcription(params: RetranscribeInput) -> Dict[str, Any]:
    """
    Re-transcribe an existing source by source_id.

    This tool does NOT trigger AI analysis. If the user wants AI analysis
    after transcription completes, ask them separately.

    Args:
        params (RetranscribeInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <api_response>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        payload = params.model_dump(exclude_none=True)
        status, data = await api_request("POST", "/api/transcribe/retranscribe", json_body=payload)
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_start_transcription failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_get_task_status",
    annotations={
        "title": "Get Task Status",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_get_task_status(params: TaskStatusInput) -> Dict[str, Any]:
    """
    Get task status by task_id, or return all tasks.

    Args:
        params (TaskStatusInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <task or task map>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        status, data = await api_request("GET", "/api/tasks")
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        if params.task_id is None:
            return _ok(data)
        key = str(params.task_id)
        if isinstance(data, dict) and key in data:
            return _ok(data[key])
        return _err(f"Task {params.task_id} not found")
    except Exception as e:
        logger.error(f"diting_get_task_status failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_get_transcript",
    annotations={
        "title": "Get Transcript",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_get_transcript(params: TranscriptInput) -> Dict[str, Any]:
    """
    Fetch full transcript details for a specific source_id.

    The response includes the latest transcript text (preprocessed to save
    tokens) plus a compact "segments" overview listing ALL historical
    transcription segments with their IDs, timestamps, ASR model, and
    whether they have AI summaries. Use a segment's transcription_id with
    diting_get_summaries or diting_start_ai_analysis to target it.

    When the user asks to summarize/analyze a transcript, briefly offer two
    approaches before fetching:
      1) You summarize directly (fetch transcript here, output in conversation)
      2) DiTing's built-in LLM (results saved to the system)
    Proceed once the user picks one. No further confirmation needed.

    Args:
        params (TranscriptInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": {<video detail>, "segments": [...]}} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        source_id = _encode_path_segment(params.source_id)
        status, data = await api_request("GET", f"/api/videos/{source_id}")
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))

        result = _preprocess_transcript(data)

        # Fetch segments overview
        seg_status, seg_data = await api_request(
            "GET", "/api/videos/segments",
            params={"source_id": params.source_id},
        )
        if seg_status >= 200 and seg_status < 300 and isinstance(seg_data, list):
            result["segments"] = [
                {
                    "id": s.get("id"),
                    "timestamp": s.get("timestamp"),
                    "asr_model": s.get("asr_model"),
                    "is_subtitle": s.get("is_subtitle"),
                    "status": s.get("status"),
                    "has_ai": s.get("has_ai", False),
                    "summary_count": len(s.get("summaries", [])),
                    "preview": _strip_subtitle_metadata(
                        (s.get("raw_text") or "")[:80]
                    ),
                }
                for s in seg_data
            ]

        return _ok(result)
    except Exception as e:
        logger.error(f"diting_get_transcript failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_get_summaries",
    annotations={
        "title": "Get AI Summaries",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_get_summaries(params: SummariesInput) -> Dict[str, Any]:
    """
    Fetch existing AI summaries for a source_id without the full transcript.

    Returns the latest summary as `ai_summary` (full text) and a compact
    `summaries` list (metadata only: id, model, timestamp, prompt — no full
    text) to save tokens. By default returns the latest segment's summaries.
    Pass transcription_id to target a specific segment.

    Args:
        params (SummariesInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": {"source_id": ..., "transcription_id": ...,
               "ai_summary": "...", "summaries": [{id, model, ...}, ...]}}
              {"ok": false, "error": "..."} on failure.
    """
    try:
        if params.transcription_id is not None:
            # Direct fetch: single segment by ID (1 request)
            status, data = await api_request(
                "GET", f"/api/segments/{params.transcription_id}"
            )
            if status < 200 or status >= 300:
                return _err(_error_from_response(status, data))
            if not isinstance(data, dict):
                return _err("Unexpected response format")

            summaries_list = data.get("summaries", [])
            return _ok({
                "source_id": params.source_id,
                "transcription_id": params.transcription_id,
                "ai_summary": summaries_list[0]["summary"] if summaries_list else None,
                "summaries": _compact_summaries(summaries_list),
                "ai_status": data.get("ai_status"),
            })
        else:
            # Default: latest segment's summaries from video detail
            source_id = _encode_path_segment(params.source_id)
            status, data = await api_request("GET", f"/api/videos/{source_id}")
            if status < 200 or status >= 300:
                return _err(_error_from_response(status, data))
            if not isinstance(data, dict):
                return _err("Unexpected response format")

            summaries_list = data.get("summaries", [])
            return _ok({
                "source_id": data.get("source_id"),
                "title": data.get("title"),
                "transcription_id": data.get("id"),
                "ai_summary": summaries_list[0]["summary"] if summaries_list else None,
                "summaries": _compact_summaries(summaries_list),
                "ai_status": data.get("ai_status"),
            })
    except Exception as e:
        logger.error(f"diting_get_summaries failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_search_transcripts",
    annotations={
        "title": "Search Transcripts",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_search_transcripts(params: SearchInput) -> Dict[str, Any]:
    """
    Search across all transcripts using the server's full-text search.

    Args:
        params (SearchInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <search result>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        status, data = await api_request("GET", "/api/search", params={"q": params.q, "limit": params.limit})
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_search_transcripts failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_list_recent_transcriptions",
    annotations={
        "title": "List Recent Transcriptions",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_list_recent_transcriptions(params: ListVideosInput) -> Dict[str, Any]:
    """
    List recent transcriptions (paginated), with optional filters.

    Args:
        params (ListVideosInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <video list>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        query = params.model_dump(exclude_none=True)
        status, data = await api_request("GET", "/api/videos", params=query)
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_list_recent_transcriptions failed: {e}")
        return _err(str(e))




@mcp.tool(
    name="diting_get_ai_analysis_options",
    annotations={
        "title": "Get AI Analysis Options",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def diting_get_ai_analysis_options() -> Dict[str, Any]:
    """
    Fetch available prompts and LLM models for DiTing's built-in AI analysis.

    Use when the user chooses DiTing's built-in LLM for analysis. You should
    automatically pick the most suitable prompt based on the user's request
    (e.g. summary → "摘要" category, refinement → "二级提炼" category) and
    use the default active model. Only present the full list if the user
    explicitly asks to customize.

    Returns:
        dict: {"ok": true, "data": {"prompts": ..., "llm_providers": ..., "default_llm_model": ...}}
              {"ok": false, "error": "..."} on failure.
    """
    try:
        prompts_status, prompts = await api_request("GET", "/api/settings/prompts")
        if prompts_status < 200 or prompts_status >= 300:
            return _err(_error_from_response(prompts_status, prompts))

        models_status, providers = await api_request("GET", "/api/settings/llm/providers")
        if models_status < 200 or models_status >= 300:
            return _err(_error_from_response(models_status, providers))

        default_model = None
        if isinstance(providers, list):
            for provider in providers:
                for model in provider.get("models", []) or []:
                    if model.get("is_active"):
                        default_model = {
                            "provider_id": provider.get("id"),
                            "provider_name": provider.get("name"),
                            "model_id": model.get("id"),
                            "model_name": model.get("model_name"),
                        }
                        break
                if default_model:
                    break

        return _ok({
            "prompts": prompts,
            "llm_providers": providers,
            "default_llm_model": default_model,
        })
    except Exception as e:
        logger.error(f"diting_get_ai_analysis_options failed: {e}")
        return _err(str(e))


@mcp.tool(
    name="diting_start_ai_analysis",
    annotations={
        "title": "Start AI Analysis",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def diting_start_ai_analysis(params: AnalyzeInput) -> Dict[str, Any]:
    """
    Start AI analysis for a transcription using DiTing's built-in LLM.

    When the user wants AI analysis, briefly offer two approaches:
      1) You summarize directly — use diting_get_transcript instead.
      2) DiTing's built-in LLM — call diting_get_ai_analysis_options, auto-pick
         the best-matching prompt + default model, briefly tell the user your
         choice (e.g. "使用「📝 会议纪要」prompt + 默认模型"), then call this tool.
    One confirmation is enough. Do not ask the user to browse prompt/model lists
    unless they explicitly request customization.

    Args:
        params (AnalyzeInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": <analysis task>} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        payload = params.model_dump(exclude_none=True)
        prompt = payload.get("prompt")
        prompt_id = payload.get("prompt_id")

        if not prompt:
            if not prompt_id:
                return _err("prompt or prompt_id is required")
            status, prompts = await api_request("GET", "/api/settings/prompts")
            if status < 200 or status >= 300:
                return _err(_error_from_response(status, prompts))
            if isinstance(prompts, list):
                matched = next((p for p in prompts if p.get("id") == prompt_id), None)
            else:
                matched = None
            if not matched:
                return _err(f"Prompt {prompt_id} not found")
            prompt = matched.get("content")
            if not prompt:
                return _err(f"Prompt {prompt_id} has empty content")
            payload["prompt"] = prompt

        if payload.get("llm_model_id") is None:
            if not payload.get("confirm_default"):
                return _err("llm_model_id is required unless confirm_default=true")

        status, data = await api_request("POST", "/api/analyze", json_body=payload)
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_start_ai_analysis failed: {e}")
        return _err(str(e))


class SaveSummaryInput(BaseModel):
    """Input for saving an AI summary."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    transcription_id: int = Field(..., description="Transcription/segment ID to attach the summary to")
    source_id: Optional[str] = Field(None, description="Source ID (for context only, not required by the API)")
    summary: str = Field(..., description="The summary text to save", min_length=1)
    prompt: Optional[str] = Field(None, description="The prompt used to generate this summary")
    model: Optional[str] = Field(None, description="Model name to display (e.g. 'claude-sonnet-4-20250514'). Defaults to your model name.")
    parent_id: Optional[int] = Field(None, description="Parent summary ID for refinement chains")


@mcp.tool(
    name="diting_save_summary",
    annotations={
        "title": "Save AI Summary",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": False,
    },
)
async def diting_save_summary(params: SaveSummaryInput) -> Dict[str, Any]:
    """
    Save your AI summary to the DiTing database.

    Use this after you've summarized a transcript yourself (approach 1 from
    diting_get_transcript). The summary will be stored with your model name
    and displayed in the UI alongside DiTing's built-in LLM summaries.

    Args:
        params (SaveSummaryInput): Validated input parameters.

    Returns:
        dict: {"ok": true, "data": {"status": "success"}} on success,
              {"ok": false, "error": "..."} on failure.
    """
    try:
        payload = {
            "transcription_id": params.transcription_id,
            "summary": params.summary,
            "prompt": params.prompt or "MCP Summary",
            "model": params.model or "MCP Agent",
        }
        if params.parent_id is not None:
            payload["parent_id"] = params.parent_id

        status, data = await api_request("POST", "/api/summaries/manual", json_body=payload)
        if status < 200 or status >= 300:
            return _err(_error_from_response(status, data))
        return _ok(data)
    except Exception as e:
        logger.error(f"diting_save_summary failed: {e}")
        return _err(str(e))

if __name__ == "__main__":
    mcp.run()

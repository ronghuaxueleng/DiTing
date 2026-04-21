// ==UserScript==
// @name         DiTing Integration
// @namespace    http://tampermonkey.net/
// @version      0.12.1
// @description  Add a transcription button to media videos to invoke local DiTing server.
// @author       [Yamico (Lix)](https://github.com/Yamico)
// @match        https://www.bilibili.com/video/*
// @match        https://www.douyin.com/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @icon         https://simpleicons.org/icons/javascript.svg
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Trusted Types Policy (YouTube CSP Bypass) ---
    // YouTube enforces Trusted Types which blocks innerHTML assignments.
    // Create a default policy to allow our script's HTML injection to work.
    if (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
        try {
            trustedTypes.createPolicy('default', {
                createHTML: (string) => string,
                createScriptURL: (string) => string,
                createScript: (string) => string,
            });
        } catch (e) {
            // Policy 'default' may already exist — that's fine
            console.log('[DiTing] Trusted Types policy already exists or failed:', e.message);
        }
    }

    // --- Configuration ---
    const SCRIPT_VERSION = "0.12.1";
    const BASE_URL = "http://127.0.0.1:5023";
    // API routes are now strictly typed on backend
    const API_ANALYZE = `${BASE_URL}/api/analyze`;
    const API_HISTORY = `${BASE_URL}/api/videos/segments`; // List segments (by video)
    const API_SEGMENT = `${BASE_URL}/api/segments`;       // Single segment (by ID)
    const API_TRANSCRIBE_YOUTUBE = `${BASE_URL}/api/transcribe/youtube`;
    const API_TRANSCRIBE_DOUYIN = `${BASE_URL}/api/transcribe/douyin`;
    const API_TRANSCRIBE_BILIBILI = `${BASE_URL}/api/transcribe/bilibili`;

    // --- Defaults ---
    const defaultPrompts = [
        {
            name: "💬 对话复盘",
            content: "【场景：对话分析】这是一段多人对话。请你：1. 识别不同发言者的意图；2. 整理对话的逻辑链路；3. 总结双方达成的共识与遗留的分歧；4. 过滤掉无效的寒暄。",
            isDefault: false
        },
        {
            name: "📌 会议纪要",
            content: "【场景：会议纪要】请根据这段对话/发言，整理出：会议主题、核心议程、决议事项、以及具体的待办清单（Action Items），使用清晰的 Markdown 表格或列表展示。",
            isDefault: false
        },
        {
            name: "😊 自媒体/口播",
            content: "【场景：文案润色】请将这段口语稿转化为适合书面阅读的文章。要求：保留作者的语气风格，去除冗余废话，并在关键观点处加粗，使其更具传播力。",
            isDefault: false
        },
        {
            name: "📝 学术/技术讲座",
            content: "【场景：知识提取】重点识别并保护专业术语。请将内容整理为逻辑严密的笔记，包含：核心定义、原理描述、以及案例分析。若有公式或代码描述，请精准还原。",
            isDefault: false
        },
        {
            name: "🎤 逐字还原 (保留口癖)",
            content: "【场景：语言学/心理分析】请注意：这是一个特殊的逐字还原任务。请**严禁**剔除任何语气助词（如：呃、啊、那个、就是、然后等）。你需要完整保留说话人的所有口癖和犹豫感，仅对明显的同音错别字进行修正，并补充基础标点。",
            isDefault: false
        },
        {
            name: "✍️ 通用处理",
            content: "【场景：通用优化】修正错别字，优化标点，在不改变原意的前提下，将口语转化为流畅的规范书面语。",
            isDefault: true
        }
    ];

    // --- Icons (SVG) ---
    const ICONS = {
        settings: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
        music: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
        pin: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>',
        grid: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
        moon: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
        sun: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
        minus: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        close: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        fileText: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
        bot: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>',
        save: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
        star: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        trash: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        clock: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        film: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>',
        mic: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
        refresh: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        list: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
        keyboard: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><line x1="6" y1="8" x2="6" y2="8"></line><line x1="10" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="14" y2="8"></line><line x1="18" y1="8" x2="18" y2="8"></line><line x1="6" y1="12" x2="6" y2="12"></line><line x1="10" y1="12" x2="10" y2="12"></line><line x1="14" y1="12" x2="14" y2="12"></line><line x1="18" y1="12" x2="18" y2="12"></line><line x1="6" y1="16" x2="18" y2="16"></line></svg>',
        zap: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        check: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        alert: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
        minimize: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        monitor: '<svg class="sv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
    };

    // --- State & Migration ---
    let currentSourceID = null;
    let totalDuration = 0;
    let currentHistory = [];
    let savedTheme = GM_getValue('sv_theme', 'auto');

    // Check version to force update prompts
    let storedVersion = GM_getValue('sv_version', '0');
    let promptLibrary;

    if (storedVersion !== SCRIPT_VERSION) {
        console.log(`[SenseVoice] Upgrading from ${storedVersion} to ${SCRIPT_VERSION}. resetting prompts.`);
        promptLibrary = defaultPrompts;
        GM_setValue('sv_prompts', promptLibrary);
        GM_setValue('sv_version', SCRIPT_VERSION);
    } else {
        promptLibrary = GM_getValue('sv_prompts', defaultPrompts);
    }

    // --- Styles ---
    GM_addStyle(`
        #sensevoice-btn {
            background-color: #38bdf8;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            margin-right: 15px;
            font-size: 14px;
            transition: background 0.3s;
            display: inline-flex;
            align-items: center;
        }
        #sensevoice-btn:hover { background-color: #0ea5e9; }

        #sensevoice-modal {
            --sv-bg: rgba(15, 23, 42, 0.95);
            --sv-text: #f1f5f9;
            --sv-text-dim: #94a3b8;
            --sv-border: rgba(255,255,255,0.1);
            --sv-header-bg: rgba(30, 41, 59, 0.8);
            --sv-input-bg: #1e293b;
            --sv-input-border: rgba(255,255,255,0.1);
            --sv-ai-bg: rgba(0,0,0,0.2);
            --sv-highlight: #38bdf8;
            --sv-ai-text: #d1fae5;
            --sv-accordion-header: rgba(51, 65, 85, 0.5);
        }

        #sensevoice-modal[data-theme="light"] {
            --sv-bg: rgba(255, 255, 255, 0.98);
            --sv-text: #0f172a;
            --sv-text-dim: #64748b;
            --sv-border: rgba(0,0,0,0.1);
            --sv-header-bg: rgba(241, 245, 249, 0.8);
            --sv-input-bg: #f8fafc;
            --sv-input-border: rgba(0,0,0,0.1);
            --sv-ai-bg: rgba(0,0,0,0.02);
            --sv-highlight: #0ea5e9;
            --sv-ai-text: #065f46;
            --sv-accordion-header: rgba(226, 232, 240, 0.8);
        }

        #sensevoice-modal {
            position: fixed;
            top: 60px;
            right: 20px;
            width: 480px;
            height: 600px;
            min-width: 350px;
            min-height: 200px;
            background: var(--sv-bg);
            backdrop-filter: blur(12px);
            color: var(--sv-text);
            z-index: 99999;
            border-radius: 12px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            border: 1px solid var(--sv-border);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            transition: opacity 0.3s, transform 0.3s;
            opacity: 0;
            pointer-events: none;
            resize: none; /* Custom Resize */
            overflow: hidden; /* For container */
        }
        /* Embedded Mode Override */
        #sensevoice-modal.embedded {
            position: relative !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important; /* Force width to fill container */
            /* height: auto !important;  <-- REMOVED to allow JS control */
            transform: none !important;
            border-radius: 0 !important;
            border: none !important;
            box-shadow: none !important;
            /* opacity: 1 !important; Remove forced opacity to respect .show toggle */
            z-index: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            pointer-events: all !important; /* Context: Fix "Unclickable" bug */
        }
        #sensevoice-modal.embedded:not(.show) {
            display: none !important; /* Remove from flow when closed */
        }
        #sensevoice-modal.embedded .sv-resizer { display: none; }

        #sensevoice-modal.minimized { height: 48px !important; min-height: 0 !important; width: 250px !important; resize: none; overflow: hidden; }

        /* Force full width when embedded and minimized */
        #sensevoice-modal.embedded.minimized {
            width: 100% !important;
            height: 48px !important;
        }

        #sensevoice-modal.minimized .sv-main-scroll,
        #sensevoice-modal.minimized .sv-nav-box { display: none !important; }

        /* Resize Handles */
        .sv-resizer { position: absolute; z-index: 100; }
        .sv-resizer-t { top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; }
        .sv-resizer-r { top: 0; right: 0; bottom: 0; width: 6px; cursor: ew-resize; }
        .sv-resizer-b { bottom: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; }
        .sv-resizer-l { top: 0; left: 0; bottom: 0; width: 6px; cursor: ew-resize; }
        .sv-resizer-tl { top: 0; left: 0; width: 10px; height: 10px; cursor: nwse-resize; z-index: 101; }
        .sv-resizer-tr { top: 0; right: 0; width: 10px; height: 10px; cursor: nesw-resize; z-index: 101; }
        .sv-resizer-bl { bottom: 0; left: 0; width: 10px; height: 10px; cursor: nesw-resize; z-index: 101; }
        .sv-resizer-br { bottom: 0; right: 0; width: 10px; height: 10px; cursor: nwse-resize; z-index: 101; }
        #sensevoice-modal.show { opacity: 1; pointer-events: all; transform: translateY(0); }
        /* Removed duplicate minimized rule */

        .sv-header {
            padding: 12px 16px;
            background: var(--sv-header-bg);
            border-bottom: 1px solid var(--sv-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
            flex-shrink: 0;
        }
        .sv-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--sv-highlight); display:flex; align-items:center; gap:8px;}
        .sv-controls { display: flex; gap: 8px; align-items: center; }

        /* Site Indicator */
        .sv-site-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255,255,255,0.1);
            color: var(--sv-text-dim);
            text-transform: uppercase;
        }

        .sv-btn-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--sv-text-dim); border-radius: 6px; transition: background 0.2s, color 0.2s; }
        .sv-btn-icon:hover { background: rgba(127, 127, 127, 0.1); color: var(--sv-text); }

        .sv-main-scroll {
            flex-grow: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }

        /* Forms & Inputs */
        /* Explicitly fix dark mode select/option styling */
        select, option {
            background-color: var(--sv-input-bg) !important;
            color: var(--sv-text) !important;
            border: 1px solid var(--sv-input-border);
            outline: none;
        }

        .sv-nav-box { padding: 10px 15px; border-top: 1px solid var(--sv-border); flex-shrink: 0; }
        .sv-history-select {
            width: 100%;
            padding: 6px;
            border-radius: 6px;
            margin-top: 8px;
            font-size: 12px;
        }

        /* Accordion Style */
        .sv-accordion { border-bottom: 1px solid var(--sv-border); }
        .sv-accordion-header {
            position: sticky;
            top: 0;
            z-index: 10;
            padding: 10px 15px;
            background: var(--sv-accordion-header);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            font-size: 13px;
            user-select: none;
            backdrop-filter: blur(4px); /* Optional: adds nice effect if transparent */
        }
        .sv-accordion-header:hover { opacity: 0.9; }
        .sv-accordion-content { padding: 15px; display: block; overflow-y: auto; }
        .sv-accordion.collapsed .sv-accordion-content { display: none; }
        .sv-accordion-toggle::after { content: "▼"; font-size: 10px; transition: transform 0.2s; }
        .sv-accordion.collapsed .sv-accordion-toggle::after { transform: rotate(-90deg); }

        /* Prompt Library UI */
        .sv-prompt-toolbar {
            display: flex;
            gap: 4px;
            margin-bottom: 8px;
            align-items: center;
        }
        .sv-prompt-select { flex-grow: 1; font-size: 11px; padding: 4px !important; border-radius: 4px; }
        .sv-tool-btn {
            background: var(--sv-input-bg);
            border: 1px solid var(--sv-input-border);
            color: var(--sv-text-dim);
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.2s;
        }
        .sv-tool-btn:hover { color: var(--sv-text); background: rgba(127,127,127,0.1); }
        .sv-tool-btn.active { color: #fcd34d; border-color: #fcd34d; }

        .sv-transcription-text { line-height: 1.6; font-size: 14px; white-space: pre-wrap; }
        .sv-ai-result-box {
            background: var(--sv-ai-bg);
            padding: 12px;
            border-radius: 8px;
            border-left: 4px solid #10b981;
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
            color: var(--sv-ai-text);
        }

        .sv-textarea {
            width: 100%;
            background: var(--sv-input-bg);
            border: 1px solid var(--sv-input-border);
            color: var(--sv-text);
            padding: 8px;
            border-radius: 6px;
            margin-bottom: 8px;
            box-sizing: border-box;
            resize: vertical;
            min-height: 50px;
            font-size: 12px;
        }
        .sv-action-btn { background: #38bdf8; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: filter 0.2s; }
        .sv-action-btn:hover { filter: brightness(1.1); }
        .sv-action-btn.ai { background: #10b981; }

        .text-happy { color: #fcd34d; } .text-sad { color: #818cf8; } .text-angry { color: #ef4444; } .text-neutral { color: var(--sv-text-dim); }
        .tag-event { color: #10b981; font-size: 1.1em; margin: 0 2px; }
        .sv-loading { text-align: center; color: var(--sv-text-dim); padding: 10px; }
        .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; border-top-color: var(--sv-highlight); animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.2); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.4); }
        .sv-ai-card {
            background: var(--sv-ai-bg);
            border: 1px solid var(--sv-border);
            border-radius: 8px;
            margin-bottom: 12px;
            padding: 12px;
            font-size: 13px;
        }
        .sv-ai-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 11px;
            color: var(--sv-text-dim);
        }
        .sv-ai-body {
            line-height: 1.6;
            margin-bottom: 10px;
        }
        .sv-ai-footer {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .sv-ai-action {
            font-size: 11px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            color: var(--sv-text-dim);
            border: 1px solid transparent;
        }
        .sv-ai-action:hover {
            background: rgba(255,255,255,0.05);
            border-color: var(--sv-border);
            color: var(--sv-text);
        }
        .sv-ai-thread {
            margin-left: 20px;
            border-left: 2px solid var(--sv-border);
            padding-left: 12px;
            margin-top: 10px;
        }
        .sv-refine-box {
            margin-top: 8px;
            display: none;
        }
        .sv-refine-textarea {
            width: 100%;
            background: var(--sv-header-bg);
            border: 1px solid var(--sv-border);
            color: var(--sv-text);
            font-size: 12px;
            padding: 6px;
            border-radius: 4px;
            min-height: 60px;
        }

        .sv-tabs {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
            overflow-x: auto;
            border-bottom: 1px solid var(--sv-border);
            padding-bottom: 6px;
        }
        .sv-tab-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--sv-text-dim);
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
        }
        .sv-tab-btn:hover { background: rgba(255,255,255,0.05); }
        .sv-tab-btn.active {
            background: rgba(16, 185, 129, 0.1);
            color: #10b981;
            border-color: rgba(16, 185, 129, 0.3);
            font-weight: 600;
        }

        /* Top Level Tabs */
        .sv-main-tabs {
            display: flex;
            background: var(--sv-header-bg);
            border-bottom: 1px solid var(--sv-border);
        }
        .sv-main-tab {
            flex: 1;
            text-align: center;
            padding: 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            color: var(--sv-text-dim);
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .sv-main-tab.active {
            color: var(--sv-highlight);
            border-bottom-color: var(--sv-highlight);
            background: rgba(255,255,255,0.02);
        }
        .sv-tab-content { display: none; flex-direction: column; flex-grow: 1; min-height: 0; }
        .sv-tab-content.active { display: flex; }

        /* Compact Header Tabs (Pill Style) */
        .sv-header-tab-bar {
            display: flex;
            background: rgba(0,0,0,0.2);
            border-radius: 6px;
            padding: 2px;
            gap: 2px;
        }
        .sv-header-tab {
            background: transparent;
            color: var(--sv-text-dim);
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }
        .sv-header-tab:hover {
            color: var(--sv-text);
            background: rgba(255,255,255,0.05);
        }
        .sv-header-tab.active {
            background: var(--sv-highlight); /* Highlight Color Background */
            color: #fff !important; /* Force White Text */
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        /* Lyrics Mode */
        .sv-lyrics-container {
            flex-grow: 1;
            overflow-y: auto;
            padding: 20px;
            text-align: center;
            scroll-behavior: smooth;
            mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
            -webkit-mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
        }
        .sv-lyrics-line {
            padding: 14px 10px;
            font-size: 15px;
            color: var(--sv-text-dim);
            cursor: pointer;
            transition: all 0.3s ease;
            border-radius: 8px;
            opacity: 0.6;
        }
        .sv-lyrics-line:hover {
            background: rgba(255,255,255,0.05);
            opacity: 1;
        }

        /* Timestamp Tooltip */
        .sv-lyrics-line, .sv-text-segment { position: relative; }
        .sv-lyrics-line[data-display-time]:hover::after,
        .sv-text-segment[data-display-time]:hover::after {
            content: attr(data-display-time);
            position: absolute;
            left: 50%;
            top: 100%; /* Below the element */
            transform: translateX(-50%);
            margin-top: -4px; /* Slight overlap or adjustment */
            background: rgba(0, 0, 0, 0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: var(--sv-highlight);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            line-height: 1.2;
            font-family: monospace;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            animation: sv-tooltip-in 0.2s forwards;
            z-index: 100;
            backdrop-filter: blur(2px);
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        }
        @keyframes sv-tooltip-in {
            from { opacity: 0; transform: translate(-50%, -5px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        .sv-lyrics-line.active {
            color: var(--sv-highlight);
            font-size: 18px;
            font-weight: bold;
            opacity: 1;
            transform: scale(1.05);
            text-shadow: 0 0 10px rgba(0,0,0,0.5);
        }
        .sv-lyrics-line.active span {
            color: inherit !important;
        }

        /* Text View Mode */
        .sv-text-container {
            flex-grow: 1;
            overflow-y: auto;
            padding: 20px;
            text-align: left;
            line-height: 1.8;
            font-size: 15px;
            color: var(--sv-text-dim);
        }
        .sv-text-segment {
            cursor: pointer;
            transition: color 0.2s, background 0.2s;
            padding: 2px 4px;
            border-radius: 4px;
            display: inline; /* or inline-block if we want spacing */
        }
        .sv-text-segment:hover {
            color: var(--sv-text);
            background: rgba(255,255,255,0.05);
        }
        .sv-text-segment.active {
            color: var(--sv-highlight);
            font-weight: bold;
            text-shadow: 0 0 5px rgba(0,0,0,0.5);
        }
        .sv-text-segment.active span {
            color: inherit !important;
        }

        /* Douyin Preview Card */
        .dy-card {
            display: flex;
            gap: 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--sv-border);
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 20px;
            transition: all 0.2s;
        }
        .dy-card:hover { border-color: var(--sv-highlight); background: rgba(255,255,255,0.05); }
        .dy-card-cover {
            width: 80px; height: 106px;
            object-fit: cover;
            border-radius: 6px;
            background: #000;
            flex-shrink: 0;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        }
        .dy-card-content { display: flex; flex-direction: column; justify-content: center; flex: 1; min-width: 0; }
        .dy-card-title {
            font-weight: bold; font-size: 14px; margin-bottom: 6px;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
            line-height: 1.4;
        }
        .dy-card-meta { font-size: 12px; color: var(--sv-text-dim); margin-bottom: 8px; display:flex; align-items:center; gap:6px; }
        .dy-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
        .dy-badge {
            font-size: 10px; padding: 2px 6px; border-radius: 4px; font-family: monospace;
        }
        .dy-badge.mem { background: rgba(16, 185, 129, 0.2); color: #10b981; }
        .dy-badge.sniff { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
        .dy-id { font-size: 10px; color: var(--sv-text-dim); font-family: monospace; opacity: 0.7; }

        /* Icons */
        .sv-icon { width: 14px; height: 14px; stroke-width: 2px; vertical-align: text-bottom; }
        .sv-btn-icon .sv-icon { width: 16px; height: 16px; }
        .sv-tool-btn .sv-icon { width: 12px; height: 12px; }
    `);

    // --- Template Helpers ---
    function parseTextToHtml(text) {
        if (!text) return '<span style="color:var(--sv-text-dim)">尚无内容</span>';

        // Remove all <|TAG|> style tags from SenseVoice
        text = text.replace(/<\|[a-zA-Z0-9_]+\|>/g, '');

        // Basic HTML escape (optional but good practice)
        text = text.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        // Convert newlines to <br> if needed, but usually we want to preserve paragraph structure or just let CSS handle white-space: pre-wrap
        // The CSS .sv-transcription-text has white-space: pre-wrap, so we don't strictly need <br>,
        // but if the text has valid HTML structure we might want it?
        // Actually, previous implementation returned HTML spans.
        // Now we return plain text wrapped in a span?
        // Let's just return the cleaned text.
        // Wait, if I escape HTML entities, I should return that.

        return text;
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return "00:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // --- UI Construction ---
    function createUI() {
        const modal = document.createElement('div');
        modal.id = 'sensevoice-modal';
        modal.innerHTML = `
            <div class="sv-header" id="sv-header" style="justify-content: flex-start; gap: 10px; padding: 0 10px; height: 40px;">
                <!-- Merged Tabs into Header -->
                <div class="sv-header-tab-bar" style="width: auto; margin-right: auto;">
                    <button class="sv-header-tab active" data-tab="general">${ICONS.settings} 常规</button>
                    <button class="sv-header-tab" data-tab="lyrics">${ICONS.music} 沉浸</button>
                </div>
                <!-- Site Badge -->
                <span class="sv-site-badge">${location.hostname.includes('youtube.com') ? '▶ YT' :
                location.hostname.includes('bilibili.com') ? 'BLB' :
                    location.hostname.includes('douyin.com') ? 'DY' : '?'
            }</span>

                <!-- Window Controls -->
                <div class="sv-controls" style="margin-left: 0;">
                    <span class="sv-btn-icon" id="sv-embed" title="嵌入/悬浮 (Pin/Float)">${ICONS.pin}</span>
                    <span class="sv-btn-icon" id="sv-dashboard" title="在 Dashboard 中打开详情">${ICONS.grid}</span>
                    <span class="sv-btn-icon" id="sv-theme" title="切换主题">${ICONS.moon}</span>
                    <span class="sv-btn-icon" id="sv-minimize" title="收起/展开">${ICONS.minimize}</span>
                    <span class="sv-btn-icon" id="sv-close" title="关闭">${ICONS.close}</span>
                </div>
            </div>

            <!-- Resize Handles -->
            <div class="sv-resizer sv-resizer-t" data-dir="t"></div>
            <div class="sv-resizer sv-resizer-r" data-dir="r"></div>
            <div class="sv-resizer sv-resizer-b" data-dir="b"></div>
            <div class="sv-resizer sv-resizer-l" data-dir="l"></div>
            <div class="sv-resizer sv-resizer-tl" data-dir="tl"></div>
            <div class="sv-resizer sv-resizer-tr" data-dir="tr"></div>
            <div class="sv-resizer sv-resizer-bl" data-dir="bl"></div>
            <div class="sv-resizer sv-resizer-br" data-dir="br"></div>

            <!-- Removed separate sv-main-tabs div -->

            <div id="tab-general" class="sv-tab-content active sv-main-scroll"> <!-- Adjust height for single header -->
                <div id="sv-douyin-preview-container" style="display:none; margin: 10px 10px 0 10px;"></div>
                <div class="sv-accordion" id="sv-acc-transcript">
                    <div class="sv-accordion-header">
                        <span>${ICONS.fileText} 转写文字</span>
                        <span class="sv-accordion-toggle"></span>
                    </div>
                    <div class="sv-accordion-content">
                        <div id="sv-content" class="sv-transcription-text">点击进度条或开始转写...</div>
                    </div>
                </div>

                <div class="sv-accordion collapsed" id="sv-acc-ai">
                    <div class="sv-accordion-header">
                        <span>${ICONS.bot} AI 总结与分析</span>
                        <span class="sv-accordion-toggle"></span>
                    </div>
                    <div class="sv-accordion-content">
                        <!-- AI Inputs Container -->
                         <div style="margin-bottom: 15px; border-bottom: 1px dashed var(--sv-input-border); padding-bottom: 10px;">
                            <div style="display:flex; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--sv-border); padding-bottom:4px;">
                                <input type="checkbox" id="sv-enable-ai" checked style="cursor:pointer;">
                                <label for="sv-enable-ai" style="font-size:12px; margin-left:4px; cursor:pointer; user-select:none; color:var(--sv-text-dim);">启用 AI 分析工具</label>
                            </div>

                             <!-- Collapsible Inputs -->
                            <div id="sv-ai-details">
                                <div style="margin-bottom: 8px;">
                                    <select id="sv-model-select" class="sv-prompt-select" style="width:100%; padding: 6px !important;">
                                        <option value="">加载模型列表...</option>
                                    </select>
                                </div>
                                <div class="sv-prompt-toolbar">
                                    <select id="sv-prompt-library" class="sv-prompt-select">
                                        <option value="">-- 预设指令 --</option>
                                    </select>
                                    <button id="sv-prompt-save" class="sv-tool-btn" title="保存当前为新预设">${ICONS.save}</button>
                                    <button id="sv-prompt-default" class="sv-tool-btn" title="设为默认">${ICONS.star}</button>
                                    <button id="sv-prompt-delete" class="sv-tool-btn" title="删除当前预设">${ICONS.trash}</button>
                                </div>
                                <textarea id="sv-ai-prompt" class="sv-textarea" placeholder="输入分析指令..."></textarea>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                                    <label style="font-size:12px; color:var(--sv-text-dim); display:flex; align-items:center; cursor:pointer;" title="覆盖最新的总结版本">
                                        <input type="checkbox" id="sv-ai-overwrite" style="margin-right:4px;"> 覆盖最新 (V<span id="sv-latest-ver">-</span>)
                                    </label>
                                    <button id="sv-ai-btn" class="sv-action-btn ai" style="padding: 6px 16px;">执行分析</button>
                                </div>
                            </div>
                        </div>
                        <div id="sv-ai-result" class="sv-ai-result-box" style="display:none;"></div>
                    </div>
                </div>
            </div>

            <div id="tab-lyrics" class="sv-tab-content">
                <!-- Removed Lyrics Switcher Row -->
                <div id="sv-lyrics-view" class="sv-lyrics-container">
                    <div style="padding-top: 100px; color: var(--sv-text-dim);">
                        请先选择一段历史记录<br>或执行转写
                    </div>
                </div>
            </div>

            <div class="sv-nav-box">
                <div id="sv-control-panel">
                    <canvas id="sv-timeline" width="450" height="2" style="width: 100%; height: 2px; background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer; border: 1px solid var(--sv-border); transition: height 0.2s;"></canvas>
                    <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--sv-text-dim); margin: 4px 0;">
                        <span>00:00</span>
                        <span id="sv-duration-text">--:--</span>
                    </div>
                    <div id="sv-input-bar" style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
                        <input type="number" id="sv-start" placeholder="Start" style="width: 40px; background:var(--sv-input-bg); border:1px solid var(--sv-input-border); color:var(--sv-text); padding:4px; border-radius:4px; font-size:11px;">
                        <input type="number" id="sv-end" placeholder="End" style="width: 40px; background:var(--sv-input-bg); border:1px solid var(--sv-input-border); color:var(--sv-text); padding:4px; border-radius:4px; font-size:11px;">
                        <button id="sv-get-current" style="background:none; border:none; cursor:pointer;" title="填入当前时间">${ICONS.clock}</button>

                        <div style="flex-basis: 100%; height: 0;"></div> <!-- Force Line Break -->

                        <select id="sv-language" style="flex:1; min-width:80px; background:var(--sv-input-bg); border:1px solid var(--sv-input-border); color:var(--sv-text); padding:4px; border-radius:4px; font-size:11px;">
                            <option value="auto">🌐 Auto</option>
                            <option value="zh">🇨🇳 ZH</option>
                            <option value="en">🇺🇸 EN</option>
                            <option value="ja">🇯🇵 JA</option>
                            <option value="ko">🇰🇷 KO</option>
                            <option value="yue">🇭🇰 Yue</option>
                        </select>
                        <select id="sv-task-type" style="flex:1; min-width:80px; background:var(--sv-input-bg); border:1px solid var(--sv-input-border); color:var(--sv-text); padding:4px; border-radius:4px; font-size:11px;">
                            <option value="transcribe">📝 转写</option>
                            <option value="subtitle">🎬 字幕</option>
                        </select>

                        <select id="sv-quality" style="flex:1; min-width:60px; background:var(--sv-input-bg); border:1px solid var(--sv-input-border); color:var(--sv-text); padding:4px; border-radius:4px; font-size:11px;" title="缓存质量">
                            <option value="best">最佳</option>
                            <option value="medium">适中</option>
                            <option value="worst">最差</option>
                            <option value="audio">仅音频</option>
                        </select>

                        <button id="sv-cache-only-btn" class="sv-action-btn" style="flex:1; min-width:60px; white-space: nowrap; background-color: #06b6d4; margin-right: 2px;" title="仅下载文件到服务器缓存 (不转写)">${ICONS.download || '💾'} 缓存</button>
                        <button id="sv-bookmark-btn" class="sv-action-btn" style="flex:1; min-width:60px; white-space: nowrap; background-color: #f59e0b; margin-right: 6px;" title="仅保存信息到库">${ICONS.star} 入库</button>
                        <button id="sv-transcribe-btn" class="sv-action-btn" style="flex:1; min-width:60px; white-space: nowrap;">${ICONS.mic} 执行</button>
                    </div>
                </div>

                <div class="sv-history-bar" style="display:flex; align-items:center; gap:8px;">
                    <button class="sv-tool-btn" id="sv-refresh" style="padding: 4px 8px;" title="刷新历史记录">${ICONS.refresh}</button>
                    <select id="sv-history-select" class="sv-history-select" style="flex:1; margin-top:0;">
                        <option value="">载入记录中...</option>
                    </select>

                    <!-- Lyrics Logic Buttons (Integrated) -->
                    <div id="sv-lyrics-controls" style="display:none; gap:4px;">
                        <button class="sv-tool-btn active" id="sv-view-list" title="滚动歌词">${ICONS.list}</button>
                        <button class="sv-tool-btn" id="sv-view-text" title="全文变色">${ICONS.fileText}</button>
                    </div>

                    <button class="sv-tool-btn" id="sv-toggle-controls" title="显示/隐藏控制栏" style="padding: 4px 8px;" onclick="window.sv_toggleControls()">${ICONS.keyboard}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Video Sync Globals
        let hasEnteredLyrics = false;

        // Embed Globals
        let isEmbedded = false;
        let savedFloatState = { width: '', height: '', top: '', left: '' };
        // Preference Load
        const prefEmbedded = GM_getValue('sv_embedded_mode', false);

        // -- Embed Logic --
        const toggleEmbed = (forceState = null) => {
            // Determine target state
            const targetState = forceState !== null ? forceState : !isEmbedded;

            if (location.hostname.includes('douyin.com')) {
                alert("嵌入功能开发中");
                return;
            }

            // On YouTube, only embed when on a watch page
            if (location.hostname.includes('youtube.com') && !location.pathname.startsWith('/watch')) {
                alert("嵌入展示仅在 YouTube 视频播放页支持");
                return;
            }

            if (targetState === isEmbedded) return; // No change

            if (targetState) {
                // Float -> Embed Logic
                // 1. Find Container
                const upInfoSelectors = ['.up-info-container', '#v_upinfo', '.up-panel-container', '.left-container-under-player', '.up-info--right'];
                let upInfoContainer = null;
                let parentContainer = null;

                for (const sel of upInfoSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) {
                        upInfoContainer = el;
                        parentContainer = el.parentElement;
                        break;
                    }
                }

                // Fallback
                if (!parentContainer) {
                    const rightCols = ['.player-auxiliary-area', '.right-container', '#danmukuBox',
                        '#secondary', '#related']; // YouTube right column
                    for (const sel of rightCols) {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) { parentContainer = el; break; }
                    }
                }

                if (!parentContainer) {
                    if (forceState === null) alert("未找到合适的嵌入位置 (Right Column)");
                    return; // Fail silently on auto-load to avoid annoying user if layout fails
                }

                // Save Float State before moving (only if currently floating)
                if (!modal.classList.contains('embedded')) {
                    const rect = modal.getBoundingClientRect();
                    // Check if we have valid rect (might be 0 if hidden/creating)
                    if (rect.width > 0) {
                        savedFloatState = {
                            width: modal.style.width || `${rect.width}px`,
                            height: modal.style.height || `${rect.height}px`,
                            top: modal.style.top,
                            left: modal.style.left
                        };
                    }
                }

                modal.classList.add('embedded');

                // Insertion
                if (upInfoContainer && parentContainer.contains(upInfoContainer)) {
                    if (upInfoContainer.nextSibling) {
                        parentContainer.insertBefore(modal, upInfoContainer.nextSibling);
                    } else {
                        parentContainer.appendChild(modal);
                    }
                } else {
                    parentContainer.insertBefore(modal, parentContainer.firstChild);
                }

                // Styles
                modal.style.top = '';
                modal.style.left = '';
                modal.style.width = '100%';

                updateEmbedHeight();
                startHeightSync();

                modal.querySelector('#sv-embed').textContent = '☁️';
                isEmbedded = true;

            } else {
                // Embed -> Float Logic
                stopHeightSync();
                modal.classList.remove('embedded');
                document.body.appendChild(modal);

                // Restore logic
                if (savedFloatState.width) {
                    modal.style.width = savedFloatState.width;
                    modal.style.height = savedFloatState.height;
                    modal.style.top = savedFloatState.top;
                    modal.style.left = savedFloatState.left;
                } else {
                    // Default Float Position if no saved state
                    modal.style.top = '100px';
                    modal.style.right = '40px';
                    modal.style.left = '';
                }

                modal.querySelector('#sv-embed').textContent = '📌';
                isEmbedded = false;
            }

            // Persist
            GM_setValue('sv_embedded_mode', isEmbedded);
        };

        modal.querySelector('#sv-embed').onclick = (e) => {
            e.stopPropagation();
            toggleEmbed();
        };

        // Window Controls Handlers (Restored)
        modal.querySelector('#sv-minimize').onclick = (e) => {
            e.stopPropagation();

            // Right-Anchor Logic: Use offset properties for relative consistency
            const originalRight = modal.offsetLeft + modal.offsetWidth;

            modal.classList.toggle('minimized');
            e.target.textContent = modal.classList.contains('minimized') ? '＋' : '−';

            // If floating, adjust left to keep right edge stationary
            if (!isEmbedded) {
                // Ensure layout updates if needed (accessing offsetWidth usually forces reflow)
                const newWidth = modal.offsetWidth;
                modal.style.left = `${originalRight - newWidth}px`;
                modal.style.right = 'auto'; // Ensure left positioning takes precedence
            }
        };

        modal.querySelector('#sv-close').onclick = (e) => {
            e.stopPropagation();
            modal.classList.remove('show');
            // Stop polling if any?
            // Actually, verify connection closes.
        };

        // Auto-Apply Preference
        if (prefEmbedded && !location.hostname.includes('douyin.com')) {
            // Delay slightly to ensure DOM is ready?
            // createUI is usually called on click, so DOM is ready.
            // If called by auto-open logic, wait for insertion.
            setTimeout(() => toggleEmbed(true), 100);
        }

        // Height Sync System
        let heightSyncParams = { observer: null, interval: null };

        function updateEmbedHeight() {
            if (!isEmbedded || modal.classList.contains('minimized')) return;

            const video = document.querySelector('video') || document.querySelector('#bilibili-player') || document.querySelector('#playerWrap');
            if (!video) return;

            // Measure Video Height (Approximate the main player area height)
            // Often #playerWrap or #bilibili-player element has the layout height.
            // The video tag itself might be object-fit: contain.
            // Let's try the player container first.
            const playerContainer =
                document.getElementById('bilibili-player') ||
                document.getElementById('playerWrap') ||
                document.getElementById('movie_player') ||         // YouTube
                document.getElementById('player-container') ||     // YouTube alt
                document.getElementById('player-container-outer') || // YouTube alt
                video.parentElement;
            const targetHeight = playerContainer.offsetHeight;

            // 2. Precise Alignment using BoundingRect
            // We want the modal bottom to align with the player bottom.
            // Height = PlayerBottom - ModalTop.
            // This accounts for any siblings (UpInfo, Headers) and margins automatically.

            if (targetHeight > 100) {
                let playerRect = playerContainer.getBoundingClientRect();
                let modalRect = modal.getBoundingClientRect();

                // Check if valid
                if (playerRect.height > 0 && modalRect.top > 0) {
                    // Calculate existing bottom of player relative to viewport
                    let targetBottom = playerRect.bottom;

                    // Calculate modal top relative to viewport
                    let startTop = modalRect.top;

                    // Helper: Handle minor scroll drifts or rounding
                    let finalHeight = targetBottom - startTop;

                    // Sanity check: If logic fails (negative), fall back or ignore
                    if (finalHeight > 100) {
                        // Optional: Subtract a pixel to prevent sub-pixel overflow causing scrollbars on parent
                        modal.style.height = `${finalHeight}px`;
                    }
                }
            }
        }

        function startHeightSync() {
            // 1. ResizeObserver on Player
            const player = document.getElementById('bilibili-player') || document.getElementById('playerWrap') ||
                document.getElementById('movie_player') || document.getElementById('player-container') || // YouTube
                document.querySelector('video');
            if (player) {
                heightSyncParams.observer = new ResizeObserver(() => updateEmbedHeight());
                heightSyncParams.observer.observe(player);
            }
            // 2. Interval fallback
            heightSyncParams.interval = setInterval(updateEmbedHeight, 1000);

            // 3. Window Resize
            window.addEventListener('resize', updateEmbedHeight);
        }

        function stopHeightSync() {
            if (heightSyncParams.observer) heightSyncParams.observer.disconnect();
            if (heightSyncParams.interval) clearInterval(heightSyncParams.interval);
            window.removeEventListener('resize', updateEmbedHeight);
        }

        // Timeline Hover
        const timeline = modal.querySelector('#sv-timeline');
        timeline.onmouseover = () => timeline.style.height = '5px';
        timeline.onmouseout = () => timeline.style.height = '2px';

        modal.querySelector('#sv-theme').onclick = toggleTheme;
        modal.querySelector('#sv-refresh').onclick = fetchAndRenderHistory;
        modal.querySelector('#sv-get-current').onclick = () => {
            const video = document.querySelector('video');
            if (video) {
                const now = Math.floor(video.currentTime);
                const s = document.getElementById('sv-start'), e = document.getElementById('sv-end');
                if (!s.value) s.value = now; else e.value = now;
            }
        };

        modal.querySelector('#sv-dashboard').onclick = () => {
            if (currentSourceID) window.open(`${BASE_URL}/video/${currentSourceID}`, '_blank');
            else alert("未检测到源 ID，请稍候或刷新页面");
        };

        modal.querySelectorAll('.sv-accordion-header').forEach(header => {
            header.onclick = () => header.parentElement.classList.toggle('collapsed');
        });

        // Drag Move Logic
        const header = modal.querySelector('#sv-header');
        let drag = { active: false, x: 0, y: 0 };
        header.onmousedown = (e) => {
            if (isEmbedded) return; // Disable drag when embedded
            if (e.target.closest('.sv-controls') || e.target.closest('.sv-header-tab-bar')) return;
            // Get current position relative to page
            const currentLeft = modal.offsetLeft;
            const currentTop = modal.offsetTop;
            // Set explicit left/top and clear right to prevent jumping
            modal.style.left = `${currentLeft}px`;
            modal.style.top = `${currentTop}px`;
            modal.style.right = 'auto';

            drag = { active: true, x: e.clientX - currentLeft, y: e.clientY - currentTop };

            const onMove = (me) => {
                if (drag.active) {
                    modal.style.left = `${me.clientX - drag.x}px`;
                    modal.style.top = `${me.clientY - drag.y}px`;
                }
            };
            const onUp = () => { drag.active = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };

        // Resize Logic (Omni-Directional)
        const minW = 350, minH = 200;
        modal.querySelectorAll('.sv-resizer').forEach(handle => {
            handle.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const dir = e.target.dataset.dir; // t, r, b, l, tl, tr, bl, br
                const startX = e.clientX, startY = e.clientY;
                const startRect = modal.getBoundingClientRect();

                // Ensure absolute positioning is set correctly before resize
                // (We might be in 'right: 20px' mode initially)
                modal.style.left = `${startRect.left}px`;
                modal.style.top = `${startRect.top}px`;
                modal.style.right = 'auto'; // Disable right-anchor
                modal.style.bottom = 'auto';
                modal.style.width = `${startRect.width}px`;
                modal.style.height = `${startRect.height}px`;

                const onResize = (me) => {
                    const dx = me.clientX - startX;
                    const dy = me.clientY - startY;
                    let newW = startRect.width, newH = startRect.height;
                    let newL = startRect.left, newT = startRect.top;

                    // Horizontal
                    if (dir.includes('r')) {
                        newW = Math.max(minW, startRect.width + dx);
                    } else if (dir.includes('l')) {
                        const w = Math.max(minW, startRect.width - dx);
                        newL = startRect.left + (startRect.width - w);
                        newW = w;
                    }

                    // Vertical
                    if (dir.includes('b')) {
                        newH = Math.max(minH, startRect.height + dy);
                    } else if (dir.includes('t')) {
                        const h = Math.max(minH, startRect.height - dy);
                        newT = startRect.top + (startRect.height - h);
                        newH = h;
                    }

                    modal.style.width = `${newW}px`;
                    modal.style.height = `${newH}px`;
                    modal.style.left = `${newL}px`;
                    modal.style.top = `${newT}px`;
                };

                const onUp = () => {
                    document.removeEventListener('mousemove', onResize);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', onUp);
            };
        });

        // Actions
        modal.querySelector('#sv-transcribe-btn').onclick = () => startTranscription('transcribe');
        modal.querySelector('#sv-bookmark-btn').onclick = () => startTranscription('bookmark');
        modal.querySelector('#sv-cache-only-btn').onclick = () => startTranscription('cache_only');
        modal.querySelector('#sv-ai-btn').onclick = analyzeText;
        modal.querySelector('#sv-history-select').onchange = (e) => selectRecord(e.target.value);
        modal.querySelector('#sv-timeline').onclick = onTimelineClick;
        modal.querySelector('#sv-enable-ai').onchange = (e) => {
            const details = document.getElementById('sv-ai-details');
            if (details) details.style.display = e.target.checked ? 'block' : 'none';
        };

        // Prompt Library Actions
        const promptSelect = modal.querySelector('#sv-prompt-library');
        promptSelect.onchange = (e) => {
            const p = promptLibrary.find(x => x.name === e.target.value);
            if (p) document.getElementById('sv-ai-prompt').value = p.content;
        };
        modal.querySelector('#sv-prompt-save').onclick = () => {
            const content = document.getElementById('sv-ai-prompt').value;
            if (!content) return;
            const name = prompt("请输入预设名称:", "新预设");
            if (name) {
                promptLibrary.push({ name, content, isDefault: false });
                saveLibrary();
                renderPromptLibrary();
                promptSelect.value = name;
            }
        };
        modal.querySelector('#sv-prompt-delete').onclick = () => {
            const name = promptSelect.value;
            if (!name) return;
            if (confirm(`确定删除预设 "${name}" 吗？`)) {
                promptLibrary = promptLibrary.filter(x => x.name !== name);
                saveLibrary();
                renderPromptLibrary();
                document.getElementById('sv-ai-prompt').value = '';
            }
        };
        modal.querySelector('#sv-prompt-default').onclick = () => {
            const name = promptSelect.value;
            if (!name) return;
            promptLibrary.forEach(x => x.isDefault = (x.name === name));
            saveLibrary();
            renderPromptLibrary();
            alert(`已设为默认: ${name}`);
        };

        renderPromptLibrary();
        fetchModels();
        updateThemeUI();

        // Bind Tab Switching
        modal.querySelectorAll('.sv-header-tab').forEach(t => {
            t.onclick = () => {
                modal.querySelectorAll('.sv-header-tab').forEach(x => x.classList.remove('active'));
                modal.querySelectorAll('.sv-tab-content').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                document.getElementById(`tab-${t.dataset.tab}`).classList.add('active');

                // Toggle Lyrics Controls Visibility
                const lyricsControls = document.getElementById('sv-lyrics-controls');
                if (lyricsControls) {
                    lyricsControls.style.display = (t.dataset.tab === 'lyrics') ? 'flex' : 'none';
                }

                // If switching to lyrics, try to sync immediately
                if (t.dataset.tab === 'lyrics') {
                    scrollToActiveLine();

                    // Auto-Hide Controls on First Entry
                    if (!hasEnteredLyrics) {
                        const panel = modal.querySelector('#sv-control-panel');
                        if (panel && panel.style.display !== 'none') {
                            panel.style.display = 'none';
                            modal.querySelector('#sv-toggle-controls').style.opacity = '0.5';
                        }
                        hasEnteredLyrics = true;
                    }
                }
            };
        });

        // Bind View Switcher
        modal.querySelector('#sv-view-list').onclick = () => sv_switchLyricsView('list');
        modal.querySelector('#sv-view-text').onclick = () => sv_switchLyricsView('text');

        // Bind Toggle Controls (Global)
        modal.querySelector('#sv-toggle-controls').onclick = () => window.sv_toggleControls();

        // Initial Bind
        ensureVideoBinding();
        updateQualityOptions(); // Init Check

        return modal;
    }

    function updateQualityOptions() {
        const isDouyin = location.hostname.includes('douyin.com');
        const isYouTube = location.hostname.includes('youtube.com');
        const qSelect = document.getElementById('sv-quality');
        if (!qSelect) return;

        // Hide "Audio Only" for Douyin
        for (let i = 0; i < qSelect.options.length; i++) {
            if (qSelect.options[i].value === 'audio') {
                qSelect.options[i].style.display = isDouyin ? 'none' : 'block';
                if (isDouyin && qSelect.value === 'audio') qSelect.value = 'best';
            }
        }
    }

    // --- Sync & Lyrics Logic ---
    let currentSubtitleData = [];
    let currentViewMode = 'list';

    // Video Sync Globals
    let activeVideoElement = null;

    function ensureVideoBinding() {
        let video = null;
        // Prioritize playing video (Douyin often has multiple video tags)
        const videos = Array.from(document.querySelectorAll('video'));
        video = videos.find(v => !v.paused && v.style.display !== 'none' && v.readyState > 2);

        if (!video) video = document.querySelector('video'); // Fallback
        if (!video) return;

        // If the video element has changed or never bound
        if (activeVideoElement !== video) {
            console.log("[SenseVoice] Binding to new video element", video);
            if (activeVideoElement) {
                activeVideoElement.removeEventListener('timeupdate', onVideoTimeUpdate);
            }
            activeVideoElement = video;
            activeVideoElement.addEventListener('timeupdate', onVideoTimeUpdate);
        }
    }

    function onVideoTimeUpdate() {
        if (!activeVideoElement) return;
        const time = activeVideoElement.currentTime;

        // Check active tab is lyrics
        const lyricsTab = document.getElementById('tab-lyrics');
        if (!lyricsTab || !lyricsTab.classList.contains('active')) return;

        let activeIdx = -1;
        currentSubtitleData.forEach((seg, idx) => {
            if (time >= seg.start && time < seg.end) {
                activeIdx = idx;
            }
        });

        // Update UI
        if (activeIdx !== -1) {
            const container = document.getElementById('sv-lyrics-view');

            const updateActive = (selector, id) => {
                const currentActive = document.querySelector(selector + '.active');
                const newActive = document.getElementById(id);
                if (currentActive !== newActive) {
                    if (currentActive) currentActive.classList.remove('active');
                    if (newActive) {
                        newActive.classList.add('active');
                        // Custom Scroll
                        if (container) {
                            const target = newActive.offsetTop - (container.clientHeight / 2) + (newActive.clientHeight / 2);
                            container.scrollTo({ top: target, behavior: 'smooth' });
                        }
                    }
                }
            };

            if (currentViewMode === 'list') {
                updateActive('.sv-lyrics-line', `lyric-${activeIdx}`);
            } else {
                updateActive('.sv-text-segment', `text-seg-${activeIdx}`);
            }
        }
    }

    function sv_switchLyricsView(mode) {
        currentViewMode = mode;
        const btnList = document.getElementById('sv-view-list');
        const btnText = document.getElementById('sv-view-text');
        if (btnList) btnList.classList.toggle('active', mode === 'list');
        if (btnText) btnText.classList.toggle('active', mode === 'text');
        if (typeof renderLyrics === 'function') renderLyrics({ raw_text: currentRawText });
    }

    let currentRawText = "";

    // Replaces initSyncMode
    // We now use ensureVideoBinding called by checkURL or mutation observer mechanics

    // --- UI Actions ---
    window.sv_toggleControls = function () {
        const modal = document.getElementById('sensevoice-modal');
        if (!modal) return;
        const panel = modal.querySelector('#sv-control-panel');
        const btn = modal.querySelector('#sv-toggle-controls');
        if (panel) {
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            if (btn) btn.style.opacity = isHidden ? '1' : '0.5';
        }
    };

    function scrollToActiveLine() {
        const active = document.querySelector('.sv-lyrics-line.active');
        const container = document.getElementById('sv-lyrics-view');
        if (active && container) {
            // Custom center scroll to avoid outer window scrolling
            const target = active.offsetTop - (container.clientHeight / 2) + (active.clientHeight / 2);
            container.scrollTo({ top: target, behavior: 'smooth' });
        }
    }

    function renderLyrics(data) {
        const container = document.getElementById('sv-lyrics-view');
        if (!container) return;

        container.innerHTML = '';
        currentRawText = data.raw_text;

        // Ensure container is positioned for offsetTop calculations
        container.style.position = 'relative';

        // Fallback to parsed global data or reparsed text?

        // ... (rest is tricky because renderLyrics relies on reparsing)
        // Actually, renderLyrics calls parseTextToHtml logic again or uses segments?
        // Wait, renderLyrics implementation in lines 1196+ uses `data` but `currentSubtitleData` is global.
        // Let's assume standard logic below is kept but I need to replace scroll calls.

        // I will only replace the scroll helper and the render logic is largely handled by my previous read.
        // But `renderLyrics` *populates* `segments`.


        currentSubtitleData = [];

        if (data.raw_text) currentRawText = data.raw_text;

        // Assuming raw_text is like [00:00.00-00:05.00] Text...
        // But our API responses might be raw text.
        // If we selected a history item, we have item.segment_start?
        // No, `selectRecord` fetches *one* item. If that item is a full subtitle file, it might just be text.
        // Wait, history items are segments? Or the whole video?
        // If it's "Subtitle Mode", usually it's one big text file?
        // Let's check `parseTextToHtml` or how we store it.
        // Actually, for "transcribe" task, we have segments in DB?
        // No, `transcriptions` table has `raw_text`.
        // If `is_subtitle=1`, `raw_text` is SRT format? Or SenseVoice format?
        // SenseVoice returns rich text `<|00:00|>` tags.

        // We need to parse SenseVoice timestamp tags: <|0.50|> TEXT <|2.30|>
        // Regex to parse: /<\|([\d\.]+)\|>/g

        const rawText = data.raw_text || "";
        const parts = rawText.split(/(<\|[\d\.]+\|>)/);

        let currentTime = 0;
        let bufferText = "";

        // Simpler approach: Split by timestamps
        // <|0.00|>Hello<|1.50|>World

        const regex = /<\|([\d\.]+)\|>/g;
        let match;
        let lastIndex = 0;
        let segments = [];

        // Initialize start time
        let startTime = 0.0;

        // We need pairs. Start -> End.
        // If SenseVoice only gives points?
        // Typically: <|0.00|> Speech <|2.00|>

        // Re-read typical output format.
        // SenseVoice: <|zh|><|NEUTRAL|><|Speech|><|withitn|>text...
        // It provides timestamps at word/sentence level?
        // Actually, my server implementation just returns `res[0]['text']`.
        // If `timestamp=True` was not set in `core.py`, we might not have timestamps!
        // Let's check `core.py`.

        // In `core.py`: `self.model.generate(..., merge_vad=True)`.
        // It produces text with tags?

        // Let's assume we have timestamps. If not, we can't sync.
        // If we don't have timestamps in text, we check if `currentHistory` (which we have access to) contains multiple segments for this video?
        // `selectRecord` loads ONE record.
        // If the record covers the WHOLE video (start=0, end=duration), and the text has no internal timestamps, we can't sync internally.

        // BUT, if the user sees `[Subtitle]` mode from `userscript.js`, maybe they uploaded an SRT?
        // OR they used `task_type=subtitle` which calls `generate_srt`.

        // If `generate_srt` was used, `raw_text` IS SRT formatted.
        // Let's check for SRT format.

        if (rawText.includes('-->')) {
            // SRT Parser
            const blocks = rawText.split(/\n\s*\n/);
            blocks.forEach((block, idx) => {
                const lines = block.split('\n');
                if (lines.length >= 3) {
                    const timeLine = lines[1];
                    const text = lines.slice(2).join('\n');
                    const [startStr, endStr] = timeLine.split(' --> ');

                    const parseSrtTime = (t) => {
                        if (!t) return 0;
                        const [hms, ms] = t.split(',');
                        const [h, m, s] = hms.split(':').map(parseFloat);
                        return h * 3600 + m * 60 + s + parseFloat(ms) / 1000;
                    };

                    if (startStr && endStr) {
                        segments.push({
                            start: parseSrtTime(startStr),
                            end: parseSrtTime(endStr),
                            text: text
                        });
                    }
                }
            });
        } else {
            // Try Timestamp Tags <|0.00|>
            const regex = /<\|([\d\.]+)\|>/g;
            let match;
            let lastIndex = 0;
            let lastTime = 0.0;
            let foundTags = false;

            while ((match = regex.exec(rawText)) !== null) {
                foundTags = true;
                const currentTime = parseFloat(match[1]);
                // Text between previous tag and this tag
                const textSegment = rawText.slice(lastIndex, match.index).trim();

                // If we have text (and it's not the very start before the first tag)
                if (textSegment.length > 0) {
                    // For the very first segment, if text appears BEFORE the first tag, we might default start to 0?
                    // But typically text is SANDWICHED: <|0.0|> Hello <|1.0|>
                    // So textSegment is "Hello". start=lastTime(0.0), end=currentTime(1.0).
                    segments.push({ start: lastTime, end: currentTime, text: textSegment });
                }

                lastTime = currentTime;
                lastIndex = regex.lastIndex;
            }

            // Handle text after the last tag
            if (lastIndex < rawText.length) {
                const text = rawText.slice(lastIndex).trim();
                if (text.length > 0) {
                    segments.push({ start: lastTime, end: 99999, text: text });
                }
            }

            // Fallback if no tags found at all
            if (!foundTags && segments.length === 0) {
                segments.push({ start: 0, end: 99999, text: rawText });
            }
        }

        currentSubtitleData = segments;

        if (segments.length === 0) {
            container.innerHTML = '<div style="padding-top:50px;">未识别到时间轴信息</div>';
            return;
        }

        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
        };

        if (currentViewMode === 'list') {
            container.className = 'sv-lyrics-container';
            segments.forEach((seg, idx) => {
                const div = document.createElement('div');
                div.className = 'sv-lyrics-line';
                div.id = `lyric-${idx}`;
                div.innerHTML = parseTextToHtml(seg.text);
                div.setAttribute('data-display-time', formatTime(seg.start));
                div.onclick = () => {
                    const video = document.querySelector('video');
                    if (video) { video.currentTime = seg.start; video.play(); }
                };
                container.appendChild(div);
            });
        } else {
            container.className = 'sv-text-container';
            segments.forEach((seg, idx) => {
                const span = document.createElement('div');
                span.className = 'sv-text-segment';
                span.id = `text-seg-${idx}`;
                span.innerHTML = parseTextToHtml(seg.text);
                span.style.display = 'inline-block';
                span.style.marginBottom = '8px';
                span.style.marginRight = "8px";
                span.setAttribute('data-title', formatTime(seg.start)); // Native tooltip for text mode? Or custom?
                // User asked for "immersive mode", which is usually the lyrics view.
                // Let's add custom tooltip here too just in case by adding the class or style.
                // But Text View uses .sv-text-segment. I didn't add CSS for it yet.
                // I'll stick to native title for text mode or add the data attribute anyway.
                span.setAttribute('data-display-time', formatTime(seg.start));

                span.onclick = () => {
                    const video = document.querySelector('video');
                    if (video) { video.currentTime = seg.start; video.play(); }
                };
                container.appendChild(span);
            });
        }
    }
    function fetchModels() {
        GM_xmlhttpRequest({
            method: "GET",
            // Use new Providers API
            url: `${BASE_URL}/api/settings/llm/providers`,
            onload: function (res) {
                if (res.status === 200) {
                    try {
                        const providers = JSON.parse(res.responseText);
                        const select = document.getElementById('sv-model-select');
                        if (!select) return;
                        select.innerHTML = '<option value="">-- 使用默认模型 (Default) --</option>';

                        providers.forEach(p => {
                            if (p.models && p.models.length > 0) {
                                const group = document.createElement('optgroup');
                                group.label = p.name; // Provider Name
                                p.models.forEach(m => {
                                    const opt = document.createElement('option');
                                    opt.value = m.id; // Model ID
                                    opt.textContent = `${m.model_name}${m.is_active ? ' [Active]' : ''}`;
                                    if (m.is_active) opt.selected = true; // Auto select active
                                    group.appendChild(opt);
                                });
                                select.appendChild(group);
                            }
                        });
                    } catch (e) {
                        console.error("Error parsing models", e);
                    }
                }
            }
        });
    }

    // --- Prompt Library Logic ---
    function renderPromptLibrary() {
        const select = document.getElementById('sv-prompt-library');
        if (!select) return;
        select.innerHTML = '<option value="">-- 预设指令 --</option>';
        promptLibrary.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.isDefault ? '⭐ ' : ''}${p.name}`;
            select.appendChild(opt);
        });

        // Auto fill default
        const def = promptLibrary.find(x => x.isDefault);
        if (def && !document.getElementById('sv-ai-prompt').value) {
            document.getElementById('sv-ai-prompt').value = def.content;
            select.value = def.name;
        }
    }

    function saveLibrary() { GM_setValue('sv_prompts', promptLibrary); }

    // --- Theme Logic ---
    function toggleTheme() {
        if (savedTheme === 'auto') savedTheme = 'light';
        else if (savedTheme === 'light') savedTheme = 'dark';
        else savedTheme = 'auto';
        GM_setValue('sv_theme', savedTheme);
        updateThemeUI();
    }

    function updateThemeUI() {
        const modal = document.getElementById('sensevoice-modal');
        if (!modal) return;
        const btn = modal.querySelector('#sv-theme');
        if (savedTheme === 'auto') {
            btn.innerHTML = ICONS.monitor; // Use monitor icon for auto
            btn.title = "跟随系统 (Auto)";
            if (window.matchMedia('(prefers-color-scheme: light)').matches) modal.setAttribute('data-theme', 'light');
            else modal.removeAttribute('data-theme');
        } else if (savedTheme === 'light') {
            btn.innerHTML = ICONS.sun; modal.setAttribute('data-theme', 'light');
        } else {
            btn.innerHTML = ICONS.moon; modal.removeAttribute('data-theme');
        }
    }

    // --- Data Logic ---
    function fetchAndRenderHistory(selectedId) {
        if (!currentSourceID) return;
        const video = document.querySelector('video');
        totalDuration = video ? video.duration : totalDuration;
        const durationText = document.getElementById('sv-duration-text');
        if (durationText) durationText.textContent = formatTime(totalDuration);

        GM_xmlhttpRequest({
            method: "GET",
            // v2: Use /api/videos/segments?source_id=...
            url: `${API_HISTORY}?source_id=${encodeURIComponent(currentSourceID)}`,
            onload: function (res) {
                if (res.status === 200) {
                    currentHistory = JSON.parse(res.responseText);
                    renderSelector(selectedId);
                    renderTimeline();
                } else {
                    console.error("Fetch history failed", res.status, res.responseText);
                }
            }
        });
    }

    function renderSelector() {
        const select = document.getElementById('sv-history-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- 选择记录片段 --</option>';
        currentHistory.forEach(item => {
            const startStr = formatTime(item.segment_start);
            const endStr = item.segment_end ? formatTime(item.segment_end) : 'End';
            const aiTag = item.has_ai ? ' [🤖已总结]' : ''; // Keep emoji in text select for now, or remove
            const subTag = item.is_subtitle ? ' [🎬字幕]' : '';
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `⏱️ ${startStr} - ${endStr} (${item.timestamp})${subTag}${aiTag}`; // Keep text emojis in select options
            select.appendChild(opt);
        });
    }

    function renderTimeline() {
        const canvas = document.getElementById('sv-timeline');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, 0, w, h);

        currentHistory.forEach(item => {
            const start = item.segment_start || 0;
            const end = item.segment_end || totalDuration;
            const x = (start / totalDuration) * w;
            const width = ((end - start) / totalDuration) * w;
            ctx.fillStyle = item.has_ai ? '#10b981' : '#38bdf8';
            ctx.fillRect(x, 0, Math.max(width, 2), h);
        });
    }

    function onTimelineClick(e) {
        if (!totalDuration) return;
        const rect = e.target.getBoundingClientRect();
        const clickedTime = ((e.clientX - rect.left) / rect.width) * totalDuration;
        const hits = currentHistory.filter(item => {
            const s = item.segment_start || 0;
            const e = item.segment_end || totalDuration;
            return clickedTime >= s && clickedTime <= e;
        });
        if (hits.length > 0) {
            const target = hits[hits.length - 1];
            document.getElementById('sv-history-select').value = target.id;
            selectRecord(target.id);
        }
    }

    function selectRecord(id) {
        if (!id) return;
        const contentBox = document.getElementById('sv-content');
        const aiBox = document.getElementById('sv-ai-result');
        contentBox.innerHTML = '<div class="sv-loading"><div class="spinner"></div> 读取中...</div>';

        GM_xmlhttpRequest({
            method: "GET",
            // v2: Use /api/segments/{id}
            url: `${API_SEGMENT}/${id}`,
            onload: function (res) {
                if (res.status === 200) {
                    try {
                        const data = JSON.parse(res.responseText);
                        contentBox.innerHTML = parseTextToHtml(data.raw_text);
                        renderLyrics(data); // Render Lyrics View

                        // Store latest summary ID for overwrite
                        const summaries = data.summaries || [];
                        const overwriteChk = document.getElementById('sv-ai-overwrite');
                        const verSpan = document.getElementById('sv-latest-ver');

                        if (summaries.length > 0) {
                            overwriteChk.disabled = false;
                            overwriteChk.dataset.latestId = summaries[0].id; // Latest is usually first
                            verSpan.textContent = summaries.length;
                        } else {
                            overwriteChk.disabled = true;
                            overwriteChk.checked = false;
                            overwriteChk.removeAttribute('data-latest-id');
                            verSpan.textContent = "0";
                        }

                        // --- Render AI Summary ---
                        const roots = summaries.filter(s => !s.parent_id);

                        aiBox.innerHTML = '';
                        aiBox.className = '';
                        aiBox.style.padding = '0';
                        aiBox.style.background = 'transparent';
                        aiBox.style.border = 'none';
                        aiBox.style.marginTop = '10px';

                        if (roots.length > 0) {
                            aiBox.style.display = 'block';
                            document.getElementById('sv-acc-ai').classList.remove('collapsed');

                            // Multi-version Tabs
                            if (roots.length > 1) {
                                const tabContainer = document.createElement('div');
                                tabContainer.className = 'sv-tabs';

                                roots.forEach((root, idx) => {
                                    const btn = document.createElement('button');
                                    btn.className = 'sv-tab-btn ' + (idx === 0 ? 'active' : '');
                                    // Label: First few chars of prompt or Model Name or "V{idx+1}"
                                    const label = root.model ? root.model : `Version ${roots.length - idx}`;
                                    btn.textContent = label;
                                    btn.onclick = () => {
                                        // Switch Tab
                                        tabContainer.querySelectorAll('.sv-tab-btn').forEach(b => b.classList.remove('active'));
                                        btn.classList.add('active');
                                        // Render Content
                                        const treeContainer = document.getElementById('sv-ai-tree-container');
                                        treeContainer.innerHTML = '';
                                        window.sv_renderRootTree(root, summaries, treeContainer);
                                    };
                                    tabContainer.appendChild(btn);
                                });
                                aiBox.appendChild(tabContainer);
                            }

                            // Container for Tree
                            const treeContainer = document.createElement('div');
                            treeContainer.id = 'sv-ai-tree-container';
                            aiBox.appendChild(treeContainer);

                            // Initial Render (Latest/First Root)
                            // roots[0] is usually latest if sorted DESC by ID?
                            // Server returns summaries descending? Let's check server.py `get_ai_summaries`.
                            // Usually DB returns ascending unless specified.
                            // Assuming roots[roots.length-1] is latest? Or roots[0]?
                            // Let's assume user wants latest.
                            // If DB order is ASC (1, 2, 3), then roots[roots.length-1] is latest.
                            // I'll default to the *last* one (latest) if array is chronological.
                            const initialRoot = roots[roots.length - 1];

                            // Update active tab logic if we pick last
                            if (roots.length > 1) {
                                const tabs = aiBox.querySelectorAll('.sv-tab-btn');
                                tabs.forEach(t => t.classList.remove('active'));
                                tabs[tabs.length - 1].classList.add('active');
                            }

                            window.sv_renderRootTree(initialRoot, summaries, treeContainer);


                        } else if (data.ai_summary) {
                            // Fallback: show latest summary as plain text
                            aiBox.style.display = 'block';
                            aiBox.className = 'sv-ai-result-box';
                            aiBox.innerHTML = (typeof marked !== 'undefined') ? marked.parse(data.ai_summary) : data.ai_summary;
                            document.getElementById('sv-acc-ai').classList.remove('collapsed');
                        } else {
                            aiBox.style.display = 'none';
                        }
                        document.querySelector('.sv-main-scroll').scrollTop = 0;
                    } catch (e) {
                        console.error("Error parsing/rendering record", e);
                        contentBox.innerHTML = `<div style="color:#ef4444; padding:20px;">${ICONS.alert} 数据解析错误: ${e.message}</div>`;
                    }
                } else {
                    console.error("Fetch record failed", res.status, res.responseText);
                    contentBox.innerHTML = `<div style="color:#ef4444; padding:20px;">${ICONS.alert} 读取失败 (HTTP ${res.status}): ${res.responseText}</div>`;
                }
            },
            onerror: function (err) {
                console.error("Network error fetching record", err);
                contentBox.innerHTML = `<div style="color:#ef4444; padding:20px;">${ICONS.alert} 网络连接失败</div>`;
            }
        });
    }

    function startTranscription(mode = 'transcribe') {
        // Compatibility: Handle boolean input from old calls if any
        if (typeof mode === 'boolean') mode = mode ? 'bookmark' : 'transcribe';

        const startVal = document.getElementById('sv-start').value;
        const endVal = document.getElementById('sv-end').value;
        const taskType = document.getElementById('sv-task-type').value;
        const language = document.getElementById('sv-language').value;
        const quality = document.getElementById('sv-quality') ? document.getElementById('sv-quality').value : 'best';

        // Base Body
        const body = {
            source_id: currentSourceID,
            task_type: taskType,
            bookmark_only: (mode === 'bookmark'),
            quality: quality
        };

        if (mode === 'cache_only') {
            body.task_type = 'cache_only';
            // bookmark_only should be false for cache task naturally, dispatcher handles it.
        }

        if (language && language !== 'auto') body.language = language;

        // Scraping Metadata (Bilibili defaults — will be overridden by platform-specific blocks)
        const titleEl = document.querySelector('h1.video-title') || document.querySelector('.video-info-title');
        if (titleEl) body.title = titleEl.textContent.trim();
        else body.title = document.title.replace('_哔哩哔哩_bilibili', '').trim();

        // 1. Try __INITIAL_STATE__ (Bilibili, Best Quality)
        let cover = '';
        if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData && window.__INITIAL_STATE__.videoData.pic) {
            cover = window.__INITIAL_STATE__.videoData.pic;
        }
        // 2. Try meta tag (High Quality usually)
        else {
            const coverEl = document.querySelector('meta[itemprop="image"]');
            if (coverEl) cover = coverEl.content;
            else {
                // 3. Last fallback: player poster
                const img = document.querySelector('.bpx-player-video-poster-img');
                if (img) cover = img.src;
            }
        }

        // Clean URL (remove resolution params like @480w_270h_1c.webp to get raw image)
        if (cover) {
            body.cover = cover.split('@')[0];
        }

        if (startVal) body.range_start = parseFloat(startVal);
        if (endVal) body.range_end = parseFloat(endVal);

        // --- Douyin Logic ---
        // --- Douyin Logic ---
        if (location.hostname.includes('douyin.com')) {
            const metadata = extractDouyinMetadata();

            if (metadata) {
                body.source_type = 'douyin';
                body.title = (metadata.title || document.title).replace(' - 抖音', '').trim();
                body.direct_url = metadata.url;      // Low Bitrate (ASR)
                body.stream_url = metadata.stream_url; // High Bitrate (Playback)
                body.cover = metadata.cover;
            } else {
                // Fallback to legacy specific helpers if extraction failed totally
                body.source_type = 'douyin';
                body.title = document.title.replace(' - 抖音', '').trim();
                body.direct_url = getDouyinUrl();
                // Extract Cover
                const playerCover = findCoverFromPlayer();
                if (playerCover) body.cover = playerCover;
                else {
                    const metaImg = document.querySelector('meta[property="og:image"]');
                    if (metaImg) body.cover = metaImg.content;
                }
            }

            if (!body.direct_url) {
                alert("未检测到媒体流！请务必先【播放视频】等待约 3秒，让浏览器加载数据包后再点击按钮。");
                return;
            }
        }

        // --- YouTube Logic ---
        if (location.hostname.includes('youtube.com')) {
            body.source_type = 'youtube';
            // Title: prefer the dedicated watch-metadata element, fall back to document.title
            const ytTitleEl =
                document.querySelector('yt-formatted-string.style-scope.ytd-watch-metadata') ||
                document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                document.querySelector('h1.title.ytd-video-primary-info-renderer');
            body.title = ytTitleEl
                ? ytTitleEl.textContent.trim()
                : document.title.replace(' - YouTube', '').trim();
            // Cover: og:image meta is always present and high-res on YouTube
            const ytCoverEl = document.querySelector('meta[property="og:image"]');
            if (ytCoverEl) body.cover = ytCoverEl.content;
            // The full URL is all the backend needs; yt-dlp handles the rest
            body.url = window.location.href;
        }

        body.force_refresh = true;

        const contentBox = document.getElementById('sv-content');
        let loadingText = '正在转写...';
        if (mode === 'bookmark') loadingText = '正在入库...';
        if (mode === 'cache_only') loadingText = `正在缓存 (${quality === 'best' ? '最佳' : quality})...`;

        contentBox.innerHTML = `<div class="sv-loading"><div class="spinner"></div><br>${loadingText}</div>`;
        document.getElementById('sv-ai-result').style.display = 'none';

        // Dynamic Endpoint Selection
        let endpointUrl = API_TRANSCRIBE_BILIBILI;

        if (location.hostname.includes('douyin.com')) {
            endpointUrl = API_TRANSCRIBE_DOUYIN;
            // Douyin backend API requires the page URL explicitly
            body.url = window.location.href;
        } else if (location.hostname.includes('youtube.com')) {
            endpointUrl = API_TRANSCRIBE_YOUTUBE;
            // body.url already set in YouTube Logic block above
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: endpointUrl,
            data: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
            onload: function (res) {
                if (res.status === 200) {
                    const data = JSON.parse(res.responseText);

                    if (data.status === 'pending' || data.status === 'processing') {
                        contentBox.innerHTML = '<div class="sv-loading"><div class="spinner"></div><br>任务已排队，正在处理中...</div>';
                        // Start Polling
                        const pollId = data.id;
                        const pollInterval = setInterval(() => {
                            GM_xmlhttpRequest({
                                method: "GET",
                                url: `${API_SEGMENT}/${pollId}`,
                                onload: function (pRes) {
                                    if (pRes.status === 200) {
                                        const pData = JSON.parse(pRes.responseText);
                                        // Fallback: If status is undefined (old server), check raw_text presence
                                        const isSuccess = pData.status === 'completed' || (!pData.status && pData.raw_text && pData.raw_text.length > 0 && !pData.raw_text.startsWith('Error'));
                                        const isFailed = pData.status === 'failed' || (!pData.status && pData.raw_text && pData.raw_text.startsWith('Error'));

                                        if (isSuccess) {
                                            clearInterval(pollInterval);
                                            contentBox.innerHTML = (pData.cached ? `<div style="color:#10b981; font-size:11px; margin-bottom:4px; display:flex; align-items:center; gap:4px;">${ICONS.zap} 已命中缓存</div>` : '') + parseTextToHtml(pData.raw_text);
                                            renderLyrics(pData); // Render Lyrics View
                                            fetchAndRenderHistory();
                                        } else if (isFailed) {
                                            clearInterval(pollInterval);
                                            contentBox.innerHTML = `<div style="color:#ef4444; display:flex; align-items:center; gap:4px;">${ICONS.alert} 任务失败: ${pData.raw_text}</div>`;
                                            fetchAndRenderHistory();
                                        }
                                    }
                                }
                            });
                        }, 2000);

                    } else if (data.status === 'bookmarked') {
                        contentBox.innerHTML = `
                            <div style="text-align:center; padding:20px 10px; color:#10b981;">
                                <div style="font-size:11px; margin-bottom:10px;">${ICONS.check}</div>
                                <div style="font-size:15px; font-weight:bold; margin-bottom:6px;">已成功入库</div>
                                <div style="font-size:11px; color:var(--sv-text-dim);">您可以在 Dashboard 中稍后执行转写</div>
                            </div>`;
                        showToast("✅ 已成功入库");
                        fetchAndRenderHistory();
                    } else {
                        // Cached or immediate
                        contentBox.innerHTML = (data.cached ? `<div style="color:#10b981; font-size:11px; margin-bottom:4px; display:flex; align-items:center; gap:4px;">${ICONS.zap} 已命中缓存</div>` : '') + parseTextToHtml(data.raw_text);
                        renderLyrics(data); // Render Lyrics View
                        fetchAndRenderHistory();
                    }
                } else {
                    contentBox.innerHTML = `<div style="color:#ef4444; display:flex; align-items:center; gap:4px;">${ICONS.alert} 出错: ${res.responseText}</div>`;
                }
            }
        });
    }

    function analyzeText() {
        const promptText = document.getElementById('sv-ai-prompt').value;
        const id = document.getElementById('sv-history-select').value;
        const overwriteChk = document.getElementById('sv-ai-overwrite');
        const configId = document.getElementById('sv-model-select').value;

        if (!promptText) return alert("请输入分析指令");

        const btn = document.getElementById('sv-ai-btn');
        const originText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = `${ICONS.clock} 分析中...`;

        const payload = { source_id: currentSourceID, prompt: promptText };
        if (id) payload.transcription_id = parseInt(id);
        if (configId) payload.llm_model_id = parseInt(configId);

        // Handle Overwrite
        if (overwriteChk.checked && overwriteChk.dataset.latestId) {
            payload.overwrite_id = parseInt(overwriteChk.dataset.latestId);
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: API_ANALYZE,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onload: function (res) {
                btn.disabled = false; btn.textContent = originText;
                if (res.status === 200) {
                    const data = JSON.parse(res.responseText);
                    const aiBox = document.getElementById('sv-ai-result');
                    aiBox.style.display = 'block';

                    const timeInfo = data.duration
                        ? `<div style="font-size:11px; color:var(--sv-text-dim); margin-bottom:5px; display:flex; align-items:center; gap:4px;">${ICONS.zap} 耗时: ${data.duration}s</div>`
                        : '';

                    aiBox.innerHTML = timeInfo + ((typeof marked !== 'undefined') ? marked.parse(data.summary) : data.summary);

                    // Refresh history to update version counts
                    if (id) selectRecord(id);
                    else fetchAndRenderHistory();
                } else {
                    alert("AI分析失败");
                }
            }
        });
    }

    // --- Life Cycle ---
    // --- Life Cycle ---
    function checkURL() {
        let newID = null;
        if (location.hostname.includes('bilibili.com')) {
            const match = window.location.pathname.match(/\/video\/(BV\w+)/);
            newID = match ? match[1] : null;
        } else if (location.hostname.includes('douyin.com')) {
            const match = window.location.pathname.match(/\/(video|note)\/(\d+)/);
            newID = match ? match[2] : null;

            // Fix: Use player metadata as fallback/primary source of truth
            try {
                const meta = extractDouyinMetadata();
                if (meta && meta.bvid) {
                    newID = meta.bvid;
                }
            } catch (e) { console.error("Metadata extraction failed in checkURL", e); }
        } else if (location.hostname.includes('youtube.com')) {
            const params = new URLSearchParams(window.location.search);
            newID = params.get('v') || null;
        }

        if (newID !== currentSourceID) {
            currentSourceID = newID;
            resetUI();
            if (currentSourceID) fetchAndRenderHistory();
        }
        // Always try to bind video (handles player replacements)
        if (typeof ensureVideoBinding === 'function') ensureVideoBinding();
    }

    function resetUI() {
        const content = document.getElementById('sv-content');
        if (content) content.innerHTML = '<div style="text-align:center; color: var(--sv-text-dim);">此视频尚无记录</div>';
        const aiBox = document.getElementById('sv-ai-result');
        if (aiBox) { aiBox.style.display = 'none'; aiBox.textContent = ''; }
        const select = document.getElementById('sv-history-select');
        if (select) select.innerHTML = '<option value="">-- 无历史记录 --</option>';
        currentHistory = [];
        renderTimeline();

        // Restore Bilibili Defaults
        const inputBar = document.getElementById('sv-input-bar');
        if (inputBar) inputBar.style.display = 'flex';

        ['sv-start', 'sv-end', 'sv-get-current'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = ''; // Restore visibility
        });

        if (document.getElementById('sv-douyin-preview-container')) document.getElementById('sv-douyin-preview-container').style.display = 'none';

        // Reset Button
        const btn = document.getElementById('sv-transcribe-btn');
        if (btn) {
            btn.textContent = '🎙️ 执行';
            btn.onclick = () => startTranscription(false);
            btn.classList.remove('sv-btn-orange'); // Remove caution color if any
        }
    }

    // --- Improved Extraction Logic (Metadata) ---
    function extractDouyinMetadata() {
        try {
            const player = unsafeWindow.player || unsafeWindow.xgplayer; // Check common global vars
            if (player && player.config && player.config.awemeInfo) {
                const info = player.config.awemeInfo;
                const video = info.video;
                if (!video) return null;

                // 1. URL Extraction
                let url = null;       // Min Bitrate (for ASR)
                let stream_url = null; // Max Bitrate (for Playback)
                let selectedBR = null;

                if (video.bitRateList && video.bitRateList.length > 0) {
                    // A. Find Min Bitrate (ASR)
                    const sortedAsc = [...video.bitRateList].sort((a, b) => (a.bitRate || 0) - (b.bitRate || 0));
                    for (let br of sortedAsc) {
                        if (br.playAddr && br.playAddr.urlList && br.playAddr.urlList.length > 0) {
                            const u = br.playAddr.urlList[0];
                            if (u && !u.includes('dash')) {
                                url = u;
                                selectedBR = br;
                                break;
                            }
                        }
                    }

                    // B. Find Max Bitrate (Playback)
                    const sortedDesc = [...video.bitRateList].sort((a, b) => (b.bitRate || 0) - (a.bitRate || 0));
                    for (let br of sortedDesc) {
                        if (br.playAddr && br.playAddr.urlList && br.playAddr.urlList.length > 0) {
                            const u = br.playAddr.urlList[0];
                            if (u && !u.includes('dash')) {
                                stream_url = u;
                                break;
                            }
                        }
                    }

                    // Fallback strategies for 'url' (ASR)
                    if (!url) {
                        for (let br of sortedAsc) {
                            if (br.playApi && !br.playApi.includes('dash')) {
                                url = br.playApi;
                                selectedBR = br;
                                break;
                            }
                        }
                    }
                }
                // Fallback
                if (!url) {
                    if (video.playApi) url = video.playApi;
                    else if (video.playAddr && video.playAddr.length > 0) url = video.playAddr[0].src;
                }

                if (!url) return null;
                if (url.startsWith('//')) url = 'https:' + url;

                // 2. Cover Extraction
                let cover = '';
                if (video.originCoverUrlList && video.originCoverUrlList.length > 0) {
                    cover = video.originCoverUrlList[1] || video.originCoverUrlList[0];
                }

                // 3. Size Calculation (Approx)
                let size = 0;
                // Try to find bitrate matching the URL? specific bitRateList item not easily mapped back from URL if generic
                // Just use duration * average bitrate of 540p (approx 1000kbps?) or info.duration
                // Better: if we picked from bitRateList, use that bitrate
                // Simplified: Just "Unknown" if not in bitRateList, or just show duration.
                // Let's try to get Duration at least.
                const duration = video.duration ? (video.duration / 1000) : 0; // ms to s

                // 4. Author
                let author = 'Unknown';
                if (info.authorInfo && info.authorInfo.nickname) author = info.authorInfo.nickname;
                else if (info.author) author = info.author.nickname || info.author;

                const title = info.desc || 'Douyin Video';

                return {
                    url: url,
                    cover: cover,
                    title: title,
                    author: author,
                    duration: duration,
                    stream_url: stream_url || url, // Fallback to min bitrate if max not found
                    source_type: 'douyin',
                    source_method: '内存读取 (Memory)',
                    bvid: info.awemeId || '',
                    // Tech Specs from selected stream (ASR version)
                    tech: selectedBR ? {
                        resolution: `${selectedBR.width}x${selectedBR.height}`,
                        fps: selectedBR.fps,
                        bitrate: selectedBR.bitRate ? Math.round(selectedBR.bitRate / 1024) + ' Kbps' : 'N/A',
                        size: selectedBR.dataSize ? (selectedBR.dataSize / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
                        format: selectedBR.format,
                        quality: selectedBR.gearName
                    } : null,
                    // Full Quality List for Selection
                    qualities: (video.bitRateList || []).map(br => {
                        // const isDash = br.playAddr && br.playAddr.urlList && br.playAddr.urlList[0] && br.playAddr.urlList[0].includes('dash');
                        // if (isDash) return null; // Keep DASH for "hidden" list

                        let directUrl = '';
                        if (br.playAddr && br.playAddr.urlList && br.playAddr.urlList.length > 0) directUrl = br.playAddr.urlList[0];
                        if (!directUrl && br.playApi) directUrl = br.playApi;
                        if (!directUrl) return null;
                        if (directUrl.startsWith('//')) directUrl = 'https:' + directUrl;

                        // determine tag
                        let tag = br.gearName;
                        if (!tag && br.height) tag = `${br.height}p`;
                        if (!tag) tag = 'unknown';

                        return {
                            tag: tag,
                            url: directUrl,
                            width: br.width,
                            height: br.height,
                            fps: br.fps || 0,
                            bitrate: br.bitRate ? Math.round(br.bitRate / 1024) : 0,
                            size: br.dataSize ? (br.dataSize / 1024 / 1024).toFixed(2) : 0,
                            format: br.format
                        };
                    }).filter(q => q !== null).sort((a, b) => b.bitrate - a.bitrate)
                };
            }
        } catch (e) {
            console.log("SenseVoice: Metadata extraction error", e);
        }

        // --- Sniffer Fallback (Minimal) ---
        // If Memory fails, try to find a media resource
        const resources = performance.getEntriesByType('resource');
        const candidates = resources
            .filter(r => r.name.includes('.mp4') || (r.decodedBodySize > 500 * 1024))
            .filter(r => r.name.startsWith('http') && !r.name.includes('.js') && !r.name.includes('.css'))
            .sort((a, b) => b.transferSize - a.transferSize);

        if (candidates.length > 0) {
            return {
                url: candidates[0].name,
                cover: '',
                title: document.title || 'Douyin Video (Sniffed)',
                author: 'Unknown (Sniffer)',
                duration: 0,
                source_type: 'douyin',
                source_method: '网络嗅探 (Sniffer)',
                bvid: 'sniffed_' + Date.now()
            };
        }

        return null;
    }

    function getDouyinUrl() {
        if (!location.hostname.includes('douyin.com')) return null;

        // 0. Global Player (New Best Method)
        let meta = extractDouyinMetadata();
        if (meta && meta.url) {
            return meta.url;
        }

        // 1. URI Construction (Priority)
        let uri = null;
        try {
            const script = document.getElementById('RENDER_DATA');
            if (script) {
                const jsonStr = decodeURIComponent(script.textContent);
                const match = jsonStr.match(/"uri"\s*:\s*"(v[0-9a-zA-Z]{31})"/);
                if (match) uri = match[1];
            }
        } catch (e) { }

        if (!uri) {
            const text = document.documentElement.innerHTML;
            const patterns = [
                /(?:["']|\\")uri(?:["']|\\")\s*[:=]\s*(?:["']|\\")(v[0-9a-zA-Z]{31})(?:["']|\\")/,
                /vid\s*[:=]\s*["']?(v[0-9a-zA-Z]{31})["']?/,
                /video_id=(v[0-9a-zA-Z]{31})/,
                /\b(v[0-9a-zA-Z]{31})\b/ // Blind scan
            ];
            for (let p of patterns) {
                const m = text.match(p);
                if (m) { uri = m[1]; break; }
            }
        }

        if (uri) {
            return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=540p&line=0`;
        }

        // 2. Network Sniffer (Fallback)
        const resources = performance.getEntriesByType('resource');
        const candidates = resources
            .filter(r => r.transferSize > 500 * 1024 || (r.encodedBodySize > 0 && r.decodedBodySize > 500 * 1024) || r.name.includes('.mp4'))
            .filter(r => r.name.startsWith('http') && !r.name.includes('.js') && !r.name.includes('.css') && !r.name.includes('.png'))
            .sort((a, b) => b.transferSize - a.transferSize);

        if (candidates.length > 0) return candidates[0].name;

        // 3. Video Src (Last Resort)
        const video = document.querySelector('video');
        if (video && !video.src.startsWith('blob:') && video.src.startsWith('http')) {
            return video.src;
        }

        return null;
    }

    // --- Status Polling ---
    function checkDouyinStatus() {
        if (!location.hostname.includes('douyin.com')) return;

        const btn = document.getElementById('sensevoice-btn');
        if (!btn) return;

        const url = getDouyinUrl();
        if (url) {
            // Ready State
            btn.innerHTML = '✅ 就绪';
            btn.style.background = '#10b981'; // Green
            btn.style.borderColor = '#10b981';
            btn.title = "已提取到直链，点击转写";
        } else {
            // Waiting State
            btn.innerHTML = '⏳ 探测以及等待...';
            btn.style.background = '#f59e0b'; // Amber/Orange
            btn.style.borderColor = '#d97706';
            btn.title = "正在探测视频流 (请尝试播放视频)";
        }
    }

    function addButton() {
        if (document.getElementById('sensevoice-btn')) return;

        // Bilibili Logic (Original)
        if (location.hostname.includes('bilibili.com')) {
            const target = document.querySelector('.video-toolbar-left') || document.querySelector('.video-info-container');
            if (target) {
                const btn = document.createElement('button');
                btn.id = 'sensevoice-btn';
                btn.innerHTML = '🎙️ 转写';
                btn.onclick = () => {
                    const modal = document.getElementById('sensevoice-modal') || createUI();
                    const wasHidden = !modal.classList.contains('show');
                    modal.classList.add('show');
                    if (wasHidden) { checkURL(); fetchAndRenderHistory(); }
                };
                target.appendChild(btn);
            }
        }
        // Douyin Logic (Floating Button)
        else if (location.hostname.includes('douyin.com')) {
            const btn = document.createElement('button');
            btn.id = 'sensevoice-btn';
            btn.innerHTML = '🎙️ 转写'; // Initial state

            // Floating Style
            Object.assign(btn.style, {
                position: 'fixed',
                top: '120px',
                right: '20px',
                zIndex: '999999', // Extremely high Z-index
                padding: '8px 16px',
                borderRadius: '20px',
                background: '#fe2c55', // Douyin Red (Default)
                color: '#fff',
                border: '2px solid white',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                transition: 'all 0.3s ease'
            });

            btn.onclick = () => {
                const modal = document.getElementById('sensevoice-modal') || createUI();
                // Ensure modal is safe
                if (!modal.parentNode) document.body.appendChild(modal);
                modal.style.zIndex = '9999999'; // Ensure modal is on top of everything

                const wasHidden = !modal.classList.contains('show');
                modal.classList.add('show');
                if (wasHidden) { checkURL(); fetchAndRenderHistory(); }
            };
            document.body.appendChild(btn);

            // Start local poll for this button
            setInterval(checkDouyinStatus, 1000);
        }
        // YouTube Logic (Floating Draggable Button)
        else if (location.hostname.includes('youtube.com')) {
            // Only show on watch pages
            if (!location.pathname.startsWith('/watch')) return;

            const btn = document.createElement('button');
            btn.id = 'sensevoice-btn';
            btn.innerHTML = '🎙️ 转写';

            // Floating style (YouTube Red accent)
            Object.assign(btn.style, {
                position: 'fixed',
                top: '80px',
                right: '20px',
                zIndex: '999999',
                padding: '8px 16px',
                borderRadius: '20px',
                background: '#ff0000',
                color: '#fff',
                border: '2px solid rgba(255,255,255,0.8)',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                transition: 'transform 0.1s',
                userSelect: 'none'
            });

            // --- Drag Logic (same pattern as Douyin floating ball) ---
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;
            let hasMoved = false;

            btn.onmousedown = (e) => {
                isDragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                const rect = btn.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;
                // Switch to left/top positioning for free movement
                btn.style.right = 'auto';
                btn.style.left = `${initialLeft}px`;
                btn.style.top = `${initialTop}px`;
                btn.style.cursor = 'grabbing';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true;
                btn.style.left = `${initialLeft + dx}px`;
                btn.style.top = `${initialTop + dy}px`;
            };

            const onMouseUp = () => {
                isDragging = false;
                btn.style.cursor = 'pointer';
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            // Hover Effect (only when not dragging)
            btn.onmouseenter = () => { if (!isDragging) btn.style.transform = 'scale(1.05)'; };
            btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };

            // Click Action (only if not dragged)
            btn.onclick = () => {
                if (hasMoved) return;
                const modal = document.getElementById('sensevoice-modal') || createUI();
                if (!modal.parentNode) document.body.appendChild(modal);
                const wasHidden = !modal.classList.contains('show');
                modal.classList.add('show');
                if (wasHidden) { checkURL(); fetchAndRenderHistory(); }
            };

            document.body.appendChild(btn);
            console.log('[DiTing] YouTube draggable button injected');
        }
    }

    // --- Douyin Logic ---
    // --- Douyin Logic ---
    function initDouyin() {
        if (document.getElementById('sensevoice-floating-ball')) return;

        const ball = document.createElement('div');
        ball.id = 'sensevoice-floating-ball';
        ball.innerHTML = `🎙️`;
        ball.title = "打开转录面板";

        Object.assign(ball.style, {
            position: 'fixed',
            bottom: '100px',
            right: '20px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: '#fe2c55',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            cursor: 'pointer',
            zIndex: '999999',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'transform 0.1s',
            userSelect: 'none'
        });

        // Hover Effect
        ball.onmouseenter = () => ball.style.transform = 'scale(1.1)';
        ball.onmouseleave = () => ball.style.transform = 'scale(1.0)';

        // Drag Logic
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let hasMoved = false;

        ball.onmousedown = (e) => {
            isDragging = true;
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = ball.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // Clear right/bottom to allow free movement via left/top
            ball.style.right = 'auto';
            ball.style.bottom = 'auto';
            ball.style.left = `${initialLeft}px`;
            ball.style.top = `${initialTop}px`;
            ball.style.cursor = 'grabbing';
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true;
            ball.style.left = `${initialLeft + dx}px`;
            ball.style.top = `${initialTop + dy}px`;
        };

        const onMouseUp = () => {
            isDragging = false;
            ball.style.cursor = 'pointer';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Click Action (Only if not dragged)
        ball.onclick = () => {
            if (!hasMoved) openDouyinPanel();
        };

        document.body.appendChild(ball);
    }

    function openDouyinPanel() {
        // 1. Open UI
        const modal = document.getElementById('sensevoice-modal') || createUI();
        if (!modal.parentNode) document.body.appendChild(modal);
        modal.classList.add('show');

        // 2. Adjust UI for Douyin
        // 2. Adjust UI for Douyin
        const inputBar = document.getElementById('sv-input-bar');
        if (inputBar) inputBar.style.display = 'flex'; // Ensure bar is visible

        // Hide specific elements only
        ['sv-start', 'sv-end', 'sv-get-current', 'sv-quality', 'sv-cache-only-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const previewContainer = document.getElementById('sv-douyin-preview-container');
        if (previewContainer) {
            previewContainer.style.display = 'block';
            previewContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--sv-text-dim);">⌛ 等待提取信息...</div>';
        }

        // 3. Set Button to Preview Mode
        const btn = document.getElementById('sv-transcribe-btn');
        if (btn) {
            btn.textContent = '🔍 获取信息';
            btn.onclick = () => renderDouyinPreview();
        }

        // 4. Auto-Preview (Optimistic)
        // If we already have metadata, render immediately
        const meta = extractDouyinMetadata();
        if (meta && meta.url) {
            renderDouyinPreview();
        }

        // 5. Update global ID if possible (for history)
        // PROACTIVE FIX: Ensure source_id is not a URL
        if (meta && meta.bvid && !meta.bvid.includes('http')) {
            currentSourceID = meta.bvid;
        } else {
            checkURL();
        }

        if (currentSourceID) fetchAndRenderHistory();
    }

    function renderDouyinPreview() {
        const container = document.getElementById('sv-douyin-preview-container');
        const btn = document.getElementById('sv-transcribe-btn');
        if (!container) return;

        const meta = extractDouyinMetadata();

        if (!meta || !meta.url) {
            container.innerHTML = `
                <div style="padding:15px; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; color:#ef4444; text-align:center;">
                    ⚠️ 未检测到视频信息<br>
                    <span style="font-size:12px; opacity:0.8;">请尝试播放视频后再点击</span>
                </div>
            `;
            if (btn) {
                btn.textContent = '🔄 重试获取';
                btn.onclick = () => renderDouyinPreview();
            }
            return;
        }

        // Success - Render Card
        const isMem = meta.source_method && meta.source_method.includes('Memory');
        const badgeClass = isMem ? 'mem' : 'sniff';
        const badgeText = isMem ? '⚡ 内存读取' : '📡 嗅探模式';
        const durStr = formatTime(meta.duration);

        container.innerHTML = `
            <div class="dy-card">
                <img src="${meta.cover || ''}" class="dy-card-cover" onerror="this.style.display='none'">
                <div class="dy-card-content">
                    <div class="dy-card-title" title="${meta.title}">${meta.title}</div>
                    <div class="dy-card-meta">
                        <span>👤 ${meta.author}</span>
                        <span style="opacity:0.5">|</span>
                        <span>⏱️ ${durStr}</span>
                         ${meta.tech ? `<span style="opacity:0.5">|</span> <span>📦 ${meta.tech.size}</span>` : ''}
                    </div>

                    ${meta.qualities && meta.qualities.length > 0 ? `
                    <div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:6px; margin-bottom:8px;">
                        ${(() => {
                    // Filter logic: Best, Mid, Smallest
                    // Filter logic: Best, Mid, Smallest (Prioritize MP4)
                    let displayList = [];
                    let hiddenList = [];

                    // Separate MP4 vs others (DASH)
                    // Note: 'format' might be undefined or 'dash', check URL too just in case
                    const mp4List = meta.qualities.filter(q => q.format !== 'dash' && !q.url.includes('dash'));
                    const otherList = meta.qualities.filter(q => !mp4List.includes(q));

                    if (mp4List.length > 3) {
                        const best = mp4List[0];
                        const smallest = mp4List[mp4List.length - 1];
                        const midIndex = Math.floor(mp4List.length / 2);
                        const mid = mp4List[midIndex];

                        // Dedup in case list is short or duplicates
                        const keyList = [best, mid, smallest].filter((item, index, self) => self.indexOf(item) === index);

                        displayList = keyList;
                        hiddenList = mp4List.filter(q => !keyList.includes(q));
                    } else {
                        displayList = mp4List;
                    }

                    // Append non-MP4s to hidden list
                    hiddenList = [...hiddenList, ...otherList];

                    const renderRow = (q) => `
                                <div class="dy-quality-row" style="display:flex; align-items:center; justify-content:space-between; font-size:11px; padding:6px 8px; margin-bottom:4px; background:rgba(255,255,255,0.05); border-radius:4px; transition:background 0.2s;">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <div style="display:flex; flex-direction:column; min-width:50px;">
                                            <span style="color:var(--sv-text); font-weight:bold; font-size:12px;">${q.tag}</span>
                                            <span style="color:var(--sv-text-dim); font-size:10px;">${q.size}M</span>
                                        </div>
                                        <div style="display:flex; flex-direction:column; gap:2px; color:var(--sv-text-dim); font-size:10px;">
                                            <span>${q.fps} FPS · ${q.format}</span>
                                            <span>${q.bitrate} Kbps</span>
                                        </div>
                                    </div>
                                    <button class="sv-tool-btn sv-dy-cache-btn" data-url="${q.url}" data-tag="${q.tag}" style="padding:4px 10px; font-size:11px; background:var(--sv-highlight); color:#fff; border:none; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:4px;">
                                        ${ICONS.download || '💾'} 缓存
                                    </button>
                                </div>
                            `;

                    let html = displayList.map(renderRow).join('');

                    if (hiddenList.length > 0) {
                        html += `
                                    <div id="dy-quality-more" style="display:none; margin-top:4px;">
                                        ${hiddenList.map(renderRow).join('')}
                                    </div>
                                    <div style="text-align:center; margin-top:4px;">
                                    <div style="text-align:center; margin-top:4px;">
                                        <button id="sv-dy-expand-btn" style="background:rgba(255,255,255,0.1); border:none; color:var(--sv-text-dim); cursor:pointer; font-size:11px; padding:4px 12px; border-radius:12px; position:relative; z-index:10;">
                                            ⬇️ 展开更多 (${hiddenList.length})
                                        </button>
                                    </div>
                                `;
                    }
                    return html;
                })()}
                    </div>
                    ` : (meta.tech ? `
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:4px; margin-bottom:8px; background:rgba(0,0,0,0.2); padding:6px; border-radius:6px; font-size:11px; color:var(--sv-text-dim);">
                        <div>📺 <span style="color:var(--sv-text)">${meta.tech.resolution}</span></div>
                        <div>🎞️ <span style="color:var(--sv-text)">${meta.tech.fps} FPS</span></div>
                        <div>💾 <span style="color:var(--sv-text)">${meta.tech.format}</span></div>
                        <div>⚡ <span style="color:var(--sv-text)">${meta.tech.bitrate}</span></div>
                        <div>💎 <span style="color:var(--sv-text)">${meta.tech.quality}</span></div>
                        <div style="grid-column: span 1;"><a href="${meta.url}" target="_blank" style="color:var(--sv-highlight); text-decoration:none;">🔗 最低画质 &nearr;</a></div>
                    </div>
                    ` : '')}

                    <div class="dy-card-footer">
                        <span class="dy-badge ${badgeClass}">${badgeText}</span>
                        <span class="dy-id">ID: ${meta.bvid}</span>
                    </div>
                </div>
            </div>
        `;

        // Event Delegation for Expand Button (Fix for inline onclick issues)
        setTimeout(() => {
            const expandBtn = document.getElementById('sv-dy-expand-btn');
            if (expandBtn) {
                expandBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const more = document.getElementById('dy-quality-more');
                    if (more) more.style.display = 'block';
                    expandBtn.style.display = 'none';
                };
            }
            // Cache Buttons
            const cacheBtns = container.querySelectorAll('.sv-dy-cache-btn');
            cacheBtns.forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = btn.dataset.url;
                    const tag = btn.dataset.tag;
                    cacheDouyinQuality(url, tag);
                };
            });
        }, 100);

        // Expose cache function globally
        window.cacheDouyinQuality = (url, tag) => {
            const body = {
                url: window.location.href,
                source_id: currentSourceID,
                task_type: 'cache_only',
                quality: tag,
                direct_url: url,
                source_type: 'douyin',
                title: meta.title,
                cover: meta.cover,
                force_refresh: true
            };

            const contentBox = document.getElementById('sv-content');
            contentBox.innerHTML = `<div class="sv-loading"><div class="spinner"></div><br>正在缓存 (${tag})...</div>`;

            GM_xmlhttpRequest({
                method: "POST",
                url: API_TRANSCRIBE_DOUYIN,
                data: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
                onload: function (res) {
                    if (res.status === 200) {
                        showToast(`✅ 已开始缓存: ${tag}`);
                        fetchAndRenderHistory();
                    } else {
                        alert("缓存失败: " + res.responseText);
                        fetchAndRenderHistory(); // Restore UI
                    }
                }
            });
        };

        // Update Button to "Execute"
        if (btn) {
            btn.textContent = '🎙️ 开始转写';
            btn.classList.remove('sv-btn-orange');
            btn.onclick = () => startTranscription(false);
        }

        // Update Global ID
        if (meta.bvid && !meta.bvid.includes('http')) {
            currentSourceID = meta.bvid;
            fetchAndRenderHistory();
        }
    }





    // --- Init Router ---
    function init() {
        if (location.hostname.includes('bilibili.com')) {
            setInterval(checkURL, 2000);
            setTimeout(addButton, 1000);
            setInterval(addButton, 2000);
        } else if (location.hostname.includes('douyin.com')) {
            initDouyin();
            setInterval(checkURL, 1500); // Poll for URL changes on Douyin
        } else if (location.hostname.includes('youtube.com')) {
            // YouTube is a heavy SPA — yt-navigate-finish fires on each page transition
            const onYouTubeNavigate = () => {
                console.log('[DiTing] YouTube navigation detected:', location.pathname);
                // Remove stale button if not on a watch page
                const oldBtn = document.getElementById('sensevoice-btn');
                if (!location.pathname.startsWith('/watch')) {
                    if (oldBtn) oldBtn.remove();
                    return;
                }
                // Re-inject if needed
                checkURL();
                if (!document.getElementById('sensevoice-btn')) addButton();
            };

            // Listen for YouTube's SPA navigation event
            document.addEventListener('yt-navigate-finish', onYouTubeNavigate);

            // Also poll as fallback (yt-navigate-finish may not fire on initial load)
            setInterval(checkURL, 2000);
            setTimeout(addButton, 2000);
            setInterval(() => {
                if (location.pathname.startsWith('/watch') && !document.getElementById('sensevoice-btn')) {
                    addButton();
                }
            }, 3000);
        }
    }

    // Run Init
    init();

    // --- Advanced AI Rendering ---
    window.sv_toggleRefine = function (id) {
        const box = document.getElementById(`sv-refine-box-${id}`);
        if (box) {
            box.style.display = box.style.display === 'none' ? 'block' : 'none';
            if (box.style.display === 'block') {
                setTimeout(() => document.getElementById(`sv-refine-text-${id}`).focus(), 100);
            }
        }
    };

    window.sv_submitRefine = function (parentId) {
        const text = document.getElementById(`sv-refine-text-${parentId}`).value;
        const configId = document.getElementById('sv-model-select').value;

        if (!text) return alert("请输入追问内容");

        const btn = document.getElementById(`sv-refine-btn-${parentId}`);
        const originText = btn.textContent;
        btn.disabled = true; btn.textContent = "⏳...";

        const payload = {
            source_id: currentSourceID,
            prompt: text,
            parent_id: parentId,
            transcription_id: parseInt(document.getElementById('sv-history-select').value)
        };
        if (configId) payload.llm_model_id = parseInt(configId);

        GM_xmlhttpRequest({
            method: "POST",
            url: API_ANALYZE,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onload: function (res) {
                btn.disabled = false; btn.textContent = originText;
                if (res.status === 200) {
                    // clear input and refresh
                    document.getElementById(`sv-refine-text-${parentId}`).value = '';
                    selectRecord(payload.id);
                } else {
                    alert("AI Refine Failed");
                }
            }
        });
    };

    window.sv_renderRootTree = function (rootNode, allNodes, container) {
        // Render Root Card
        const card = document.createElement('div');
        card.className = 'sv-ai-card';
        card.style.borderLeft = '4px solid var(--sv-highlight)'; // Highlight root

        const timeStr = rootNode.response_time ? `${rootNode.response_time}s` : '';
        const modelStr = rootNode.model ? rootNode.model : 'AI';

        card.innerHTML = `
            <div class="sv-ai-header">
                <span>${rootNode.prompt.length > 30 ? rootNode.prompt.substring(0, 30) + '...' : rootNode.prompt}</span>
                <span>${modelStr} ${timeStr ? '⚡' + timeStr : ''}</span>
            </div>
            <div class="sv-ai-body">
                ${(typeof marked !== 'undefined') ? marked.parse(rootNode.summary) : rootNode.summary}
            </div>
            <div class="sv-ai-footer">
                 <span class="sv-ai-action sv-refine-toggle">💬 追问 / Refine</span>
            </div>
            <div class="sv-refine-box" id="sv-refine-box-${rootNode.id}">
                <textarea class="sv-refine-textarea" id="sv-refine-text-${rootNode.id}" placeholder="输入追问或修改建议..."></textarea>
                <div style="text-align:right; margin-top:6px;">
                    <button class="sv-action-btn ai sv-refine-submit" id="sv-refine-btn-${rootNode.id}">提交分析</button>
                </div>
            </div>
        `;

        // Bind JS Events to avoid sandbox scope issues
        card.querySelector('.sv-refine-toggle').onclick = () => window.sv_toggleRefine(rootNode.id);
        card.querySelector('.sv-refine-submit').onclick = () => window.sv_submitRefine(rootNode.id);

        container.appendChild(card);

        // Render Children (Thread)
        const children = allNodes.filter(n => n.parent_id === rootNode.id);
        if (children.length > 0) {
            const threadDiv = document.createElement('div');
            threadDiv.className = 'sv-ai-thread';
            card.appendChild(threadDiv);
            renderAiTree(allNodes, threadDiv, rootNode.id);
        }
    };

    function renderAiTree(nodes, container, parentId) {
        // Filter nodes belonging to this parent
        const children = nodes.filter(n => n.parent_id === parentId);

        children.forEach(node => {
            const card = document.createElement('div');
            card.className = 'sv-ai-card';

            // Header
            const timeStr = node.response_time ? `${node.response_time}s` : '';
            const modelStr = node.model ? `ExampleModel` : '';
            // We don't have model name in legacy summary struct?
            // Actually API returns it.

            card.innerHTML = `
                <div class="sv-ai-header">
                    <span>${node.prompt.length > 30 ? node.prompt.substring(0, 30) + '...' : node.prompt}</span>
                    <span>${node.model || 'AI'} ${timeStr ? '⚡' + timeStr : ''}</span>
                </div>
                <div class="sv-ai-body">
                    ${(typeof marked !== 'undefined') ? marked.parse(node.summary) : node.summary}
                </div>
                <div class="sv-ai-footer">
                     <span class="sv-ai-action sv-refine-toggle">💬 追问 / Refine</span>
                </div>
                <div class="sv-refine-box" id="sv-refine-box-${node.id}">
                    <textarea class="sv-refine-textarea" id="sv-refine-text-${node.id}" placeholder="输入追问或修改建议..."></textarea>
                    <div style="text-align:right; margin-top:6px;">
                        <button class="sv-action-btn ai sv-refine-submit" id="sv-refine-btn-${node.id}">提交分析</button>
                    </div>
                </div>
            `;

            // Bind JS Events
            card.querySelector('.sv-refine-toggle').onclick = () => window.sv_toggleRefine(node.id);
            card.querySelector('.sv-refine-submit').onclick = () => window.sv_submitRefine(node.id);

            container.appendChild(card);

            // Render Children
            const grandChildren = nodes.filter(n => n.parent_id === node.id);
            if (grandChildren.length > 0) {
                const threadDiv = document.createElement('div');
                threadDiv.className = 'sv-ai-thread';
                card.appendChild(threadDiv); // Append inside card or after?
                // Inside card logic visualizes nesting well?
                // Detail page: Thread is recursive.
                // Let's append to a dedicated container AFTER functionality buttons
                renderAiTree(nodes, threadDiv, node.id); // Recursion
            }
        });
    }

    // --- Toast Notification ---
    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 16px 32px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: bold;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            backdrop-filter: blur(4px);
        `;
        document.body.appendChild(toast);

        // Animate In
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        // Animate Out
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }
})();

import { useState } from 'react'

const TAURI_AVAILABLE = typeof window !== 'undefined' && '__TAURI__' in window

export default function DoneStep() {
    const [closing, setClosing] = useState(false)

    const finish = async () => {
        setClosing(true)
        try {
            if (TAURI_AVAILABLE) {
                const { invoke } = await import('@tauri-apps/api/core')
                await invoke('mark_setup_done')
                // Close wizard and show main window
                const { getCurrentWindow } = await import('@tauri-apps/api/window')
                await getCurrentWindow().close()
            }
        } catch (e) {
            console.error('Failed to finish setup:', e)
            // Fallback: redirect to main app
            window.location.href = '/app/'
        }
    }

    return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="text-5xl">🎉</div>
            <h1 className="text-2xl font-bold">You're All Set!</h1>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
                DiTing is ready to use. You can always adjust settings from the Management page later.
            </p>
            <button
                onClick={finish}
                disabled={closing}
                className="mt-4 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
            >
                {closing ? 'Opening...' : 'Open Dashboard'}
            </button>
        </div>
    )
}

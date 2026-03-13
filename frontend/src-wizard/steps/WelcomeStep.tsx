interface Props {
    onNext: () => void
}

export default function WelcomeStep({ onNext }: Props) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="text-5xl">🎧</div>
            <h1 className="text-2xl font-bold">Welcome to DiTing</h1>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
                DiTing transforms videos into searchable, annotated text.
                Let's get you set up in a few quick steps.
            </p>
            <button
                onClick={onNext}
                className="mt-4 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: 'var(--color-primary)' }}
            >
                Get Started
            </button>
        </div>
    )
}

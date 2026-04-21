import { useLocale } from '../i18n'

interface Props {
    onNext: () => void
}

export default function WelcomeStep({ onNext }: Props) {
    const { t } = useLocale()

    return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="text-5xl">🎧</div>
            <h1 className="text-2xl font-bold">{t('welcome.title')}</h1>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('welcome.desc')}
            </p>
            <button
                onClick={onNext}
                className="mt-4 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: 'var(--color-primary)' }}
            >
                {t('welcome.start')}
            </button>
        </div>
    )
}

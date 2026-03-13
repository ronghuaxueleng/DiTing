import { useState } from 'react'
import { useLocale } from './i18n'
import WelcomeStep from './steps/WelcomeStep'
import ASRWorkerStep from './steps/ASRWorkerStep'
import BilibiliStep from './steps/BilibiliStep'
import LLMSetupStep from './steps/LLMSetupStep'
import DoneStep from './steps/DoneStep'

const STEPS = ['welcome', 'asr', 'bilibili', 'llm', 'done'] as const
type Step = typeof STEPS[number]

export default function WizardApp() {
    const [step, setStep] = useState<Step>('welcome')
    const { locale, setLocale } = useLocale()

    const currentIndex = STEPS.indexOf(step)
    const goNext = () => {
        if (currentIndex < STEPS.length - 1) {
            setStep(STEPS[currentIndex + 1]!)
        }
    }
    const goBack = () => {
        if (currentIndex > 0) {
            setStep(STEPS[currentIndex - 1]!)
        }
    }

    const toggleLocale = () => {
        setLocale(locale === 'zh' ? 'en' : 'zh')
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            {/* Top bar: progress + language toggle */}
            <div className="flex items-center gap-3 px-6 pt-5">
                <div className="flex gap-1 flex-1">
                    {STEPS.map((s, i) => (
                        <div
                            key={s}
                            className="h-1 flex-1 rounded-full transition-colors duration-300"
                            style={{
                                background: i <= currentIndex ? 'var(--color-primary)' : 'var(--color-border)',
                            }}
                        />
                    ))}
                </div>
                <button
                    onClick={toggleLocale}
                    className="text-xs px-2 py-1 rounded border transition-colors shrink-0"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                    {locale === 'zh' ? 'EN' : '中文'}
                </button>
            </div>

            {/* Step content */}
            <div className="flex-1 px-6 py-5 overflow-y-auto">
                {step === 'welcome' && <WelcomeStep onNext={goNext} />}
                {step === 'asr' && <ASRWorkerStep onNext={goNext} onBack={goBack} />}
                {step === 'bilibili' && <BilibiliStep onNext={goNext} onBack={goBack} />}
                {step === 'llm' && <LLMSetupStep onNext={goNext} onBack={goBack} />}
                {step === 'done' && <DoneStep />}
            </div>
        </div>
    )
}

import { useState } from 'react'
import WelcomeStep from './steps/WelcomeStep'
import ASRWorkerStep from './steps/ASRWorkerStep'
import LLMSetupStep from './steps/LLMSetupStep'
import DoneStep from './steps/DoneStep'

const STEPS = ['welcome', 'asr', 'llm', 'done'] as const
type Step = typeof STEPS[number]

export default function WizardApp() {
    const [step, setStep] = useState<Step>('welcome')

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

    return (
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            {/* Progress bar */}
            <div className="flex gap-1 px-6 pt-5">
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

            {/* Step content */}
            <div className="flex-1 px-6 py-5 overflow-y-auto">
                {step === 'welcome' && <WelcomeStep onNext={goNext} />}
                {step === 'asr' && <ASRWorkerStep onNext={goNext} onBack={goBack} />}
                {step === 'llm' && <LLMSetupStep onNext={goNext} onBack={goBack} />}
                {step === 'done' && <DoneStep />}
            </div>
        </div>
    )
}

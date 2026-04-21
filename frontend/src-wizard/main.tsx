import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WizardApp from './WizardApp'
import '../src/index.css'

createRoot(document.getElementById('wizard-root')!).render(
    <StrictMode>
        <WizardApp />
    </StrictMode>,
)

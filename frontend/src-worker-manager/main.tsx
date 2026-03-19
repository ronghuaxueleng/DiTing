import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WorkerManagerApp from './WorkerManagerApp'
import '../src/i18n'
import '../src/index.css'

createRoot(document.getElementById('worker-manager-root')!).render(
    <StrictMode>
        <WorkerManagerApp />
    </StrictMode>,
)

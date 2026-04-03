import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NotchView } from '@/components/NotchView/NotchView'
import '@/styles/index.css'

document.body.style.background = 'transparent'
document.body.style.margin = '0'
document.body.style.padding = '0'
document.body.style.overflow = 'visible'
document.documentElement.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NotchView />
  </StrictMode>
)

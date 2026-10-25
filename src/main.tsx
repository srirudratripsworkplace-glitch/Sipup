import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './Theme'
import './index.css'
import './storefront-redesign.css'
import './responsive.css'
import './themes.css'
import './mobile-storefront.css'
import './mobile-refresh.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider><App /></ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

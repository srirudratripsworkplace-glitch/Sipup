import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111a16' : '#f6f4ed')
  }, [theme])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === 'sipup-appearance') setTheme(event.newValue === 'dark' ? 'dark' : 'light') }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    try { localStorage.setItem('sipup-appearance', next) } catch { /* Appearance still works without storage. */ }
    setTheme(next)
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useContext(ThemeContext)
  const target = theme === 'light' ? 'dark' : 'light'
  return <button type="button" className={`theme-toggle${compact ? ' theme-toggle-compact' : ''}`} onClick={toggle} aria-label={`Switch to ${target} theme`} aria-pressed={theme === 'dark'} title={`Switch to ${target} theme`}>
    {theme === 'light' ? <Moon size={18} /> : <Sun size={19} />}<span>{target === 'dark' ? 'Dark' : 'Light'}</span>
  </button>
}

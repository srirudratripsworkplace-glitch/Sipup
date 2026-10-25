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
    try { localStorage.setItem('sipup-theme', theme) } catch { /* The switch still works when storage is unavailable. */ }
  }, [theme])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === 'sipup-theme' && (event.newValue === 'dark' || event.newValue === 'light')) setTheme(event.newValue) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return <ThemeContext.Provider value={{ theme, toggle: () => setTheme(current => current === 'light' ? 'dark' : 'light') }}>{children}</ThemeContext.Provider>
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useContext(ThemeContext)
  const target = theme === 'light' ? 'dark' : 'light'
  return <button type="button" className={`theme-toggle${compact ? ' theme-toggle-compact' : ''}`} onClick={toggle} aria-label={`Switch to ${target} theme`} aria-pressed={theme === 'dark'} title={`Switch to ${target} theme`}>
    {theme === 'light' ? <Moon size={18} /> : <Sun size={19} />}<span>{target === 'dark' ? 'Dark' : 'Light'}</span>
  </button>
}

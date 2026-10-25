// Run before the app renders so saved appearance is applied without a light flash.
(() => {
  let theme
  try { theme = localStorage.getItem('sipup-theme') } catch {}
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#111a16' : '#f6f4ed'
})()

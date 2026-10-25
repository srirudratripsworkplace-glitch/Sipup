// Start in light mode unless the shopper has explicitly chosen another appearance.
(() => {
  let theme
  try { theme = localStorage.getItem('sipup-appearance') } catch {}
  if (theme !== 'light' && theme !== 'dark') theme = 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#111a16' : '#f6f4ed'
})()

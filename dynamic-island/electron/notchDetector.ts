import { execSync } from 'child_process'
import { screen } from 'electron'

export function hasHardwareNotch(): boolean {
  try {
    const model = execSync('sysctl -n hw.model').toString().trim()
    if (/^MacBookPro(1[8-9]|[2-9]\d),/.test(model)) return true
    if (/^MacBookAir(1[1-9]|[2-9]\d),/.test(model)) return true
    if (/^Mac(1[4-9]|[2-9]\d),/.test(model)) {
      const internal = getInternalDisplay()
      if (!internal) return false
      return (internal.workArea.y - internal.bounds.y) >= 32
    }
    return false
  } catch {
    return false
  }
}

export function getInternalDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays()
  for (const d of displays) {
    if ((d as any).internal === true) return d
    const label = (d.label || '').toLowerCase()
    if (label.includes('built-in') || label.includes('color lcd') || label.includes('liquid retina')) return d
  }
  if (displays.length === 1) return displays[0]
  return null
}

export function getNotchHeight(display: Electron.Display): number {
  const topOffset = display.workArea.y - display.bounds.y
  return topOffset > 0 ? topOffset : 40
}

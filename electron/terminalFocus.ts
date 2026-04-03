import { spawnSync } from 'child_process'
import type { CliSession } from './sessionManager'

type TerminalType = 'terminal' | 'vscode' | 'cursor' | 'windsurf' | 'warp' | 'unknown'

function detectTerminalType(
  env: Record<string, string> = {},
  pidChain: Array<{ pid: number; comm: string }> = []
): TerminalType {
  // Env-based detection is most reliable
  if (env.WARP_IS_LOCAL_SHELL_SESSION || env.WARP_SESSION_ID) return 'warp'
  if (env.CURSOR_TRACE_ID) return 'cursor'
  if (env.WINDSURF_EXTENSION || env.WINDSURF_EXTENSION_VERSION) return 'windsurf'
  if (env.TERM_PROGRAM === 'vscode') {
    // Disambiguate VS Code vs Cursor/Windsurf via pid chain
    for (const { comm } of pidChain) {
      const c = comm.toLowerCase()
      if (c === 'cursor') return 'cursor'
      if (c.includes('windsurf')) return 'windsurf'
    }
    return 'vscode'
  }
  if (env.TERM_PROGRAM === 'Apple_Terminal' || env.__CFBundleIdentifier === 'com.apple.Terminal') {
    return 'terminal'
  }

  // Pid-chain fallback
  for (const { comm } of pidChain) {
    const c = comm.toLowerCase()
    if (c.includes('warp')) return 'warp'
    if (c === 'cursor') return 'cursor'
    if (c.includes('windsurf')) return 'windsurf'
    if (c === 'code' || c === 'code helper' || c === 'code - insiders') return 'vscode'
    if (c === 'terminal') return 'terminal'
  }

  return 'unknown'
}

export function isTerminalFocused(session: CliSession): boolean {
  const type = detectTerminalType(session.terminalEnv ?? {}, session.pidChain ?? [])
  try {
    if (type === 'terminal') {
      if (!session.tty) {
        const r = spawnSync('osascript', ['-e', 'tell application "Terminal" to return frontmost'],
          { encoding: 'utf8', timeout: 2000 })
        return r.stdout?.trim() === 'true'
      }
      const result = spawnSync('osascript', ['-'], {
        input: `
tell application "Terminal"
  if not frontmost then return "false"
  try
    if tty of selected tab of front window is "${session.tty}" then return "true"
  end try
  return "false"
end tell`,
        encoding: 'utf8',
        timeout: 2000
      })
      return result.stdout?.trim() === 'true'
    }
    if (type === 'warp') return _isWarpFrontmost()
  } catch { /* ignore */ }
  // IDEs: can't tell if terminal panel is visible — don't suppress
  return false
}

function _isWarpFrontmost(): boolean {
  // Ask Warp directly first (most reliable)
  const direct = spawnSync('osascript', ['-'], {
    input: `try\n  tell application "Warp" to return frontmost\non error\n  return false\nend try`,
    encoding: 'utf8',
    timeout: 2000
  })
  if (direct.stdout?.trim() === 'true') return true

  // Fallback: check via bundle identifier in System Events
  const fallback = spawnSync('osascript', ['-'], {
    input: `try
  tell application "System Events"
    set p to first application process whose frontmost is true
    set bid to ""
    try
      set bid to bundle identifier of p
    end try
    return (name of p) & "|" & bid
  end tell
on error
  return ""
end try`,
    encoding: 'utf8',
    timeout: 2000
  })
  const out = fallback.stdout?.trim()?.toLowerCase() ?? ''
  return out.includes('warp')
}

export function focusTerminal(session: CliSession): void {
  const type = detectTerminalType(session.terminalEnv, session.pidChain)

  switch (type) {
    case 'terminal':
      focusTerminalApp(session.tty)
      break
    case 'vscode':
      activateApp('Visual Studio Code')
      break
    case 'cursor':
      activateApp('Cursor')
      break
    case 'windsurf':
      activateApp('Windsurf')
      break
    case 'warp':
      focusWarp()
      break
    default:
      // Best-effort: find a known terminal name in the pid chain and activate it
      for (const { comm } of (session.pidChain ?? [])) {
        const name = mapCommToAppName(comm)
        if (name) { activateApp(name); break }
      }
  }
}

function focusTerminalApp(tty?: string): void {
  if (tty && /^\/dev\/tty[a-z0-9]+$/.test(tty)) {
    runAppleScript(`
tell application "Terminal"
  activate
  set targetTTY to "${tty}"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is targetTTY then
        set selected tab of w to t
        set frontmost of w to true
        return
      end if
    end repeat
  end repeat
end tell`)
  } else {
    runAppleScript(`tell application "Terminal" to activate`)
  }
}

function focusWarp(): void {
  // Try opening by bundle ID first, fall back to AppleScript by name
  const r = spawnSync('open', ['-b', 'dev.warp.Warp-Stable'], { timeout: 3000 })
  if (r.status !== 0) {
    runAppleScript(`tell application "Warp" to activate`)
  }
}

function activateApp(appName: string): void {
  runAppleScript(`tell application "${appName}" to activate`)
}

function mapCommToAppName(comm: string): string | null {
  const c = comm.toLowerCase()
  if (c.includes('warp')) return 'Warp'
  if (c === 'cursor') return 'Cursor'
  if (c.includes('windsurf')) return 'Windsurf'
  if (c === 'code' || c === 'code helper' || c === 'code - insiders') return 'Visual Studio Code'
  if (c === 'terminal') return 'Terminal'
  return null
}

export function typeInTerminal(text: string): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  runAppleScript(`
tell application "System Events"
  delay 0.4
  keystroke "${escaped}"
  key code 36
end tell`)
}

export function submitSelectionInTerminal(selection: string): void {
  const escaped = selection.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  runAppleScript(`
tell application "System Events"
  delay 0.25
  keystroke "${escaped}"
  key code 36
end tell`)
}

function runAppleScript(script: string): void {
  try {
    spawnSync('osascript', ['-'], {
      input: script,
      encoding: 'utf8',
      timeout: 5000
    })
  } catch { /* ignore */ }
}

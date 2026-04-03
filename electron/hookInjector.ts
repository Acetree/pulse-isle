import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'

const VIBE_MARKER = 'pulse-isle-hook'

export interface InstallResult {
  hookScriptPath: string
  claudeInjected: boolean
  codexInjected: boolean
  codexFlagEnabled: boolean
}

export interface CheckResult {
  installed: boolean
  claudeHooked: boolean
  codexHooked: boolean
}

export interface RemoveResult {
  claudeRemoved: boolean
  codexRemoved: boolean
}

function hookScriptDest(): string {
  return path.join(os.homedir(), '.pulse-isle', 'pulse-isle-hook.py')
}

// ── Claude Code: ~/.claude/settings.json ──────────────────────────────────

function injectClaudeHooks(hookScript: string): boolean {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    let settings: any = {}
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch { /* keep empty */ }
    }
    if (!settings.hooks) settings.hooks = {}

    const command = `python3 "${hookScript}" claude`
    const withMatcher = { matcher: '.*', hooks: [{ type: 'command', command }] }
    const withoutMatcher = { hooks: [{ type: 'command', command }] }

    for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'] as const) {
      if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
      // Remove stale pulse-isle entries
      settings.hooks[event] = settings.hooks[event].filter(
        (e: any) => !e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
      )
      // Inject fresh entry
      settings.hooks[event].push(
        event === 'PreToolUse' || event === 'PostToolUse' ? withMatcher : withoutMatcher
      )
    }

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    return true
  } catch (e) {
    console.error('[hookInjector] Claude inject failed:', e)
    return false
  }
}

function removeClaudeHooks(): boolean {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  if (!fs.existsSync(settingsPath)) return false
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (!settings?.hooks) return false
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit']) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter(
          (e: any) => !e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
        )
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    return true
  } catch { return false }
}

function isClaudeHooked(): boolean {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  if (!fs.existsSync(settingsPath)) return false
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    return s?.hooks?.PreToolUse?.some?.(
      (e: any) => e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
    ) ?? false
  } catch { return false }
}

// ── Codex: ~/.codex/hooks.json ────────────────────────────────────────────

function injectCodexHooks(hookScript: string): boolean {
  const hooksPath = path.join(os.homedir(), '.codex', 'hooks.json')
  try {
    let hooks: any = { hooks: {} }
    if (fs.existsSync(hooksPath)) {
      try { hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8')) } catch { /* keep empty */ }
    }
    if (!hooks.hooks) hooks.hooks = {}

    const command = `python3 "${hookScript}" codex`
    const withMatcher = { matcher: '.*', hooks: [{ type: 'command', command }] }
    const withoutMatcher = { hooks: [{ type: 'command', command }] }

    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'] as const) {
      if (!Array.isArray(hooks.hooks[event])) hooks.hooks[event] = []
      hooks.hooks[event] = hooks.hooks[event].filter(
        (e: any) => !e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
      )
      hooks.hooks[event].push(
        event === 'PreToolUse' || event === 'PostToolUse' ? withMatcher : withoutMatcher
      )
    }

    fs.mkdirSync(path.dirname(hooksPath), { recursive: true })
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2))
    return true
  } catch (e) {
    console.error('[hookInjector] Codex inject failed:', e)
    return false
  }
}

function removeCodexHooks(): boolean {
  const hooksPath = path.join(os.homedir(), '.codex', 'hooks.json')
  if (!fs.existsSync(hooksPath)) return false
  try {
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'))
    if (!hooks?.hooks) return false
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit']) {
      if (Array.isArray(hooks.hooks[event])) {
        hooks.hooks[event] = hooks.hooks[event].filter(
          (e: any) => !e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
        )
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2))
    return true
  } catch { return false }
}

function isCodexHooked(): boolean {
  const hooksPath = path.join(os.homedir(), '.codex', 'hooks.json')
  if (!fs.existsSync(hooksPath)) return false
  try {
    const h = JSON.parse(fs.readFileSync(hooksPath, 'utf8'))
    return h?.hooks?.PreToolUse?.some?.(
      (e: any) => e.hooks?.some?.((h: any) => typeof h.command === 'string' && h.command.includes(VIBE_MARKER))
    ) ?? false
  } catch { return false }
}

function enableCodexHooksFlag(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('codex features enable codex_hooks 2>&1', (err) => resolve(!err))
  })
}

// ── Public API ────────────────────────────────────────────────────────────

export async function installHooks(
  isPackaged: boolean,
  resourcesPath: string,
  dirname: string
): Promise<InstallResult> {
  const hookScriptSrc = isPackaged
    ? path.join(resourcesPath, 'hooks', 'pulse-isle-hook.py')
    : path.join(dirname, '../../hooks/pulse-isle-hook.py')

  if (!fs.existsSync(hookScriptSrc)) {
    throw new Error('pulse-isle-hook.py not found in app resources')
  }

  const hookDir = path.join(os.homedir(), '.pulse-isle')
  fs.mkdirSync(hookDir, { recursive: true })
  const dest = hookScriptDest()
  fs.copyFileSync(hookScriptSrc, dest)
  fs.chmodSync(dest, 0o755)

  const claudeInjected = injectClaudeHooks(dest)
  const codexInjected = injectCodexHooks(dest)
  const codexFlagEnabled = await enableCodexHooksFlag()

  return { hookScriptPath: dest, claudeInjected, codexInjected, codexFlagEnabled }
}

export function checkHooks(): CheckResult {
  const scriptExists = fs.existsSync(hookScriptDest())
  const claudeHooked = scriptExists && isClaudeHooked()
  const codexHooked = scriptExists && isCodexHooked()
  return {
    installed: claudeHooked || codexHooked,
    claudeHooked,
    codexHooked
  }
}

export function removeHooks(): RemoveResult {
  const claudeRemoved = removeClaudeHooks()
  const codexRemoved = removeCodexHooks()

  const script = hookScriptDest()
  if (fs.existsSync(script)) {
    try { fs.unlinkSync(script) } catch { /* ok */ }
  }

  return { claudeRemoved, codexRemoved }
}

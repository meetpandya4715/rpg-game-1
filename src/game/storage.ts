import type { GameState } from './types'

const STORAGE_KEY = 'emberfall-save-v1'

export function hasSavedGame(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(STORAGE_KEY) !== null
}

export function saveGameState(state: GameState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadGameState(): GameState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as GameState
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

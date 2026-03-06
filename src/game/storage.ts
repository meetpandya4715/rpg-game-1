import type { GameState, NotificationEntry, SaveKind, SaveMeta } from './types'

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
    return normalizeLoadedState(JSON.parse(raw) as Partial<GameState>)
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function normalizeLoadedState(state: Partial<GameState>): GameState | null {
  if (
    !state.currentMapId ||
    !state.currentSpawnId ||
    !state.checkpoint ||
    !state.player ||
    !state.inventory ||
    !state.equipment ||
    !state.questProgress ||
    !state.flags ||
    !state.defeatedEnemyIds
  ) {
    return null
  }

  return {
    ...state,
    notifications: normalizeNotifications(state.notifications),
    saveMeta: normalizeSaveMeta(state.saveMeta),
  } as GameState
}

function normalizeNotifications(notifications: unknown): NotificationEntry[] {
  if (!Array.isArray(notifications)) {
    return []
  }

  return notifications
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          id: `legacy-${index}`,
          message: entry,
          kind: 'system',
          count: 1,
          occurredAt: Date.now() - index,
        } satisfies NotificationEntry
      }

      if (!entry || typeof entry !== 'object') {
        return null
      }

      const note = entry as Partial<NotificationEntry>
      if (typeof note.message !== 'string') {
        return null
      }

      return {
        id: typeof note.id === 'string' ? note.id : `legacy-${index}`,
        message: note.message,
        kind: normalizeNotificationKind(note.kind),
        count: typeof note.count === 'number' && note.count > 0 ? note.count : 1,
        dedupeKey: typeof note.dedupeKey === 'string' ? note.dedupeKey : undefined,
        occurredAt: typeof note.occurredAt === 'number' ? note.occurredAt : Date.now() - index,
      } satisfies NotificationEntry
    })
    .filter((entry): entry is NotificationEntry => Boolean(entry))
}

function normalizeSaveMeta(saveMeta: unknown): SaveMeta | null {
  if (!saveMeta || typeof saveMeta !== 'object') {
    return null
  }

  const meta = saveMeta as Partial<SaveMeta>
  if (typeof meta.savedAt !== 'string') {
    return null
  }

  return {
    savedAt: meta.savedAt,
    version: 2,
    kind: isSaveKind(meta.kind) ? meta.kind : 'manual',
  }
}

function normalizeNotificationKind(kind: unknown): NotificationEntry['kind'] {
  switch (kind) {
    case 'combat':
    case 'quest':
    case 'loot':
    case 'save':
    case 'system':
      return kind
    default:
      return 'system'
  }
}

function isSaveKind(kind: unknown): kind is SaveKind {
  return kind === 'auto' || kind === 'manual'
}

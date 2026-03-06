import type {
  ContentPack,
  DialogueNode,
  EnemyData,
  ItemData,
  MapData,
  NpcData,
  QuestData,
} from './types'

async function loadArray<T>(path: string): Promise<T[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    throw new Error(`Expected ${path} to contain an array`)
  }

  return payload as T[]
}

function indexById<T extends { id: string }>(entries: T[]): Record<string, T> {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry]))
}

export async function loadContentPack(): Promise<ContentPack> {
  const [maps, npcs, enemies, items, quests, dialogue] = await Promise.all([
    loadArray<MapData>('content/maps.json'),
    loadArray<NpcData>('content/npcs.json'),
    loadArray<EnemyData>('content/enemies.json'),
    loadArray<ItemData>('content/items.json'),
    loadArray<QuestData>('content/quests.json'),
    loadArray<DialogueNode>('content/dialogue.json'),
  ])

  return {
    maps: indexById(maps),
    npcs: indexById(npcs),
    enemies: indexById(enemies),
    items: indexById(items),
    quests: indexById(quests),
    dialogue: indexById(dialogue),
  }
}

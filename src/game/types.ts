export type EquipmentSlot = 'weapon' | 'armor'
export type QuestStatus = 'not_started' | 'active' | 'complete'

export interface Vector2 {
  x: number
  y: number
}

export interface RectArea extends Vector2 {
  width: number
  height: number
}

export interface StatBlock {
  maxHp: number
  attack: number
  defense: number
}

export interface PlayerState {
  level: number
  xp: number
  gold: number
  hp: number
  baseStats: StatBlock
}

export interface InventoryEntry {
  itemId: string
  quantity: number
}

export interface QuestProgress {
  status: QuestStatus
  stageId: string | null
}

export interface SaveMeta {
  savedAt: string
  version: number
}

export interface GameState {
  currentMapId: string
  currentSpawnId: string
  checkpoint: {
    mapId: string
    spawnId: string
  }
  player: PlayerState
  inventory: InventoryEntry[]
  equipment: Partial<Record<EquipmentSlot, string>>
  questProgress: Record<string, QuestProgress>
  flags: Record<string, boolean>
  defeatedEnemyIds: string[]
  notifications: string[]
  saveMeta: SaveMeta | null
}

export interface MapSpawn extends Vector2 {
  id: string
}

export interface MapExit {
  id: string
  area: RectArea
  targetMapId: string
  targetSpawnId: string
  label: string
}

export interface MapCheckpoint {
  id: string
  area: RectArea
  spawnId: string
  label: string
}

export interface MapProp extends RectArea {
  color: string
  alpha?: number
  label?: string
}

export interface MapData {
  id: string
  name: string
  description: string
  width: number
  height: number
  backgroundColor: string
  accentColor: string
  spawns: MapSpawn[]
  exits: MapExit[]
  checkpoints: MapCheckpoint[]
  props: MapProp[]
  obstacles: RectArea[]
}

export interface ConversationRule {
  nodeId: string
  questId?: string
  questStatus?: QuestStatus
  flag?: string
  flagValue?: boolean
}

export interface NpcData extends Vector2 {
  id: string
  name: string
  mapId: string
  color: string
  conversations: ConversationRule[]
}

export interface LootDrop {
  itemId: string
  quantity: number
  chance: number
}

export type DialogueAction =
  | { type: 'startQuest'; questId: string }
  | { type: 'advanceQuestStage'; questId: string; stageId: string }
  | { type: 'completeQuest'; questId: string }
  | { type: 'setFlag'; flag: string; value: boolean }
  | { type: 'giveItem'; itemId: string; quantity: number }
  | { type: 'removeItem'; itemId: string; quantity: number }
  | { type: 'healPlayer'; amount?: number; full?: boolean }

export interface EnemyData extends Vector2 {
  id: string
  name: string
  mapId: string
  color: string
  maxHp: number
  attack: number
  defense: number
  speed: number
  aggroRadius: number
  patrolRadius: number
  contactDamage: number
  attackCooldownMs: number
  xpReward: number
  goldReward: number
  loot: LootDrop[]
  isBoss?: boolean
  deathActions?: DialogueAction[]
}

export interface ItemData {
  id: string
  name: string
  type: 'consumable' | 'weapon' | 'armor' | 'quest'
  description: string
  value: number
  stackable: boolean
  slot?: EquipmentSlot
  statBonuses?: Partial<StatBlock>
  healAmount?: number
}

export interface QuestStage {
  id: string
  title: string
  description: string
}

export interface QuestReward {
  gold: number
  xp: number
  itemId?: string
}

export interface QuestData {
  id: string
  name: string
  summary: string
  stages: QuestStage[]
  reward: QuestReward
}

export interface DialogueOption {
  id: string
  label: string
  nextId?: string
  close?: boolean
  actions?: DialogueAction[]
}

export interface DialogueNode {
  id: string
  speaker: string
  text: string
  options: DialogueOption[]
}

export interface ContentPack {
  maps: Record<string, MapData>
  npcs: Record<string, NpcData>
  enemies: Record<string, EnemyData>
  items: Record<string, ItemData>
  quests: Record<string, QuestData>
  dialogue: Record<string, DialogueNode>
}

export interface PlayerView extends StatBlock {
  level: number
  xp: number
  gold: number
  hp: number
  weaponName: string | null
  armorName: string | null
}

export interface InventoryView {
  item: ItemData
  quantity: number
  equipped: boolean
}

export interface QuestView {
  quest: QuestData
  progress: QuestProgress
  currentStage: QuestStage | null
}

export interface DialogueView {
  npcId: string
  node: DialogueNode
}

export interface GameSnapshot {
  screen: 'loading' | 'title' | 'playing'
  canContinue: boolean
  locationName: string
  locationDescription: string
  nextStep: string
  player: PlayerView | null
  inventory: InventoryView[]
  quests: QuestView[]
  dialogue: DialogueView | null
  notifications: string[]
  interactionHint: string | null
  objective: string
  lastSavedAt: string | null
}

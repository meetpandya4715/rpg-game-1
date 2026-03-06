import type {
  ContentPack,
  EquipmentSlot,
  GameSnapshot,
  GameState,
  InventoryEntry,
  InventoryView,
  ItemData,
  PlayerView,
  QuestData,
  QuestProgress,
  QuestStatus,
  QuestView,
  StatBlock,
} from './types'

export function createLoadingSnapshot(): GameSnapshot {
  return {
    screen: 'loading',
    canContinue: false,
    locationName: 'Loading',
    locationDescription: 'Gathering the Emberfall content pack.',
    nextStep: 'Assembling the frontier.',
    player: null,
    inventory: [],
    quests: [],
    dialogue: null,
    notifications: [],
    interactionHint: null,
    objective: 'Preparing the frontier.',
    lastSavedAt: null,
  }
}

export function createTitleSnapshot(canContinue: boolean): GameSnapshot {
  return {
    screen: 'title',
    canContinue,
    locationName: 'Emberfall Frontier',
    locationDescription: 'A lone settlement holds the road against the Ashen Ruin.',
    nextStep: canContinue ? 'Press Enter to continue, or press N to begin a new run.' : 'Press Enter or N to start a new run.',
    player: null,
    inventory: [],
    quests: [],
    dialogue: null,
    notifications: [
      'Move with WASD or arrow keys.',
      'Press E near villagers to talk.',
      'Press Space to strike nearby enemies.',
    ],
    interactionHint: null,
    objective: 'Begin a new expedition or continue your last watch.',
    lastSavedAt: null,
  }
}

export function createInitialGameState(content: ContentPack): GameState {
  const questProgress: Record<string, QuestProgress> = Object.fromEntries(
    Object.keys(content.quests).map((questId) => [
      questId,
      { status: 'not_started' as QuestStatus, stageId: null },
    ]),
  )

  return {
    currentMapId: 'town',
    currentSpawnId: 'town_square',
    checkpoint: {
      mapId: 'town',
      spawnId: 'town_square',
    },
    player: {
      level: 1,
      xp: 0,
      gold: 18,
      hp: 64,
      baseStats: {
        maxHp: 64,
        attack: 8,
        defense: 4,
      },
    },
    inventory: [
      { itemId: 'iron_sword', quantity: 1 },
      { itemId: 'leather_vest', quantity: 1 },
      { itemId: 'potion', quantity: 2 },
    ],
    equipment: {
      weapon: 'iron_sword',
      armor: 'leather_vest',
    },
    questProgress,
    flags: {},
    defeatedEnemyIds: [],
    notifications: ['You arrive in Emberfall as the bells announce dusk.'],
    saveMeta: null,
  }
}

export function cloneGameState(state: GameState): GameState {
  return structuredClone(state)
}

export function pushNotification(state: GameState, message: string): void {
  state.notifications = [message, ...state.notifications].slice(0, 8)
}

export function getItemQuantity(state: GameState, itemId: string): number {
  return state.inventory.find((entry) => entry.itemId === itemId)?.quantity ?? 0
}

export function addItem(state: GameState, itemId: string, quantity: number): void {
  if (quantity <= 0) {
    return
  }

  const existing = state.inventory.find((entry) => entry.itemId === itemId)
  if (existing) {
    existing.quantity += quantity
    return
  }

  state.inventory.push({ itemId, quantity })
}

export function removeItem(state: GameState, itemId: string, quantity: number): boolean {
  const existing = state.inventory.find((entry) => entry.itemId === itemId)
  if (!existing || existing.quantity < quantity) {
    return false
  }

  existing.quantity -= quantity
  if (existing.quantity === 0) {
    state.inventory = state.inventory.filter((entry) => entry.itemId !== itemId)
    clearEquipmentIfMissing(state, itemId)
  }

  return true
}

export function isEquipped(state: GameState, itemId: string): boolean {
  return state.equipment.weapon === itemId || state.equipment.armor === itemId
}

export function toggleEquipment(state: GameState, item: ItemData): EquipmentSlot | null {
  if (!item.slot) {
    return null
  }

  const current = state.equipment[item.slot]
  state.equipment[item.slot] = current === item.id ? undefined : item.id
  return item.slot
}

export function getDerivedStats(state: GameState, content: ContentPack): StatBlock {
  const bonus: StatBlock = {
    maxHp: 0,
    attack: 0,
    defense: 0,
  }

  for (const itemId of Object.values(state.equipment)) {
    if (!itemId) {
      continue
    }

    const item = content.items[itemId]
    if (!item?.statBonuses) {
      continue
    }

    bonus.maxHp += item.statBonuses.maxHp ?? 0
    bonus.attack += item.statBonuses.attack ?? 0
    bonus.defense += item.statBonuses.defense ?? 0
  }

  return {
    maxHp: state.player.baseStats.maxHp + bonus.maxHp,
    attack: state.player.baseStats.attack + bonus.attack,
    defense: state.player.baseStats.defense + bonus.defense,
  }
}

export function clampPlayerHp(state: GameState, content: ContentPack): void {
  const stats = getDerivedStats(state, content)
  state.player.hp = Math.min(Math.max(state.player.hp, 0), stats.maxHp)
}

export function healPlayer(state: GameState, content: ContentPack, amount?: number, full?: boolean): number {
  const stats = getDerivedStats(state, content)
  const before = state.player.hp
  state.player.hp = full ? stats.maxHp : Math.min(stats.maxHp, state.player.hp + (amount ?? 0))
  return state.player.hp - before
}

export function ensureQuestProgress(state: GameState, questId: string): QuestProgress {
  if (!state.questProgress[questId]) {
    state.questProgress[questId] = {
      status: 'not_started',
      stageId: null,
    }
  }

  return state.questProgress[questId]
}

export function getQuestStage(quest: QuestData, stageId: string | null) {
  return quest.stages.find((stage) => stage.id === stageId) ?? null
}

export function getQuestViews(state: GameState, content: ContentPack): QuestView[] {
  return Object.values(content.quests)
    .map((quest) => {
      const progress = ensureQuestProgress(state, quest.id)
      return {
        quest,
        progress,
        currentStage: getQuestStage(quest, progress.stageId),
      }
    })
    .filter((entry) => entry.progress.status !== 'not_started')
}

export function getInventoryViews(state: GameState, content: ContentPack): InventoryView[] {
  return [...state.inventory]
    .map((entry: InventoryEntry) => ({
      item: content.items[entry.itemId],
      quantity: entry.quantity,
      equipped: isEquipped(state, entry.itemId),
    }))
    .filter((entry) => Boolean(entry.item))
    .sort((left, right) => {
      if (left.item.type === right.item.type) {
        return left.item.name.localeCompare(right.item.name)
      }
      return left.item.type.localeCompare(right.item.type)
    })
}

export function getPlayerView(state: GameState, content: ContentPack): PlayerView {
  const stats = getDerivedStats(state, content)

  return {
    level: state.player.level,
    xp: state.player.xp,
    gold: state.player.gold,
    hp: state.player.hp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    weaponName: state.equipment.weapon ? content.items[state.equipment.weapon]?.name ?? null : null,
    armorName: state.equipment.armor ? content.items[state.equipment.armor]?.name ?? null : null,
  }
}

export function getCurrentObjective(state: GameState, content: ContentPack): string {
  const mainQuest = content.quests.ember_relic
  const progress = ensureQuestProgress(state, mainQuest.id)

  if (progress.status === 'not_started') {
    return 'Speak with Elder Mira in Emberfall.'
  }

  if (progress.status === 'complete') {
    return 'Quest complete. The Sunstone now protects Emberfall.'
  }

  const stage = getQuestStage(mainQuest, progress.stageId)
  return stage?.description ?? mainQuest.summary
}

export function getNextStep(state: GameState, content: ContentPack): string {
  const mainQuest = content.quests.ember_relic
  const progress = ensureQuestProgress(state, mainQuest.id)
  const recovered = state.flags.sunstone_recovered ?? false

  if (progress.status === 'not_started') {
    return 'Walk north to Elder Mira in the Council Hall and press E.'
  }

  if (progress.status === 'complete') {
    return 'Emberfall is safe. Explore freely, or press P to save and continue later.'
  }

  if (!recovered) {
    if (state.currentMapId === 'town') {
      return 'Use the glowing East Road gate on the right edge of town.'
    }
    if (state.currentMapId === 'wilds') {
      return 'Keep moving east through the Greenwild until you reach the Ashen Ruin.'
    }
    return 'Push deeper into the vault and defeat the Ashen Guardian with Space attacks.'
  }

  if (state.currentMapId === 'dungeon') {
    return 'Take the west exit to leave the Ashen Ruin.'
  }
  if (state.currentMapId === 'wilds') {
    return 'Head west through the Greenwild to return to Emberfall.'
  }
  return 'Find Elder Mira in the Council Hall and press E to return the Sunstone.'
}

export function awardXp(state: GameState, amount: number): string[] {
  const messages: string[] = []
  state.player.xp += amount

  while (state.player.xp >= state.player.level * 80) {
    state.player.xp -= state.player.level * 80
    state.player.level += 1
    state.player.baseStats.maxHp += 10
    state.player.baseStats.attack += 2
    state.player.baseStats.defense += 1
    state.player.hp = state.player.baseStats.maxHp
    messages.push(`Level up. You are now level ${state.player.level}.`)
  }

  return messages
}

function clearEquipmentIfMissing(state: GameState, itemId: string): void {
  if (state.equipment.weapon === itemId) {
    state.equipment.weapon = undefined
  }
  if (state.equipment.armor === itemId) {
    state.equipment.armor = undefined
  }
}

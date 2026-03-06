import Phaser from 'phaser'
import {
  addItem,
  awardXp,
  clampPlayerHp,
  cloneGameState,
  createTitleSnapshot,
  ensureQuestProgress,
  getCurrentObjective,
  getDerivedStats,
  getInventoryViews,
  getNextStep,
  getPlayerView,
  getQuestViews,
  getItemQuantity,
  healPlayer,
  isEquipped,
  pushNotification,
  removeItem,
  toggleEquipment as toggleEquippedState,
} from '../state'
import { hasSavedGame, saveGameState } from '../storage'
import type { GameController } from '../controller'
import type {
  ContentPack,
  DialogueAction,
  DialogueOption,
  DialogueView,
  EnemyData,
  GameState,
  MapCheckpoint,
  MapData,
  MapExit,
  NpcData,
  PlayerView,
  RectArea,
} from '../types'

type RectSprite = Phaser.GameObjects.Rectangle & {
  body: Phaser.Physics.Arcade.Body
}

interface EnemyRuntime {
  data: EnemyData
  sprite: RectSprite
  label: Phaser.GameObjects.Text
  ring: Phaser.GameObjects.Arc
  hp: number
  homeX: number
  homeY: number
  lastAttackAt: number
}

interface NpcRuntime {
  data: NpcData
  sprite: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  ring: Phaser.GameObjects.Arc
}

function toColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color
}

function isInside(area: RectArea, x: number, y: number): boolean {
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height
}

function normalizeVelocity(deltaX: number, deltaY: number, speed: number): { x: number; y: number } {
  const length = Math.hypot(deltaX, deltaY)
  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: (deltaX / length) * speed,
    y: (deltaY / length) * speed,
  }
}

export class RpgScene extends Phaser.Scene {
  private readonly controller: GameController
  private readonly content: ContentPack
  private state: GameState | null = null
  private checkpointState: GameState | null = null
  private currentMap: MapData | null = null
  private player: RectSprite | null = null
  private obstacleGroup: Phaser.Physics.Arcade.StaticGroup | null = null
  private colliders: Phaser.Physics.Arcade.Collider[] = []
  private mapObjects: Phaser.GameObjects.GameObject[] = []
  private enemyRuntimes: EnemyRuntime[] = []
  private npcRuntimes: NpcRuntime[] = []
  private activeDialogue: { npcId: string; nodeId: string } | null = null
  private interactionHint: string | null = null
  private lastPlayerAttackAt = 0
  private damageInvulnerableUntil = 0
  private interactionCooldownUntil = 0
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private keys!: {
    W: Phaser.Input.Keyboard.Key
    A: Phaser.Input.Keyboard.Key
    S: Phaser.Input.Keyboard.Key
    D: Phaser.Input.Keyboard.Key
    E: Phaser.Input.Keyboard.Key
    SPACE: Phaser.Input.Keyboard.Key
  }

  constructor(controller: GameController, content: ContentPack) {
    super('rpg-world')
    this.controller = controller
    this.content = content
  }

  create(): void {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE') as typeof this.keys
    this.cameras.main.setRoundPixels(true)
    this.controller.registerScene(this)
  }

  update(_time: number, delta: number): void {
    if (!this.state || !this.player || !this.currentMap) {
      return
    }

    const hasDialogue = Boolean(this.activeDialogue)
    this.updatePlayerMovement(hasDialogue)
    this.updateEnemies(delta)
    this.handleInteractableHint()

    if (!hasDialogue && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.tryInteract()
    }

    if (!hasDialogue && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.tryAttack()
    }

    this.checkAreaInteractions()
  }

  loadGameState(nextState: GameState): void {
    this.state = cloneGameState(nextState)
    this.activeDialogue = null
    this.lastPlayerAttackAt = 0
    this.damageInvulnerableUntil = 0
    clampPlayerHp(this.state, this.content)
    pushNotification(this.state, 'The watch resumes.')
    this.checkpointState = cloneGameState(this.state)
    this.renderCurrentMap()
    this.publishSnapshot()
  }

  saveCurrentGame(): void {
    if (!this.state) {
      return
    }

    this.persistState(true, 'Game saved to the ember archive.')
    this.publishSnapshot()
  }

  useItem(itemId: string): void {
    if (!this.state) {
      return
    }

    const item = this.content.items[itemId]
    if (!item || item.type !== 'consumable' || getItemQuantity(this.state, itemId) <= 0) {
      return
    }

    if (!removeItem(this.state, itemId, 1)) {
      return
    }

    const restored = healPlayer(this.state, this.content, item.healAmount)
    pushNotification(this.state, `${item.name} restores ${restored} HP.`)
    this.persistState(false)
    this.publishSnapshot()
  }

  toggleEquipment(itemId: string): void {
    if (!this.state) {
      return
    }

    const item = this.content.items[itemId]
    if (!item?.slot || getItemQuantity(this.state, itemId) <= 0) {
      return
    }

    const slot = toggleEquippedState(this.state, item)
    const action = isEquipped(this.state, itemId) ? 'equipped' : 'stowed'
    pushNotification(this.state, `${item.name} ${action}${slot ? ` as ${slot}` : ''}.`)
    clampPlayerHp(this.state, this.content)
    this.persistState(false)
    this.publishSnapshot()
  }

  selectDialogueOption(optionId: string): void {
    if (!this.state || !this.activeDialogue) {
      return
    }

    const dialogueNode = this.content.dialogue[this.activeDialogue.nodeId]
    const option = dialogueNode?.options.find((entry) => entry.id === optionId)
    if (!option) {
      return
    }

    this.applyDialogueActions(option)

    if (!this.state) {
      return
    }

    if (option.nextId) {
      this.activeDialogue = {
        npcId: this.activeDialogue.npcId,
        nodeId: option.nextId,
      }
    } else if (option.close || !option.nextId) {
      this.activeDialogue = null
    }

    this.persistState(false)
    this.publishSnapshot()
  }

  closeDialogue(): void {
    if (!this.activeDialogue) {
      return
    }

    this.activeDialogue = null
    this.publishSnapshot()
  }

  private renderCurrentMap(): void {
    if (!this.state) {
      this.controller.publish(createTitleSnapshot(hasSavedGame()))
      return
    }

    this.clearMap()

    const map = this.content.maps[this.state.currentMapId]
    const spawn = map.spawns.find((entry) => entry.id === this.state!.currentSpawnId) ?? map.spawns[0]

    this.currentMap = map
    this.cameras.main.setBackgroundColor(map.backgroundColor)
    this.physics.world.setBounds(0, 0, map.width, map.height)
    this.cameras.main.setBounds(0, 0, map.width, map.height)

    const base = this.add.rectangle(0, 0, map.width, map.height, toColor(map.backgroundColor)).setOrigin(0)
    const glow = this.add
      .rectangle(map.width / 2, map.height / 2, map.width - 100, map.height - 100, toColor(map.accentColor), 0.16)
      .setStrokeStyle(4, toColor(map.accentColor), 0.22)
    const title = this.add
      .text(28, 20, map.name, {
        fontFamily: 'Palatino Linotype, serif',
        fontSize: '28px',
        color: '#fff0d7',
      })
      .setScrollFactor(0)
      .setDepth(10)
    const subtitle = this.add
      .text(28, 56, map.description, {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '14px',
        color: '#d9c8ae',
        wordWrap: { width: 360 },
      })
      .setScrollFactor(0)
      .setDepth(10)

    this.mapObjects.push(base, glow, title, subtitle)

    this.obstacleGroup = this.physics.add.staticGroup()
    for (const prop of map.props) {
      const rect = this.add.rectangle(prop.x, prop.y, prop.width, prop.height, toColor(prop.color), prop.alpha ?? 1)
      if (prop.label) {
        const label = this.add.text(prop.x, prop.y, prop.label, {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '13px',
          color: '#fcead4',
        })
        label.setOrigin(0.5)
        this.mapObjects.push(label)
      }
      this.mapObjects.push(rect)
    }

    for (const obstacle of map.obstacles) {
      const rect = this.add
        .rectangle(
          obstacle.x + obstacle.width / 2,
          obstacle.y + obstacle.height / 2,
          obstacle.width,
          obstacle.height,
          0x1d241f,
          0.82,
        )
        .setStrokeStyle(2, 0x3d463f, 0.44)

      this.physics.add.existing(rect, true)
      this.obstacleGroup.add(rect)
      this.mapObjects.push(rect)
    }

    for (const exit of map.exits) {
      const rect = this.add
        .rectangle(
          exit.area.x + exit.area.width / 2,
          exit.area.y + exit.area.height / 2,
          exit.area.width,
          exit.area.height,
          0xffdc9b,
          0.1,
        )
        .setStrokeStyle(2, 0xffdc9b, 0.28)
      const label = this.add
        .text(exit.area.x + exit.area.width / 2, exit.area.y + exit.area.height / 2, exit.label, {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '13px',
          color: '#ffe7c1',
          align: 'center',
          wordWrap: { width: 120 },
        })
        .setOrigin(0.5)
      this.tweens.add({
        targets: rect,
        alpha: { from: 0.1, to: 0.24 },
        duration: 900,
        yoyo: true,
        repeat: -1,
      })
      this.mapObjects.push(rect, label)
    }

    for (const checkpoint of map.checkpoints) {
      const rect = this.add
        .rectangle(
          checkpoint.area.x + checkpoint.area.width / 2,
          checkpoint.area.y + checkpoint.area.height / 2,
          checkpoint.area.width,
          checkpoint.area.height,
          0xa5ffd6,
          0.08,
        )
        .setStrokeStyle(2, 0xa5ffd6, 0.28)
      const label = this.add
        .text(
          checkpoint.area.x + checkpoint.area.width / 2,
          checkpoint.area.y + checkpoint.area.height / 2,
          checkpoint.label,
          {
            fontFamily: 'Trebuchet MS, sans-serif',
            fontSize: '12px',
            color: '#dcfff2',
            align: 'center',
            wordWrap: { width: 120 },
          },
        )
        .setOrigin(0.5)
      this.tweens.add({
        targets: rect,
        alpha: { from: 0.08, to: 0.18 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
      })
      this.mapObjects.push(rect, label)
    }

    this.createPlayer(spawn.x, spawn.y)
    this.spawnNpcs(map)
    this.spawnEnemies(map)
    this.cameras.main.startFollow(this.player!, true, 1, 1)
    this.publishSnapshot()
  }

  private createPlayer(x: number, y: number): void {
    if (this.player) {
      this.player.destroy()
    }

    const player = this.add.rectangle(x, y, 24, 28, 0xf7d7a6).setStrokeStyle(2, 0xffffff, 0.45)
    this.physics.add.existing(player)
    const body = player.body as Phaser.Physics.Arcade.Body
    body.setSize(24, 28)
    body.setCollideWorldBounds(true)

    this.player = player as RectSprite
    this.mapObjects.push(player)

    if (this.obstacleGroup) {
      this.colliders.push(this.physics.add.collider(this.player, this.obstacleGroup))
    }
  }

  private spawnNpcs(map: MapData): void {
    const npcs = Object.values(this.content.npcs).filter((npc) => npc.mapId === map.id)
    for (const npc of npcs) {
      const ring = this.add.circle(npc.x, npc.y + 6, 18, 0x7de2d1, 0.14).setStrokeStyle(2, 0x7de2d1, 0.34)
      const sprite = this.add
        .rectangle(npc.x, npc.y, 24, 32, toColor(npc.color))
        .setStrokeStyle(2, 0x93f0d6, 0.7)
      const label = this.add
        .text(npc.x, npc.y - 30, npc.name, {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '12px',
          color: '#cbfff7',
        })
        .setOrigin(0.5)
      this.npcRuntimes.push({ data: npc, sprite, label, ring })
      this.mapObjects.push(ring, sprite, label)
    }
  }

  private spawnEnemies(map: MapData): void {
    const enemies = Object.values(this.content.enemies).filter(
      (enemy) => enemy.mapId === map.id && !this.state!.defeatedEnemyIds.includes(enemy.id),
    )

    for (const enemy of enemies) {
      const ring = this.add.circle(enemy.x, enemy.y, enemy.isBoss ? 24 : 19, 0xff8e7d, 0.12).setStrokeStyle(2, 0xff8e7d, 0.42)
      const sprite = this.add
        .rectangle(enemy.x, enemy.y, enemy.isBoss ? 34 : 26, enemy.isBoss ? 34 : 26, toColor(enemy.color))
        .setStrokeStyle(2, 0xff8e7d, 0.85)
      this.physics.add.existing(sprite)

      const body = sprite.body as Phaser.Physics.Arcade.Body
      body.setCollideWorldBounds(true)
      body.setDrag(320, 320)
      body.setMaxVelocity(enemy.speed, enemy.speed)

      const label = this.add
        .text(enemy.x, enemy.y - 28, `! ${enemy.name}`, {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '11px',
          color: '#ffd1c9',
        })
        .setOrigin(0.5)

      this.tweens.add({
        targets: ring,
        alpha: { from: 0.12, to: 0.26 },
        scaleX: { from: 1, to: 1.1 },
        scaleY: { from: 1, to: 1.1 },
        duration: enemy.isBoss ? 560 : 860,
        yoyo: true,
        repeat: -1,
      })

      const runtime: EnemyRuntime = {
        data: enemy,
        sprite: sprite as RectSprite,
        label,
        ring,
        hp: enemy.maxHp,
        homeX: enemy.x,
        homeY: enemy.y,
        lastAttackAt: 0,
      }

      if (this.obstacleGroup) {
        this.colliders.push(this.physics.add.collider(runtime.sprite, this.obstacleGroup))
      }

      this.enemyRuntimes.push(runtime)
      this.mapObjects.push(ring, sprite, label)
    }
  }

  private updatePlayerMovement(hasDialogue: boolean): void {
    if (!this.player || !this.state) {
      return
    }

    const body = this.player.body
    if (hasDialogue) {
      body.setVelocity(0, 0)
      return
    }

    const left = this.cursors.left.isDown || this.keys.A.isDown
    const right = this.cursors.right.isDown || this.keys.D.isDown
    const up = this.cursors.up.isDown || this.keys.W.isDown
    const down = this.cursors.down.isDown || this.keys.S.isDown

    const velocity = normalizeVelocity(Number(right) - Number(left), Number(down) - Number(up), 185)
    body.setVelocity(velocity.x, velocity.y)
  }

  private updateEnemies(delta: number): void {
    if (!this.player || !this.state) {
      return
    }

    const playerStats = getDerivedStats(this.state, this.content)
    const now = this.time.now

    for (const enemy of this.enemyRuntimes) {
      const { sprite, data, label, ring } = enemy
      const distance = Phaser.Math.Distance.Between(sprite.x, sprite.y, this.player.x, this.player.y)
      const body = sprite.body

      if (distance <= data.aggroRadius || enemy.hp < data.maxHp) {
        const velocity = normalizeVelocity(this.player.x - sprite.x, this.player.y - sprite.y, data.speed)
        body.setVelocity(velocity.x, velocity.y)
      } else {
        const homeDistance = Phaser.Math.Distance.Between(sprite.x, sprite.y, enemy.homeX, enemy.homeY)
        if (homeDistance > data.patrolRadius) {
          const velocity = normalizeVelocity(enemy.homeX - sprite.x, enemy.homeY - sprite.y, data.speed * 0.6)
          body.setVelocity(velocity.x, velocity.y)
        } else {
          const drift = Math.sin(now / 500 + enemy.homeX * 0.01) * 0.6
          body.setVelocity(Math.cos(now / 700 + enemy.homeY * 0.02) * data.speed * drift, Math.sin(now / 900) * 22)
        }
      }

      label.setPosition(sprite.x, sprite.y - (data.isBoss ? 34 : 26))
      ring.setPosition(sprite.x, sprite.y)

      if (distance < 34 && now >= enemy.lastAttackAt + data.attackCooldownMs && now >= this.damageInvulnerableUntil) {
        enemy.lastAttackAt = now
        this.damageInvulnerableUntil = now + 700
        const damage = Math.max(1, data.contactDamage + data.attack - Math.floor(playerStats.defense / 2))
        this.damagePlayer(damage)
      }
    }

    void delta
  }

  private handleInteractableHint(): void {
    if (!this.player || !this.currentMap || !this.state) {
      return
    }

    const player = this.player
    let nextHint: string | null = null
    let closestNpc: NpcRuntime | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    for (const npc of this.npcRuntimes) {
      const distance = Phaser.Math.Distance.Between(player.x, player.y, npc.data.x, npc.data.y)
      if (distance < 82 && distance < closestDistance) {
        closestDistance = distance
        closestNpc = npc
      }
    }

    const nearbyEnemy = this.enemyRuntimes
      .map((enemy) => ({
        enemy,
        distance: Phaser.Math.Distance.Between(player.x, player.y, enemy.sprite.x, enemy.sprite.y),
      }))
      .filter((entry) => entry.distance < 96)
      .sort((left, right) => left.distance - right.distance)[0]

    if (nearbyEnemy) {
      nextHint = `${nearbyEnemy.enemy.data.name} is in range. Press Space to attack.`
    } else if (closestNpc) {
      nextHint = `Press E to speak with ${closestNpc.data.name}.`
    } else {
      for (const checkpoint of this.currentMap.checkpoints) {
        if (isInside(checkpoint.area, player.x, player.y)) {
          nextHint = `Checkpoint: ${checkpoint.label}.`
          break
        }
      }
    }

    if (nextHint !== this.interactionHint) {
      this.interactionHint = nextHint
      this.publishSnapshot()
    }
  }

  private tryInteract(): void {
    if (!this.player || !this.state) {
      return
    }

    let targetNpc: NpcRuntime | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const npc of this.npcRuntimes) {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.data.x, npc.data.y)
      if (distance < 82 && distance < bestDistance) {
        targetNpc = npc
        bestDistance = distance
      }
    }

    if (!targetNpc) {
      return
    }

    const nodeId = this.resolveDialogueNode(targetNpc.data)
    this.activeDialogue = {
      npcId: targetNpc.data.id,
      nodeId,
    }
    this.publishSnapshot()
  }

  private tryAttack(): void {
    if (!this.player || !this.state || this.time.now < this.lastPlayerAttackAt + 440) {
      return
    }

    this.lastPlayerAttackAt = this.time.now
    const playerStats = getDerivedStats(this.state, this.content)
    const target = this.enemyRuntimes
      .map((enemy) => ({
        enemy,
        distance: Phaser.Math.Distance.Between(this.player!.x, this.player!.y, enemy.sprite.x, enemy.sprite.y),
      }))
      .filter((entry) => entry.distance < 84)
      .sort((left, right) => left.distance - right.distance)[0]

    const effect = this.add.circle(this.player.x, this.player.y, 46, 0xffd48a, 0.14).setStrokeStyle(3, 0xffd48a, 0.35)
    this.tweens.add({
      targets: effect,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 180,
      onComplete: () => effect.destroy(),
    })

    if (!target) {
      return
    }

    const damage = Math.max(1, playerStats.attack - Math.floor(target.enemy.data.defense / 2))
    target.enemy.hp -= damage
    target.enemy.sprite.setFillStyle(0xffe3c2, 1)
    this.time.delayedCall(90, () => {
      target.enemy.sprite.setFillStyle(toColor(target.enemy.data.color), 1)
    })

    pushNotification(this.state, `${target.enemy.data.name} takes ${damage} damage.`)

    if (target.enemy.hp <= 0) {
      this.defeatEnemy(target.enemy)
      return
    }

    this.publishSnapshot()
  }

  private checkAreaInteractions(): void {
    if (!this.player || !this.currentMap || !this.state || this.time.now < this.interactionCooldownUntil) {
      return
    }

    for (const checkpoint of this.currentMap.checkpoints) {
      if (isInside(checkpoint.area, this.player.x, this.player.y)) {
        this.activateCheckpoint(checkpoint)
        break
      }
    }

    for (const exit of this.currentMap.exits) {
      if (isInside(exit.area, this.player.x, this.player.y)) {
        this.transitionToExit(exit)
        break
      }
    }
  }

  private activateCheckpoint(checkpoint: MapCheckpoint): void {
    if (!this.state) {
      return
    }

    const unchanged =
      this.state.checkpoint.mapId === this.currentMap?.id && this.state.checkpoint.spawnId === checkpoint.spawnId
    if (unchanged) {
      return
    }

    this.state.checkpoint = {
      mapId: this.currentMap!.id,
      spawnId: checkpoint.spawnId,
    }

    pushNotification(this.state, `${checkpoint.label} is now your checkpoint.`)
    this.persistState(false)
    this.checkpointState = cloneGameState(this.state)
    this.publishSnapshot()
  }

  private transitionToExit(exit: MapExit): void {
    if (!this.state) {
      return
    }

    this.interactionCooldownUntil = this.time.now + 700
    this.state.currentMapId = exit.targetMapId
    this.state.currentSpawnId = exit.targetSpawnId
    this.state.checkpoint = {
      mapId: exit.targetMapId,
      spawnId: exit.targetSpawnId,
    }
    pushNotification(this.state, `You head toward ${this.content.maps[exit.targetMapId].name}.`)
    this.persistState(false)
    this.checkpointState = cloneGameState(this.state)
    this.renderCurrentMap()
  }

  private resolveDialogueNode(npc: NpcData): string {
    for (const rule of npc.conversations) {
      const progress = rule.questId ? ensureQuestProgress(this.state!, rule.questId) : null
      const questMatches = !rule.questId || progress?.status === rule.questStatus || !rule.questStatus
      const flagValue = rule.flag ? this.state!.flags[rule.flag] ?? false : undefined
      const flagMatches = !rule.flag || flagValue === (rule.flagValue ?? true)

      if (questMatches && flagMatches) {
        return rule.nodeId
      }
    }

    return npc.conversations[0].nodeId
  }

  private applyDialogueActions(option: DialogueOption): void {
    if (!this.state || !option.actions) {
      return
    }

    for (const action of option.actions) {
      this.applyAction(action)
    }
  }

  private applyAction(action: DialogueAction): void {
    if (!this.state) {
      return
    }

    switch (action.type) {
      case 'startQuest': {
        const quest = this.content.quests[action.questId]
        const progress = ensureQuestProgress(this.state, quest.id)
        if (progress.status === 'not_started') {
          progress.status = 'active'
          progress.stageId = quest.stages[0]?.id ?? null
          pushNotification(this.state, `Quest started: ${quest.name}.`)
        }
        break
      }
      case 'advanceQuestStage': {
        const progress = ensureQuestProgress(this.state, action.questId)
        if (progress.status === 'active') {
          progress.stageId = action.stageId
        }
        break
      }
      case 'completeQuest': {
        const quest = this.content.quests[action.questId]
        const progress = ensureQuestProgress(this.state, quest.id)
        if (progress.status !== 'complete') {
          progress.status = 'complete'
          progress.stageId = quest.stages.at(-1)?.id ?? null
          this.state.player.gold += quest.reward.gold
          for (const message of awardXp(this.state, quest.reward.xp)) {
            pushNotification(this.state, message)
          }
          if (quest.reward.itemId) {
            addItem(this.state, quest.reward.itemId, 1)
            pushNotification(this.state, `${this.content.items[quest.reward.itemId].name} joins your kit.`)
          }
          pushNotification(this.state, `${quest.name} completed.`)
        }
        break
      }
      case 'setFlag': {
        this.state.flags[action.flag] = action.value
        break
      }
      case 'giveItem': {
        addItem(this.state, action.itemId, action.quantity)
        pushNotification(this.state, `Received ${this.content.items[action.itemId].name}.`)
        break
      }
      case 'removeItem': {
        removeItem(this.state, action.itemId, action.quantity)
        break
      }
      case 'healPlayer': {
        const restored = healPlayer(this.state, this.content, action.amount, action.full)
        if (restored > 0) {
          pushNotification(this.state, `Recovered ${restored} HP.`)
        }
        break
      }
    }

    clampPlayerHp(this.state, this.content)
  }

  private defeatEnemy(enemy: EnemyRuntime): void {
    if (!this.state) {
      return
    }

    this.state.defeatedEnemyIds.push(enemy.data.id)
    this.state.player.gold += enemy.data.goldReward

    for (const message of awardXp(this.state, enemy.data.xpReward)) {
      pushNotification(this.state, message)
    }

    pushNotification(this.state, `${enemy.data.name} falls.`)

    for (const drop of enemy.data.loot) {
      if (Math.random() <= drop.chance) {
        addItem(this.state, drop.itemId, drop.quantity)
        pushNotification(this.state, `Looted ${this.content.items[drop.itemId].name}.`)
      }
    }

    for (const action of enemy.data.deathActions ?? []) {
      this.applyAction(action)
    }

    enemy.sprite.destroy()
    enemy.label.destroy()
    enemy.ring.destroy()
    this.enemyRuntimes = this.enemyRuntimes.filter((entry) => entry !== enemy)
    this.persistState(false)
    this.publishSnapshot()
  }

  private damagePlayer(amount: number): void {
    if (!this.state || !this.player) {
      return
    }

    this.state.player.hp = Math.max(0, this.state.player.hp - amount)
    this.player.setFillStyle(0xff9a91, 1)
    this.time.delayedCall(120, () => {
      this.player?.setFillStyle(0xf7d7a6, 1)
    })
    pushNotification(this.state, `You suffer ${amount} damage.`)

    if (this.state.player.hp === 0) {
      this.restoreCheckpoint()
      return
    }

    this.publishSnapshot()
  }

  private restoreCheckpoint(): void {
    if (!this.checkpointState) {
      return
    }

    const restored = cloneGameState(this.checkpointState)
    restored.player.hp = getDerivedStats(restored, this.content).maxHp
    pushNotification(restored, 'You collapse and awaken at your last checkpoint.')
    this.state = restored
    this.activeDialogue = null
    this.renderCurrentMap()
  }

  private buildDialogueView(): DialogueView | null {
    if (!this.activeDialogue) {
      return null
    }

    const node = this.content.dialogue[this.activeDialogue.nodeId]
    if (!node) {
      return null
    }

    return {
      npcId: this.activeDialogue.npcId,
      node,
    }
  }

  private publishSnapshot(): void {
    if (!this.state || !this.currentMap) {
      this.controller.publish(createTitleSnapshot(hasSavedGame()))
      return
    }

    const player: PlayerView = getPlayerView(this.state, this.content)
    this.controller.publish({
      screen: 'playing',
      canContinue: hasSavedGame(),
      locationName: this.currentMap.name,
      locationDescription: this.currentMap.description,
      nextStep: getNextStep(this.state, this.content),
      player,
      inventory: getInventoryViews(this.state, this.content),
      quests: getQuestViews(this.state, this.content),
      dialogue: this.buildDialogueView(),
      notifications: this.state.notifications,
      interactionHint: this.interactionHint,
      objective: getCurrentObjective(this.state, this.content),
      lastSavedAt: this.state.saveMeta?.savedAt ?? null,
    })
  }

  private persistState(notify: boolean, notificationText?: string): void {
    if (!this.state) {
      return
    }

    this.state.saveMeta = {
      savedAt: new Date().toISOString(),
      version: 1,
    }

    if (notify && notificationText) {
      pushNotification(this.state, notificationText)
    }

    saveGameState(this.state)
    this.checkpointState = cloneGameState(this.state)
  }

  private clearMap(): void {
    for (const collider of this.colliders) {
      collider.destroy()
    }
    this.colliders = []

    this.obstacleGroup?.clear(true, true)
    this.obstacleGroup = null
    this.enemyRuntimes = []
    this.npcRuntimes = []

    for (const object of this.mapObjects) {
      object.destroy()
    }
    this.mapObjects = []
    this.player = null
  }
}

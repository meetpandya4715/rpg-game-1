import Phaser from 'phaser'
import {
  addItem,
  awardXp,
  clampPlayerHp,
  cloneGameState,
  createTitleSnapshot,
  ensureQuestProgress,
  getCelebration,
  getCurrentObjective,
  getDerivedStats,
  getInventoryViews,
  getItemQuantity,
  getNextStep,
  getObjectiveTarget,
  getPlayerView,
  getQuestViews,
  getSaveStatus,
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
  ObjectiveTarget,
  PlayerView,
  RectArea,
  SaveKind,
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
  hpTrack: Phaser.GameObjects.Rectangle
  hpFill: Phaser.GameObjects.Rectangle
  marker: Phaser.GameObjects.Text
  hpBarWidth: number
}

interface NpcRuntime {
  data: NpcData
  sprite: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  ring: Phaser.GameObjects.Arc
  marker: Phaser.GameObjects.Text
}

interface ExitRuntime {
  data: MapExit
  zone: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  beacon: Phaser.GameObjects.Triangle
}

interface BossBarRuntime {
  frame: Phaser.GameObjects.Rectangle
  fill: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  sublabel: Phaser.GameObjects.Text
  width: number
}

type DirectionKey = 'left' | 'right' | 'up' | 'down'

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

function matchesDirectionKey(key: string): DirectionKey | null {
  switch (key) {
    case 'arrowleft':
    case 'a':
      return 'left'
    case 'arrowright':
    case 'd':
      return 'right'
    case 'arrowup':
    case 'w':
      return 'up'
    case 'arrowdown':
    case 's':
      return 'down'
    default:
      return null
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
  private exitRuntimes: ExitRuntime[] = []
  private bossBar: BossBarRuntime | null = null
  private activeDialogue: { npcId: string; nodeId: string } | null = null
  private interactionHint: string | null = null
  private lastPlayerAttackAt = 0
  private damageInvulnerableUntil = 0
  private interactionCooldownUntil = 0
  private movementState: Record<DirectionKey, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
  }
  private queuedInteract = false
  private queuedAttack = false
  private readonly handleWindowKeyDown = (event: KeyboardEvent) => {
    if (!this.state || this.activeDialogue || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const key = event.key.toLowerCase()
    const direction = matchesDirectionKey(key)
    if (direction) {
      this.movementState[direction] = true
      event.preventDefault()
      return
    }

    if (key === 'e' && !event.repeat) {
      this.queuedInteract = true
      event.preventDefault()
      return
    }

    if ((key === ' ' || event.code === 'Space') && !event.repeat) {
      this.queuedAttack = true
      event.preventDefault()
    }
  }
  private readonly handleWindowKeyUp = (event: KeyboardEvent) => {
    const direction = matchesDirectionKey(event.key.toLowerCase())
    if (!direction) {
      return
    }
    this.movementState[direction] = false
  }
  private readonly clearGameplayInput = () => {
    this.movementState.left = false
    this.movementState.right = false
    this.movementState.up = false
    this.movementState.down = false
    this.queuedInteract = false
    this.queuedAttack = false
  }
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.clearGameplayInput()
    }
  }

  constructor(controller: GameController, content: ContentPack) {
    super('rpg-world')
    this.controller = controller
    this.content = content
  }

  create(): void {
    this.cameras.main.setRoundPixels(true)
    window.addEventListener('keydown', this.handleWindowKeyDown)
    window.addEventListener('keyup', this.handleWindowKeyUp)
    window.addEventListener('blur', this.clearGameplayInput)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.handleWindowKeyDown)
      window.removeEventListener('keyup', this.handleWindowKeyUp)
      window.removeEventListener('blur', this.clearGameplayInput)
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      this.clearGameplayInput()
    })
    this.controller.registerScene(this)
  }

  update(_time: number, delta: number): void {
    if (!this.state || !this.player || !this.currentMap) {
      return
    }

    const hasDialogue = Boolean(this.activeDialogue)
    this.updatePlayerMovement(hasDialogue)
    this.updateEnemies(delta)

    if (!hasDialogue && this.queuedInteract) {
      this.queuedInteract = false
      this.tryInteract()
    }

    if (!hasDialogue && this.queuedAttack) {
      this.queuedAttack = false
      this.tryAttack()
    }

    this.syncInteractionHint()
    this.checkAreaInteractions()
  }

  loadGameState(nextState: GameState): void {
    this.state = cloneGameState(nextState)
    this.activeDialogue = null
    this.lastPlayerAttackAt = 0
    this.damageInvulnerableUntil = 0
    this.clearGameplayInput()
    clampPlayerHp(this.state, this.content)
    pushNotification(this.state, 'The watch resumes.', { kind: 'system' })
    this.checkpointState = cloneGameState(this.state)
    this.renderCurrentMap()
    this.publishSnapshot()
  }

  saveCurrentGame(): void {
    if (!this.state) {
      return
    }

    this.persistState('manual', 'Manual save secured at the frontier board.')
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
    pushNotification(this.state, `${item.name} restores ${restored} HP.`, {
      kind: 'loot',
      dedupeKey: `${itemId}-restored-${restored}`,
    })
    this.persistState('auto')
    this.publishSnapshot()
  }

  attackNearby(): void {
    this.tryAttack()
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
    pushNotification(this.state, `${item.name} ${action}${slot ? ` as ${slot}` : ''}.`, {
      kind: 'system',
      dedupeKey: `${itemId}-${action}`,
    })
    clampPlayerHp(this.state, this.content)
    this.persistState('auto')
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
    } else {
      this.activeDialogue = null
    }

    this.persistState('auto')
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
      .rectangle(map.width / 2, map.height / 2, map.width - 84, map.height - 84, toColor(map.accentColor), 0.15)
      .setStrokeStyle(3, toColor(map.accentColor), 0.18)
    const title = this.add
      .text(26, 20, map.name, {
        fontFamily: '"Palatino Linotype", serif',
        fontSize: '30px',
        color: '#fff1d9',
      })
      .setScrollFactor(0)
      .setDepth(10)
    const subtitle = this.add
      .text(26, 58, map.description, {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '14px',
        color: '#dfcfb5',
        wordWrap: { width: 320 },
      })
      .setScrollFactor(0)
      .setDepth(10)

    this.mapObjects.push(base, glow, title, subtitle)

    this.obstacleGroup = this.physics.add.staticGroup()
    for (const prop of map.props) {
      const rect = this.add.rectangle(prop.x, prop.y, prop.width, prop.height, toColor(prop.color), prop.alpha ?? 1)
      if (prop.label) {
        const label = this.add.text(prop.x, prop.y, prop.label, {
          fontFamily: '"Trebuchet MS", sans-serif',
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
          0x17201c,
          0.84,
        )
        .setStrokeStyle(2, 0x33473d, 0.42)

      this.physics.add.existing(rect, true)
      this.obstacleGroup.add(rect)
      this.mapObjects.push(rect)
    }

    for (const exit of map.exits) {
      const zone = this.add
        .rectangle(
          exit.area.x + exit.area.width / 2,
          exit.area.y + exit.area.height / 2,
          exit.area.width,
          exit.area.height,
          0xffd08f,
          0.12,
        )
        .setStrokeStyle(2, 0xffd08f, 0.26)
      const label = this.add
        .text(exit.area.x + exit.area.width / 2, exit.area.y + exit.area.height / 2, exit.label, {
          fontFamily: '"Trebuchet MS", sans-serif',
          fontSize: '13px',
          color: '#ffe8c2',
          align: 'center',
          wordWrap: { width: 130 },
        })
        .setOrigin(0.5)
      const beacon = this.add
        .triangle(exit.area.x + exit.area.width / 2, exit.area.y + 34, 0, 22, 14, 0, 28, 22, 0xffe5a6, 0.95)
        .setVisible(false)
        .setDepth(3)

      this.tweens.add({
        targets: zone,
        alpha: { from: 0.1, to: 0.22 },
        duration: 920,
        yoyo: true,
        repeat: -1,
      })

      this.tweens.add({
        targets: beacon,
        y: beacon.y - 10,
        alpha: { from: 0.45, to: 0.95 },
        duration: 760,
        yoyo: true,
        repeat: -1,
      })

      this.exitRuntimes.push({ data: exit, zone, label, beacon })
      this.mapObjects.push(zone, label, beacon)
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
            fontFamily: '"Trebuchet MS", sans-serif',
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
    this.createBossBar()
    this.cameras.main.startFollow(this.player!, true, 1, 1)
    this.refreshObjectivePresentation()
    this.interactionHint = this.computeInteractionHint()
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
          fontFamily: '"Trebuchet MS", sans-serif',
          fontSize: '12px',
          color: '#cbfff7',
        })
        .setOrigin(0.5)
      const marker = this.add
        .text(npc.x, npc.y - 52, 'QUEST', {
          fontFamily: '"Trebuchet MS", sans-serif',
          fontSize: '11px',
          color: '#1b130e',
          backgroundColor: '#ffd28b',
          padding: { left: 7, right: 7, top: 3, bottom: 3 },
        })
        .setOrigin(0.5)
        .setVisible(false)
      this.npcRuntimes.push({ data: npc, sprite, label, ring, marker })
      this.mapObjects.push(ring, sprite, label, marker)
    }
  }

  private spawnEnemies(map: MapData): void {
    const enemies = Object.values(this.content.enemies).filter(
      (enemy) => enemy.mapId === map.id && !this.state!.defeatedEnemyIds.includes(enemy.id),
    )

    for (const enemy of enemies) {
      const ring = this.add
        .circle(enemy.x, enemy.y, enemy.isBoss ? 24 : 19, 0xff8e7d, 0.12)
        .setStrokeStyle(2, 0xff8e7d, 0.42)
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
          fontFamily: '"Trebuchet MS", sans-serif',
          fontSize: '11px',
          color: '#ffd1c9',
        })
        .setOrigin(0.5)

      const hpBarWidth = enemy.isBoss ? 94 : 58
      const hpTrack = this.add
        .rectangle(enemy.x, enemy.y - 48, hpBarWidth, 8, 0x190f0f, 0.85)
        .setStrokeStyle(1, 0xffb7a2, 0.18)
        .setVisible(false)
      const hpFill = this.add
        .rectangle(enemy.x - hpBarWidth / 2, enemy.y - 48, hpBarWidth, 4, enemy.isBoss ? 0xff9d58 : 0xff8e7d, 0.96)
        .setOrigin(0, 0.5)
        .setVisible(false)
      const marker = this.add
        .text(enemy.x, enemy.y - 64, enemy.isBoss ? 'BOSS' : 'TARGET', {
          fontFamily: '"Trebuchet MS", sans-serif',
          fontSize: '10px',
          color: '#1d130d',
          backgroundColor: '#ffb98a',
          padding: { left: 6, right: 6, top: 2, bottom: 2 },
        })
        .setOrigin(0.5)
        .setVisible(false)

      this.tweens.add({
        targets: ring,
        alpha: { from: 0.12, to: 0.26 },
        scaleX: { from: 1, to: enemy.isBoss ? 1.18 : 1.1 },
        scaleY: { from: 1, to: enemy.isBoss ? 1.18 : 1.1 },
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
        hpTrack,
        hpFill,
        marker,
        hpBarWidth,
      }

      if (this.obstacleGroup) {
        this.colliders.push(this.physics.add.collider(runtime.sprite, this.obstacleGroup))
      }

      this.enemyRuntimes.push(runtime)
      this.mapObjects.push(ring, sprite, label, hpTrack, hpFill, marker)
    }
  }

  private createBossBar(): void {
    const boss = this.enemyRuntimes.find((enemy) => enemy.data.isBoss)
    if (!boss) {
      return
    }

    const width = 220
    const frame = this.add
      .rectangle(480, 36, width, 30, 0x1b1113, 0.88)
      .setStrokeStyle(1, 0xffc08d, 0.32)
      .setScrollFactor(0)
      .setDepth(20)
      .setVisible(false)
    const fill = this.add
      .rectangle(370, 36, width - 24, 10, 0xff9d58, 0.95)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(21)
      .setVisible(false)
    const label = this.add
      .text(480, 23, boss.data.name, {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '12px',
        color: '#ffe8cf',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21)
      .setVisible(false)
    const sublabel = this.add
      .text(480, 47, 'Sunstone Vault threat', {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '10px',
        color: '#d5bfa3',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21)
      .setVisible(false)

    this.bossBar = { frame, fill, label, sublabel, width: width - 24 }
    this.mapObjects.push(frame, fill, label, sublabel)
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

    const velocity = normalizeVelocity(
      Number(this.movementState.right) - Number(this.movementState.left),
      Number(this.movementState.down) - Number(this.movementState.up),
      185,
    )
    body.setVelocity(velocity.x, velocity.y)
  }

  private updateEnemies(delta: number): void {
    if (!this.player || !this.state) {
      return
    }

    const playerStats = getDerivedStats(this.state, this.content)
    const now = this.time.now
    const objectiveTarget = this.getActiveObjectiveTarget()

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
      this.updateEnemyHud(enemy, distance, objectiveTarget.targetId === data.id)

      if (distance < 34 && now >= enemy.lastAttackAt + data.attackCooldownMs && now >= this.damageInvulnerableUntil) {
        enemy.lastAttackAt = now
        this.damageInvulnerableUntil = now + 700
        const damage = Math.max(1, data.contactDamage + data.attack - Math.floor(playerStats.defense / 2))
        this.damagePlayer(damage)
      }
    }

    this.updateBossBar(objectiveTarget)
    void delta
  }

  private updateEnemyHud(enemy: EnemyRuntime, distance: number, isObjective: boolean): void {
    const y = enemy.sprite.y - (enemy.data.isBoss ? 52 : 40)
    enemy.hpTrack.setPosition(enemy.sprite.x, y)
    enemy.hpFill.setPosition(enemy.sprite.x - enemy.hpBarWidth / 2, y)
    enemy.hpFill.displayWidth = Math.max(0, enemy.hpBarWidth * (enemy.hp / enemy.data.maxHp))
    enemy.marker.setPosition(enemy.sprite.x, y - 14)

    const visible = enemy.hp < enemy.data.maxHp || distance < 145 || isObjective
    enemy.hpTrack.setVisible(visible)
    enemy.hpFill.setVisible(visible && enemy.hp > 0)
    enemy.marker.setVisible(isObjective)
    enemy.ring.setStrokeStyle(2, isObjective ? 0xffcf7a : 0xff8e7d, isObjective ? 0.72 : 0.42)
  }

  private updateBossBar(objectiveTarget: ObjectiveTarget): void {
    if (!this.bossBar) {
      return
    }

    const boss = this.enemyRuntimes.find((enemy) => enemy.data.isBoss)
    const visible = Boolean(boss) && this.currentMap?.id === boss?.data.mapId
    this.bossBar.frame.setVisible(visible)
    this.bossBar.fill.setVisible(visible)
    this.bossBar.label.setVisible(visible)
    this.bossBar.sublabel.setVisible(visible)

    if (!visible || !boss) {
      return
    }

    this.bossBar.fill.displayWidth = Math.max(0, this.bossBar.width * (boss.hp / boss.data.maxHp))
    this.bossBar.label.setText(`${boss.data.name} ${objectiveTarget.targetId === boss.data.id ? '• Objective' : ''}`)
  }

  private computeInteractionHint(): string | null {
    if (!this.player || !this.currentMap || !this.state) {
      return null
    }

    const nearbyEnemy = this.enemyRuntimes
      .map((enemy) => ({
        enemy,
        distance: Phaser.Math.Distance.Between(this.player!.x, this.player!.y, enemy.sprite.x, enemy.sprite.y),
      }))
      .filter((entry) => entry.distance < 96)
      .sort((left, right) => left.distance - right.distance)[0]

    if (nearbyEnemy) {
      return `${nearbyEnemy.enemy.data.name} is in range. Press Space to strike.`
    }

    const objectiveTarget = this.getActiveObjectiveTarget()
    if (objectiveTarget.mapId === this.currentMap.id && objectiveTarget.label) {
      return objectiveTarget.label
    }

    const closestNpc = this.npcRuntimes
      .map((npc) => ({
        npc,
        distance: Phaser.Math.Distance.Between(this.player!.x, this.player!.y, npc.data.x, npc.data.y),
      }))
      .filter((entry) => entry.distance < 82)
      .sort((left, right) => left.distance - right.distance)[0]

    if (closestNpc) {
      return `Press E to speak with ${closestNpc.npc.data.name}.`
    }

    const checkpoint = this.currentMap.checkpoints.find((entry) => isInside(entry.area, this.player!.x, this.player!.y))
    if (checkpoint) {
      return `Checkpoint active: ${checkpoint.label}.`
    }

    return 'Stay on the marked path and keep the field deck in sight.'
  }

  private syncInteractionHint(): void {
    const nextHint = this.computeInteractionHint()
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
      this.spawnFloatingText(this.player.x, this.player.y - 36, 'Too far', '#ffe5bc')
      return
    }

    const damage = Math.max(1, playerStats.attack - Math.floor(target.enemy.data.defense / 2))
    target.enemy.hp -= damage
    target.enemy.sprite.setFillStyle(0xffe3c2, 1)
    this.spawnFloatingText(target.enemy.sprite.x, target.enemy.sprite.y - 38, `-${damage}`, '#ffd28b')
    this.time.delayedCall(90, () => {
      target.enemy.sprite.setFillStyle(toColor(target.enemy.data.color), 1)
    })

    pushNotification(this.state, `${target.enemy.data.name} takes ${damage} damage.`, {
      kind: 'combat',
      dedupeKey: `${target.enemy.data.id}-damage-${damage}`,
    })

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

    pushNotification(this.state, `${checkpoint.label} is now your checkpoint.`, {
      kind: 'system',
      dedupeKey: `checkpoint-${checkpoint.id}`,
    })
    this.persistState('auto')
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
    pushNotification(this.state, `You head toward ${this.content.maps[exit.targetMapId].name}.`, {
      kind: 'quest',
      dedupeKey: `travel-${exit.targetMapId}`,
    })
    this.persistState('auto')
    this.checkpointState = cloneGameState(this.state)
    this.renderCurrentMap()
    this.publishSnapshot()
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
          pushNotification(this.state, `Quest started: ${quest.name}.`, {
            kind: 'quest',
            dedupeKey: `quest-start-${quest.id}`,
          })
        }
        break
      }
      case 'advanceQuestStage': {
        const progress = ensureQuestProgress(this.state, action.questId)
        if (progress.status === 'active') {
          progress.stageId = action.stageId
          const quest = this.content.quests[action.questId]
          const stage = quest.stages.find((entry) => entry.id === action.stageId)
          if (stage) {
            pushNotification(this.state, `${quest.name}: ${stage.title}.`, {
              kind: 'quest',
              dedupeKey: `quest-stage-${quest.id}-${stage.id}`,
            })
          }
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
            pushNotification(this.state, message, { kind: 'quest', dedupeKey: message })
          }
          if (quest.reward.itemId) {
            addItem(this.state, quest.reward.itemId, 1)
            pushNotification(this.state, `${this.content.items[quest.reward.itemId].name} joins your kit.`, {
              kind: 'loot',
              dedupeKey: `reward-item-${quest.reward.itemId}`,
            })
          }
          pushNotification(this.state, `${quest.name} completed.`, {
            kind: 'quest',
            dedupeKey: `quest-complete-${quest.id}`,
          })
        }
        break
      }
      case 'setFlag': {
        this.state.flags[action.flag] = action.value
        break
      }
      case 'giveItem': {
        addItem(this.state, action.itemId, action.quantity)
        pushNotification(this.state, `Received ${this.content.items[action.itemId].name}.`, {
          kind: 'loot',
          dedupeKey: `item-${action.itemId}-received`,
        })
        break
      }
      case 'removeItem': {
        removeItem(this.state, action.itemId, action.quantity)
        break
      }
      case 'healPlayer': {
        const restored = healPlayer(this.state, this.content, action.amount, action.full)
        if (restored > 0) {
          pushNotification(this.state, `Recovered ${restored} HP.`, {
            kind: 'system',
            dedupeKey: `recover-${restored}`,
          })
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
      pushNotification(this.state, message, { kind: 'quest', dedupeKey: message })
    }

    pushNotification(this.state, `${enemy.data.name} falls.`, {
      kind: 'combat',
      dedupeKey: `enemy-fall-${enemy.data.id}`,
    })
    this.spawnFloatingText(enemy.sprite.x, enemy.sprite.y - 56, 'Defeated', '#ffb88e')

    for (const drop of enemy.data.loot) {
      if (Math.random() <= drop.chance) {
        addItem(this.state, drop.itemId, drop.quantity)
        pushNotification(this.state, `Looted ${this.content.items[drop.itemId].name}.`, {
          kind: 'loot',
          dedupeKey: `loot-${drop.itemId}`,
        })
      }
    }

    for (const action of enemy.data.deathActions ?? []) {
      this.applyAction(action)
    }

    enemy.sprite.destroy()
    enemy.label.destroy()
    enemy.ring.destroy()
    enemy.hpTrack.destroy()
    enemy.hpFill.destroy()
    enemy.marker.destroy()
    this.enemyRuntimes = this.enemyRuntimes.filter((entry) => entry !== enemy)
    this.refreshObjectivePresentation()
    this.persistState('auto')
    this.publishSnapshot()
  }

  private damagePlayer(amount: number): void {
    if (!this.state || !this.player) {
      return
    }

    this.state.player.hp = Math.max(0, this.state.player.hp - amount)
    this.player.setFillStyle(0xff9a91, 1)
    this.spawnFloatingText(this.player.x, this.player.y - 42, `-${amount}`, '#ff9d91')
    this.time.delayedCall(120, () => {
      this.player?.setFillStyle(0xf7d7a6, 1)
    })
    pushNotification(this.state, `You suffer ${amount} damage.`, {
      kind: 'combat',
      dedupeKey: `player-damage-${amount}`,
    })

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
    pushNotification(restored, 'You collapse and awaken at your last checkpoint.', {
      kind: 'system',
      dedupeKey: 'restore-checkpoint',
    })
    this.state = restored
    this.activeDialogue = null
    this.clearGameplayInput()
    this.renderCurrentMap()
    this.publishSnapshot()
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    const label = this.add.text(x, y, text, {
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: '14px',
      color,
      stroke: '#140c0a',
      strokeThickness: 3,
    })
    label.setOrigin(0.5)
    this.mapObjects.push(label)
    this.tweens.add({
      targets: label,
      y: y - 24,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        label.destroy()
        this.mapObjects = this.mapObjects.filter((entry) => entry !== label)
      },
    })
  }

  private refreshObjectivePresentation(): void {
    const objectiveTarget = this.getActiveObjectiveTarget()

    for (const npc of this.npcRuntimes) {
      const isTarget = objectiveTarget.kind === 'npc' && objectiveTarget.targetId === npc.data.id
      npc.marker.setVisible(isTarget)
      npc.ring.setStrokeStyle(2, isTarget ? 0xffd28b : 0x7de2d1, isTarget ? 0.8 : 0.34)
    }

    for (const exit of this.exitRuntimes) {
      const isTarget = objectiveTarget.kind === 'exit' && objectiveTarget.targetId === exit.data.id
      exit.zone.setStrokeStyle(2, isTarget ? 0xffefb5 : 0xffd08f, isTarget ? 0.6 : 0.26)
      exit.zone.setFillStyle(0xffd08f, isTarget ? 0.2 : 0.12)
      exit.label.setColor(isTarget ? '#fff5d2' : '#ffe8c2')
      exit.beacon.setVisible(isTarget)
    }

    for (const enemy of this.enemyRuntimes) {
      const isTarget = objectiveTarget.kind === 'enemy' && objectiveTarget.targetId === enemy.data.id
      enemy.marker.setVisible(isTarget)
      enemy.ring.setStrokeStyle(2, isTarget ? 0xffd28b : 0xff8e7d, isTarget ? 0.72 : 0.42)
    }
  }

  private getActiveObjectiveTarget(): ObjectiveTarget {
    if (!this.state) {
      return { kind: 'none', mapId: null, targetId: null, label: null }
    }

    return getObjectiveTarget(this.state, this.content)
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

    this.refreshObjectivePresentation()
    this.interactionHint = this.computeInteractionHint()

    const player: PlayerView = getPlayerView(this.state, this.content)
    this.controller.publish({
      screen: 'playing',
      canContinue: hasSavedGame(),
      locationName: this.currentMap.name,
      locationDescription: this.currentMap.description,
      nextStep: getNextStep(this.state, this.content),
      saveStatus: getSaveStatus(this.state),
      objectiveTarget: getObjectiveTarget(this.state, this.content),
      celebration: getCelebration(this.state, this.content),
      player,
      inventory: getInventoryViews(this.state, this.content),
      quests: getQuestViews(this.state, this.content),
      dialogue: this.buildDialogueView(),
      notifications: this.state.notifications,
      interactionHint: this.interactionHint,
      objective: getCurrentObjective(this.state, this.content),
    })
  }

  private persistState(kind: SaveKind, notificationText?: string): void {
    if (!this.state) {
      return
    }

    this.state.saveMeta = {
      savedAt: new Date().toISOString(),
      version: 2,
      kind,
    }

    if (kind === 'manual' && notificationText) {
      pushNotification(this.state, notificationText, {
        kind: 'save',
        dedupeKey: 'manual-save',
      })
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
    this.exitRuntimes = []
    this.bossBar = null

    for (const object of this.mapObjects) {
      object.destroy()
    }
    this.mapObjects = []
    this.player = null
  }
}

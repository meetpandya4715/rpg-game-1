import Phaser from 'phaser'
import { createInitialGameState, createTitleSnapshot } from './state'
import { hasSavedGame, loadGameState } from './storage'
import { RpgScene } from './phaser/RpgScene'
import type { ContentPack, GameSnapshot, GameState } from './types'

type SnapshotListener = (snapshot: GameSnapshot) => void

export class GameController {
  private readonly content: ContentPack
  private readonly listeners = new Set<SnapshotListener>()
  private game: Phaser.Game | null = null
  private scene: RpgScene | null = null
  private snapshot: GameSnapshot
  private pendingState: GameState | null = null

  constructor(content: ContentPack) {
    this.content = content
    this.snapshot = createTitleSnapshot(hasSavedGame())
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  mount(parent: HTMLElement): void {
    if (this.game) {
      return
    }

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: 960,
      height: 540,
      backgroundColor: '#171019',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
        },
      },
      scene: [new RpgScene(this, this.content)],
    })
  }

  registerScene(scene: RpgScene): void {
    this.scene = scene
    if (this.pendingState) {
      scene.loadGameState(this.pendingState)
      this.pendingState = null
      return
    }

    this.publish(createTitleSnapshot(hasSavedGame()))
  }

  startNewGame(): void {
    const state = createInitialGameState(this.content)
    this.loadIntoScene(state)
  }

  continueGame(): void {
    const state = loadGameState()
    if (!state) {
      this.publish(createTitleSnapshot(false))
      return
    }

    this.loadIntoScene(state)
  }

  saveGame(): void {
    this.scene?.saveCurrentGame()
  }

  useItem(itemId: string): void {
    this.scene?.useItem(itemId)
  }

  attackNearby(): void {
    this.scene?.attackNearby()
  }

  toggleEquipment(itemId: string): void {
    this.scene?.toggleEquipment(itemId)
  }

  chooseDialogueOption(optionId: string): void {
    this.scene?.selectDialogueOption(optionId)
  }

  closeDialogue(): void {
    this.scene?.closeDialogue()
  }

  publish(snapshot: GameSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  destroy(): void {
    this.scene = null
    this.game?.destroy(true)
    this.game = null
  }

  private loadIntoScene(state: GameState): void {
    if (this.scene) {
      this.scene.loadGameState(state)
      return
    }

    this.pendingState = state
  }
}

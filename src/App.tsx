import { startTransition, useEffect, useRef, useState } from 'react'
import './App.css'
import { loadContentPack } from './game/content'
import { GameController } from './game/controller'
import { createLoadingSnapshot } from './game/state'
import type {
  ContentPack,
  DialogueOption,
  GameSnapshot,
  InventoryView,
  NotificationEntry,
  QuestView,
  SaveStatus,
} from './game/types'

type SidebarView = 'guide' | 'quests' | 'inventory' | 'log'

const EMPTY_DIALOGUE_OPTIONS: DialogueOption[] = []
const KEYBOARD_GUIDE = [
  { key: 'Move', description: 'WASD or arrow keys' },
  { key: 'Talk', description: 'E near a villager' },
  { key: 'Attack', description: 'Space near a threat' },
  { key: 'Heal', description: 'H uses a tonic' },
  { key: 'Save', description: 'P locks a manual save' },
  { key: 'Deck', description: '1-4 or Q / I / L' },
]

function formatSaveStatus(saveStatus: SaveStatus): string {
  if (!saveStatus.savedAt) {
    return 'No save yet'
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(saveStatus.savedAt))

  return `${saveStatus.kind === 'manual' ? 'Manual save' : 'Autosaved'} ${formatted}`
}

function renderQuestStatus(quest: QuestView): string {
  if (quest.progress.status === 'complete') {
    return 'Complete'
  }
  return 'Active'
}

function renderItemAction(item: InventoryView): string | null {
  if (item.item.type === 'consumable') {
    return 'Use'
  }

  if (item.item.slot) {
    return item.equipped ? 'Unequip' : 'Equip'
  }

  return null
}

function renderNotificationText(notification: NotificationEntry): string {
  return notification.count > 1 ? `${notification.message} x${notification.count}` : notification.message
}

function renderNotificationKind(notification: NotificationEntry): string {
  switch (notification.kind) {
    case 'combat':
      return 'Combat'
    case 'quest':
      return 'Quest'
    case 'loot':
      return 'Loot'
    case 'save':
      return 'Save'
    default:
      return 'Field'
  }
}

function App() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<GameController | null>(null)
  const [content, setContent] = useState<ContentPack | null>(null)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => createLoadingSnapshot())
  const [error, setError] = useState<string | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('guide')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [hiddenCelebrationTitle, setHiddenCelebrationTitle] = useState<string | null>(null)
  const [dialogueSelection, setDialogueSelection] = useState<{ nodeId: string | null; index: number }>({
    nodeId: null,
    index: 0,
  })
  const [selectedInventoryIndex, setSelectedInventoryIndex] = useState(0)
  const dialogue = snapshot.dialogue
  const dialogueOptions = dialogue?.node.options ?? EMPTY_DIALOGUE_OPTIONS
  const activeDialogueIndex =
    dialogue && dialogueSelection.nodeId === dialogue.node.id
      ? Math.min(dialogueSelection.index, Math.max(0, dialogueOptions.length - 1))
      : 0
  const clampedInventoryIndex = Math.min(selectedInventoryIndex, Math.max(0, snapshot.inventory.length - 1))
  const selectedInventoryItem = snapshot.inventory[clampedInventoryIndex] ?? null
  const potionCount = snapshot.inventory.find((entry) => entry.item.id === 'potion')?.quantity ?? 0
  const lowHealth = snapshot.player ? snapshot.player.hp / snapshot.player.maxHp <= 0.35 : false
  const celebrationVisible = Boolean(snapshot.celebration && snapshot.celebration.title !== hiddenCelebrationTitle)

  useEffect(() => {
    let cancelled = false

    loadContentPack()
      .then((loadedContent) => {
        if (!cancelled) {
          setContent(loadedContent)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load the RPG content pack.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!content || !hostRef.current) {
      return
    }

    const controller = new GameController(content)
    controllerRef.current = controller

    const unsubscribe = controller.subscribe((nextSnapshot) => {
      startTransition(() => {
        setSnapshot(nextSnapshot)
      })
    })

    controller.mount(hostRef.current)

    return () => {
      unsubscribe()
      controller.destroy()
      controllerRef.current = null
    }
  }, [content])

  useEffect(() => {
    if (snapshot.celebration && snapshot.celebration.title !== hiddenCelebrationTitle) {
      return
    }

    if (!snapshot.celebration && hiddenCelebrationTitle) {
      setHiddenCelebrationTitle(null)
    }
  }, [hiddenCelebrationTitle, snapshot.celebration])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        setShowShortcuts((current) => !current)
        return
      }

      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'escape' && showShortcuts) {
        event.preventDefault()
        setShowShortcuts(false)
        return
      }

      if (snapshot.screen === 'title') {
        if (key === 'enter' || key === 'n') {
          event.preventDefault()
          controllerRef.current?.startNewGame()
          return
        }
        if (key === 'c' && snapshot.canContinue) {
          event.preventDefault()
          controllerRef.current?.continueGame()
        }
        return
      }

      if (dialogue) {
        if (key === 'escape') {
          event.preventDefault()
          controllerRef.current?.closeDialogue()
          return
        }

        if (key === 'arrowdown' || key === 'j') {
          event.preventDefault()
          if (dialogueOptions.length === 0) {
            return
          }
          setDialogueSelection((current) => ({
            nodeId: dialogue.node.id,
            index: current.nodeId === dialogue.node.id ? (current.index + 1) % dialogueOptions.length : 0,
          }))
          return
        }

        if (key === 'arrowup' || key === 'k') {
          event.preventDefault()
          if (dialogueOptions.length === 0) {
            return
          }
          setDialogueSelection((current) => ({
            nodeId: dialogue.node.id,
            index:
              current.nodeId === dialogue.node.id
                ? (current.index - 1 + dialogueOptions.length) % dialogueOptions.length
                : Math.max(0, dialogueOptions.length - 1),
          }))
          return
        }

        if (key === 'enter' || key === ' ') {
          event.preventDefault()
          const option = dialogueOptions[activeDialogueIndex]
          if (option) {
            controllerRef.current?.chooseDialogueOption(option.id)
          }
          return
        }

        const number = Number.parseInt(key, 10)
        if (!Number.isNaN(number) && number >= 1 && number <= dialogueOptions.length) {
          event.preventDefault()
          controllerRef.current?.chooseDialogueOption(dialogueOptions[number - 1].id)
        }
        return
      }

      if (snapshot.screen !== 'playing') {
        return
      }

      if (key === 'p') {
        event.preventDefault()
        controllerRef.current?.saveGame()
        return
      }

      if (key === 'h') {
        event.preventDefault()
        controllerRef.current?.useItem('potion')
        return
      }

      if (key === '1') {
        event.preventDefault()
        setSidebarView('guide')
        return
      }
      if (key === '2') {
        event.preventDefault()
        setSidebarView('quests')
        return
      }
      if (key === '3') {
        event.preventDefault()
        setSidebarView('inventory')
        return
      }
      if (key === '4') {
        event.preventDefault()
        setSidebarView('log')
        return
      }

      if (key === 'q') {
        event.preventDefault()
        setSidebarView('quests')
        return
      }
      if (key === 'i') {
        event.preventDefault()
        setSidebarView('inventory')
        return
      }
      if (key === 'l') {
        event.preventDefault()
        setSidebarView('log')
        return
      }

      if (sidebarView === 'inventory') {
        if (key === 'j') {
          event.preventDefault()
          setSelectedInventoryIndex((current) =>
            snapshot.inventory.length === 0 ? 0 : (current + 1) % snapshot.inventory.length,
          )
          return
        }

        if (key === 'k') {
          event.preventDefault()
          setSelectedInventoryIndex((current) =>
            snapshot.inventory.length === 0
              ? 0
              : (current - 1 + snapshot.inventory.length) % snapshot.inventory.length,
          )
          return
        }

        if (key === 'enter' && selectedInventoryItem) {
          event.preventDefault()
          if (selectedInventoryItem.item.type === 'consumable') {
            controllerRef.current?.useItem(selectedInventoryItem.item.id)
            return
          }
          if (selectedInventoryItem.item.slot) {
            controllerRef.current?.toggleEquipment(selectedInventoryItem.item.id)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeDialogueIndex,
    dialogue,
    dialogueOptions,
    selectedInventoryItem,
    showShortcuts,
    sidebarView,
    snapshot.canContinue,
    snapshot.inventory,
    snapshot.screen,
  ])

  const renderInventoryAction = (item: InventoryView) => {
    const action = renderItemAction(item)
    if (!action) {
      return null
    }

    return (
      <button
        type="button"
        className="pill-button secondary"
        onClick={() => {
          if (item.item.type === 'consumable') {
            controllerRef.current?.useItem(item.item.id)
            return
          }
          if (item.item.slot) {
            controllerRef.current?.toggleEquipment(item.item.id)
          }
        }}
      >
        {action}
      </button>
    )
  }

  const renderSidebarContent = () => {
    switch (sidebarView) {
      case 'guide':
        return (
          <div className="deck-stack">
            <section className="deck-card accent">
              <div className="deck-eyebrow">Objective Route</div>
              <h3>{snapshot.nextStep}</h3>
              <p>{snapshot.objectiveTarget.label ?? snapshot.objective}</p>
            </section>
            <section className="deck-card">
              <div className="deck-eyebrow">Field Readout</div>
              <div className="stat-grid">
                <div className="stat-card">
                  <span>HP</span>
                  <strong>{snapshot.player ? `${snapshot.player.hp} / ${snapshot.player.maxHp}` : '--'}</strong>
                </div>
                <div className="stat-card">
                  <span>Level</span>
                  <strong>{snapshot.player ? `${snapshot.player.level} • XP ${snapshot.player.xp}` : '--'}</strong>
                </div>
                <div className="stat-card">
                  <span>Attack</span>
                  <strong>{snapshot.player?.attack ?? '--'}</strong>
                </div>
                <div className="stat-card">
                  <span>Gold</span>
                  <strong>{snapshot.player?.gold ?? '--'}</strong>
                </div>
              </div>
            </section>
            <section className="deck-card">
              <div className="deck-eyebrow">Nearby</div>
              <p>{snapshot.interactionHint ?? 'Keep moving toward the marked route or nearby villagers.'}</p>
            </section>
            {showShortcuts ? (
              <section className="deck-card">
                <div className="deck-eyebrow">Command Sheet</div>
                <div className="shortcut-list">
                  {KEYBOARD_GUIDE.map((entry) => (
                    <div key={entry.key} className="shortcut-row">
                      <span className="shortcut-key">{entry.key}</span>
                      <span>{entry.description}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )
      case 'quests':
        return (
          <ul className="panel-list">
            {snapshot.quests.length > 0 ? (
              snapshot.quests.map((quest) => (
                <li key={quest.quest.id} className="panel-item">
                  <div className="panel-item-head">
                    <strong>{quest.quest.name}</strong>
                    <span className={`status-tag ${quest.progress.status}`}>{renderQuestStatus(quest)}</span>
                  </div>
                  <p>{quest.currentStage?.title ?? quest.quest.summary}</p>
                  <p className="muted-copy">{quest.currentStage?.description ?? quest.quest.summary}</p>
                </li>
              ))
            ) : (
              <li className="panel-item">
                <strong>No active quests yet</strong>
                <p className="muted-copy">Speak with Elder Mira to begin the frontier watch.</p>
              </li>
            )}
          </ul>
        )
      case 'inventory':
        return (
          <ul className="panel-list">
            {snapshot.inventory.map((entry, index) => (
              <li key={entry.item.id} className={`panel-item ${index === clampedInventoryIndex ? 'selected' : ''}`}>
                <div className="panel-item-head">
                  <strong>{entry.item.name}</strong>
                  <span className="status-tag neutral">x{entry.quantity}</span>
                </div>
                <p>{entry.item.description}</p>
                <div className="inline-actions">
                  <span className={`status-tag ${entry.equipped ? 'complete' : 'neutral'}`}>
                    {entry.equipped ? 'Equipped' : entry.item.type}
                  </span>
                  {renderInventoryAction(entry)}
                </div>
              </li>
            ))}
          </ul>
        )
      case 'log':
        return (
          <ul className="panel-list">
            {snapshot.notifications.map((note) => (
              <li key={note.id} className="panel-item">
                <div className="panel-item-head">
                  <strong>{renderNotificationKind(note)}</strong>
                  <span className="status-tag neutral">{new Date(note.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <p>{renderNotificationText(note)}</p>
              </li>
            ))}
          </ul>
        )
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="top-hud">
          <div className="brand-cluster">
            <div className="brand-mark">EF</div>
            <div>
              <p className="eyebrow">Keyboard-first frontier RPG</p>
              <h1>Emberfall Frontier</h1>
            </div>
          </div>
          <div className="hud-strip">
            <div className="hud-chip">
              <span>Location</span>
              <strong>{snapshot.locationName}</strong>
            </div>
            <div className="hud-chip wide">
              <span>Objective</span>
              <strong>{snapshot.nextStep}</strong>
            </div>
            <div className="hud-chip">
              <span>Save Status</span>
              <strong>{formatSaveStatus(snapshot.saveStatus)}</strong>
            </div>
            <button type="button" className="pill-button secondary" onClick={() => setShowShortcuts((current) => !current)}>
              {showShortcuts ? 'Hide Help' : 'Show Help'}
            </button>
          </div>
        </header>

        <div className="experience-grid">
          <section className="game-column">
            <div className="game-toolbar">
              <div className="autosave-note">
                <span>Autosave live</span>
                <strong>Travel, quest beats, checkpoints, and loot update automatically.</strong>
              </div>
              <div className="quick-actions">
                <button type="button" className="pill-button primary" onClick={() => controllerRef.current?.attackNearby()}>
                  Attack
                </button>
                <button
                  type="button"
                  className="pill-button secondary"
                  onClick={() => controllerRef.current?.useItem('potion')}
                  disabled={potionCount <= 0}
                >
                  Heal {potionCount > 0 ? `(${potionCount})` : ''}
                </button>
                <button type="button" className="pill-button secondary" onClick={() => controllerRef.current?.saveGame()}>
                  Save Now
                </button>
              </div>
            </div>

            <section className="game-panel">
              <div className="game-stage">
                <div ref={hostRef} className="game-canvas" />
                <div className="stage-overlay top">
                  <div className="stage-card objective">
                    <span className="eyebrow">Route</span>
                    <strong>{snapshot.nextStep}</strong>
                    <p>{snapshot.objectiveTarget.label ?? snapshot.objective}</p>
                  </div>
                </div>
                <div className="stage-overlay bottom">
                  <div className="stage-status-row">
                    <div className="stage-pill">{snapshot.saveStatus.kind === 'manual' ? 'Manual save ready' : 'Autosave active'}</div>
                    <div className="stage-pill muted">{snapshot.interactionHint ?? 'Stay on route.'}</div>
                    {lowHealth ? <div className="stage-pill danger">Low health: use a tonic or find Iora.</div> : null}
                  </div>
                </div>

                {error ? (
                  <div className="overlay">
                    <div className="overlay-card error">
                      <h2>Content Error</h2>
                      <p>{error}</p>
                    </div>
                  </div>
                ) : null}

                {!content && !error ? (
                  <div className="overlay">
                    <div className="overlay-card">
                      <h2>Loading Emberfall</h2>
                      <p>Gathering maps, dialogue, combat data, and the frontier field deck.</p>
                    </div>
                  </div>
                ) : null}

                {snapshot.screen === 'title' ? (
                  <div className="overlay">
                    <div className="overlay-card">
                      <span className="eyebrow">Stand Watch Over Emberfall</span>
                      <h2>Three maps. One relic. One clean run.</h2>
                      <p>Start a fresh watch, cross the Greenwild, descend into the Ashen Ruin, and bring the Sunstone home.</p>
                      <div className="inline-actions">
                        <button type="button" className="pill-button primary" onClick={() => controllerRef.current?.startNewGame()}>
                          New Game
                        </button>
                        <button
                          type="button"
                          className="pill-button secondary"
                          onClick={() => controllerRef.current?.continueGame()}
                          disabled={!snapshot.canContinue}
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {dialogue ? (
                  <div className="dialogue-overlay">
                    <div className="dialogue-card">
                      <div className="dialogue-head">
                        <span className="speaker-pill">{dialogue.node.speaker}</span>
                        <button type="button" className="pill-button secondary" onClick={() => controllerRef.current?.closeDialogue()}>
                          Close
                        </button>
                      </div>
                      <h3>{snapshot.locationName}</h3>
                      <p>{dialogue.node.text}</p>
                      <div className="dialogue-actions">
                        {dialogue.node.options.map((option, index) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`choice-button ${index === activeDialogueIndex ? 'selected' : ''}`}
                            onClick={() => controllerRef.current?.chooseDialogueOption(option.id)}
                          >
                            {index + 1}. {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </section>

          <aside className="field-deck">
            <section className="deck-shell">
              <div className="deck-head">
                <div>
                  <p className="eyebrow">Field Deck</p>
                  <h2>{snapshot.objectiveTarget.kind === 'none' ? 'Frontier Secure' : 'Active Route'}</h2>
                </div>
                <button type="button" className="pill-button secondary" onClick={() => controllerRef.current?.saveGame()} disabled={snapshot.screen !== 'playing'}>
                  Save Now
                </button>
              </div>

              <div className="deck-summary">
                <div className="summary-chip">
                  <span>Target</span>
                  <strong>{snapshot.objectiveTarget.kind === 'none' ? 'Free roam' : snapshot.objectiveTarget.kind}</strong>
                </div>
                <div className="summary-chip">
                  <span>Autosave</span>
                  <strong>{snapshot.saveStatus.kind === 'manual' ? 'Manual locked' : 'Live'}</strong>
                </div>
              </div>

              <div className="tab-row" role="tablist" aria-label="Field deck panels">
                <button type="button" className={`tab-button${sidebarView === 'guide' ? ' active' : ''}`} onClick={() => setSidebarView('guide')}>
                  Guide
                </button>
                <button type="button" className={`tab-button${sidebarView === 'quests' ? ' active' : ''}`} onClick={() => setSidebarView('quests')}>
                  Quest
                </button>
                <button type="button" className={`tab-button${sidebarView === 'inventory' ? ' active' : ''}`} onClick={() => setSidebarView('inventory')}>
                  Pack
                </button>
                <button type="button" className={`tab-button${sidebarView === 'log' ? ' active' : ''}`} onClick={() => setSidebarView('log')}>
                  Log
                </button>
              </div>

              <div className="deck-content">{renderSidebarContent()}</div>
            </section>
          </aside>
        </div>
      </div>

      {celebrationVisible && snapshot.celebration ? (
        <div className="celebration-backdrop">
          <div className="celebration-card">
            <span className="eyebrow">Quest Complete</span>
            <h2>{snapshot.celebration.title}</h2>
            <p>{snapshot.celebration.summary}</p>
            <ul className="reward-list">
              {snapshot.celebration.rewards.map((reward) => (
                <li key={reward}>{reward}</li>
              ))}
            </ul>
            <div className="inline-actions">
              <button type="button" className="pill-button primary" onClick={() => setSidebarView('inventory')}>
                Review Pack
              </button>
              <button type="button" className="pill-button secondary" onClick={() => controllerRef.current?.saveGame()}>
                Save Now
              </button>
              <button type="button" className="pill-button secondary" onClick={() => setHiddenCelebrationTitle(snapshot.celebration!.title)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App

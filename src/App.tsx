import { startTransition, useEffect, useRef, useState } from 'react'
import './App.css'
import { loadContentPack } from './game/content'
import { GameController } from './game/controller'
import { createLoadingSnapshot } from './game/state'
import type { ContentPack, DialogueOption, GameSnapshot, InventoryView, QuestView } from './game/types'

function formatSaveTime(isoTime: string | null): string {
  if (!isoTime) {
    return 'No save yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoTime))
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

type SidebarView = 'guide' | 'quests' | 'inventory' | 'log'
const EMPTY_DIALOGUE_OPTIONS: DialogueOption[] = []
const KEYBOARD_GUIDE = [
  { key: 'Move', description: 'WASD or arrow keys' },
  { key: 'Talk', description: 'E near a villager' },
  { key: 'Attack', description: 'Space near an enemy' },
  { key: 'Heal', description: 'H uses a tonic' },
  { key: 'Save', description: 'P saves instantly' },
  { key: 'Panels', description: '1-4 or Q / I / L' },
]

function App() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<GameController | null>(null)
  const [content, setContent] = useState<ContentPack | null>(null)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => createLoadingSnapshot())
  const [error, setError] = useState<string | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('guide')
  const [showShortcuts, setShowShortcuts] = useState(false)
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

  useEffect(() => {
    let cancelled = false

    loadContentPack()
      .then((loadedContent) => {
        if (cancelled) {
          return
        }
        setContent(loadedContent)
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load the RPG content pack.')
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
            index:
              current.nodeId === dialogue.node.id
                ? (current.index + 1) % dialogueOptions.length
                : 0,
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
    dialogue,
    dialogueOptions,
    activeDialogueIndex,
    selectedInventoryItem,
    sidebarView,
    showShortcuts,
    snapshot.canContinue,
    snapshot.inventory,
    snapshot.screen,
  ])

  const renderSidebarContent = () => {
    switch (sidebarView) {
      case 'guide':
        return (
          <div className="sidebar-stack">
            <div className="hero-note">
              <strong>Nearby</strong>
              <p>{snapshot.interactionHint ?? 'Move toward labeled exits, checkpoints, villagers, or red hostile markers.'}</p>
            </div>
            <div className="legend-grid">
              <div className="legend-item">
                <span className="legend-swatch ally" />
                <div>
                  <strong>Allies</strong>
                  <p>Teal markers and calm labels</p>
                </div>
              </div>
              <div className="legend-item">
                <span className="legend-swatch foe" />
                <div>
                  <strong>Enemies</strong>
                  <p>Red rings and danger labels</p>
                </div>
              </div>
              <div className="legend-item">
                <span className="legend-swatch exit" />
                <div>
                  <strong>Exits</strong>
                  <p>Amber gate zones advance the route</p>
                </div>
              </div>
              <div className="legend-item">
                <span className="legend-swatch checkpoint" />
                <div>
                  <strong>Checkpoints</strong>
                  <p>Mint zones become respawn anchors</p>
                </div>
              </div>
            </div>
          </div>
        )
      case 'quests':
        return (
          <ul className="quest-list compact">
            {snapshot.quests.length > 0 ? (
              snapshot.quests.map((quest) => (
                <li key={quest.quest.id} className="quest-item">
                  <strong>{quest.quest.name}</strong>
                  <p className="panel-copy">{quest.currentStage?.title ?? quest.quest.summary}</p>
                  <p className="panel-muted">{quest.currentStage?.description ?? quest.quest.summary}</p>
                  <span className={`quest-status${quest.progress.status === 'complete' ? ' complete' : ''}`}>
                    {renderQuestStatus(quest)}
                  </span>
                </li>
              ))
            ) : (
              <li className="quest-item">Speak with Elder Mira to take the frontier quest.</li>
            )}
          </ul>
        )
      case 'inventory':
        return (
          <div className="sidebar-stack">
            <div className="hero-note subtle">
              <strong>Inventory Shortcuts</strong>
              <p>Press J/K to move the selection and Enter to use or equip the highlighted item.</p>
            </div>
            <ul className="inventory-list compact">
              {snapshot.inventory.map((entry, index) => (
                <li
                  key={entry.item.id}
                  className={`inventory-item${index === clampedInventoryIndex ? ' selected' : ''}`}
                >
                  <div className="inventory-head">
                    <strong>{entry.item.name}</strong>
                    <span className="tag">x{entry.quantity}</span>
                  </div>
                  <p className="panel-muted">{entry.item.description}</p>
                  <div className="inventory-actions">
                    <span className={`tag${entry.equipped ? ' equipped-tag' : ''}`}>
                      {entry.equipped ? 'Equipped' : entry.item.type}
                    </span>
                    {renderItemAction(entry) ? <span className="tag action-tag">{renderItemAction(entry)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      case 'log':
        return (
          <ul className="notification-list compact">
            {snapshot.notifications.map((note, index) => (
              <li key={`${note}-${index}`} className="notification-item">
                <strong>Log {snapshot.notifications.length - index}</strong>
                <div>{note}</div>
              </li>
            ))}
          </ul>
        )
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="masthead">
          <div className="title-block">
            <p>Keyboard-first browser RPG vertical slice</p>
            <h1>Emberfall Frontier</h1>
          </div>
          <div className="status-strip">
            <div className="header-actions">
              <div className="status-chip">Single-player React + Phaser</div>
              <button type="button" className="shortcut-chip" onClick={() => setShowShortcuts((current) => !current)}>
                Ctrl+, Keys
              </button>
            </div>
            <p>Three connected maps, no mouse required, larger playfield, cleaner HUD.</p>
          </div>
        </header>

        <div className="experience-grid">
          <section className="game-column">
            <section className="mission-bar">
              <div className="mission-pill">
                <strong>Location</strong>
                <span>{snapshot.locationName}</span>
              </div>
              <div className="mission-pill emphasized">
                <strong>Next</strong>
                <span>{snapshot.nextStep}</span>
              </div>
              <div className="mission-pill">
                <strong>Save</strong>
                <span>{formatSaveTime(snapshot.lastSavedAt)}</span>
              </div>
            </section>

            <section className="panel game-panel">
              <div className="game-stage">
                <div ref={hostRef} className="game-canvas" />

                {error ? (
                  <div className="overlay">
                    <div className="overlay-card error-card">
                      <h2>Content Error</h2>
                      <p>{error}</p>
                    </div>
                  </div>
                ) : null}

                {!content && !error ? (
                  <div className="overlay">
                    <div className="loading-state">
                      <div className="spinner" />
                      <h2>Loading Emberfall</h2>
                      <p>Fetching maps, dialogue, items, and encounter data.</p>
                    </div>
                  </div>
                ) : null}

                {snapshot.screen === 'title' ? (
                  <div className="overlay">
                    <div className="overlay-card">
                      <h2>Stand Watch Over Emberfall</h2>
                      <p>
                        Travel from the town square into the Greenwild, descend into the Ashen Ruin, recover the
                        Sunstone, and return before the frontier breaks.
                      </p>
                      <p className="panel-muted">Keyboard: `Enter` or `N` starts a new run. `C` continues. `Ctrl+,` opens controls.</p>
                      <div className="overlay-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => controllerRef.current?.startNewGame()}
                        >
                          New Game
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
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
                      <div className="dialogue-speaker">
                        <span className="speaker-pill">{dialogue.node.speaker}</span>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => controllerRef.current?.closeDialogue()}
                        >
                          Close
                        </button>
                      </div>
                      <h3>{snapshot.locationName}</h3>
                      <p className="dialogue-text">{dialogue.node.text}</p>
                      <div className="dialogue-actions">
                        {dialogue.node.options.map((option, index) => (
                          <button
                            key={option.id}
                            type="button"
                            className={index === activeDialogueIndex ? 'primary-button selected-option' : 'secondary-button'}
                            onClick={() => controllerRef.current?.chooseDialogueOption(option.id)}
                          >
                            {index + 1}. {option.label}
                          </button>
                        ))}
                      </div>
                      <p className="panel-muted">Keyboard: `J/K` or arrow keys move, `Enter` selects, `Esc` closes.</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

          </section>

          <aside className="sidebar">
            <section className="panel sidebar-panel">
              <div className="toolbar">
                <div>
                  <h2>Field Deck</h2>
                  <p className="panel-copy">{snapshot.nextStep}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => controllerRef.current?.saveGame()}
                  disabled={snapshot.screen !== 'playing'}
                >
                  Save
                </button>
              </div>

              {showShortcuts ? (
                <section className="shortcut-sheet">
                  <div className="shortcut-sheet-head">
                    <strong>Command Sheet</strong>
                    <span className="tag">Toggle with Ctrl+,</span>
                  </div>
                  <div className="shortcut-grid">
                    {KEYBOARD_GUIDE.map((entry) => (
                      <div key={entry.key} className="shortcut-row">
                        <span className="shortcut-key">{entry.key}</span>
                        <span className="shortcut-text">{entry.description}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {snapshot.player ? (
                <>
                  <div className="stats-grid">
                    <div className="stat-tile">
                      <strong>HP</strong>
                      <span>
                        {snapshot.player.hp} / {snapshot.player.maxHp}
                      </span>
                    </div>
                    <div className="stat-tile">
                      <strong>Level</strong>
                      <span>
                        {snapshot.player.level} · XP {snapshot.player.xp}
                      </span>
                    </div>
                    <div className="stat-tile">
                      <strong>Attack</strong>
                      <span>{snapshot.player.attack}</span>
                    </div>
                    <div className="stat-tile">
                      <strong>Defense</strong>
                      <span>{snapshot.player.defense}</span>
                    </div>
                    <div className="stat-tile">
                      <strong>Weapon</strong>
                      <span>{snapshot.player.weaponName ?? 'Unarmed'}</span>
                    </div>
                    <div className="stat-tile">
                      <strong>Gold</strong>
                      <span>{snapshot.player.gold}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="panel-muted">Start a run to initialize the party state.</p>
              )}
              <div className="tab-row" role="tablist" aria-label="Field deck panels">
                <button
                  type="button"
                  className={`tab-button${sidebarView === 'guide' ? ' active' : ''}`}
                  onClick={() => setSidebarView('guide')}
                >
                  1 Guide
                </button>
                <button
                  type="button"
                  className={`tab-button${sidebarView === 'quests' ? ' active' : ''}`}
                  onClick={() => setSidebarView('quests')}
                >
                  2 Quest
                </button>
                <button
                  type="button"
                  className={`tab-button${sidebarView === 'inventory' ? ' active' : ''}`}
                  onClick={() => setSidebarView('inventory')}
                >
                  3 Pack
                </button>
                <button
                  type="button"
                  className={`tab-button${sidebarView === 'log' ? ' active' : ''}`}
                  onClick={() => setSidebarView('log')}
                >
                  4 Log
                </button>
              </div>
              <div className="sidebar-content">{renderSidebarContent()}</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default App

# Emberfall Frontier

Keyboard-first browser RPG built with `React`, `TypeScript`, and `Phaser`.

This project is a small web RPG vertical slice with:

- A town, wilderness route, and dungeon
- NPC dialogue and a main questline
- Real-time movement and melee combat
- Inventory, equipment, healing items, and quest rewards
- Local save/load in browser storage
- Keyboard-only UI flow for gameplay, dialogue, and menus

## Stack

- `React 19`
- `TypeScript`
- `Vite`
- `Phaser 3`

## Requirements

- `Node.js 22+`
- `npm 11+`

## Setup

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Lint the codebase:

```bash
npm run lint
```

Quick verification:

```bash
npm run dev
```

Then open the local Vite URL and confirm you can start a run, move, talk, attack, and transition between maps.

## Controls

- `WASD` or arrow keys: move
- `E`: interact with nearby NPCs
- `Space`: attack nearby enemies
- `H`: use a tonic
- `P`: save game
- `1-4`: switch side panels
- `Q`: quest panel
- `I`: inventory panel
- `L`: log panel
- `Ctrl+,`: toggle the command sheet
- `Esc`: close dialogue or close the command sheet
- `J/K` or arrow keys in dialogue: move selection
- `Enter` in dialogue/inventory: confirm action

## Current Game Flow

1. Start in Emberfall.
2. Speak with Elder Mira to take the quest.
3. Leave town through the east gate.
4. Cross the Greenwild and fight or avoid roaming enemies.
5. Enter the Ashen Ruin.
6. Defeat the Ashen Guardian and recover the Sunstone.
7. Return to Emberfall and turn the relic in.

## Project Structure

```text
public/content/         JSON content pack for maps, NPCs, enemies, items, quests, and dialogue
src/App.tsx             React shell, keyboard UI, side panels, and overlays
src/game/controller.ts  Bridge between React and Phaser
src/game/phaser/        Phaser scene and runtime logic
src/game/state.ts       Derived state, inventory, quests, and objective helpers
src/game/storage.ts     Browser save/load
src/game/types.ts       Shared game and content types
```

## Notes

- Saves are stored in browser local storage.
- The current branch is pushed to GitHub over SSH.
- The production bundle is functional, but Phaser still produces a large chunk warning during build.

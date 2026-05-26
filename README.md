# VaultMap for Obsidian

A force-directed graph explorer for Obsidian vaults with AI-powered Q&A.
No build step -- open `index.html` directly or serve from any static host.

## What it does

- Renders your Obsidian vault as an interactive force-directed graph (nodes = notes, edges = wikilinks)
- Five visual themes: Phosphor, Atlas, Constellation, Brutalist, Linear
- Full-text search across note titles, tags, and body
- Side panel with rendered note markdown and neighbor links
- Q&A panel: ask questions over selected notes or a lasso-selected region using any LLM

## Usage

### Open directly

Double-click `index.html`. Works in any modern browser with no server required for the graph UI.

### Serve statically

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

## Loading your vault

1. Click **Open Vault** in the top bar
2. Select your Obsidian vault folder
3. The browser reads `.md` files locally -- nothing is uploaded anywhere

The included `vault-data.js` powers the default demo graph (500 mock notes across 12 topic clusters).

## AI provider setup

Click the gear icon to configure a provider. Keys are stored only in your browser's `localStorage` and are never sent anywhere except the provider's API.

| Provider | Notes |
|---|---|
| DeepSeek | Cheap; good for summaries |
| Kimi (Moonshot) | Large context window |
| Anthropic | Direct API billing |
| OpenAI | Direct API billing |
| OpenRouter | One key, many models |
| Custom | Any OpenAI-compatible endpoint (Ollama, self-hosted, etc.) |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `Escape` | Dismiss modal / blur input / clear selection |
| `L` | Toggle lasso mode |
| `V` | Open / close vault picker |
| `0` | Reset graph view |
| `T` | Cycle theme |

## License

MIT

# VaultMap

A force-directed graph explorer for markdown vaults with AI-powered Q&A. 

Works with Obsidian or any similar markdown-based vault.

No build steps: open `index.html` directly or serve from any static host. Just works.

Live demo: https://shawndata.com/vaultmap/
- Use Chrome for best experience
- Allows pointing at your own markdown vault
- Your data stays in local memory, never gets sent anywhere

<img width="2048" height="1199" alt="Screenshot 2026-05-26 at 7 48 31 PM" src="https://github.com/user-attachments/assets/891392e2-53d1-49ba-a316-324ba1be0e3f" />


## What it does

- Renders your markdown vault as an interactive force-directed graph (nodes = notes, edges = wikilinks)
- Three visual themes: Atlas, Constellation, Brutalist
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
2. Select your vault folder
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

## Security

API keys you enter in Settings are stored in your browser's localStorage. They never leave your device -- no server receives them, and no network calls are made except to the AI provider you select. To remove your keys, clear your browser's localStorage or use the Settings panel.

Do not load vault files from untrusted sources.

## License

MIT

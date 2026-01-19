# Vectorbits-tools-CallGraph

Vectorbits-tools-CallGraph is a browser-based Solidity call graph explorer. It parses Solidity source code in the client, renders function-level call relationships, and provides an inspector for quick navigation, filtering, and notes.

## Features
- Local parsing and visualization of Solidity function call graphs
- Ctrl/Cmd + click on a node to jump to source
- Auto-sync from editor to graph with change highlights
- Search and focus nodes from the canvas
- Right-side inspector for incoming/outgoing calls and notes
- Shareable read/edit links

## Quick Start

### Install
```bash
npm install --cache ./node_modules/.cache/npm
```

### Develop
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Lint
```bash
npm run lint
```

## Usage
1. Paste or edit Solidity code in the left workspace.
2. Click Sync to Graph or enable Auto Sync.
3. Use the search bar to jump between functions.
4. Select a node to view incoming/outgoing edges in the inspector.
5. Add notes for audit context and share via read/edit links.

## Notes
- Parsing and storage are local to the browser.
- Very large contracts may increase CPU and memory usage on the client.

# NowK

Desktop IDE (Electron) for **macOS**, **Windows**, and **Linux**. Open a project, edit code, run a terminal, manage Chrome profiles, and use **Agent** so AI can read and change the real repo on disk — models (Gemini, ChatGPT, DeepSeek) run in a Chrome tab; NowK executes the tools.

**Version:** 1.2.6 · **License:** [ISC](#license)

---

## System requirements

| Component | Requirement |
| --- | --- |
| **Node.js** | **18 or later** (required) |
| **npm** | Bundled with Node.js |
| **OS** | macOS (darwin), Windows, Linux |
| **CPU** | x64 or arm64 |
| **Google Chrome** | Required for Agent and browser profiles |
| **RAM** | 4 GB or more recommended when running the IDE plus Chrome |

On first launch, NowK downloads **Electron**. On Linux, if the GPU causes errors:

```bash
NOWK_DISABLE_GPU=1 nowk start
```

---

## Installation

Install [Node.js](https://nodejs.org/) 18+ first. Check:

```bash
node -v
npm -v
```

### Quick install (npm global)

```bash
npm i -g nowk-ide
nowk start
```

### Run from source

```bash
git clone <repo-url>
cd NowK
npm install
npm run build:ui
npx nowk start
```

Development mode (Vite + Electron):

```bash
npm run dev
```

Package installers (NSIS / DMG / AppImage):

```bash
npm run build
```

---

## Features

### Workspace

- Open a project folder; recent projects list
- New project from templates: Vue 3, Node.js, Electron, Chrome Extension (MV3), HTML/CSS/JS
- Clone a Git repository into a chosen folder
- Explorer: create / rename / delete files and folders; multiple editor tabs
- CodeMirror editor (JS, Vue, HTML, CSS, JSON, Markdown, Python, XML, and more), find/replace, format
- Markdown preview
- Web pane: open a URL in the IDE (back, reload, open in an external browser)

### Terminal

- Integrated terminal (PTY when `node-pty` is available)
- Multiple tabs; cwd follows the project
- Agent can run commands and read logs to confirm results (HMR, server errors, and so on)

### Agent (AI coding)

UI slogan: *You think it. Agent writes the code.*

1. Open Chrome and a model tab (Gemini / ChatGPT / DeepSeek).
2. Select a project in NowK.
3. Describe the work (UI changes, bug fixes, paste a console stack…).
4. Agent routes through **AG Kit** (`.agents/`): match rules / skills / workflows / specialist agents, load only those files, then edit the real repo and **verify with terminal output**.

- Tools: read, edit (`edit_file`), create files, search, retrieve via index, git status, browser / screenshot when needed
- Diff after a successful write; checks that disk content matches
- Does not mark work done merely by editing files — a run/test/start with real output is required
- Destructive shell commands are blocked by the AG Kit hook before they run
- Slash workflows such as `/debug` or `/create` select the matching procedure from `.agents/workflows/`

### Chrome profiles

- Isolated profiles, independent of the IDE folder
- Proxy and fingerprint (native / stealth / custom / consistent)
- Open the web or an LLM tab for Agent

### UI

- Vietnamese and English
- In-app settings

---

## License

Distributed under the **ISC** license.

You may use, copy, modify, and distribute the software provided you keep the copyright and license notice. The software is provided **as is**, without warranty of any kind, including but not limited to merchantability or fitness for a particular purpose. The authors are not liable for damages arising from use of the software.

---

## Donate

If NowK is useful, you can support it via **PayPal**:

**vietduy989kc@gmail.com**

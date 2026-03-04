# Tejus Computer Agent

A Chrome extension that acts as an AI agent powered by **Groq**. It takes screenshots of your active tab, sends them to a Groq vision model, and automatically performs browser actions (click, type, scroll, navigate, press keys) to complete any task you describe.

---

## Features

- **AI-powered vision** – Uses Groq's LLM vision API to understand the current state of the browser.
- **Full browser control** – Can click, type, scroll, press keys, and navigate to URLs.
- **Live activity log** – See exactly what the agent is thinking and doing in real-time.
- **Screenshot preview** – Watch the agent's current view update step-by-step.
- **Persistent settings** – API key and model choice are saved in extension storage.

---

## Requirements

- **Google Chrome** (including Chrome Beta) version 116 or newer (Manifest V3 + Side Panel API).
- A [**Groq API key**](https://console.groq.com) (free tier available).

---

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the root folder of this repository (the folder containing `manifest.json`).
5. The **Tejus Computer** extension will appear in your toolbar.

---

## Usage

1. Click the **Tejus Computer** icon in the Chrome toolbar – the side panel opens.
2. Enter your **Groq API key** (starts with `gsk_`).
3. Select a **vision model** (meta-llama/llama-4-scout-17b-16e-instruct recommended).
4. Type a **task** in natural language, e.g.:
   - *"Search for the latest news about AI on Google and summarize the first result."*
   - *"Go to github.com and star the repository Tejus_Computer."*
   - *"Fill in the contact form on this page with my details."*
5. Click **▶ Start Agent**.
6. Watch the activity log and screenshot preview as the agent works.
7. Click **⏹ Stop** at any time to halt the agent.

---

## File Structure

```
manifest.json      – Extension manifest (Manifest V3)
background.js      – Service worker; opens the side panel on icon click
content.js         – Injected into pages; executes click/type/scroll/key actions
sidepanel.html     – Side panel UI
sidepanel.js       – Agent loop: screenshot → Groq API → action → repeat
sidepanel.css      – Dark-theme styles
icons/             – Extension icons (16×16, 48×48, 128×128)
```

---

## How It Works

```
User describes task
       │
       ▼
 Screenshot of active tab  ──►  Groq Vision API  ──►  JSON action
       ▲                                                    │
       │                                                    ▼
 Activity log updated  ◄──  Action executed in page  ◄──  content.js
```

The agent loops until it decides the task is `done` or it reaches the 50-step safety limit.

---

## Supported Actions

| Action      | Description                                      |
|-------------|--------------------------------------------------|
| `click`     | Click at CSS pixel coordinates (x, y)            |
| `type`      | Type text into the currently focused element     |
| `scroll`    | Scroll the page by a given delta                 |
| `press_key` | Press a keyboard key (Enter, Tab, Escape, …)     |
| `navigate`  | Navigate the current tab to a URL                |
| `done`      | Signal that the task is complete                 |

---

## Privacy & Security

- Your Groq API key is stored only in Chrome's local extension storage and is never sent anywhere except the official Groq API endpoint (`api.groq.com`).
- Screenshots are sent to Groq solely to determine the next action and are not stored by this extension.

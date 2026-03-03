// sidepanel.js – Main agent logic for the Tejus Computer Chrome extension.
// Manages the agent loop: screenshot → Groq vision API → parse action → execute → repeat.

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STEPS = 50;

const SYSTEM_PROMPT = `You are a browser automation agent called "Tejus Computer".
Your job is to complete user tasks by observing browser screenshots and deciding what to do next.

You MUST reply with ONLY a valid JSON object – no markdown, no extra text – in this exact shape:
{
  "thinking": "Your step-by-step reasoning about what you see and what needs to be done",
  "action": "action_name",
  "params": {},
  "done": false,
  "status": "Short, human-readable description of what you are doing right now"
}

Available actions and their params:
• "click"      – {"x": <number>, "y": <number>}
• "type"       – {"text": "<string>"}         (types into the currently focused element)
• "scroll"     – {"x": <number>, "y": <number>, "deltaX": <number>, "deltaY": <number>}
• "press_key"  – {"key": "<string>"}          (Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right)
• "navigate"   – {"url": "<full URL>"}        (navigate the current tab to a new URL)
• "done"       – {}                           (signal that the task is complete)

Rules:
- Coordinates (x, y) must be CSS pixel values within the viewport dimensions given to you.
- To fill in a form field: first "click" it, then use "type".
- Set "done": true ONLY when the task is fully and verifiably complete.
- If an action seems to have no effect, try a different approach.
- Respond with ONLY the JSON object.`;

// ─── DOM references ────────────────────────────────────────────────────────────

const apiKeyInput    = document.getElementById('api-key');
const modelSelect    = document.getElementById('model');
const customModelInput = document.getElementById('custom-model');
const taskInput      = document.getElementById('task');
const startBtn       = document.getElementById('start-btn');
const stopBtn        = document.getElementById('stop-btn');
const statusBadge    = document.getElementById('status-badge');
const logContainer   = document.getElementById('log-container');
const screenshotPanel = document.getElementById('screenshot-panel');
const screenshotImg  = document.getElementById('screenshot-img');
const stepCounter    = document.getElementById('step-counter');
const toggleKeyBtn   = document.getElementById('toggle-key');
const clearLogBtn    = document.getElementById('clear-log');

// ─── State ────────────────────────────────────────────────────────────────────

let stopRequested = false;

// ─── Initialisation ────────────────────────────────────────────────────────────

chrome.storage.local.get(['groqApiKey', 'groqModel'], (data) => {
  if (data.groqApiKey) apiKeyInput.value = data.groqApiKey;
  if (data.groqModel) {
    const knownValues = Array.from(modelSelect.options).map((o) => o.value);
    if (knownValues.includes(data.groqModel)) {
      modelSelect.value = data.groqModel;
    } else {
      modelSelect.value = 'custom';
      customModelInput.style.display = 'block';
      customModelInput.value = data.groqModel;
    }
  }
});

// ─── UI event listeners ────────────────────────────────────────────────────────

toggleKeyBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  toggleKeyBtn.textContent = apiKeyInput.type === 'password' ? '👁' : '🙈';
});

modelSelect.addEventListener('change', () => {
  customModelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
});

clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
});

startBtn.addEventListener('click', onStartClicked);
stopBtn.addEventListener('click', () => {
  stopRequested = true;
  stopBtn.disabled = true;
});

// ─── Start handler ─────────────────────────────────────────────────────────────

async function onStartClicked() {
  const apiKey = apiKeyInput.value.trim();
  const model  = modelSelect.value === 'custom'
    ? customModelInput.value.trim()
    : modelSelect.value;
  const task   = taskInput.value.trim();

  if (!apiKey) { addLog('error', '❌ Please enter your Groq API key.'); return; }
  if (!model)  { addLog('error', '❌ Please enter a model name.');       return; }
  if (!task)   { addLog('error', '❌ Please describe a task.');           return; }

  chrome.storage.local.set({ groqApiKey: apiKey, groqModel: model });

  stopRequested = false;
  setRunning(true);
  screenshotPanel.style.display = 'none';
  addLog('system', `🚀 Starting: "${task}"`);

  try {
    await runAgent(apiKey, model, task);
  } catch (err) {
    addLog('error', `❌ Fatal error: ${err.message}`);
  }

  setRunning(false);
}

// ─── Core agent loop ───────────────────────────────────────────────────────────

async function runAgent(apiKey, model, task) {
  const actionHistory = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (stopRequested) {
      addLog('system', '⏹️ Agent stopped by user.');
      return;
    }

    stepCounter.textContent = `Step ${step}/${MAX_STEPS}`;

    try {
      // 1. Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        addLog('error', '❌ No active tab found.');
        return;
      }

      if (isRestrictedUrl(tab.url)) {
        addLog('error', '⚠️ Cannot operate on this page (chrome://, extension pages, etc.). Navigate to a regular web page.');
        return;
      }

      // 2. Take screenshot
      addLog('system', `📸 Capturing screenshot…`);
      let screenshot;
      try {
        screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality: 75,
        });
      } catch (e) {
        addLog('error', `❌ Screenshot failed: ${e.message}`);
        return;
      }

      // 3. Get viewport dimensions from the page
      let viewport = { width: 1280, height: 800 };
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            width:  window.innerWidth,
            height: window.innerHeight,
          }),
        });
        if (res?.result) viewport = res.result;
      } catch (_) { /* use defaults */ }

      // 4. Update screenshot preview
      screenshotPanel.style.display = 'block';
      screenshotImg.src = screenshot;

      // 5. Build prompt
      const historyText = actionHistory.length
        ? '\n\nPrevious actions (most recent last):\n' +
          actionHistory.slice(-6).map((a, i) => `${i + 1}. ${a}`).join('\n')
        : '';

      const userMessage =
        `Task: ${task}${historyText}\n\n` +
        `Viewport: ${viewport.width}×${viewport.height} CSS pixels.\n\n` +
        `Analyze the screenshot and decide the next action.`;

      // 6. Call Groq
      addLog('thinking', '🤔 Thinking…');
      let response;
      try {
        response = await callGroqAPI(apiKey, model, userMessage, screenshot);
      } catch (e) {
        addLog('error', `❌ Groq API error: ${e.message}`);
        if (e.message.includes('401') || e.message.toLowerCase().includes('api key')) return;
        await sleep(3000);
        continue;
      }

      // 7. Show thinking
      if (response.thinking) {
        addLog('thinking', `💭 ${response.thinking}`);
      }

      // 8. Check for completion
      if (response.done === true || response.action === 'done') {
        addLog('system', '✅ Task completed!');
        stepCounter.textContent = `Done in ${step} step${step === 1 ? '' : 's'}`;
        return;
      }

      // 9. Show status / execute action
      const actionLabel = formatAction(response.action, response.params);
      addLog('action', `⚡ ${response.status || actionLabel}`);

      try {
        const result = await executeAction(tab, response.action, response.params);
        addLog('result', `✓ ${result}`);
        actionHistory.push(`${actionLabel} → ${result}`);
      } catch (e) {
        addLog('error', `❌ Action failed: ${e.message}`);
        actionHistory.push(`${actionLabel} → FAILED: ${e.message}`);
      }

      // 10. Pause before next step
      await sleep(1200);

    } catch (e) {
      addLog('error', `❌ Step ${step} error: ${e.message}`);
      await sleep(2000);
    }
  }

  addLog('system', `⚠️ Reached the maximum of ${MAX_STEPS} steps.`);
}

// ─── Groq API ──────────────────────────────────────────────────────────────────

async function callGroqAPI(apiKey, model, userMessage, screenshotDataUrl) {
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text',      text: userMessage },
          { type: 'image_url', image_url: { url: screenshotDataUrl } },
        ],
      },
    ],
    max_tokens: 1024,
    temperature: 0.1,
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data    = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  // Parse JSON – try direct parse first, then extract from prose
  try {
    return JSON.parse(content);
  } catch (_) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Model returned non-JSON response: ${content.slice(0, 200)}`);
  }
}

// ─── Action execution ──────────────────────────────────────────────────────────

async function executeAction(tab, action, params) {
  // navigate is handled here (requires tabs API, not content script)
  if (action === 'navigate') {
    const url = params?.url;
    if (!url) throw new Error('navigate action requires a "url" param');
    await chrome.tabs.update(tab.id, { url });
    await waitForTabLoad(tab.id);
    return `Navigated to ${url}`;
  }

  // All other actions are executed by the content script
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      type:   'EXECUTE_ACTION',
      action,
      params,
    });
  } catch (e) {
    // Content script might not be ready on freshly loaded pages – inject and retry
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await sleep(300);
    result = await chrome.tabs.sendMessage(tab.id, { type: 'EXECUTE_ACTION', action, params });
  }

  if (!result?.success) throw new Error(result?.error ?? 'Unknown content-script error');
  return result.result;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 600); // extra settle time
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://')
  );
}

function formatAction(action, params = {}) {
  switch (action) {
    case 'click':     return `Click (${params.x}, ${params.y})`;
    case 'type':      return `Type "${params.text}"`;
    case 'scroll':    return `Scroll by (${params.deltaX ?? 0}, ${params.deltaY ?? 0})`;
    case 'navigate':  return `Navigate → ${params.url}`;
    case 'press_key': return `Press ${params.key}`;
    case 'done':      return 'Done';
    default:          return `${action}(${JSON.stringify(params)})`;
  }
}

function addLog(type, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const msg = document.createElement('span');
  msg.className = 'log-message';
  msg.textContent = message;   // textContent avoids XSS

  entry.appendChild(time);
  entry.appendChild(msg);
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled  = !running;
  statusBadge.textContent  = running ? 'Running' : 'Idle';
  statusBadge.className    = running ? 'status-badge running' : 'status-badge';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

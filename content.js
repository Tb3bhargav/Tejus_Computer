// content.js – Injected into every web page.
// Listens for EXECUTE_ACTION messages from the side panel and performs DOM actions.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTION') {
    executeAction(message.action, message.params)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function executeAction(action, params) {
  switch (action) {
    case 'click': {
      const { x, y } = params;
      const el = document.elementFromPoint(x, y);
      if (!el) throw new Error(`No element found at (${x}, ${y})`);

      el.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
      el.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
      el.click();
      return `Clicked at (${x}, ${y}) on <${el.tagName.toLowerCase()}>`;
    }

    case 'type': {
      const { text } = params;
      const el = document.activeElement;

      if (!el || el === document.body || el === document.documentElement) {
        throw new Error('No element is focused. Please click on an input field first.');
      }

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        // Use the native setter so React/Vue synthetic events fire correctly
        const proto =
          el.tagName === 'INPUT'
            ? window.HTMLInputElement.prototype
            : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, text);
        } else {
          el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        // Use Selection API to replace content, fall back to execCommand for older browsers
        const selection = window.getSelection();
        selection.selectAllChildren(el);
        selection.collapseToEnd();
        const range = selection.getRangeAt(0);
        range.selectNodeContents(el);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        throw new Error(`Focused element <${el.tagName.toLowerCase()}> is not editable.`);
      }

      return `Typed "${text}" into <${el.tagName.toLowerCase()}>`;
    }

    case 'scroll': {
      const { x = window.innerWidth / 2, y = window.innerHeight / 2, deltaX = 0, deltaY = 300 } =
        params;
      const el = document.elementFromPoint(x, y);
      if (el && el !== document.documentElement && el !== document.body) {
        el.scrollBy(deltaX, deltaY);
      }
      window.scrollBy(deltaX, deltaY);
      return `Scrolled by (${deltaX}, ${deltaY})`;
    }

    case 'press_key': {
      const { key } = params;
      const el = document.activeElement || document.body;

      const keyMap = {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 8,
        Delete: 46,
        ArrowUp: 38,
        ArrowDown: 40,
        ArrowLeft: 37,
        ArrowRight: 39,
        Space: 32,
      };

      const init = {
        key,
        keyCode: keyMap[key] || key.charCodeAt(0),
        which: keyMap[key] || key.charCodeAt(0),
        bubbles: true,
        cancelable: true,
      };

      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));

      // Submit form on Enter
      if (key === 'Enter') {
        const form = el.closest?.('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return `Pressed key: ${key}`;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

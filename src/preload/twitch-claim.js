// Loaded only into the hidden Twitch chat page Prism opens to claim a
// channel-points bonus. It waits for Twitch's "Claim Bonus" button, clicks
// it once, and tells Prism. Nothing else.
const { ipcRenderer } = require('electron');

const SELECTORS = [
  'button[aria-label="Claim Bonus"]',
  'button[aria-label*="Claim Bonus" i]',
  '.claimable-bonus__icon',
  '[data-test-selector="community-points-summary"] button[aria-label*="Claim" i]'
];

let clicked = false;
function tryClaim() {
  if (clicked) return;
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    const btn = el && (el.closest('button') || el);
    if (btn) {
      clicked = true;
      btn.click();
      ipcRenderer.send('twitch:claim-clicked');
      return;
    }
  }
}
window.addEventListener('DOMContentLoaded', () => {
  tryClaim();
  const timer = setInterval(() => { tryClaim(); if (clicked) clearInterval(timer); }, 700);
});

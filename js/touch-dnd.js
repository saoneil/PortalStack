const STYLE_ID = 'touch-dnd-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    body.touch-dnd-active {
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .touch-dnd-follower {
      pointer-events: none;
      opacity: 0.92;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .touch-dnd-source {
      opacity: 0.4;
    }
    .touch-dnd-pending {
      transform: scale(0.98);
      opacity: 0.85;
    }
  `;
  document.head.appendChild(style);
}

function resolveRoot(root) {
  if (!root) return document;
  return typeof root === 'string' ? document.querySelector(root) : root;
}

function defaultDragImage(el) {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true);
  clone.classList.add('touch-dnd-follower');
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.boxSizing = 'border-box';
  return clone;
}

/**
 * Long-press touch drag for mobile. Desktop HTML5 drag-and-drop is unchanged.
 */
export function bindTouchDnD(root, options = {}) {
  const host = resolveRoot(root);
  if (!host) return () => {};

  ensureStyles();

  const {
    selector = '[draggable="true"]',
    pressDelay = 450,
    moveThreshold = 12,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    dragImage = defaultDragImage
  } = options;

  let pressTimer = null;
  let dragging = false;
  let payload = null;
  let sourceEl = null;
  let follower = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  function clearPress() {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = null;
    sourceEl?.classList.remove('touch-dnd-pending');
    sourceEl = null;
  }

  function positionFollower(x, y) {
    if (!follower) return;
    follower.style.position = 'fixed';
    follower.style.left = '0';
    follower.style.top = '0';
    follower.style.zIndex = '10050';
    follower.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  function elementUnder(x, y) {
    if (follower) follower.hidden = true;
    const el = document.elementFromPoint(x, y);
    if (follower) follower.hidden = false;
    return el;
  }

  function cleanup() {
    clearPress();
    dragging = false;
    payload = null;
    sourceEl?.classList.remove('touch-dnd-source', 'touch-dnd-pending');
    sourceEl = null;
    if (follower?.parentNode) follower.parentNode.removeChild(follower);
    follower = null;
    document.body.classList.remove('touch-dnd-active');
    document.removeEventListener('touchmove', onDocTouchMove);
    document.removeEventListener('touchend', onDocTouchEnd);
    document.removeEventListener('touchcancel', onDocTouchEnd);
  }

  function cancelDrag() {
    onDragCancel?.(payload, sourceEl);
    cleanup();
  }

  function onDocTouchMove(e) {
    if (!dragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    e.preventDefault();
    lastX = touch.clientX;
    lastY = touch.clientY;
    positionFollower(lastX, lastY);
    onDragMove?.(touch, payload, elementUnder(lastX, lastY), sourceEl);
  }

  function onDocTouchEnd(e) {
    if (!dragging) return;
    const touch = e.changedTouches[0];
    const x = touch?.clientX ?? lastX;
    const y = touch?.clientY ?? lastY;
    e.preventDefault();
    const under = elementUnder(x, y);
    onDragEnd?.(touch, payload, under, sourceEl);
    cleanup();
  }

  function beginDrag(el, touch) {
    const result = onDragStart?.(el, touch);
    if (result === false) {
      sourceEl = null;
      return;
    }
    payload = result === undefined ? true : result;
    dragging = true;
    sourceEl?.classList.remove('touch-dnd-pending');
    sourceEl?.classList.add('touch-dnd-source');
    document.body.classList.add('touch-dnd-active');
    lastX = touch.clientX;
    lastY = touch.clientY;
    follower = dragImage(el);
    if (follower) document.body.appendChild(follower);
    positionFollower(lastX, lastY);
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_) { /* ignore */ }
    }
    document.addEventListener('touchmove', onDocTouchMove, { passive: false });
    document.addEventListener('touchend', onDocTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onDocTouchEnd, { passive: false });
    onDragMove?.(touch, payload, elementUnder(lastX, lastY), el);
  }

  function onHostTouchStart(e) {
    if (dragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const el = touch.target.closest(selector);
    if (!el || !host.contains(el)) return;

    startX = touch.clientX;
    startY = touch.clientY;
    lastX = startX;
    lastY = startY;
    sourceEl = el;
    clearPress();
    sourceEl.classList.add('touch-dnd-pending');

    pressTimer = setTimeout(() => {
      pressTimer = null;
      beginDrag(el, touch);
    }, pressDelay);
  }

  function onHostTouchMove(e) {
    if (dragging) return;
    if (!pressTimer || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) clearPress();
  }

  function onHostTouchEnd() {
    clearPress();
  }

  host.addEventListener('touchstart', onHostTouchStart, { passive: true });
  host.addEventListener('touchmove', onHostTouchMove, { passive: true });
  host.addEventListener('touchend', onHostTouchEnd, { passive: true });
  host.addEventListener('touchcancel', onHostTouchEnd, { passive: true });

  return () => {
    cancelDrag();
    host.removeEventListener('touchstart', onHostTouchStart);
    host.removeEventListener('touchmove', onHostTouchMove);
    host.removeEventListener('touchend', onHostTouchEnd);
    host.removeEventListener('touchcancel', onHostTouchEnd);
  };
}

if (typeof window !== 'undefined') {
  window.TouchDnD = { bind: bindTouchDnD };
}

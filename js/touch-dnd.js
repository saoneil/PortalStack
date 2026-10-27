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

function pointFromEvent(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY, id: e.touches[0].identifier };
  }
  if (e.changedTouches && e.changedTouches[0]) {
    return {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
      id: e.changedTouches[0].identifier
    };
  }
  return { x: e.clientX, y: e.clientY, id: e.pointerId };
}

/**
 * Touch / pointer drag helper.
 * activation: 'longpress' (default) waits pressDelay; 'move' starts after moveThreshold.
 * Desktop HTML5 drag-and-drop is unchanged for longpress callers.
 */
export function bindTouchDnD(root, options = {}) {
  const host = resolveRoot(root);
  if (!host) return () => {};

  ensureStyles();

  const {
    selector = '[draggable="true"]',
    activation = 'longpress',
    pressDelay = 450,
    moveThreshold = activation === 'move' ? 8 : 12,
    canActivate = null,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    dragImage = defaultDragImage
  } = options;

  const usePointers = activation === 'move';

  let pressTimer = null;
  let dragging = false;
  let pending = false;
  let payload = null;
  let sourceEl = null;
  let follower = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  let didDrag = false;
  let clearDidDragTimer = null;

  function clearPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pending = false;
    sourceEl?.classList.remove('touch-dnd-pending');
    if (!dragging) {
      sourceEl = null;
      pointerId = null;
    }
  }

  function armClickSuppress() {
    didDrag = true;
    if (clearDidDragTimer) clearTimeout(clearDidDragTimer);
    // If the browser never synthesizes a click after pointer drag, clear the
    // flag so the user's next intentional click is not eaten.
    clearDidDragTimer = setTimeout(() => {
      clearDidDragTimer = null;
      didDrag = false;
    }, 50);
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

  function detachDocListeners() {
    document.removeEventListener('touchmove', onDocTouchMove);
    document.removeEventListener('touchend', onDocTouchEnd);
    document.removeEventListener('touchcancel', onDocTouchEnd);
    document.removeEventListener('pointermove', onDocPointerMove);
    document.removeEventListener('pointerup', onDocPointerUp);
    document.removeEventListener('pointercancel', onDocPointerUp);
  }

  function cleanup() {
    clearPress();
    dragging = false;
    payload = null;
    sourceEl?.classList.remove('touch-dnd-source', 'touch-dnd-pending');
    sourceEl = null;
    if (follower?.parentNode) follower.parentNode.removeChild(follower);
    follower = null;
    pointerId = null;
    document.body.classList.remove('touch-dnd-active');
    detachDocListeners();
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

  function onDocPointerMove(e) {
    if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
    e.preventDefault();
    lastX = e.clientX;
    lastY = e.clientY;
    positionFollower(lastX, lastY);
    onDragMove?.(e, payload, elementUnder(lastX, lastY), sourceEl);
  }

  function onDocPointerUp(e) {
    if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
    e.preventDefault();
    lastX = e.clientX;
    lastY = e.clientY;
    const under = elementUnder(lastX, lastY);
    onDragEnd?.(e, payload, under, sourceEl);
    cleanup();
  }

  function beginDrag(el, point, rawEvent) {
    const result = onDragStart?.(el, rawEvent || point);
    if (result === false) {
      sourceEl = null;
      pending = false;
      return;
    }
    payload = result === undefined ? true : result;
    dragging = true;
    armClickSuppress();
    pending = false;
    sourceEl?.classList.remove('touch-dnd-pending');
    sourceEl?.classList.add('touch-dnd-source');
    document.body.classList.add('touch-dnd-active');
    lastX = point.x;
    lastY = point.y;
    follower = dragImage(el);
    if (follower) document.body.appendChild(follower);
    positionFollower(lastX, lastY);
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_) { /* ignore */ }
    }
    if (usePointers) {
      try {
        if (rawEvent && rawEvent.pointerId != null) {
          el.setPointerCapture?.(rawEvent.pointerId);
        }
      } catch (_) { /* ignore */ }
      document.addEventListener('pointermove', onDocPointerMove, { passive: false });
      document.addEventListener('pointerup', onDocPointerUp, { passive: false });
      document.addEventListener('pointercancel', onDocPointerUp, { passive: false });
    } else {
      document.addEventListener('touchmove', onDocTouchMove, { passive: false });
      document.addEventListener('touchend', onDocTouchEnd, { passive: false });
      document.addEventListener('touchcancel', onDocTouchEnd, { passive: false });
    }
    onDragMove?.(rawEvent || point, payload, elementUnder(lastX, lastY), el);
  }

  function tryActivateMove(el, point, rawEvent) {
    const dx = point.x - startX;
    const dy = point.y - startY;
    if (dx * dx + dy * dy <= moveThreshold * moveThreshold) return false;
    if (typeof canActivate === 'function' && !canActivate(el, dx, dy)) {
      clearPress();
      return true;
    }
    beginDrag(el, point, rawEvent);
    return true;
  }

  function onHostTouchStart(e) {
    if (usePointers) return;
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
    pending = true;
    sourceEl.classList.add('touch-dnd-pending');

    pressTimer = setTimeout(() => {
      pressTimer = null;
      beginDrag(el, { x: touch.clientX, y: touch.clientY }, touch);
    }, pressDelay);
  }

  function onHostTouchMove(e) {
    if (usePointers) return;
    if (dragging) return;
    if (!pending || !pressTimer || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) clearPress();
  }

  function onHostTouchEnd() {
    if (usePointers) return;
    clearPress();
  }

  function onHostPointerDown(e) {
    if (!usePointers) return;
    if (dragging || e.button !== 0) return;
    const el = e.target.closest(selector);
    if (!el || !host.contains(el)) return;
    if (e.target.closest('button, a, input, select, textarea, label')) return;

    startX = e.clientX;
    startY = e.clientY;
    lastX = startX;
    lastY = startY;
    pointerId = e.pointerId;
    sourceEl = el;
    pending = true;
    didDrag = false;
    sourceEl.classList.add('touch-dnd-pending');
  }

  function onHostPointerMove(e) {
    if (!usePointers) return;
    if (dragging) return;
    if (!pending || !sourceEl) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    const point = pointFromEvent(e);
    if (tryActivateMove(sourceEl, point, e)) {
      if (dragging) e.preventDefault();
    }
  }

  function onHostPointerUp(e) {
    if (!usePointers) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    if (dragging) return;
    clearPress();
  }

  function onClickCapture(e) {
    if (!didDrag) return;
    didDrag = false;
    if (clearDidDragTimer) {
      clearTimeout(clearDidDragTimer);
      clearDidDragTimer = null;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  if (usePointers) {
    host.addEventListener('pointerdown', onHostPointerDown);
    host.addEventListener('pointermove', onHostPointerMove, { passive: false });
    host.addEventListener('pointerup', onHostPointerUp);
    host.addEventListener('pointercancel', onHostPointerUp);
    host.addEventListener('click', onClickCapture, true);
  } else {
    host.addEventListener('touchstart', onHostTouchStart, { passive: true });
    host.addEventListener('touchmove', onHostTouchMove, { passive: true });
    host.addEventListener('touchend', onHostTouchEnd, { passive: true });
    host.addEventListener('touchcancel', onHostTouchEnd, { passive: true });
  }

  return () => {
    cancelDrag();
    if (usePointers) {
      host.removeEventListener('pointerdown', onHostPointerDown);
      host.removeEventListener('pointermove', onHostPointerMove);
      host.removeEventListener('pointerup', onHostPointerUp);
      host.removeEventListener('pointercancel', onHostPointerUp);
      host.removeEventListener('click', onClickCapture, true);
    } else {
      host.removeEventListener('touchstart', onHostTouchStart);
      host.removeEventListener('touchmove', onHostTouchMove);
      host.removeEventListener('touchend', onHostTouchEnd);
      host.removeEventListener('touchcancel', onHostTouchEnd);
    }
  };
}

if (typeof window !== 'undefined') {
  window.TouchDnD = { bind: bindTouchDnD };
}

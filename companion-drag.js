// The character keeps normal pointer events for click interaction and moves via
// main IPC. The separate bottom strip uses native Windows dragging.
(() => {
  let drag = null;
  let suppressUntil = 0;

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 4) return;
    drag.moved = true;
    document.body.classList.add('dragging');
    window.widget.moveDrag();
    event.preventDefault();
  }

  function finish(event) {
    if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    if (event && event.type === 'pointerup') move(event);
    const previous = drag;
    drag = null;
    if (previous.moved) suppressUntil = performance.now() + 500;
    window.widget.endDrag();
    document.body.classList.remove('drag-held', 'dragging');
    if (previous.handle.hasPointerCapture(previous.pointerId)) {
      previous.handle.releasePointerCapture(previous.pointerId);
    }
  }

  document.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || !event.isPrimary || document.body.classList.contains('ghost')) return;
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle) return;
    const control = event.target.closest('button, input, a, [contenteditable="true"]');
    if (control && control !== handle) return;
    drag = { pointerId: event.pointerId, handle, x: event.screenX, y: event.screenY, moved: false };
    document.body.classList.add('drag-held');
    // Preserve the press coordinates. By the time main receives IPC the OS
    // cursor may already have reached the end of a short/fast drag.
    window.widget.startDrag({ x: event.clientX, y: event.clientY });
    // Capture keeps pointerup reachable even outside the window or character.
    // Synthetic test events have no active pointer and cannot be captured.
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  });
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', () => finish());
  window.addEventListener('pagehide', () => finish());
  window.widget.onGhost(on => { if (on) finish(); });
  window.widget.onDragging(() => {
    if (!drag) return;
    drag.moved = true;
    document.body.classList.add('dragging');
  });
  for (const type of ['click', 'dblclick']) {
    document.addEventListener(type, event => {
      if (event.detail > 0 && performance.now() < suppressUntil && event.target.closest('[data-drag-handle]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
})();

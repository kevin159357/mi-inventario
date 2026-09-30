// ========================================
// INTERFAZ, MODALES Y TOASTS
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;

  function el(id) {
    return document.getElementById(id);
  }

  function showScreen(screenId) {
    ['loadingScreen', 'startScreen', 'adminScreen', 'folderInventoryScreen', 'clientScreen']
      .forEach((id) => {
        const node = el(id);
        if (!node) return;
        const show = id === screenId;
        node.hidden = !show;
        node.classList.toggle('is-active', show);
      });
  }

  function toast(message, type) {
    const root = el('toastRoot');
    if (!root) return;
    const item = document.createElement('div');
    item.className = `toast toast--${type || 'info'}`;
    item.textContent = message;
    root.appendChild(item);
    window.setTimeout(() => item.remove(), 3200);
  }

  function closeModal() {
    const root = el('modalRoot');
    if (root) root.innerHTML = '';
  }

  function openModal(options) {
    const root = el('modalRoot');
    if (!root) throw new Error('No existe modalRoot.');
    closeModal();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal__header">
          <div>
            ${options.eyebrow ? `<p class="eyebrow">${App.utils.escapeHtml(options.eyebrow)}</p>` : ''}
            <h2 id="modalTitle">${App.utils.escapeHtml(options.title || '')}</h2>
          </div>
          ${options.hideClose ? '' : '<button class="modal__close" type="button" data-modal-close aria-label="Cerrar">✕</button>'}
        </div>
        <div class="modal__body">${options.bodyHtml || ''}</div>
        ${options.footerHtml ? `<div class="modal__footer">${options.footerHtml}</div>` : ''}
      </section>
    `;

    root.appendChild(backdrop);

    if (!options.hideClose) {
      backdrop.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop && options.closeOnBackdrop !== false) closeModal();
      });
    }

    if (typeof options.onReady === 'function') {
      options.onReady(backdrop.querySelector('.modal'));
    }

    return backdrop.querySelector('.modal');
  }

  function confirmDialog(options) {
    return new Promise((resolve) => {
      openModal({
        title: options.title || 'Confirmar',
        bodyHtml: `<p>${App.utils.escapeHtml(options.message || '')}</p>${options.warning ? `<div class="warning-box">${App.utils.escapeHtml(options.warning)}</div>` : ''}`,
        footerHtml: `
          <button class="btn btn--secondary" type="button" data-confirm-cancel>Cancelar</button>
          <button class="btn btn--danger" type="button" data-confirm-ok>${App.utils.escapeHtml(options.confirmText || 'Eliminar')}</button>
        `,
        closeOnBackdrop: false,
        onReady(modal) {
          const finish = (value) => { closeModal(); resolve(value); };
          modal.querySelector('[data-confirm-cancel]').addEventListener('click', () => finish(false));
          modal.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
          modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(false), { once: true });
        }
      });
    });
  }

  function emptyState(icon, title, text, buttonHtml) {
    return `
      <div class="empty-state">
        <div class="empty-state__icon">${icon}</div>
        <h3>${App.utils.escapeHtml(title)}</h3>
        <p>${App.utils.escapeHtml(text)}</p>
        ${buttonHtml ? `<div style="margin-top:14px">${buttonHtml}</div>` : ''}
      </div>
    `;
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = busyText || 'Guardando…';
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function stockStatus(stock, lowStockLimit) {
    const value = Number(stock) || 0;
    if (value <= 0) return { key: 'out', label: '🔴 SIN STOCK' };
    if (value <= lowStockLimit) return { key: 'low', label: '🟠 STOCK BAJO' };
    return { key: 'ok', label: '🟢 DISPONIBLE' };
  }

  function togglePassword(input, button) {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? '👁️' : '🙈';
    button.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  }

  App.ui = {
    el,
    showScreen,
    toast,
    openModal,
    closeModal,
    confirmDialog,
    emptyState,
    setButtonBusy,
    stockStatus,
    togglePassword
  };
})();

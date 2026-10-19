// ========================================
// APLICACIÓN PRINCIPAL
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;
  const viewCache = {
    folders: [],
    clientFolders: [],
    currentProducts: [],
    clientProducts: []
  };

  function applyBranding() {
    const appName = App.state.settings?.appName || 'Mi Inventario';
    document.title = appName;
    const startName = App.ui.el('startAppName');
    const adminName = App.ui.el('adminAppName');
    if (startName) startName.textContent = appName;
    if (adminName) adminName.textContent = appName;
  }

  async function buildDashboard() {
    const [folders, products] = await Promise.all([
      App.folders.list(),
      App.db.getAll('products')
    ]);
    const threshold = App.state.settings.lowStockLimit;
    const totalUnits = products.reduce((sum, product) => sum + (Number(product.stock) || 0), 0);
    const low = products.filter((product) => product.stock > 0 && product.stock <= threshold).length;
    const out = products.filter((product) => product.stock <= 0).length;

    const cards = [
      ['📁', folders.length, 'Total de carpetas'],
      ['📦', products.length, 'Total de productos'],
      ['🔢', totalUnits, 'Unidades en stock'],
      ['🟠', low, 'Productos con stock bajo'],
      ['🔴', out, 'Productos sin stock']
    ];

    const target = App.ui.el('dashboardCards');
    target.innerHTML = cards.map(([icon, value, label], index) => `
      ${index >= 3 ? `<button type="button" class="stat-card stat-card--interactive" data-action="stock-report" data-kind="${index === 3 ? 'low' : 'out'}" aria-label="Ver detalle: ${label}">` : '<article class="stat-card">'}
        <span class="stat-card__icon">${icon}</span>
        <strong class="stat-card__value">${value}</strong>
        <div class="stat-card__label">${label}${index >= 3 ? ' · Ver detalle ›' : ''}</div>
      ${index >= 3 ? '</button>' : '</article>'}
    `).join('');
  }

  async function showStockReport(kind) {
    const [folders, products] = await Promise.all([App.folders.list(), App.db.getAll('products')]);
    const limit = App.state.settings.lowStockLimit;
    const matches = (p) => kind === 'out' ? Number(p.stock) <= 0 : Number(p.stock) > 0 && Number(p.stock) <= limit;
    const groups = folders.map((folder) => ({
      folder,
      rows: products.filter((p) => p.folderId === folder.id && matches(p))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
    })).filter((group) => group.rows.length);
    const total = groups.reduce((count, group) => count + group.rows.length, 0);
    const title = kind === 'out' ? 'Láminas sin stock' : 'Láminas con stock bajo';
    App.ui.openModal({
      title: `${title} (${total})`, eyebrow: 'Resumen por carpeta',
      bodyHtml: total ? `<p class="form-hint">${groups.length} carpetas afectadas · Pulsa una carpeta para ver sus láminas.</p>` +
        groups.map(({ folder, rows }) => `
          <details class="stock-report-group" open>
            <summary><span>📁 ${App.utils.escapeHtml(folder.name)}</span><strong>${rows.length} lámina${rows.length === 1 ? '' : 's'}</strong></summary>
            <div class="stock-report-list">${rows.map((p) => `
              <div class="stock-report-row"><div><strong>${App.utils.escapeHtml(p.name)}</strong><small>${App.utils.escapeHtml(p.code)}</small></div>
              <span class="stock-badge stock-badge--${kind === 'out' ? 'out' : 'low'}">${p.stock} unidad${Number(p.stock) === 1 ? '' : 'es'}</span></div>
            `).join('')}</div>
          </details>`).join('') : '<p>✅ No hay láminas en este estado.</p>',
      footerHtml: '<button class="btn btn--secondary" type="button" data-modal-close-report>Cerrar</button>',
      onReady(modal) { modal.querySelector('[data-modal-close-report]').addEventListener('click', App.ui.closeModal); }
    });
  }

  function renderFoldersFromCache() {
    const target = App.ui.el('folderGrid');
    const query = App.utils.normalize(App.ui.el('folderSearchInput')?.value || '');
    const folders = viewCache.folders.filter((folder) => !query || App.utils.normalize(folder.name).includes(query));

    if (!folders.length) {
      target.innerHTML = query
        ? App.ui.emptyState('🔎', 'Sin resultados', 'No encontramos carpetas con esa búsqueda.')
        : App.ui.emptyState('📁', 'Todavía no hay carpetas', 'Crea una carpeta para comenzar.', '<button class="btn btn--primary" data-action="create-folder">➕ Crear carpeta</button>');
      return;
    }

    target.innerHTML = folders.map((folder) => `
      <article class="folder-card">
        <div class="folder-card__main" data-action="open-folder" data-folder-id="${folder.id}" role="button" tabindex="0">
          <div class="folder-card__icon">📁</div>
          <h3>${App.utils.escapeHtml(folder.name)}</h3>
          <p>Creada: ${App.utils.formatDate(folder.createdAt)}</p>
          <div class="folder-meta">
            <span>📦 ${folder.productCount} producto${folder.productCount === 1 ? '' : 's'}</span>
            <span>🔢 ${folder.totalUnits} unidad${folder.totalUnits === 1 ? '' : 'es'}</span>
          </div>
        </div>
        <div class="folder-card__actions">
          <button class="mini-btn" type="button" data-action="rename-folder" data-folder-id="${folder.id}" title="Renombrar">✏️</button>
          <button class="mini-btn mini-btn--danger" type="button" data-action="delete-folder" data-folder-id="${folder.id}" title="Eliminar">🗑️</button>
        </div>
      </article>
    `).join('');
  }

  async function refreshAdmin() {
    try {
      viewCache.folders = await App.folders.listWithSummaries();
      renderFoldersFromCache();
      await buildDashboard();
    } catch (error) {
      console.error('Error al actualizar administrador:', error);
      App.ui.toast('❌ No se pudo actualizar el inventario', 'error');
    }
  }

  async function enterAdmin() {
    App.state.currentMode = 'admin';
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    App.ui.showScreen('adminScreen');
    await refreshAdmin();
  }

  async function showStart() {
    App.state.currentMode = 'start';
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    applyBranding();
    App.ui.showScreen('startScreen');
  }

  function openAdminLogin() {
    App.ui.openModal({
      eyebrow: 'Acceso protegido',
      title: 'Modo administrador',
      bodyHtml: `
        <form id="adminLoginForm" class="form-grid">
          <div class="form-row">
            <label for="adminPasswordInput">Contraseña</label>
            <div class="password-field">
              <input id="adminPasswordInput" type="password" autocomplete="current-password" required>
              <button type="button" data-login-toggle aria-label="Mostrar contraseña">👁️</button>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn--secondary" type="button" data-modal-cancel>Cancelar</button>
        <button class="btn btn--dark" type="submit" form="adminLoginForm" data-admin-login>Entrar</button>
      `,
      onReady(modal) {
        const input = modal.querySelector('#adminPasswordInput');
        const button = modal.querySelector('[data-admin-login]');
        modal.querySelector('[data-modal-cancel]').addEventListener('click', App.ui.closeModal);
        modal.querySelector('[data-login-toggle]').addEventListener('click', (event) => App.ui.togglePassword(input, event.currentTarget));
        input.focus();

        modal.querySelector('#adminLoginForm').addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            App.ui.setButtonBusy(button, true, 'Verificando…');
            const ok = await App.settings.verifyPassword(input.value);
            if (!ok) {
              App.ui.toast('❌ Contraseña incorrecta', 'error');
              input.select();
              App.ui.setButtonBusy(button, false);
              return;
            }
            App.ui.closeModal();
            await enterAdmin();
          } catch (error) {
            console.error('Error al verificar contraseña:', error);
            App.ui.toast('❌ No se pudo verificar la contraseña', 'error');
            App.ui.setButtonBusy(button, false);
          }
        });
      }
    });
  }

  async function openFolder(folderId) {
    const folder = await App.folders.get(folderId);
    if (!folder) {
      App.ui.toast('❌ La carpeta ya no existe', 'error');
      await refreshAdmin();
      return;
    }
    App.state.currentMode = 'folder';
    App.state.currentFolderId = folderId;
    App.ui.el('folderInventoryTitle').textContent = folder.name;
    App.ui.el('productSearchInput').value = '';
    App.ui.showScreen('folderInventoryScreen');
    await refreshCurrentFolder();
  }

  function filterAndSortCurrentProducts() {
    const query = App.utils.normalize(App.ui.el('productSearchInput')?.value || '');
    const filtered = viewCache.currentProducts.filter((product) => {
      if (!query) return true;
      return App.utils.normalize(product.name).includes(query) || App.utils.normalize(product.code).includes(query);
    });
    return App.products.sortProducts(filtered);
  }

  async function renderCurrentProducts() {
    await App.products.renderProducts(App.ui.el('productGrid'), filterAndSortCurrentProducts(), { isClient: false });
  }

  async function refreshCurrentFolder() {
    if (!App.state.currentFolderId) return;
    const folder = await App.folders.get(App.state.currentFolderId);
    if (!folder) {
      App.ui.toast('⚠️ Esa carpeta fue eliminada', 'warning');
      App.state.currentFolderId = null;
      App.state.currentMode = 'admin';
      App.ui.showScreen('adminScreen');
      await refreshAdmin();
      return;
    }

    App.ui.el('folderInventoryTitle').textContent = folder.name;
    viewCache.currentProducts = await App.products.listByFolder(folder.id);
    await renderCurrentProducts();
    await refreshAdmin();
  }

  // El mostrario del cliente es una segunda vista de TODAS las carpetas.
  // No exige asignaciones ni permite crear, renombrar o borrar.
  function renderClientFoldersFromCache() {
    const target = App.ui.el('clientFolderGrid');
    const query = App.utils.normalize(App.ui.el('clientFolderSearchInput')?.value || '');
    const folders = viewCache.clientFolders.filter((folder) =>
      !query || App.utils.normalize(folder.name).includes(query)
    );
    if (!folders.length) {
      target.innerHTML = query
        ? App.ui.emptyState('🔎', 'Sin resultados', 'No encontramos carpetas con esa búsqueda.')
        : App.ui.emptyState('📁', 'Sin carpetas todavía', 'El administrador aún no ha añadido carpetas.');
      return;
    }
    target.innerHTML = folders.map((folder) => `
      <article class="folder-card folder-card--readonly">
        <div class="folder-card__main" data-action="open-client-folder" data-folder-id="${folder.id}" role="button" tabindex="0" aria-label="Abrir carpeta ${App.utils.escapeHtml(folder.name)}">
          <div class="folder-card__icon">📁</div>
          <h3>${App.utils.escapeHtml(folder.name)}</h3>
          <p>Ver láminas de esta carpeta ›</p>
          <div class="folder-meta">
            <span>📦 ${folder.productCount} producto${folder.productCount === 1 ? '' : 's'}</span>
            <span>🔢 ${folder.totalUnits} unidad${folder.totalUnits === 1 ? '' : 'es'}</span>
          </div>
        </div>
      </article>
    `).join('');
  }

  async function refreshClientFolders() {
    viewCache.clientFolders = await App.folders.listWithSummaries();
    renderClientFoldersFromCache();
  }

  async function enterClient() {
    App.state.currentMode = 'client-folders';
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    App.ui.el('clientFolderSearchInput').value = '';
    App.ui.showScreen('clientFoldersScreen');
    await refreshClientFolders();
    return true;
  }

  async function openClientFolder(folderId) {
    if (App.state.currentMode !== 'client-folders') return;
    const folder = await App.folders.get(folderId);
    if (!folder) {
      App.ui.toast('⚠️ La carpeta ya no existe', 'warning');
      await refreshClientFolders();
      return;
    }
    App.state.currentMode = 'client';
    App.state.currentFolderId = folder.id;
    App.ui.el('clientFolderTitle').textContent = folder.name;
    App.ui.el('clientSearchInput').value = '';
    App.ui.showScreen('clientScreen');
    await refreshClient();
  }

  async function backToClientFolders() {
    App.state.currentMode = 'client-folders';
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    App.ui.showScreen('clientFoldersScreen');
    await refreshClientFolders();
  }

  function filterClientProducts() {
    const query = App.utils.normalize(App.ui.el('clientSearchInput')?.value || '');
    return App.products.sortProducts(viewCache.clientProducts.filter((product) => {
      if (!query) return true;
      return App.utils.normalize(product.name).includes(query) || App.utils.normalize(product.code).includes(query);
    }));
  }

  async function renderClientProducts() {
    await App.products.renderProducts(App.ui.el('clientProductGrid'), filterClientProducts(), { isClient: true });
  }

  async function refreshClient() {
    if (App.state.currentMode !== 'client' || !App.state.currentFolderId) return;
    const folder = await App.folders.get(App.state.currentFolderId);
    if (!folder) return backToClientFolders();
    App.ui.el('clientFolderTitle').textContent = folder.name;
    viewCache.clientProducts = await App.products.listByFolder(folder.id);
    await renderClientProducts();
  }

  async function changeStock(productId, delta, clickedButton) {
    if (clickedButton) clickedButton.disabled = true;
    try {
      const product = await App.products.get(productId);
      if (!product) throw new Error('El producto ya no existe.');
      if (delta < 0 && product.stock <= 0) {
        App.ui.toast('⚠️ El stock ya está en 0', 'warning');
        return;
      }
      await App.products.changeStock(productId, delta);
      App.ui.toast('✅ Stock actualizado', 'success');
      await refreshCurrentFolder();
    } catch (error) {
      console.error('Error al cambiar stock:', error);
      App.ui.toast(`❌ ${error.message || 'No se pudo actualizar el stock'}`, 'error');
    } finally {
      if (clickedButton?.isConnected) clickedButton.disabled = false;
    }
  }

  async function handleAction(actionElement) {
    const action = actionElement.dataset.action;
    const adminOnly = new Set([
      'open-settings', 'create-folder', 'rename-folder', 'delete-folder',
      'open-folder', 'create-product', 'edit-product', 'delete-product',
      'stock-plus', 'stock-minus', 'back-admin', 'stock-report'
    ]);
    if (adminOnly.has(action) && !['admin', 'folder'].includes(App.state.currentMode)) return;
    switch (action) {
      case 'enter-client':
        await enterClient();
        break;
      case 'open-admin-login':
      case 'client-admin-unlock':
        openAdminLogin();
        break;
      case 'logout-admin':
        await showStart();
        break;
      case 'open-settings':
        await App.settings.openSettingsModal();
        break;
      case 'create-folder':
        App.folders.openCreateModal();
        break;
      case 'rename-folder':
        await App.folders.openRenameModal(actionElement.dataset.folderId);
        break;
      case 'delete-folder':
        await App.folders.confirmRemove(actionElement.dataset.folderId);
        break;
      case 'open-folder':
        await openFolder(actionElement.dataset.folderId);
        break;
      case 'open-client-folder':
        await openClientFolder(actionElement.dataset.folderId);
        break;
      case 'back-client-folders':
        await backToClientFolders();
        break;
      case 'clear-client-folder-search':
        App.ui.el('clientFolderSearchInput').value = '';
        renderClientFoldersFromCache();
        App.ui.el('clientFolderSearchInput').focus();
        break;
      case 'back-admin':
        App.state.currentMode = 'admin';
        App.state.currentFolderId = null;
        App.utils.revokeObjectUrls();
        App.ui.showScreen('adminScreen');
        await refreshAdmin();
        break;
      case 'create-product':
        if (App.state.currentFolderId) await App.products.openProductModal(App.state.currentFolderId, null);
        break;
      case 'edit-product':
        await App.products.openProductModal(App.state.currentFolderId, actionElement.dataset.productId);
        break;
      case 'delete-product':
        await App.products.confirmRemove(actionElement.dataset.productId);
        break;
      case 'stock-plus':
        await changeStock(actionElement.dataset.productId, 1, actionElement);
        break;
      case 'stock-minus':
        await changeStock(actionElement.dataset.productId, -1, actionElement);
        break;
      case 'view-image':
        if (['folder', 'client'].includes(App.state.currentMode)) {
          const product = await App.products.get(actionElement.dataset.productId);
          if (product?.folderId === App.state.currentFolderId) {
            await App.products.openImageViewer(product.id);
          }
        }
        break;
      case 'stock-report':
        if (App.state.currentMode === 'admin') await showStockReport(actionElement.dataset.kind);
        break;
      case 'clear-folder-search':
        App.ui.el('folderSearchInput').value = '';
        renderFoldersFromCache();
        App.ui.el('folderSearchInput').focus();
        break;
      case 'clear-product-search':
        App.ui.el('productSearchInput').value = '';
        await renderCurrentProducts();
        App.ui.el('productSearchInput').focus();
        break;
      case 'clear-client-search':
        App.ui.el('clientSearchInput').value = '';
        await renderClientProducts();
        App.ui.el('clientSearchInput').focus();
        break;
      default:
        break;
    }
  }

  function bindProductReordering() {
    const grid = App.ui.el('productGrid');
    let drag = null;
    grid.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-reorder-handle]');
      if (!handle || App.state.currentMode !== 'folder') return;
      if (App.ui.el('productSearchInput').value.trim()) {
        App.ui.toast('⚠️ Borra la búsqueda para ordenar todas las láminas.', 'warning');
        return;
      }
      const card = handle.closest('[data-product-id]');
      if (!card) return;
      event.preventDefault();
      drag = { id: event.pointerId, card, handle, changed: false };
      handle.setPointerCapture(event.pointerId);
      card.classList.add('product-card--dragging');
    });
    grid.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      const other = document.elementFromPoint(event.clientX, event.clientY)?.closest('#productGrid > .product-card');
      if (other && other !== drag.card) {
        const rect = other.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2 ||
          (Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 2 && event.clientX < rect.left + rect.width / 2);
        grid.insertBefore(drag.card, before ? other : other.nextSibling);
        drag.changed = true;
      }
      if (event.clientY > window.innerHeight - 85) window.scrollBy(0, 13);
      else if (event.clientY < 85) window.scrollBy(0, -13);
    });
    async function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const current = drag;
      drag = null;
      current.card.classList.remove('product-card--dragging');
      try { if (current.handle.hasPointerCapture(event.pointerId)) current.handle.releasePointerCapture(event.pointerId); } catch (_) {}
      if (!current.changed) return;
      try {
        const ids = [...grid.querySelectorAll(':scope > .product-card')].map((node) => node.dataset.productId);
        await App.products.setCustomOrder(App.state.currentFolderId, ids);
        await refreshCurrentFolder();
        App.ui.toast('✅ Orden guardado', 'success');
      } catch (error) {
        console.error('Error al guardar el orden:', error);
        App.ui.toast('❌ No se pudo guardar el orden', 'error');
        await refreshCurrentFolder();
      }
    }
    grid.addEventListener('pointerup', (event) => { endDrag(event).catch(console.error); });
    grid.addEventListener('pointercancel', (event) => { endDrag(event).catch(console.error); });
  }

  function bindEvents() {
    document.addEventListener('click', async (event) => {
      const actionElement = event.target.closest('[data-action]');
      if (!actionElement || !App.state.initialized) return;
      try { await handleAction(actionElement); }
      catch (error) {
        console.error('Error al ejecutar acción:', actionElement.dataset.action, error);
        App.ui.toast('❌ Ocurrió un error inesperado', 'error');
      }
    });

    document.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const action = event.target?.dataset?.action;
      if (action === 'open-folder' && App.state.currentMode === 'admin') {
        event.preventDefault();
        await openFolder(event.target.dataset.folderId);
      } else if (action === 'open-client-folder' && App.state.currentMode === 'client-folders') {
        event.preventDefault();
        await openClientFolder(event.target.dataset.folderId);
      }
    });

    App.ui.el('folderSearchInput').addEventListener('input', renderFoldersFromCache);
    App.ui.el('clientFolderSearchInput').addEventListener('input', renderClientFoldersFromCache);
    App.ui.el('productSearchInput').addEventListener('input', () => renderCurrentProducts().catch(console.error));
    bindProductReordering();
    App.ui.el('clientSearchInput').addEventListener('input', () => renderClientProducts().catch(console.error));
    App.backup.bindRestoreInput();
    App.backup.bindVerifyInput();

    window.addEventListener('beforeunload', () => App.utils.revokeObjectUrls());
  }

  async function initialize() {
    try {
      App.ui.showScreen('loadingScreen');
      await App.db.open();
      await App.db.initializeDefaults();
      applyBranding();
      bindEvents();
      App.state.initialized = true;

      if (App.state.settings.autoClientMode) {
        const entered = await enterClient();
        if (!entered) await showStart();
      } else {
        await showStart();
      }
    } catch (error) {
      console.error('Error fatal al iniciar Mi Inventario:', error);
      App.state.initialized = false;
      const loading = App.ui.el('loadingScreen');
      if (loading) {
        loading.innerHTML = `
          <div class="loading-card">
            <div class="brand-mark">⚠️</div>
            <h1>No se pudo iniciar</h1>
            <p>${App.utils.escapeHtml(error.message || 'Error desconocido')}</p>
            <p class="muted">Prueba cerrando otras pestañas de la aplicación y vuelve a abrir index.html.</p>
          </div>
        `;
      }
    }
  }

  App.app = {
    initialize,
    applyBranding,
    refreshAdmin,
    refreshCurrentFolder,
    refreshClientFolders,
    refreshClient,
    enterAdmin,
    enterClient,
    showStart
  };

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

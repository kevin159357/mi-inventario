// ========================================
// APLICACIÓN PRINCIPAL
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;
  const viewCache = {
    folders: [],
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
    const assigned = App.state.settings.clientFolderId
      ? folders.find((folder) => folder.id === App.state.settings.clientFolderId)
      : null;

    const cards = [
      ['📁', folders.length, 'Total de carpetas'],
      ['📦', products.length, 'Total de productos'],
      ['🔢', totalUnits, 'Unidades en stock'],
      ['🟠', low, 'Productos con stock bajo'],
      ['🔴', out, 'Productos sin stock']
    ];

    const target = App.ui.el('dashboardCards');
    target.innerHTML = cards.map(([icon, value, label]) => `
      <article class="stat-card">
        <span class="stat-card__icon">${icon}</span>
        <strong class="stat-card__value">${value}</strong>
        <div class="stat-card__label">${label}</div>
      </article>
    `).join('') + `
      <article class="stat-card stat-card--wide">
        <span class="stat-card__icon">👤</span>
        <strong class="stat-card__value" style="font-size:1.05rem">${assigned ? App.utils.escapeHtml(assigned.name) : 'Sin asignar'}</strong>
        <div class="stat-card__label">Carpeta actualmente asignada al cliente</div>
      </article>
    `;
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
    const sort = App.ui.el('productSortSelect')?.value || 'name-asc';
    const filtered = viewCache.currentProducts.filter((product) => {
      if (!query) return true;
      return App.utils.normalize(product.name).includes(query) || App.utils.normalize(product.code).includes(query);
    });
    return App.products.sortProducts(filtered, sort);
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

  async function enterClient() {
    const folderId = App.state.settings.clientFolderId;
    if (!folderId) {
      App.ui.toast('⚠️ Todavía no se ha configurado una carpeta para el cliente.', 'warning');
      if (App.state.currentMode === 'loading') await showStart();
      return false;
    }

    const folder = await App.folders.get(folderId);
    if (!folder) {
      App.state.settings.clientFolderId = null;
      await App.db.setConfig('settings', App.state.settings);
      App.ui.toast('⚠️ La carpeta del cliente ya no existe. Configúrala nuevamente.', 'warning');
      await showStart();
      return false;
    }

    App.state.currentMode = 'client';
    App.state.currentFolderId = folderId;
    App.ui.el('clientFolderTitle').textContent = folder.name;
    App.ui.el('clientSearchInput').value = '';
    App.ui.showScreen('clientScreen');
    await refreshClient();
    return true;
  }

  function filterClientProducts() {
    const query = App.utils.normalize(App.ui.el('clientSearchInput')?.value || '');
    return App.products.sortProducts(viewCache.clientProducts.filter((product) => {
      if (!query) return true;
      return App.utils.normalize(product.name).includes(query) || App.utils.normalize(product.code).includes(query);
    }), 'name-asc');
  }

  async function renderClientProducts() {
    await App.products.renderProducts(App.ui.el('clientProductGrid'), filterClientProducts(), { isClient: true });
  }

  async function refreshClient() {
    if (!App.state.settings.clientFolderId) return showStart();
    const folder = await App.folders.get(App.state.settings.clientFolderId);
    if (!folder) return showStart();
    App.state.currentFolderId = folder.id;
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
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="open-folder"][role="button"]')) {
        event.preventDefault();
        await openFolder(event.target.dataset.folderId);
      }
    });

    App.ui.el('folderSearchInput').addEventListener('input', renderFoldersFromCache);
    App.ui.el('productSearchInput').addEventListener('input', () => renderCurrentProducts().catch(console.error));
    App.ui.el('productSortSelect').addEventListener('change', () => renderCurrentProducts().catch(console.error));
    App.ui.el('clientSearchInput').addEventListener('input', () => renderClientProducts().catch(console.error));
    App.backup.bindRestoreInput();

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

      if (App.state.settings.autoClientMode && App.state.settings.clientFolderId) {
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
    refreshClient,
    enterAdmin,
    enterClient,
    showStart
  };

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

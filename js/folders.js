// ========================================
// CARPETAS
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;

  async function list() {
    const folders = await App.db.getAll('folders');
    return folders.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }

  async function get(id) {
    return App.db.get('folders', id);
  }

  async function create(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('El nombre de la carpeta no puede estar vacío.');

    const timestamp = App.utils.now();
    const folder = {
      id: App.utils.uid('folder'),
      name: cleanName,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await App.db.add('folders', folder);
    return folder;
  }

  async function rename(id, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('El nombre de la carpeta no puede estar vacío.');
    const folder = await get(id);
    if (!folder) throw new Error('La carpeta ya no existe.');
    folder.name = cleanName;
    folder.updatedAt = App.utils.now();
    await App.db.put('folders', folder);
    return folder;
  }

  async function summary(folder) {
    const products = await App.db.getAllByIndex('products', 'folderId', folder.id);
    return {
      ...folder,
      productCount: products.length,
      totalUnits: products.reduce((sum, product) => sum + (Number(product.stock) || 0), 0)
    };
  }

  async function listWithSummaries() {
    const folders = await list();
    return Promise.all(folders.map(summary));
  }

  async function remove(id) {
    const folder = await get(id);
    if (!folder) return;
    const products = await App.db.getAllByIndex('products', 'folderId', id);

    for (const product of products) {
      if (product.imageId) {
        await App.db.remove('images', product.imageId);
      }
      await App.db.remove('products', product.id);
    }

    await App.db.remove('folders', id);

    if (App.state.settings.clientFolderId === id) {
      App.state.settings.clientFolderId = null;
      await App.db.setConfig('settings', App.state.settings);
    }
  }

  function openCreateModal() {
    App.ui.openModal({
      eyebrow: 'Carpetas',
      title: 'Crear carpeta',
      bodyHtml: `
        <form id="folderCreateForm" class="form-grid">
          <div class="form-row">
            <label for="folderNameInput">Nombre</label>
            <input id="folderNameInput" name="name" type="text" maxlength="80" autocomplete="off" placeholder="Ej. Pokémon" required>
          </div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn--secondary" type="button" data-modal-cancel>Cancelar</button>
        <button class="btn btn--primary" type="submit" form="folderCreateForm" data-save-folder>Crear carpeta</button>
      `,
      onReady(modal) {
        const form = modal.querySelector('#folderCreateForm');
        const input = modal.querySelector('#folderNameInput');
        const saveButton = modal.querySelector('[data-save-folder]');
        modal.querySelector('[data-modal-cancel]').addEventListener('click', App.ui.closeModal);
        input.focus();

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            App.ui.setButtonBusy(saveButton, true, 'Creando…');
            await create(input.value);
            App.ui.closeModal();
            App.ui.toast('✅ Carpeta creada', 'success');
            await App.app.refreshAdmin();
          } catch (error) {
            console.error('Error al crear carpeta:', error);
            App.ui.toast(`❌ ${error.message || 'No se pudo crear la carpeta'}`, 'error');
            App.ui.setButtonBusy(saveButton, false);
          }
        });
      }
    });
  }

  async function openRenameModal(id) {
    const folder = await get(id);
    if (!folder) {
      App.ui.toast('❌ La carpeta ya no existe', 'error');
      return;
    }

    App.ui.openModal({
      eyebrow: 'Carpetas',
      title: 'Renombrar carpeta',
      bodyHtml: `
        <form id="folderRenameForm" class="form-grid">
          <div class="form-row">
            <label for="folderRenameInput">Nombre</label>
            <input id="folderRenameInput" type="text" maxlength="80" value="${App.utils.escapeHtml(folder.name)}" required>
          </div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn--secondary" type="button" data-modal-cancel>Cancelar</button>
        <button class="btn btn--primary" type="submit" form="folderRenameForm" data-save-folder>Guardar</button>
      `,
      onReady(modal) {
        const form = modal.querySelector('#folderRenameForm');
        const input = modal.querySelector('#folderRenameInput');
        const button = modal.querySelector('[data-save-folder]');
        modal.querySelector('[data-modal-cancel]').addEventListener('click', App.ui.closeModal);
        input.focus();
        input.select();

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            App.ui.setButtonBusy(button, true, 'Guardando…');
            await rename(id, input.value);
            App.ui.closeModal();
            App.ui.toast('✅ Carpeta renombrada', 'success');
            await App.app.refreshAdmin();
          } catch (error) {
            console.error('Error al renombrar carpeta:', error);
            App.ui.toast(`❌ ${error.message || 'No se pudo renombrar'}`, 'error');
            App.ui.setButtonBusy(button, false);
          }
        });
      }
    });
  }

  async function confirmRemove(id) {
    const folder = await get(id);
    if (!folder) return;
    const products = await App.db.getAllByIndex('products', 'folderId', id);
    const warning = products.length
      ? `Esta carpeta contiene ${products.length} producto${products.length === 1 ? '' : 's'}. Al eliminarla también se eliminarán todos sus productos e imágenes.`
      : 'La carpeta está vacía.';

    const confirmed = await App.ui.confirmDialog({
      title: 'Eliminar carpeta',
      message: `¿Seguro que deseas eliminar “${folder.name}”?`,
      warning,
      confirmText: 'Eliminar'
    });

    if (!confirmed) return;

    try {
      await remove(id);
      App.ui.toast('✅ Carpeta eliminada', 'success');
      await App.app.refreshAdmin();
    } catch (error) {
      console.error('Error al eliminar carpeta:', error);
      App.ui.toast('❌ No se pudo eliminar la carpeta', 'error');
    }
  }

  App.folders = {
    list,
    get,
    create,
    rename,
    remove,
    summary,
    listWithSummaries,
    openCreateModal,
    openRenameModal,
    confirmRemove
  };
})();

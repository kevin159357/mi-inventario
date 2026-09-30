// ========================================
// COPIA DE SEGURIDAD Y RESTAURACIÓN
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;

  async function buildPayload() {
    const [folders, products, imageRows] = await Promise.all([
      App.db.getAll('folders'),
      App.db.getAll('products'),
      App.db.getAll('images')
    ]);

    const images = [];
    for (const image of imageRows) {
      images.push({
        id: image.id,
        type: image.type || image.blob?.type || 'application/octet-stream',
        name: image.name || 'imagen',
        createdAt: image.createdAt || App.utils.now(),
        dataURL: await App.utils.blobToDataURL(image.blob)
      });
    }

    return {
      format: 'mi-inventario-backup',
      version: 1,
      appVersion: App.VERSION,
      exportedAt: App.utils.now(),
      settings: { ...App.state.settings },
      folders,
      products,
      images
    };
  }

  async function download() {
    const payload = await buildPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mi-inventario-backup-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    App.ui.toast('✅ Copia de seguridad creada', 'success');
  }

  function validatePayload(payload) {
    if (!payload || payload.format !== 'mi-inventario-backup') throw new Error('El archivo no es una copia válida de Mi Inventario.');
    if (payload.version !== 1) throw new Error('La versión de la copia no es compatible.');
    if (!payload.settings || !Array.isArray(payload.folders) || !Array.isArray(payload.products) || !Array.isArray(payload.images)) {
      throw new Error('La copia está incompleta o dañada.');
    }

    const folderIds = new Set();
    payload.folders.forEach((folder) => {
      if (!folder.id || !String(folder.name || '').trim()) throw new Error('La copia contiene una carpeta inválida.');
      folderIds.add(folder.id);
    });

    const productIds = new Set();
    const perFolderCodes = new Set();
    payload.products.forEach((product) => {
      if (!product.id || !folderIds.has(product.folderId) || !String(product.name || '').trim() || !String(product.code || '').trim()) {
        throw new Error('La copia contiene un producto inválido.');
      }
      if (productIds.has(product.id)) throw new Error('La copia contiene IDs de producto duplicados.');
      productIds.add(product.id);
      product.stock = Math.max(0, Number.parseInt(product.stock, 10) || 0);
      product.codeKey = App.utils.normalize(product.code);
      const pair = `${product.folderId}::${product.codeKey}`;
      if (perFolderCodes.has(pair)) throw new Error('La copia contiene códigos duplicados dentro de una carpeta.');
      perFolderCodes.add(pair);
    });

    const imageIds = new Set();
    payload.images.forEach((image) => {
      if (!image.id || typeof image.dataURL !== 'string' || !image.dataURL.startsWith('data:')) throw new Error('La copia contiene una imagen inválida.');
      imageIds.add(image.id);
    });

    payload.products.forEach((product) => {
      if (product.imageId && !imageIds.has(product.imageId)) product.imageId = null;
    });

    if (payload.settings.clientFolderId && !folderIds.has(payload.settings.clientFolderId)) {
      payload.settings.clientFolderId = null;
    }

    payload.settings = {
      ...App.DEFAULT_SETTINGS,
      ...payload.settings,
      appName: String(payload.settings.appName || 'Mi Inventario').trim() || 'Mi Inventario',
      lowStockLimit: App.utils.clampInt(payload.settings.lowStockLimit, 0, 999999),
      autoClientMode: Boolean(payload.settings.autoClientMode)
    };

    if (!payload.settings.adminPasswordHash || !/^[a-f0-9]{64}$/i.test(payload.settings.adminPasswordHash)) {
      throw new Error('La copia no contiene una contraseña administrativa válida.');
    }

    return payload;
  }

  async function parseFile(file) {
    if (!file) throw new Error('No se seleccionó ningún archivo.');
    const text = await file.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch (error) { throw new Error('El archivo JSON no se puede leer.'); }
    return validatePayload(payload);
  }

  async function restorePayload(payload) {
    const images = payload.images.map((image) => ({
      id: image.id,
      type: image.type || 'application/octet-stream',
      name: image.name || 'imagen',
      createdAt: image.createdAt || App.utils.now(),
      blob: App.utils.dataURLToBlob(image.dataURL)
    }));

    await App.db.replaceAllData({
      folders: payload.folders,
      products: payload.products,
      images,
      settings: payload.settings
    });

    App.state.settings = payload.settings;
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    App.app.applyBranding();
  }

  async function handleRestoreFile(file) {
    try {
      const payload = await parseFile(file);
      const confirmed = await App.ui.confirmDialog({
        title: 'Restaurar copia de seguridad',
        message: 'Restaurar esta copia reemplazará los datos actuales.',
        warning: 'Las carpetas, productos, imágenes, stock y configuración actuales serán reemplazados por los de la copia.',
        confirmText: 'Restaurar'
      });
      if (!confirmed) return;
      await restorePayload(payload);
      App.ui.toast('✅ Datos restaurados', 'success');
      App.state.currentMode = 'admin';
      App.ui.showScreen('adminScreen');
      await App.app.refreshAdmin();
    } catch (error) {
      console.error('Error al restaurar copia:', error);
      App.ui.toast(`❌ ${error.message || 'No se pudo restaurar la copia'}`, 'error');
    }
  }

  function chooseRestoreFile() {
    const input = App.ui.el('restoreFileInput');
    if (!input) return;
    input.value = '';
    input.click();
  }

  function bindRestoreInput() {
    const input = App.ui.el('restoreFileInput');
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) await handleRestoreFile(file);
    });
  }

  App.backup = {
    buildPayload,
    download,
    parseFile,
    restorePayload,
    chooseRestoreFile,
    bindRestoreInput
  };
})();

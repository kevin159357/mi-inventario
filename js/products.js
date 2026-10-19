// ========================================
// PRODUCTOS, IMÁGENES Y STOCK
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  async function listByFolder(folderId) {
    return App.db.getAllByIndex('products', 'folderId', folderId);
  }

  async function get(id) {
    return App.db.get('products', id);
  }

  async function codeExists(folderId, code, excludeId) {
    const key = App.utils.normalize(code);
    const products = await listByFolder(folderId);
    return products.some((product) => product.id !== excludeId && product.codeKey === key);
  }

  function getImageBlob(source) {
    if (!source) return null;
    if (source.blob instanceof Blob) return source.blob;
    if (source instanceof Blob) return source;
    return null;
  }

  function validateImage(source) {
    if (!source) return;
    const blob = getImageBlob(source);
    if (!blob) throw new Error('Selecciona un archivo de imagen válido.');
    const type = source.type || blob.type || '';
    if (!type || !type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande. Máximo 8 MB.');
    if (blob.size <= 0) throw new Error('La imagen seleccionada está vacía o no se pudo leer.');
  }

  function blobToArrayBuffer(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen seleccionada.'));
      reader.readAsArrayBuffer(blob);
    });
  }

  // En algunos móviles Android, el File recibido desde el selector de fotos
  // puede apuntar a un recurso temporal del sistema. IndexedDB puede rechazarlo
  // con "Failed to write blobs (invalid blob)". Para evitarlo, copiamos sus
  // bytes a memoria y creamos un Blob nuevo y estable antes de previsualizar
  // o guardar la imagen.
  async function prepareImage(source) {
    if (!source) return null;
    if (source.__inventoryPrepared && source.blob instanceof Blob) return source;

    const originalBlob = getImageBlob(source);
    validateImage(source);

    let buffer;
    try {
      buffer = await blobToArrayBuffer(originalBlob);
    } catch (error) {
      console.error('Error al leer la imagen seleccionada:', error);
      throw new Error('No se pudo leer la imagen. Prueba seleccionándola desde Galería o Archivos.');
    }

    if (!buffer || buffer.byteLength <= 0) {
      throw new Error('No se pudo leer el contenido de la imagen.');
    }

    const type = source.type || originalBlob.type || 'image/jpeg';
    const stableBlob = new Blob([buffer], { type });
    if (stableBlob.size <= 0) throw new Error('No se pudo preparar la imagen para guardarla.');

    return {
      __inventoryPrepared: true,
      blob: stableBlob,
      type,
      name: source.name || 'imagen',
      size: stableBlob.size
    };
  }

  async function saveImage(source) {
    if (!source) return null;
    const prepared = await prepareImage(source);
    const newImageId = App.utils.uid('image');
    await App.db.put('images', {
      id: newImageId,
      blob: prepared.blob,
      type: prepared.type,
      name: prepared.name || 'imagen',
      createdAt: App.utils.now()
    });
    return newImageId;
  }

  function manualOrder(products) {
    return [...products].sort((a, b) => {
      const aSet = Number.isFinite(a.sortOrder), bSet = Number.isFinite(b.sortOrder);
      if (aSet && bSet && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      // Instalaciones antiguas: orden de ingreso, no alfabético.
      return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id));
    });
  }

  async function ensureFolderOrder(folderId) {
    const rows = manualOrder(await listByFolder(folderId));
    if (rows.some((p, index) => p.sortOrder !== index)) {
      await App.db.putMany('products', rows.map((p, index) => ({ ...p, sortOrder: index })));
    }
    return rows;
  }

  async function setCustomOrder(folderId, orderedIds) {
    const products = await listByFolder(folderId);
    const originalIds = new Set(products.map((p) => p.id));
    if (originalIds.size !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length ||
        !orderedIds.every((id) => originalIds.has(id))) {
      throw new Error('El orden no coincide con los productos de la carpeta.');
    }
    const lookup = new Map(products.map((p) => [p.id, p]));
    await App.db.putMany('products', orderedIds.map((id, index) => ({ ...lookup.get(id), sortOrder: index })));
  }

  function safeRotation(value) {
    const rotation = Number(value);
    return [0, 90, 180, 270].includes(rotation) ? rotation : 0;
  }

  async function create(folderId, data) {
    const name = String(data.name || '').trim();
    const code = String(data.code || '').trim();
    const stock = App.utils.clampInt(data.stock, 0, 999999999);
    if (!name) throw new Error('El producto necesita un nombre.');
    if (!code) throw new Error('El código no puede estar vacío.');
    if (await codeExists(folderId, code, null)) throw new Error('Ya existe un producto con ese código en esta carpeta.');

    const existing = await ensureFolderOrder(folderId);
    const imageId = await saveImage(data.imageFile);
    const timestamp = App.utils.now();
    const product = {
      id: App.utils.uid('product'),
      folderId,
      name,
      code,
      codeKey: App.utils.normalize(code),
      stock,
      imageId,
      imageRotation: safeRotation(data.imageRotation),
      sortOrder: existing.length,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    try {
      await App.db.add('products', product);
      return product;
    } catch (error) {
      if (imageId) await App.db.remove('images', imageId).catch(() => {});
      throw error;
    }
  }

  async function update(id, data) {
    const product = await get(id);
    if (!product) throw new Error('El producto ya no existe.');
    const name = String(data.name || '').trim();
    const code = String(data.code || '').trim();
    const stock = App.utils.clampInt(data.stock, 0, 999999999);
    if (!name) throw new Error('El producto necesita un nombre.');
    if (!code) throw new Error('El código no puede estar vacío.');
    if (await codeExists(product.folderId, code, id)) throw new Error('Ya existe un producto con ese código en esta carpeta.');

    const previousImageId = product.imageId || null;
    let imageId = previousImageId;
    let newImageId = null;
    if (data.imageFile) {
      newImageId = await saveImage(data.imageFile);
      imageId = newImageId;
    }

    const updated = {
      ...product,
      name,
      code,
      codeKey: App.utils.normalize(code),
      stock,
      imageId,
      imageRotation: safeRotation(data.imageRotation ?? product.imageRotation),
      updatedAt: App.utils.now()
    };

    try {
      await App.db.put('products', updated);
      if (newImageId && previousImageId && previousImageId !== newImageId) {
        await App.db.remove('images', previousImageId);
      }
      return updated;
    } catch (error) {
      if (newImageId) await App.db.remove('images', newImageId).catch(() => {});
      console.error('Error al guardar producto actualizado:', error);
      throw error;
    }
  }

  async function remove(id) {
    const product = await get(id);
    if (!product) return;
    if (product.imageId) await App.db.remove('images', product.imageId);
    await App.db.remove('products', id);
  }

  async function changeStock(id, delta) {
    const product = await get(id);
    if (!product) throw new Error('El producto ya no existe.');
    const nextStock = Math.max(0, (Number(product.stock) || 0) + delta);
    product.stock = nextStock;
    product.updatedAt = App.utils.now();
    await App.db.put('products', product);
    return product;
  }

  async function loadImageUrl(imageId) {
    if (!imageId) return null;
    const image = await App.db.get('images', imageId);
    if (!image || !(image.blob instanceof Blob)) return null;
    return App.utils.trackObjectUrl(URL.createObjectURL(image.blob));
  }

  function sortProducts(products) {
    return manualOrder(products);
  }

  async function openImageViewer(productId) {
    const product = await get(productId);
    if (!product || !product.imageId) {
      App.ui.toast('⚠️ Esta lámina no tiene imagen.', 'warning');
      return;
    }
    const url = await loadImageUrl(product.imageId);
    if (!url) throw new Error('No se pudo abrir la imagen.');
    const rotation = safeRotation(product.imageRotation);
    const overlay = document.createElement('section');
    overlay.className = 'image-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Imagen ampliada');
    overlay.innerHTML = `
      <header class="image-lightbox__bar">
        <strong>${App.utils.escapeHtml(product.name)}</strong>
        <button type="button" class="image-lightbox__close" aria-label="Cerrar imagen">✕</button>
      </header>
      <div class="image-lightbox__stage"><img src="${url}" alt="${App.utils.escapeHtml(product.name)}"></div>
    `;
    const image = overlay.querySelector('img');
    const stage = overlay.querySelector('.image-lightbox__stage');
    const fitImage = () => {
      const w = image.naturalWidth || 1, h = image.naturalHeight || 1;
      const maxW = Math.max(1, stage.clientWidth - 20), maxH = Math.max(1, stage.clientHeight - 20);
      const swap = rotation % 180 !== 0;
      const factor = Math.min(maxW / (swap ? h : w), maxH / (swap ? w : h), 2);
      image.style.width = `${Math.round(w * factor)}px`;
      image.style.height = `${Math.round(h * factor)}px`;
      image.style.transform = `rotate(${rotation}deg)`;
    };
    const close = () => {
      window.removeEventListener('resize', fitImage);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      try { URL.revokeObjectURL(url); } catch (_) {}
      App.state.objectUrls.delete(url);
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    image.addEventListener('load', fitImage, { once: true });
    overlay.querySelector('button').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === stage) close(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fitImage);
    document.body.appendChild(overlay);
    overlay.querySelector('button').focus();
  }

  async function renderProducts(target, products, options) {
    App.utils.revokeObjectUrls();
    target.innerHTML = '';
    if (!products.length) {
      target.innerHTML = App.ui.emptyState('📦', 'No hay productos', options.isClient ? 'No hay productos para mostrar.' : 'Añade el primer producto a esta carpeta.');
      return;
    }

    for (const product of products) {
      const status = App.ui.stockStatus(product.stock, App.state.settings.lowStockLimit);
      const card = document.createElement('article');
      card.className = `product-card ${status.key === 'out' ? 'product-card--out' : ''}`;
      card.dataset.productId = product.id;
      card.innerHTML = `
        <button type="button" class="product-image-wrap" data-action="view-image" data-product-id="${product.id}" data-image-slot aria-label="Ver imagen completa de ${App.utils.escapeHtml(product.name)}">
          <div class="product-placeholder">🖼️</div>
        </button>
        <div class="product-card__body">
          <h3>${App.utils.escapeHtml(product.name)}</h3>
          <div class="product-code">${App.utils.escapeHtml(product.code)}</div>
          <div class="product-info-row">
            <div><span class="muted">Stock</span><br><span class="stock-value">${product.stock}</span></div>
            <span class="stock-badge stock-badge--${status.key}">${status.label}</span>
          </div>
          ${options.isClient ? '' : `
            <div class="product-reorder"><button type="button" class="reorder-handle" data-reorder-handle aria-label="Mantener pulsado para reordenar ${App.utils.escapeHtml(product.name)}">☰ Mover lámina</button></div>
            <div class="stock-stepper">
              <button type="button" data-action="stock-minus" data-product-id="${product.id}" aria-label="Restar stock">−</button>
              <strong>${product.stock}</strong>
              <button type="button" data-action="stock-plus" data-product-id="${product.id}" aria-label="Sumar stock">+</button>
            </div>
            <div class="product-actions">
              <button class="btn btn--secondary" type="button" data-action="edit-product" data-product-id="${product.id}">✏️ Editar</button>
              <button class="btn btn--danger" type="button" data-action="delete-product" data-product-id="${product.id}">🗑️ Eliminar</button>
            </div>
          `}
        </div>
      `;
      target.appendChild(card);

      if (product.imageId) {
        loadImageUrl(product.imageId).then((url) => {
          if (!url || !card.isConnected) return;
          const slot = card.querySelector('[data-image-slot]');
          const rotation = safeRotation(product.imageRotation);
          slot.innerHTML = `<img class="product-image ${rotation ? 'product-image--rotated' : ''}" src="${url}" alt="${App.utils.escapeHtml(product.name)}" style="--rotation:${rotation}deg;--image-scale:${rotation % 180 ? '.72' : '1'}">`;
        }).catch((error) => console.error('Error al mostrar imagen:', error));
      }
    }
  }

  function productFormHtml(product) {
    const editing = Boolean(product);
    return `
      <form id="productForm" class="form-grid">
        <div class="image-picker">
          <div class="form-row">
            <label for="productImageInput">🖼️ Imagen ${editing ? '(opcional para reemplazar)' : '(opcional)'}</label>
            <input id="productImageInput" type="file" accept="image/*">
            <p class="form-hint">Máximo recomendado: 8 MB.</p>
          </div>
          <div id="productImagePreview" class="image-preview">${editing && product.imageId ? 'Cargando imagen actual…' : 'Vista previa'}</div>
          <div class="rotation-controls">
            <button type="button" class="btn btn--secondary" data-rotate-left>↶ Girar izquierda</button>
            <button type="button" class="btn btn--secondary" data-rotate-right>↷ Girar derecha</button>
          </div>
          <p class="form-hint">La rotación se guarda sin alterar la fotografía original.</p>
        </div>
        <div class="form-row">
          <label for="productNameInput">Nombre</label>
          <input id="productNameInput" type="text" maxlength="120" value="${editing ? App.utils.escapeHtml(product.name) : ''}" required>
        </div>
        <div class="form-row">
          <label for="productCodeInput">Código / identificador</label>
          <input id="productCodeInput" type="text" maxlength="80" value="${editing ? App.utils.escapeHtml(product.code) : ''}" required>
        </div>
        <div class="form-row">
          <label for="productStockInput">Stock</label>
          <input id="productStockInput" type="number" min="0" step="1" value="${editing ? product.stock : 0}" required>
        </div>
      </form>
    `;
  }

  async function openProductModal(folderId, productId) {
    const product = productId ? await get(productId) : null;
    if (productId && !product) {
      App.ui.toast('❌ El producto ya no existe', 'error');
      return;
    }

    App.ui.openModal({
      eyebrow: 'Productos',
      title: product ? 'Editar producto' : 'Añadir producto',
      bodyHtml: productFormHtml(product),
      footerHtml: `
        <button class="btn btn--secondary" type="button" data-modal-cancel>Cancelar</button>
        <button class="btn btn--primary" type="submit" form="productForm" data-save-product>${product ? 'Guardar cambios' : 'Añadir producto'}</button>
      `,
      onReady(modal) {
        const form = modal.querySelector('#productForm');
        const imageInput = modal.querySelector('#productImageInput');
        const preview = modal.querySelector('#productImagePreview');
        const saveButton = modal.querySelector('[data-save-product]');
        modal.querySelector('[data-modal-cancel]').addEventListener('click', App.ui.closeModal);

        let preparedImage = null;
        let imagePreparing = false;
        let rotation = safeRotation(product?.imageRotation);
        let previewUrl = null;
        function refreshPreview() {
          const img = preview.querySelector('img');
          if (!img) return;
          img.style.transform = `rotate(${rotation}deg) scale(${rotation % 180 ? 0.72 : 1})`;
        }
        if (product?.imageId) {
          loadImageUrl(product.imageId).then((url) => {
            if (!url || !modal.isConnected || preparedImage) return;
            previewUrl = url;
            preview.innerHTML = `<img src="${url}" alt="Imagen actual">`;
            refreshPreview();
          }).catch(console.error);
        }
        modal.querySelector('[data-rotate-left]').addEventListener('click', () => {
          rotation = (rotation + 270) % 360;
          refreshPreview();
        });
        modal.querySelector('[data-rotate-right]').addEventListener('click', () => {
          rotation = (rotation + 90) % 360;
          refreshPreview();
        });

        imageInput.addEventListener('change', async () => {
          const file = imageInput.files?.[0];
          preparedImage = null;
          if (!file) {
            preview.textContent = product && product.imageId
              ? 'Imagen actual conservada si no eliges otra.'
              : 'Vista previa';
            return;
          }

          try {
            imagePreparing = true;
            preview.textContent = 'Preparando imagen…';
            preparedImage = await prepareImage(file);
            const dataUrl = await App.utils.blobToDataURL(preparedImage.blob);
            preview.innerHTML = `<img src="${dataUrl}" alt="Vista previa">`;
            refreshPreview();
          } catch (error) {
            console.error('Error al preparar vista previa:', error);
            preparedImage = null;
            imageInput.value = '';
            preview.textContent = 'No se pudo cargar la imagen.';
            App.ui.toast(`⚠️ ${error.message || 'No se pudo previsualizar la imagen'}`, 'warning');
          } finally {
            imagePreparing = false;
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();

          if (imagePreparing) {
            App.ui.toast('⏳ Espera un momento mientras se prepara la imagen.', 'warning');
            return;
          }

          const selectedRawFile = imageInput.files?.[0] || null;
          if (selectedRawFile && !preparedImage) {
            try {
              preparedImage = await prepareImage(selectedRawFile);
            } catch (error) {
              App.ui.toast(`⚠️ ${error.message || 'No se pudo leer la imagen'}`, 'warning');
              return;
            }
          }

          const data = {
            name: modal.querySelector('#productNameInput').value,
            code: modal.querySelector('#productCodeInput').value,
            stock: modal.querySelector('#productStockInput').value,
            imageFile: preparedImage,
            imageRotation: rotation
          };

          try {
            App.ui.setButtonBusy(saveButton, true, 'Guardando…');
            if (product) {
              await update(product.id, data);
              App.ui.toast('✅ Producto actualizado', 'success');
            } else {
              await create(folderId, data);
              App.ui.toast('✅ Producto añadido', 'success');
            }
            App.ui.closeModal();
            await App.app.refreshCurrentFolder();
          } catch (error) {
            console.error('Error al guardar producto:', error);
            const isDuplicate = /Ya existe un producto/.test(error.message || '');
            App.ui.toast(`${isDuplicate ? '⚠️' : '❌'} ${error.message || 'No se pudo guardar'}`, isDuplicate ? 'warning' : 'error');
            App.ui.setButtonBusy(saveButton, false);
          }
        });
      }
    });
  }

  async function confirmRemove(id) {
    const product = await get(id);
    if (!product) return;
    const confirmed = await App.ui.confirmDialog({
      title: 'Eliminar producto',
      message: `¿Eliminar “${product.name}”?`,
      warning: 'También se eliminará su imagen guardada.',
      confirmText: 'Eliminar'
    });
    if (!confirmed) return;

    try {
      await remove(id);
      App.ui.toast('✅ Producto eliminado', 'success');
      await App.app.refreshCurrentFolder();
    } catch (error) {
      console.error('Error al eliminar producto:', error);
      App.ui.toast('❌ No se pudo eliminar el producto', 'error');
    }
  }

  App.products = {
    listByFolder,
    ensureFolderOrder,
    setCustomOrder,
    openImageViewer,
    get,
    create,
    update,
    remove,
    changeStock,
    loadImageUrl,
    sortProducts,
    renderProducts,
    openProductModal,
    confirmRemove
  };
})();

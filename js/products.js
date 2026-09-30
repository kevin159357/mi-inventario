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

  function validateImage(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen válido.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande. Máximo 8 MB.');
  }

  async function saveImage(file) {
    if (!file) return null;
    validateImage(file);
    const newImageId = App.utils.uid('image');
    await App.db.put('images', {
      id: newImageId,
      blob: file,
      type: file.type,
      name: file.name || 'imagen',
      createdAt: App.utils.now()
    });
    return newImageId;
  }

  async function create(folderId, data) {
    const name = String(data.name || '').trim();
    const code = String(data.code || '').trim();
    const stock = App.utils.clampInt(data.stock, 0, 999999999);
    if (!name) throw new Error('El producto necesita un nombre.');
    if (!code) throw new Error('El código no puede estar vacío.');
    if (await codeExists(folderId, code, null)) throw new Error('Ya existe un producto con ese código en esta carpeta.');

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

  function sortProducts(products, sortValue) {
    const result = [...products];
    switch (sortValue) {
      case 'name-desc': return result.sort((a, b) => b.name.localeCompare(a.name, 'es', { sensitivity: 'base' }));
      case 'stock-desc': return result.sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name, 'es'));
      case 'stock-asc': return result.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'es'));
      case 'updated-desc': return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      default: return result.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    }
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
        <div class="product-image-wrap" data-image-slot>
          <div class="product-placeholder">🖼️</div>
        </div>
        <div class="product-card__body">
          <h3>${App.utils.escapeHtml(product.name)}</h3>
          <div class="product-code">${App.utils.escapeHtml(product.code)}</div>
          <div class="product-info-row">
            <div><span class="muted">Stock</span><br><span class="stock-value">${product.stock}</span></div>
            <span class="stock-badge stock-badge--${status.key}">${status.label}</span>
          </div>
          ${options.isClient ? '' : `
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
          slot.innerHTML = `<img class="product-image" src="${url}" alt="${App.utils.escapeHtml(product.name)}">`;
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
          <div id="productImagePreview" class="image-preview">${editing && product.imageId ? 'Imagen actual conservada si no eliges otra.' : 'Vista previa'}</div>
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

        imageInput.addEventListener('change', () => {
          const file = imageInput.files?.[0];
          if (!file) return;
          try {
            validateImage(file);
            const reader = new FileReader();
            reader.onload = () => { preview.innerHTML = `<img src="${reader.result}" alt="Vista previa">`; };
            reader.onerror = () => App.ui.toast('❌ No se pudo previsualizar la imagen', 'error');
            reader.readAsDataURL(file);
          } catch (error) {
            imageInput.value = '';
            App.ui.toast(`⚠️ ${error.message}`, 'warning');
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const imageFile = imageInput.files?.[0] || null;
          const data = {
            name: modal.querySelector('#productNameInput').value,
            code: modal.querySelector('#productCodeInput').value,
            stock: modal.querySelector('#productStockInput').value,
            imageFile
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

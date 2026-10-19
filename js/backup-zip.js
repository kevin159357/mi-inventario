// ========================================
// RESPALDO ZIP EN PARTES, SIN BASE64
// ZIP sin compresión: las fotografías JPEG/PNG ya están comprimidas.
// Cada parte se construye sin concatenar las imágenes en una cadena gigante.
// ========================================
(function () {
  'use strict';
  const App = window.InventoryApp;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const LIMIT = 32 * 1024 * 1024; // partes pequeñas para tablets
  const MAX_ENTRIES = 180;
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  async function crc32(blob) {
    let crc = 0xFFFFFFFF;
    for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
      for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTimeDate() {
    const date = new Date();
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const stamp = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return [time, stamp];
  }

  async function zipParts(entries) {
    const items = [];
    const parts = [];
    let position = 0;
    const [time, date] = dosTimeDate();
    for (const entry of entries) {
      const name = encoder.encode(entry.path);
      const blob = entry.blob;
      if (blob.size > 0xFFFFFFFF) throw new Error('Una imagen supera el límite del formato ZIP.');
      const checksum = await crc32(blob);
      const local = new Uint8Array(30 + name.length);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true); // nombres UTF-8
      view.setUint16(8, 0, true); // sin compresión
      view.setUint16(10, time, true);
      view.setUint16(12, date, true);
      view.setUint32(14, checksum, true);
      view.setUint32(18, blob.size, true);
      view.setUint32(22, blob.size, true);
      view.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, blob);
      items.push({ name, size: blob.size, checksum, offset: position });
      position += local.length + blob.size;
    }
    const centralOffset = position;
    for (const item of items) {
      const central = new Uint8Array(46 + item.name.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, time, true);
      view.setUint16(14, date, true);
      view.setUint32(16, item.checksum, true);
      view.setUint32(20, item.size, true);
      view.setUint32(24, item.size, true);
      view.setUint16(28, item.name.length, true);
      view.setUint32(42, item.offset, true);
      central.set(item.name, 46);
      parts.push(central);
      position += central.length;
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, items.length, true);
    view.setUint16(10, items.length, true);
    view.setUint32(12, position - centralOffset, true);
    view.setUint32(16, centralOffset, true);
    parts.push(end);
    return new Blob(parts, { type: 'application/zip' });
  }

  async function preparePlan() {
    const [folders, products, infos] = await Promise.all([
      App.db.getAll('folders'), App.db.getAll('products'), App.db.getImageInfoList()
    ]);
    const groups = [[]];
    let groupBytes = 0;
    for (const item of infos) {
      if (!item.size) throw new Error(`La imagen ${item.id} está vacía o dañada.`);
      let group = groups[groups.length - 1];
      if (group.length && (groupBytes + item.size > LIMIT || group.length >= MAX_ENTRIES)) {
        group = [];
        groups.push(group);
        groupBytes = 0;
      }
      item.part = groups.length;
      group.push(item);
      groupBytes += item.size;
    }
    return {
      groups,
      manifest: {
        format: 'mi-inventario-zip-partes', version: 2,
        backupId: App.utils.uid('respaldo'), appVersion: App.VERSION,
        exportedAt: App.utils.now(), partCount: groups.length,
        settings: { ...App.state.settings }, folders, products, images: infos
      }
    };
  }

  async function buildPart(plan, index) {
    const partNo = index + 1;
    const meta = index === 0 ? plan.manifest : {
      format: plan.manifest.format, version: 2,
      backupId: plan.manifest.backupId, part: partNo, partCount: plan.groups.length
    };
    const entries = [{
      path: index === 0 ? 'inventario.json' : 'parte.json',
      blob: new Blob([JSON.stringify(meta)], { type: 'application/json' })
    }];
    for (const info of plan.groups[index]) {
      const row = await App.db.get('images', info.id);
      if (!row || !(row.blob instanceof Blob)) throw new Error(`Falta la imagen ${info.id}.`);
      if (row.blob.size !== info.size) throw new Error(`La imagen ${info.id} cambió durante el respaldo. Vuelve a empezar.`);
      entries.push({ path: `imagenes/${encodeURIComponent(String(info.id))}.bin`, blob: row.blob });
    }
    return zipParts(entries);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // No revocar inmediatamente; Android a veces inicia la descarga después.
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function openZipBackupModal() {
    const plan = await preparePlan();
    let nextPart = 0;
    const date = new Date().toISOString().slice(0, 10);
    App.ui.openModal({
      eyebrow: 'Copia de seguridad segura',
      title: 'Exportar inventario en ZIP',
      bodyHtml: `
        <p>La copia incluye carpetas, productos, stock, orden, rotación, imágenes y configuración.</p>
        <div class="backup-status" id="backupStatus">
          <strong>${plan.manifest.products.length} láminas</strong> · ${plan.manifest.images.length} imágenes ·
          <strong>${plan.groups.length} archivo${plan.groups.length === 1 ? '' : 's'} ZIP</strong>.
          <p><strong>Importante:</strong> descarga y conserva TODAS las partes en la misma carpeta.
          No borres los datos originales hasta comprobar tu respaldo.</p>
        </div>`,
      footerHtml: `<button class="btn btn--secondary" type="button" data-zip-close>Cerrar</button>
        <button class="btn btn--primary" type="button" data-zip-next>⬇️ Descargar parte 1 de ${plan.groups.length}</button>`,
      closeOnBackdrop: false,
      onReady(modal) {
        const button = modal.querySelector('[data-zip-next]');
        const status = modal.querySelector('#backupStatus');
        modal.querySelector('[data-zip-close]').addEventListener('click', App.ui.closeModal);
        button.addEventListener('click', async () => {
          if (nextPart >= plan.groups.length) return;
          const index = nextPart;
          try {
            App.ui.setButtonBusy(button, true, `Preparando parte ${index + 1}…`);
            status.textContent = `Preparando la parte ${index + 1}/${plan.groups.length}. Mantén abierta esta página.`;
            const zip = await buildPart(plan, index);
            if (!modal.isConnected) return;
            const filename = `inventario-${date}-parte-${String(index + 1).padStart(3, '0')}-de-${String(plan.groups.length).padStart(3, '0')}.zip`;
            triggerDownload(zip, filename);
            nextPart += 1;
            status.textContent = `Descarga iniciada: ${filename} (${(zip.size / (1024 * 1024)).toFixed(1)} MB). Comprueba que aparezca en Descargas.`;
            App.ui.setButtonBusy(button, false);
            if (nextPart < plan.groups.length) {
              button.textContent = `⬇️ Descargar parte ${nextPart + 1} de ${plan.groups.length}`;
            } else {
              button.disabled = true;
              button.textContent = '✅ Todas las partes preparadas';
              status.textContent += ' Conserva todas las partes y prueba a restaurar en una instalación de prueba.';
            }
          } catch (error) {
            console.error('Error al exportar ZIP:', error);
            status.textContent = `❌ ${error.message || 'No se pudo preparar la parte'}. No borres los datos originales.`;
            App.ui.setButtonBusy(button, false);
          }
        });
      }
    });
  }

  async function zipIndex(file) {
    const n = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - n).arrayBuffer());
    let end = -1;
    for (let i = n - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end === -1) throw new Error(`${file.name}: ZIP incompleto.`);
    const length = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    const count = tail.getUint16(end + 10, true);
    if (length > 10 * 1024 * 1024 || offset + length > file.size || count > 10000) throw new Error('Índice ZIP inválido.');
    const data = new DataView(await file.slice(offset, offset + length).arrayBuffer());
    const entries = new Map();
    let position = 0;
    for (let k = 0; k < count; k++) {
      if (position + 46 > data.byteLength || data.getUint32(position, true) !== 0x02014b50) throw new Error('Índice ZIP dañado.');
      const method = data.getUint16(position + 10, true);
      const checksum = data.getUint32(position + 16, true);
      const compressed = data.getUint32(position + 20, true);
      const size = data.getUint32(position + 24, true);
      const nameLen = data.getUint16(position + 28, true);
      const extraLen = data.getUint16(position + 30, true);
      const commentLen = data.getUint16(position + 32, true);
      const localOffset = data.getUint32(position + 42, true);
      if (position + 46 + nameLen + extraLen + commentLen > data.byteLength) throw new Error('ZIP truncado.');
      const name = decoder.decode(new Uint8Array(data.buffer, position + 46, nameLen));
      if (method !== 0 || compressed !== size) throw new Error('Este ZIP usa una compresión no compatible.');
      if (entries.has(name)) throw new Error('El ZIP tiene entradas duplicadas.');
      entries.set(name, { size, checksum, localOffset, file });
      position += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryBlob(index, name) {
    const row = index.get(name);
    if (!row) throw new Error(`Falta ${name} en una de las partes del respaldo.`);
    const header = new DataView(await row.file.slice(row.localOffset, row.localOffset + 30).arrayBuffer());
    if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error('Cabecera ZIP dañada.');
    const start = row.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    if (start + row.size > row.file.size) throw new Error('Archivo ZIP cortado.');
    return row.file.slice(start, start + row.size);
  }

  async function readJson(index, name) {
    const blob = await entryBlob(index, name);
    if (blob.size > 12 * 1024 * 1024 || await crc32(blob) !== index.get(name).checksum) {
      throw new Error(`Metadatos dañados: ${name}.`);
    }
    try { return JSON.parse(await blob.text()); }
    catch (_) { throw new Error(`${name} no contiene un JSON válido.`); }
  }

  function checkManifest(meta) {
    if (!meta || meta.format !== 'mi-inventario-zip-partes' || meta.version !== 2 ||
        !meta.backupId || !Number.isInteger(meta.partCount) || meta.partCount < 1 ||
        !Array.isArray(meta.images) || !Array.isArray(meta.products) || !Array.isArray(meta.folders) ||
        !meta.settings?.adminPasswordHash) throw new Error('Respaldo ZIP inválido o incompleto.');
    const ids = new Set();
    for (const f of meta.folders) {
      if (!f.id || !String(f.name || '').trim() || ids.has(f.id)) throw new Error('Carpetas inválidas en respaldo.');
      ids.add(f.id);
    }
    const products = new Set(), codes = new Set();
    for (const p of meta.products) {
      if (!p.id || products.has(p.id) || !ids.has(p.folderId) || !String(p.name || '').trim() || !String(p.code || '').trim()) throw new Error('Productos inválidos en el respaldo.');
      products.add(p.id);
      const key = `${p.folderId}::${App.utils.normalize(p.code)}`;
      if (codes.has(key)) throw new Error('Códigos de lámina duplicados.');
      codes.add(key);
      p.codeKey = App.utils.normalize(p.code);
      p.stock = Math.max(0, parseInt(p.stock, 10) || 0);
    }
    const images = new Set();
    for (const item of meta.images) {
      if (!item.id || images.has(item.id) || !Number.isInteger(item.part) || item.part < 1 || item.part > meta.partCount ||
        !(item.size > 0) || item.size > 1024 * 1024 * 512) throw new Error('Imágenes inválidas en respaldo.');
      images.add(item.id);
    }
    for (const p of meta.products) {
      if (p.imageId && !images.has(p.imageId)) throw new Error('Faltan imágenes asociadas a láminas.');
    }
    if (!/^[a-f0-9]{64}$/i.test(meta.settings.adminPasswordHash)) throw new Error('Contraseña guardada inválida.');
    if (meta.settings.clientFolderId && !ids.has(meta.settings.clientFolderId)) meta.settings.clientFolderId = null;
    meta.settings = {
      ...App.DEFAULT_SETTINGS, ...meta.settings,
      lowStockLimit: App.utils.clampInt(meta.settings.lowStockLimit, 0, 999999),
      autoClientMode: Boolean(meta.settings.autoClientMode)
    };
  }

  async function inspectZipFiles(files) {
    if (!files.length || files.some((file) => !/\.zip$/i.test(file.name))) {
      throw new Error('Selecciona todos los ZIP de una misma copia de seguridad.');
    }
    const indexes = await Promise.all(files.map(async (file) => ({ file, index: await zipIndex(file) })));
    const first = indexes.find((p) => p.index.has('inventario.json'));
    if (!first) throw new Error('Falta la parte 001 del respaldo, que contiene inventario.json.');
    const manifest = await readJson(first.index, 'inventario.json');
    checkManifest(manifest);
    const lookup = new Map([[1, first.index]]);
    for (const item of indexes) {
      if (item === first) continue;
      const info = await readJson(item.index, 'parte.json');
      if (info.format !== manifest.format || info.version !== 2 || info.backupId !== manifest.backupId ||
          info.partCount !== manifest.partCount || !Number.isInteger(info.part) || info.part < 2 || info.part > manifest.partCount ||
          lookup.has(info.part)) throw new Error('Hay partes duplicadas o de copias distintas.');
      lookup.set(info.part, item.index);
    }
    if (lookup.size !== manifest.partCount) throw new Error(`Seleccionaste ${lookup.size} de ${manifest.partCount} partes. Selecciónalas todas juntas.`);
    for (const info of manifest.images) {
      const entry = lookup.get(info.part)?.get(`imagenes/${encodeURIComponent(String(info.id))}.bin`);
      if (!entry || entry.size !== info.size) throw new Error(`Falta la imagen ${info.id} en el respaldo.`);
    }
    return { manifest, lookup };
  }

  async function handleZipFiles(files) {
    const { manifest, lookup } = await inspectZipFiles(files);
    const yes = await App.ui.confirmDialog({
      title: 'Restaurar respaldo ZIP',
      message: `Se verificaron ${manifest.partCount} partes. Incluyen ${manifest.folders.length} carpetas, ${manifest.products.length} láminas y ${manifest.images.length} imágenes.`,
      warning: 'ATENCIÓN: restaurar REEMPLAZARÁ los datos actuales. Hazlo primero en una instalación de prueba.',
      confirmText: 'Sí, reemplazar datos'
    });
    if (!yes) return;
    App.ui.toast('⏳ Importando imágenes. No cierres la aplicación.', 'warning');
    await App.db.clear('restoreStageImages');
    for (let i = 0; i < manifest.images.length; i++) {
      const info = manifest.images[i];
      const index = lookup.get(info.part);
      const filename = `imagenes/${encodeURIComponent(String(info.id))}.bin`;
      const imageBlob = await entryBlob(index, filename);
      if (await crc32(imageBlob) !== index.get(filename).checksum) {
        throw new Error(`La imagen ${info.id} está dañada. No se modificaron tus datos anteriores.`);
      }
      // Recrear Blob estable: Android puede invalidar Blobs ligados al selector de archivos.
      const stable = new Blob([await imageBlob.arrayBuffer()], { type: info.type || 'image/jpeg' });
      await App.db.put('restoreStageImages', {
        id: info.id, blob: stable, type: info.type || 'image/jpeg',
        name: info.name || 'imagen', createdAt: info.createdAt || App.utils.now()
      });
      if (i % 50 === 0 && i > 0) console.info(`Restaurando imagen ${i}/${manifest.images.length}`);
    }
    await App.db.commitStagedRestore(manifest);
    App.state.settings = manifest.settings;
    App.state.currentFolderId = null;
    App.utils.revokeObjectUrls();
    App.app.applyBranding();
    App.state.currentMode = 'admin';
    App.ui.showScreen('adminScreen');
    await App.app.refreshAdmin();
    App.ui.toast(`✅ Restauración completa: ${manifest.products.length} láminas`, 'success');
  }

  // Inspección de todas las partes e integridad CRC sin tocar IndexedDB.
  async function verifyZipFiles(files) {
    App.ui.openModal({
      eyebrow: 'Validación segura',
      title: 'Comprobar copia de seguridad',
      bodyHtml: '<div class="backup-status" id="verifyBackupStatus" role="status">Revisando archivos ZIP… No cierres esta ventana.</div>',
      footerHtml: '<button class="btn btn--secondary" type="button" data-verify-close>Cerrar</button>',
      closeOnBackdrop: false,
      onReady(modal) {
        modal.querySelector('[data-verify-close]').addEventListener('click', App.ui.closeModal);
        (async () => {
          const status = modal.querySelector('#verifyBackupStatus');
          const { manifest, lookup } = await inspectZipFiles(files);
          status.textContent = `Copia encontrada: ${manifest.folders.length} carpetas, ${manifest.products.length} láminas y ${manifest.images.length} imágenes. Verificando integridad…`;
          for (let i = 0; i < manifest.images.length; i++) {
            if (!modal.isConnected) return; // El usuario canceló la verificación.
            const info = manifest.images[i];
            const name = `imagenes/${encodeURIComponent(String(info.id))}.bin`;
            const index = lookup.get(info.part);
            const blob = await entryBlob(index, name);
            if (await crc32(blob) !== index.get(name).checksum) {
              throw new Error(`La imagen ${info.name || info.id} está dañada.`);
            }
            if (i % 25 === 0 || i + 1 === manifest.images.length) {
              status.textContent = `Comprobando imagen ${i + 1} de ${manifest.images.length}… Mantén abierta esta ventana.`;
            }
          }
          if (!modal.isConnected) return;
          status.innerHTML = `<strong>✅ Respaldo comprobado correctamente.</strong>
            <p>${manifest.folders.length} carpetas · ${manifest.products.length} láminas · ${manifest.images.length} imágenes · ${manifest.partCount} parte(s).</p>
            <p>Se verificó la integridad de los archivos ZIP. <strong>No se reemplazó ningún dato.</strong> Conserva TODAS las partes y realiza una restauración de prueba antes de actualizar la tablet original.</p>`;
        })().catch((error) => {
          console.error('Error al verificar copia de seguridad:', error);
          if (!modal.isConnected) return;
          modal.querySelector('#verifyBackupStatus').textContent = `❌ No se pudo verificar: ${error.message || 'ZIP incompleto o dañado'}. No borres ningún dato.`;
        });
      }
    });
  }

  function chooseVerifyFiles() {
    const input = App.ui.el('verifyBackupFileInput');
    if (!input) return;
    input.value = '';
    input.click();
  }

  function bindVerifyInput() {
    const input = App.ui.el('verifyBackupFileInput');
    if (!input) return;
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (!files.length) return;
      await verifyZipFiles(files);
    });
  }

  App.backup.chooseVerifyFiles = chooseVerifyFiles;
  App.backup.bindVerifyInput = bindVerifyInput;
  App.backup.verifyZipFiles = verifyZipFiles;
  App.backup.openZipBackupModal = openZipBackupModal;
  App.backup.handleZipFiles = handleZipFiles;
})();

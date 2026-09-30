// ========================================
// BASE DE DATOS - INDEXEDDB
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;
  let db = null;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error de IndexedDB.'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('La transacción falló.'));
      transaction.onabort = () => reject(transaction.error || new Error('La transacción fue cancelada.'));
    });
  }

  async function open() {
    if (db) return db;

    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(App.DB_NAME, App.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        const upgradeTx = event.target.transaction;

        // IMPORTANTE: esta migración no borra datos anteriores.
        // La versión 2 repara instalaciones donde ya existía una base
        // "MiInventarioDB" con una estructura antigua o incompleta.

        let foldersStore;
        if (!database.objectStoreNames.contains('folders')) {
          foldersStore = database.createObjectStore('folders', { keyPath: 'id' });
        } else {
          foldersStore = upgradeTx.objectStore('folders');
        }
        if (!foldersStore.indexNames.contains('name')) {
          foldersStore.createIndex('name', 'name', { unique: false });
        }
        if (!foldersStore.indexNames.contains('createdAt')) {
          foldersStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        let productsStore;
        if (!database.objectStoreNames.contains('products')) {
          productsStore = database.createObjectStore('products', { keyPath: 'id' });
        } else {
          productsStore = upgradeTx.objectStore('products');
        }
        if (!productsStore.indexNames.contains('folderId')) {
          productsStore.createIndex('folderId', 'folderId', { unique: false });
        }
        if (!productsStore.indexNames.contains('folderCodeKey')) {
          productsStore.createIndex('folderCodeKey', ['folderId', 'codeKey'], { unique: true });
        }
        if (!productsStore.indexNames.contains('updatedAt')) {
          productsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!database.objectStoreNames.contains('images')) {
          database.createObjectStore('images', { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains('config')) {
          database.createObjectStore('config', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
      request.onblocked = () => reject(new Error('Hay otra pestaña de Mi Inventario abierta con una versión anterior. Ciérrala y vuelve a abrir esta página.'));
    });

    db.onversionchange = () => {
      db.close();
      db = null;
    };

    return db;
  }

  function getDb() {
    if (!db) throw new Error('La base de datos aún no está inicializada.');
    return db;
  }

  async function get(storeName, key) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readonly');
    const result = await requestToPromise(tx.objectStore(storeName).get(key));
    await transactionDone(tx);
    return result;
  }

  async function getAll(storeName) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readonly');
    const result = await requestToPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return result;
  }

  async function put(storeName, value) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).put(value));
    await transactionDone(tx);
    return value;
  }

  async function add(storeName, value) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).add(value));
    await transactionDone(tx);
    return value;
  }

  async function remove(storeName, key) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).delete(key));
    await transactionDone(tx);
  }

  async function clear(storeName) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).clear());
    await transactionDone(tx);
  }

  async function getAllByIndex(storeName, indexName, query) {
    const database = getDb();
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const result = await requestToPromise(index.getAll(query));
    await transactionDone(tx);
    return result;
  }

  async function getConfig(key) {
    const row = await get('config', key);
    return row ? row.value : undefined;
  }

  async function setConfig(key, value) {
    await put('config', { key, value });
    return value;
  }

  async function initializeDefaults() {
    let settings = await getConfig('settings');
    if (!settings) {
      settings = { ...App.DEFAULT_SETTINGS };
    } else {
      settings = { ...App.DEFAULT_SETTINGS, ...settings };
    }

    if (!settings.adminPasswordHash) {
      settings.adminPasswordHash = await App.utils.sha256('1234');
    }

    settings.lowStockLimit = App.utils.clampInt(settings.lowStockLimit, 0, 999999);
    settings.autoClientMode = Boolean(settings.autoClientMode);
    await setConfig('settings', settings);
    App.state.settings = settings;
    return settings;
  }

  async function replaceAllData(payload) {
    const database = getDb();
    const tx = database.transaction(['folders', 'products', 'images', 'config'], 'readwrite');
    const folders = tx.objectStore('folders');
    const products = tx.objectStore('products');
    const images = tx.objectStore('images');
    const config = tx.objectStore('config');

    // Todas las operaciones se encolan sin pausas para mantener activa
    // la misma transacción y hacer la restauración de forma atómica.
    folders.clear();
    products.clear();
    images.clear();
    config.clear();

    (payload.folders || []).forEach((item) => folders.put(item));
    (payload.products || []).forEach((item) => products.put(item));
    (payload.images || []).forEach((item) => images.put(item));
    config.put({ key: 'settings', value: payload.settings });

    await transactionDone(tx);
  }

  App.db = {
    open,
    get,
    getAll,
    put,
    add,
    remove,
    clear,
    getAllByIndex,
    getConfig,
    setConfig,
    initializeDefaults,
    replaceAllData
  };
})();

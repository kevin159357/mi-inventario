// ========================================
// NAMESPACE GLOBAL Y UTILIDADES
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp = window.InventoryApp || {};

  App.VERSION = '1.0.1';
  App.DB_NAME = 'MiInventarioDB';
  App.DB_VERSION = 2;
  App.DEFAULT_SETTINGS = {
    appName: 'Mi Inventario',
    lowStockLimit: 5,
    clientFolderId: null,
    autoClientMode: false,
    adminPasswordHash: null
  };

  App.state = {
    initialized: false,
    currentMode: 'loading',
    currentFolderId: null,
    settings: null,
    objectUrls: new Set()
  };

  App.utils = {
    uid(prefix) {
      if (window.crypto && typeof crypto.randomUUID === 'function') {
        return `${prefix || 'id'}-${crypto.randomUUID()}`;
      }
      return `${prefix || 'id'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    },

    now() {
      return new Date().toISOString();
    },

    normalize(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    },

    escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
      }[char]));
    },

    formatDate(iso) {
      if (!iso) return '—';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('es-EC', {
        year: 'numeric', month: 'short', day: '2-digit'
      }).format(date);
    },

    clampInt(value, min, max) {
      const number = Number.parseInt(value, 10);
      if (!Number.isFinite(number)) return min;
      return Math.min(max, Math.max(min, number));
    },

    async sha256(text) {
      if (!window.crypto || !window.crypto.subtle) {
        throw new Error('Web Crypto API no está disponible en este navegador.');
      }
      const data = new TextEncoder().encode(String(text));
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },

    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(blob);
      });
    },

    dataURLToBlob(dataURL) {
      const parts = String(dataURL).split(',');
      if (parts.length !== 2) throw new Error('DataURL inválido.');
      const mimeMatch = parts[0].match(/data:(.*?);base64/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    },

    trackObjectUrl(url) {
      if (url) App.state.objectUrls.add(url);
      return url;
    },

    revokeObjectUrls() {
      App.state.objectUrls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (error) { console.warn(error); }
      });
      App.state.objectUrls.clear();
    }
  };
})();

// ========================================
// CONFIGURACIÓN Y CONTRASEÑA
// ========================================
(function () {
  'use strict';

  const App = window.InventoryApp;

  async function saveSettings(nextSettings) {
    const normalized = {
      ...App.state.settings,
      ...nextSettings,
      appName: String(nextSettings.appName ?? App.state.settings.appName).trim() || 'Mi Inventario',
      lowStockLimit: App.utils.clampInt(nextSettings.lowStockLimit ?? App.state.settings.lowStockLimit, 0, 999999),
      clientFolderId: nextSettings.clientFolderId || null,
      autoClientMode: Boolean(nextSettings.autoClientMode)
    };
    await App.db.setConfig('settings', normalized);
    App.state.settings = normalized;
    return normalized;
  }

  async function verifyPassword(password) {
    const hash = await App.utils.sha256(password);
    return hash === App.state.settings.adminPasswordHash;
  }

  async function changePassword(currentPassword, newPassword, confirmPassword) {
    if (!(await verifyPassword(currentPassword))) throw new Error('La contraseña actual es incorrecta.');
    if (String(newPassword).length < 4) throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    if (newPassword !== confirmPassword) throw new Error('La confirmación no coincide con la nueva contraseña.');
    const adminPasswordHash = await App.utils.sha256(newPassword);
    await saveSettings({ adminPasswordHash });
  }

  async function openSettingsModal() {
    const folders = await App.folders.list();
    const settings = App.state.settings;
    const folderOptions = [
      '<option value="">— Sin carpeta asignada —</option>',
      ...folders.map((folder) => `<option value="${folder.id}" ${settings.clientFolderId === folder.id ? 'selected' : ''}>${App.utils.escapeHtml(folder.name)}</option>`)
    ].join('');

    App.ui.openModal({
      eyebrow: 'Administrador',
      title: 'Configuración',
      bodyHtml: `
        <form id="settingsForm" class="form-grid">
          <h3 class="settings-title">General</h3>
          <div class="form-row">
            <label for="settingsAppName">Nombre de la aplicación</label>
            <input id="settingsAppName" type="text" maxlength="80" value="${App.utils.escapeHtml(settings.appName)}" required>
          </div>

          <div class="divider"></div>
          <h3 class="settings-title">Stock</h3>
          <div class="form-row">
            <label for="settingsLowStock">Límite de stock bajo</label>
            <input id="settingsLowStock" type="number" min="0" step="1" value="${settings.lowStockLimit}" required>
            <p class="form-hint">De 1 hasta este número se mostrará STOCK BAJO; 0 siempre será SIN STOCK.</p>
          </div>

          <div class="divider"></div>
          <h3 class="settings-title">Cliente</h3>
          <div class="form-row">
            <label for="settingsClientFolder">Carpeta visible para el cliente</label>
            <select id="settingsClientFolder">${folderOptions}</select>
          </div>
          <label class="checkbox-row" for="settingsAutoClient">
            <span><strong>Iniciar automáticamente en modo cliente</strong><br><span class="form-hint">Solo funciona si existe una carpeta asignada.</span></span>
            <input id="settingsAutoClient" type="checkbox" ${settings.autoClientMode ? 'checked' : ''}>
          </label>

          <div class="divider"></div>
          <h3 class="settings-title">Copia de seguridad</h3>
          <div class="stack">
            <button class="btn btn--secondary btn--block" type="button" data-settings-backup>💾 Crear copia de seguridad</button>
            <button class="btn btn--secondary btn--block" type="button" data-settings-restore>📥 Restaurar copia de seguridad</button>
          </div>

          <div class="divider"></div>
          <h3 class="settings-title">Cambiar contraseña</h3>
          <div class="form-row">
            <label for="currentPassword">Contraseña actual</label>
            <div class="password-field">
              <input id="currentPassword" type="password" autocomplete="current-password">
              <button type="button" data-toggle-password="#currentPassword" aria-label="Mostrar contraseña">👁️</button>
            </div>
          </div>
          <div class="form-row">
            <label for="newPassword">Nueva contraseña</label>
            <div class="password-field">
              <input id="newPassword" type="password" minlength="4" autocomplete="new-password">
              <button type="button" data-toggle-password="#newPassword" aria-label="Mostrar contraseña">👁️</button>
            </div>
          </div>
          <div class="form-row">
            <label for="confirmPassword">Confirmar nueva contraseña</label>
            <div class="password-field">
              <input id="confirmPassword" type="password" minlength="4" autocomplete="new-password">
              <button type="button" data-toggle-password="#confirmPassword" aria-label="Mostrar contraseña">👁️</button>
            </div>
          </div>
          <button class="btn btn--dark btn--block" type="button" data-change-password>🔑 Cambiar contraseña</button>
        </form>
      `,
      footerHtml: `
        <button class="btn btn--secondary" type="button" data-modal-cancel>Cerrar</button>
        <button class="btn btn--primary" type="submit" form="settingsForm" data-save-settings>Guardar configuración</button>
      `,
      onReady(modal) {
        const form = modal.querySelector('#settingsForm');
        const saveButton = modal.querySelector('[data-save-settings]');
        modal.querySelector('[data-modal-cancel]').addEventListener('click', App.ui.closeModal);

        modal.querySelectorAll('[data-toggle-password]').forEach((button) => {
          button.addEventListener('click', () => {
            const input = modal.querySelector(button.dataset.togglePassword);
            if (input) App.ui.togglePassword(input, button);
          });
        });

        modal.querySelector('[data-settings-backup]').addEventListener('click', async () => {
          try { await App.backup.download(); }
          catch (error) {
            console.error('Error al crear backup:', error);
            App.ui.toast('❌ No se pudo crear la copia de seguridad', 'error');
          }
        });

        modal.querySelector('[data-settings-restore]').addEventListener('click', () => {
          App.ui.closeModal();
          App.backup.chooseRestoreFile();
        });

        modal.querySelector('[data-change-password]').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          try {
            App.ui.setButtonBusy(button, true, 'Cambiando…');
            await changePassword(
              modal.querySelector('#currentPassword').value,
              modal.querySelector('#newPassword').value,
              modal.querySelector('#confirmPassword').value
            );
            modal.querySelector('#currentPassword').value = '';
            modal.querySelector('#newPassword').value = '';
            modal.querySelector('#confirmPassword').value = '';
            App.ui.toast('✅ Contraseña actualizada', 'success');
          } catch (error) {
            console.error('Error al cambiar contraseña:', error);
            App.ui.toast(`❌ ${error.message || 'No se pudo cambiar la contraseña'}`, 'error');
          } finally {
            App.ui.setButtonBusy(button, false);
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            App.ui.setButtonBusy(saveButton, true, 'Guardando…');
            await saveSettings({
              appName: modal.querySelector('#settingsAppName').value,
              lowStockLimit: modal.querySelector('#settingsLowStock').value,
              clientFolderId: modal.querySelector('#settingsClientFolder').value || null,
              autoClientMode: modal.querySelector('#settingsAutoClient').checked
            });
            App.ui.closeModal();
            App.ui.toast('✅ Configuración guardada', 'success');
            App.app.applyBranding();
            await App.app.refreshAdmin();
          } catch (error) {
            console.error('Error al guardar configuración:', error);
            App.ui.toast('❌ No se pudo guardar la configuración', 'error');
            App.ui.setButtonBusy(saveButton, false);
          }
        });
      }
    });
  }

  App.settings = {
    saveSettings,
    verifyPassword,
    changePassword,
    openSettingsModal
  };
})();

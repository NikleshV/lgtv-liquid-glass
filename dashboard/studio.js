(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var tvFrame = $('tvPreviewFrame');
  var consoleLog = $('consoleLog');

  var currentConfig = null;
  var currentInventory = { apps: [], inputs: [] };

  function logLine(msg) {
    var ts = new Date().toLocaleTimeString();
    consoleLog.textContent += '\n[' + ts + '] ' + msg;
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  $('btnClearLog').addEventListener('click', function () {
    consoleLog.textContent = 'Log cleared.';
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      $(targetId).classList.add('active');
    });
  });

  // Virtual Remote Key Injection into Live TV Preview iframe
  function sendKeyToPreview(keyCode) {
    try {
      var win = tvFrame.contentWindow;
      var doc = tvFrame.contentDocument || win.document;
      var down = new win.KeyboardEvent('keydown', { keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
      var up = new win.KeyboardEvent('keyup', { keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
      doc.dispatchEvent(down);
      setTimeout(function () { doc.dispatchEvent(up); }, 60);
    } catch (e) {}
  }

  document.querySelectorAll('.remote-btn[data-key]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      sendKeyToPreview(Number(btn.getAttribute('data-key')));
    });
  });

  $('btnRemoteHoldOk').addEventListener('click', function () {
    try {
      var win = tvFrame.contentWindow;
      var doc = tvFrame.contentDocument || win.document;
      var down = new win.KeyboardEvent('keydown', { keyCode: 13, which: 13, bubbles: true, cancelable: true });
      doc.dispatchEvent(down);
      setTimeout(function () {
        var up = new win.KeyboardEvent('keyup', { keyCode: 13, which: 13, bubbles: true, cancelable: true });
        doc.dispatchEvent(up);
      }, 650);
    } catch (e) {}
  });

  $('btnSimScreensaver').addEventListener('click', function () {
    try {
      if (tvFrame.contentWindow && tvFrame.contentWindow.LiquidGlassLauncher) {
        tvFrame.contentWindow.LiquidGlassLauncher.triggerScreensaver();
      }
    } catch (e) {}
  });

  $('btnSimDebloat').addEventListener('click', function () {
    try {
      if (tvFrame.contentWindow && tvFrame.contentWindow.LiquidGlassLauncher) {
        tvFrame.contentWindow.LiquidGlassLauncher.openDebloatWizard();
      }
    } catch (e) {}
  });

  $('btnSimReload').addEventListener('click', function () {
    tvFrame.contentWindow.location.reload();
  });

  // Load initial config & app inventory
  function fetchStudioState() {
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        currentConfig = data.config || {};
        currentInventory = data.inventory || { apps: [], inputs: [] };
        populateUiControls();
      })
      .catch(function (err) {
        logLine('Could not load config: ' + err);
      });
  }

  function populateUiControls() {
    if (!currentConfig) return;
    $('selectTheme').value = currentConfig.theme || 'aurora';
    $('selectColumns').value = String(currentConfig.columns || 6);
    $('inputGreetingName').value = currentConfig.greetingName || '';
    $('inputScreensaverMins').value = String(currentConfig.screensaverMinutes || 4);
    $('chkHeroShelf').checked = currentConfig.showHeroShelf !== false;
    $('chkAutoRenew').checked = currentConfig.autoRenewDevMode !== false;

    renderAppsEditor();
    renderBloatwareTags();
  }

  function renderAppsEditor() {
    var container = $('dockAppsEditor');
    container.innerHTML = '';
    var apps = (currentInventory && currentInventory.apps) || [];
    var hidden = currentConfig.hiddenApps || [];
    var dockOrder = currentConfig.dockApps || [];

    var sorted = apps.slice().sort(function (a, b) {
      var ia = dockOrder.indexOf(a.id);
      var ib = dockOrder.indexOf(b.id);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

    sorted.forEach(function (app, index) {
      var isHidden = hidden.indexOf(app.id) !== -1;
      var row = document.createElement('div');
      row.className = 'app-edit-row';
      row.innerHTML =
        '<div><strong>' + escapeHtml(app.title) + '</strong> <span style="color:#64748b;font-size:11.5px;">(' + escapeHtml(app.id) + ')</span></div>' +
        '<div class="app-edit-controls">' +
          '<button type="button" class="chip-btn" data-act="up">↑</button>' +
          '<button type="button" class="chip-btn" data-act="down">↓</button>' +
          '<button type="button" class="chip-btn" data-act="toggle">' + (isHidden ? 'Hidden' : 'Visible') + '</button>' +
        '</div>';

      row.querySelector('[data-act="up"]').addEventListener('click', function () {
        if (index <= 0) return;
        var ids = sorted.map(function (x) { return x.id; });
        var tmp = ids[index - 1];
        ids[index - 1] = ids[index];
        ids[index] = tmp;
        currentConfig.dockApps = ids;
        renderAppsEditor();
        syncPreviewConfig();
      });

      row.querySelector('[data-act="down"]').addEventListener('click', function () {
        if (index >= sorted.length - 1) return;
        var ids = sorted.map(function (x) { return x.id; });
        var tmp = ids[index + 1];
        ids[index + 1] = ids[index];
        ids[index] = tmp;
        currentConfig.dockApps = ids;
        renderAppsEditor();
        syncPreviewConfig();
      });

      row.querySelector('[data-act="toggle"]').addEventListener('click', function () {
        var idx = currentConfig.hiddenApps.indexOf(app.id);
        if (idx !== -1) currentConfig.hiddenApps.splice(idx, 1);
        else currentConfig.hiddenApps.push(app.id);
        renderAppsEditor();
        renderBloatwareTags();
        syncPreviewConfig();
      });

      container.appendChild(row);
    });
  }

  function renderBloatwareTags() {
    var box = $('bloatwareTags');
    box.innerHTML = '';
    (currentConfig.hiddenApps || []).forEach(function (id) {
      var span = document.createElement('span');
      span.className = 'bloat-tag';
      span.textContent = id;
      box.appendChild(span);
    });
  }

  function syncPreviewConfig(extra) {
    if (!currentConfig) return;
    currentConfig.theme = $('selectTheme').value;
    currentConfig.columns = Number($('selectColumns').value) || 6;
    currentConfig.greetingName = $('inputGreetingName').value.trim();
    currentConfig.screensaverMinutes = Number($('inputScreensaverMins').value) || 4;
    currentConfig.showHeroShelf = $('chkHeroShelf').checked;
    currentConfig.autoRenewDevMode = $('chkAutoRenew').checked;

    var payload = Object.assign({}, currentConfig, extra || {});
    try {
      if (tvFrame.contentWindow && tvFrame.contentWindow.LiquidGlassLauncher) {
        tvFrame.contentWindow.LiquidGlassLauncher.reloadConfig(payload);
      }
    } catch (e) {}
  }

  ['selectTheme', 'selectColumns', 'inputGreetingName', 'inputScreensaverMins', 'chkHeroShelf'].forEach(function (id) {
    $(id).addEventListener('input', function () { syncPreviewConfig(); });
    $(id).addEventListener('change', function () { syncPreviewConfig(); });
  });

  // Custom Wallpaper Upload
  $('inputWallpaperFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var dataUrl = ev.target.result;
      $('selectTheme').value = 'custom';
      syncPreviewConfig({ customWallpaperData: dataUrl });
      fetch('/api/wallpaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: dataUrl })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok) logLine('Uploaded custom wallpaper (' + Math.round(res.bytes / 1024) + ' KB) & updated IPK.');
        });
    };
    reader.readAsDataURL(file);
  });

  // Save UI Configuration & Rebuild IPK
  $('btnSaveUiConfig').addEventListener('click', function () {
    syncPreviewConfig();
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          logLine('Saved UI configuration and rebuilt launcher IPK (' + Math.round(res.ipkSize / 1024) + ' KB).');
        } else {
          logLine('Error saving config: ' + res.error);
        }
      });
  });

  // Sync Apps from LG QNED83SRA over SSAP
  $('btnSyncApps').addEventListener('click', function () {
    var host = $('inputTvIp').value.trim();
    if (!host) {
      logLine('Please enter your LG QNED83SRA IPv4 address first.');
      return;
    }
    logLine('Connecting to wss://' + host + ':3001 (accept pairing prompt on your TV if shown)...');
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: host })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          currentInventory = res.inventory;
          logLine('Synced ' + res.inventory.apps.length + ' apps and ' + res.inventory.inputs.length + ' HDMI inputs from ' + host + '!');
          renderAppsEditor();
          tvFrame.contentWindow.location.reload();
        } else {
          logLine('Sync failed: ' + res.error);
        }
      })
      .catch(function (err) { logLine('Sync request error: ' + err); });
  });

  // Full 1-Click Deployment to LG QNED83SRA
  $('btnDeployTv').addEventListener('click', function () {
    var host = $('inputTvIp').value.trim();
    var passphrase = $('inputPassphrase').value.trim();
    var autoRenew = $('chkAutoRenew').checked;
    if (!host) {
      logLine('Please enter your LG QNED83SRA IPv4 address first.');
      return;
    }
    logLine('Starting 6-step No-Root Developer Mode deployment to ' + host + '...');
    $('btnDeployTv').disabled = true;
    fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: host, passphrase: passphrase, autoRenew: autoRenew })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        $('btnDeployTv').disabled = false;
        if (res.logs) {
          res.logs.forEach(function (l) { logLine(l); });
        }
        if (res.ok) {
          logLine('SUCCESS! Liquid Glass Home and On-TV Home Helper are active on your LG QNED83SRA.');
          fetchStudioState();
          tvFrame.contentWindow.location.reload();
        } else {
          logLine('Deployment error: ' + res.error);
        }
      })
      .catch(function (err) {
        $('btnDeployTv').disabled = false;
        logLine('Deployment request failed: ' + err);
      });
  });

  // Restore Stock LG Home
  $('btnRestoreTv').addEventListener('click', function () {
    var host = $('inputTvIp').value.trim();
    var passphrase = $('inputPassphrase').value.trim();
    if (!host) {
      logLine('Please enter your LG QNED83SRA IPv4 address first.');
      return;
    }
    logLine('Removing custom launcher & restoring stock LG Home on ' + host + '...');
    fetch('/api/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: host, passphrase: passphrase })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.logs) res.logs.forEach(function (l) { logLine(l); });
        if (res.ok) logLine('Stock LG Home restored.');
        else logLine('Uninstall error: ' + res.error);
      });
  });

  // Remote Debloat Settings Jump Buttons
  document.querySelectorAll('[data-debloat-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-debloat-target');
      var host = $('inputTvIp').value.trim();
      if (!host) {
        logLine('Enter your LG QNED83SRA IP address in Tab 1 first so we can open LG ' + target + ' settings on your TV.');
        return;
      }
      logLine('Opening LG ' + target + ' settings on ' + host + '...');
      fetch('/api/debloat-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host, target: target })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok) logLine('Opened LG ' + target + ' Settings screen on your TV.');
          else logLine('Could not open settings: ' + res.error);
        });
    });
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  fetchStudioState();
})();

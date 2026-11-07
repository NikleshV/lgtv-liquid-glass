/*
 * Liquid Glass Home Engine for LG webOS (QNED83SRA)
 * Features:
 * - 5 or 6 column Frosted Liquid Glass Dock + scrollable App Grid
 * - Dynamic Ambient App-Color Backlight Crossfade + Hero Spotlight Shelf
 * - Top Frosted Pills: Live Open-Meteo Weather, HDMI Inputs, Wi-Fi status, Appearance/Themes, Settings & Debloat
 * - Hold-OK Context Menu (Move tile, Hide bloatware app, Pin/Unpin Dock)
 * - Full Integration with CleanYourTV No-Root Home Helper (`com.local.nativehome`) & Auto-Renewal service (`com.gathin.tvhome.renewal`)
 * - QNED / OLED Burn-in Safe Drifting Clock Screensaver
 */
(function () {
  'use strict';

  var STORAGE_PREFIX = 'lgtv.liquidglass.';
  var state = {
    columns: Math.max(4, Math.min(7, Number(window.CONFIG && CONFIG.columns) || 6)),
    theme: loadPref('theme', (window.CONFIG && CONFIG.theme) || 'aurora'),
    greetingName: loadPref('greetingName', (window.CONFIG && CONFIG.greetingName) || ''),
    weatherEnabled: loadPref('weatherEnabled', window.CONFIG ? CONFIG.weatherEnabled !== false : true),
    screensaverMinutes: Number(loadPref('screensaverMinutes', (window.CONFIG && CONFIG.screensaverMinutes) || 4)),
    showHeroShelf: loadPref('showHeroShelf', window.CONFIG ? CONFIG.showHeroShelf !== false : true),
    customWallpaperData: loadPref('customWallpaperData', ''),
    hiddenIds: loadPref('hiddenIds', (window.CONFIG && CONFIG.hiddenApps) || []),
    orderedIds: loadPref('orderedIds', null)
  };

  var THEMES = [
    { id: 'aurora', title: 'Northern Aurora (Liquid Glass)', wallpaper: 'wallpapers/aurora.jpg', baseBg: '#070a1a', scrimOpacity: 0.58 },
    { id: 'alpine', title: 'Alpine Dusk Valley', wallpaper: 'wallpapers/alpine.jpg', baseBg: '#090d16', scrimOpacity: 0.62 },
    { id: 'cosmos', title: 'Deep Cosmos Nebula', wallpaper: 'wallpapers/cosmos.jpg', baseBg: '#050712', scrimOpacity: 0.55 },
    { id: 'winter', title: 'Nordic Frosted Pines', wallpaper: 'wallpapers/winter.jpg', baseBg: '#080e1a', scrimOpacity: 0.64 },
    { id: 'oled-pitch', title: 'QNED Pitch Black (Zero Wallpaper)', wallpaper: '', baseBg: '#000000', scrimOpacity: 0.85 },
    { id: 'custom', title: 'Custom Uploaded Photo', wallpaper: 'custom', baseBg: '#070a1a', scrimOpacity: 0.58 }
  ];

  var KEY = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    OK: 13,
    BACK: 461,
    ESC: 27,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var $ = function (id) { return document.getElementById(id); };
  var surfaceEl = $('homeSurface');
  var wallpaperEl = $('wallpaperLayer');
  var scrimEl = $('wallpaperScrim');
  var ambientEls = [$('ambientA'), $('ambientB')];
  var ambientActive = 0;

  var topBarEl = $('topBar');
  var heroEl = $('heroSpotlight');
  var heroCategoryEl = $('heroCategory');
  var heroTitleEl = $('heroTitle');
  var heroSubtitleEl = $('heroSubtitle');
  var heroHintEl = $('heroHint');

  var stageEl = $('stage');
  var dockBandEl = $('dockBand');
  var tilesContainerEl = $('tilesContainer');
  var glassFocusEl = $('glassFocus');

  var pillEls = [
    $('pillWeather'),
    $('pillInputs'),
    $('pillWifi'),
    $('pillThemes'),
    $('pillSettings')
  ];

  var modalBackdropEl = $('modalBackdrop');
  var modalTitleEl = $('modalTitle');
  var modalSubtitleEl = $('modalSubtitle');
  var modalBodyEl = $('modalBody');

  var tileMenuBackdropEl = $('tileMenuBackdrop');
  var tileMenuTitleEl = $('tileMenuTitle');
  var tileMenuListEl = $('tileMenuList');

  var screensaverEl = $('screensaverOverlay');
  var screensaverGlowEl = $('screensaverGlow');
  var screensaverDrifterEl = $('screensaverDrifter');

  // Navigation state
  var zone = 'grid'; // 'grid' | 'top' | 'modal' | 'context' | 'screensaver'
  var items = [];    // { app, el, cardEl, rgb, subtitle, category }
  var focusedIndex = 0;
  var pillIndex = 1;
  var stageOffset = 0;
  var movingState = null; // { item, originalOrder }
  var modalRows = [];
  var modalFocusIndex = 0;
  var contextRows = [];
  var contextFocusIndex = 0;

  // Hold-OK detection
  var okDownTime = 0;
  var okHoldTimer = null;
  var okHoldTriggered = false;

  // Idle / Screensaver timer
  var lastActivityAt = Date.now();
  var screensaverActive = false;

  // Helper & Renewal state cache
  var helperRunning = true;
  var homeControlEnabled = true;
  var renewalEnabled = false;

  // ---- Storage Helpers -----------------------------------------------------------------------

  function loadPref(key, fallback) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (e) {}
  }

  // ---- webOS Luna Service Bridge -------------------------------------------------------------

  var activeBridges = [];

  function luna(uri, params, callback) {
    try {
      if (typeof PalmServiceBridge === 'undefined') {
        if (callback) callback({ returnValue: false, simulated: true });
        return;
      }
      var bridge = new PalmServiceBridge();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        var idx = activeBridges.indexOf(bridge);
        if (idx !== -1) activeBridges.splice(idx, 1);
        if (callback) callback({ returnValue: false, errorText: 'timeout' });
      }, 6000);

      bridge.onservicecallback = function (msg) {
        if (done && (!params || !params.subscribe)) return;
        done = true;
        clearTimeout(timer);
        if (!params || !params.subscribe) {
          var idx = activeBridges.indexOf(bridge);
          if (idx !== -1) activeBridges.splice(idx, 1);
        }
        var parsed;
        try { parsed = JSON.parse(msg); } catch (e) { parsed = { returnValue: false }; }
        if (callback) callback(parsed);
      };
      activeBridges.push(bridge);
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (callback) callback({ returnValue: false, errorText: String(e) });
    }
  }

  function launchApp(appId, title, params) {
    toast('Opening ' + (title || appId) + '…');
    luna('luna://com.webos.applicationManager/launch', { id: appId, params: params || {} }, function (res) {
      if (res && res.simulated) {
        toast('Preview Mode: Launched ' + (title || appId));
      } else if (!res || res.returnValue === false) {
        toast('Could not launch ' + (title || appId));
      }
    });
  }

  var toastTimeout = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('shown');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      el.classList.remove('shown');
    }, 2600);
  }

  // ---- Geometry & Layout Calculation ---------------------------------------------------------

  function metrics() {
    var cols = state.columns;
    var marginX = 96;
    var usableW = 1920 - marginX * 2;
    var gapX = cols >= 6 ? 24 : 30;
    var tileW = Math.floor((usableW - gapX * (cols - 1)) / cols);
    var tileH = Math.round(tileW * 0.5625); // 16:9 widescreen card aspect ratio
    var cellW = tileW + gapX;
    var dockTop = state.showHeroShelf ? 556 : 360;
    var rowPitch = tileH + 74;
    var dockExtraGap = 44;
    return {
      cols: cols,
      marginX: marginX,
      tileW: tileW,
      tileH: tileH,
      cellW: cellW,
      dockTop: dockTop,
      rowPitch: rowPitch,
      dockExtraGap: dockExtraGap
    };
  }

  function rowOf(index) {
    return Math.floor(index / state.columns);
  }

  function tileLeft(index, m) {
    m = m || metrics();
    return m.marginX + (index % m.cols) * m.cellW;
  }

  function tileTop(index, m) {
    m = m || metrics();
    var r = rowOf(index);
    return m.dockTop + r * m.rowPitch + (r > 0 ? m.dockExtraGap : 0);
  }

  // ---- App Inventory & Ordering --------------------------------------------------------------

  var BRAND_PRESETS = {
    'netflix': { color: [229, 9, 20], category: 'Streaming · 4K HDR', subtitle: 'Watch TV Shows, Originals & Movies Online' },
    'youtube.leanback.v4': { color: [255, 0, 51], category: 'Video · 4K 60fps', subtitle: 'Subscriptions, Creators, Music & Live Streams' },
    'amazon': { color: [0, 168, 225], category: 'Streaming · Dolby Vision', subtitle: 'Amazon Originals, Blockbuster Movies & Live Sports' },
    'com.disney.disneyplus-prod': { color: [0, 99, 229], category: 'Streaming · IMAX Enhanced', subtitle: 'Disney, Pixar, Marvel, Star Wars & National Geographic' },
    'com.apple.appletv': { color: [56, 118, 246], category: 'Apple Originals · 4K Atmos', subtitle: 'Apple TV+, MLS Season Pass & Purchased Library' },
    'cdp-30': { color: [229, 160, 13], category: 'Personal Media Server', subtitle: 'Direct Play 4K Remuxes, Movies, Shows & Music' },
    'spotify-beehive': { color: [29, 185, 84], category: 'Music & Podcasts', subtitle: 'Listen to Millions of Songs & Curated Playlists' },
    'com.wbd.stream': { color: [45, 70, 255], category: 'Streaming · Max', subtitle: 'HBO Series, Warner Bros. Films & Max Originals' },
    'org.jellyfin.webos': { color: [0, 164, 220], category: 'Home Media Server', subtitle: 'Self-Hosted Cinema & Local Library' },
    'com.stremio.one': { color: [138, 90, 171], category: 'Media Hub', subtitle: 'Discover & Stream All Your Video Channels' },
    'twitch': { color: [145, 70, 255], category: 'Live Streaming', subtitle: 'Esports, Gaming & Live Channels' },
    'com.webos.app.livetv': { color: [16, 185, 129], category: 'Broadcast Tuner', subtitle: 'Live Antenna & Cable TV Channels' }
  };

  function allCatalogApps() {
    return (window.TV_APPS && Array.isArray(window.TV_APPS.apps)) ? window.TV_APPS.apps : [];
  }

  function computeVisibleApps() {
    var all = allCatalogApps();
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });

    var hiddenMap = {};
    (state.hiddenIds || []).forEach(function (id) { hiddenMap[id] = true; });
    hiddenMap['com.gathin.tvhome'] = true;
    hiddenMap['com.local.nativehome'] = true;

    var placed = [];
    var seen = {};

    var orderSource = state.orderedIds && state.orderedIds.length
      ? state.orderedIds
      : ((window.CONFIG && CONFIG.dockApps) || []);

    orderSource.forEach(function (id) {
      if (byId[id] && !hiddenMap[id] && !seen[id]) {
        placed.push(byId[id]);
        seen[id] = true;
      }
    });

    var remaining = all.filter(function (a) {
      return !hiddenMap[a.id] && !seen[a.id];
    });
    remaining.sort(function (a, b) {
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

    return placed.concat(remaining);
  }

  function persistCurrentOrder() {
    state.orderedIds = items.map(function (it) { return it.app.id; });
    savePref('orderedIds', state.orderedIds);
  }

  // ---- Tile Building & Color Sampling --------------------------------------------------------

  function parseHexColor(hex) {
    if (!hex || typeof hex !== 'string') return null;
    var clean = hex.trim().replace(/^#/, '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ];
  }

  function fallbackBrandFor(app) {
    if (BRAND_PRESETS[app.id]) return BRAND_PRESETS[app.id];
    var titleLower = String(app.title || '').toLowerCase();
    if (titleLower.indexOf('netflix') !== -1) return BRAND_PRESETS['netflix'];
    if (titleLower.indexOf('youtube') !== -1) return BRAND_PRESETS['youtube.leanback.v4'];
    if (titleLower.indexOf('prime') !== -1) return BRAND_PRESETS['amazon'];
    if (titleLower.indexOf('disney') !== -1) return BRAND_PRESETS['com.disney.disneyplus-prod'];
    if (titleLower.indexOf('apple') !== -1) return BRAND_PRESETS['com.apple.appletv'];
    if (titleLower.indexOf('plex') !== -1) return BRAND_PRESETS['cdp-30'];
    if (titleLower.indexOf('spotify') !== -1) return BRAND_PRESETS['spotify-beehive'];
    var parsed = parseHexColor(app.iconColor);
    return {
      color: parsed || [72, 118, 230],
      category: app.category || 'webOS Application',
      subtitle: app.subtitle || ('Launch ' + (app.title || app.id) + ' on your LG QNED TV')
    };
  }

  function buildGrid() {
    tilesContainerEl.innerHTML = '';
    var visible = computeVisibleApps();
    var m = metrics();

    items = visible.map(function (app, idx) {
      var brand = fallbackBrandFor(app);
      var el = document.createElement('div');
      el.className = 'tile-item';
      el.style.width = m.tileW + 'px';
      el.style.height = m.tileH + 'px';

      var card = document.createElement('div');
      card.className = 'tile-card';
      var rgb = brand.color;
      card.style.background = 'linear-gradient(145deg, rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ', 0.88) 0%, rgba(' +
        Math.max(8, Math.floor(rgb[0] * 0.35)) + ',' +
        Math.max(10, Math.floor(rgb[1] * 0.35)) + ',' +
        Math.max(18, Math.floor(rgb[2] * 0.42)) + ', 0.96) 100%)';

      var itemObj = {
        app: app,
        el: el,
        cardEl: card,
        rgb: rgb,
        category: app.category || brand.category,
        subtitle: app.subtitle || brand.subtitle
      };

      if (app.icon) {
        var img = document.createElement('img');
        img.alt = app.title;
        img.onload = function () {
          sampleIconColor(itemObj, img);
        };
        img.onerror = function () {
          renderMonogram(card, app);
        };
        img.src = app.icon;
        card.appendChild(img);
      } else {
        renderMonogram(card, app);
      }

      var label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = app.title;

      el.appendChild(card);
      el.appendChild(label);

      el.addEventListener('mouseenter', function () {
        if (zone === 'grid' && !movingState) {
          focusTile(items.indexOf(itemObj));
        }
      });

      el.addEventListener('click', function () {
        if (movingState) {
          finishMoving(true);
        } else {
          launchApp(app.id, app.title);
        }
      });

      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        focusTile(items.indexOf(itemObj));
        openTileContextMenu();
      });

      tilesContainerEl.appendChild(el);
      setTimeout(function () { el.classList.add('shown'); }, 40 + Math.min(idx, 18) * 28);
      return itemObj;
    });

    layoutGrid();
    if (items.length > 0) {
      focusedIndex = Math.min(focusedIndex, items.length - 1);
      focusTile(focusedIndex, true);
    }
  }

  function renderMonogram(card, app) {
    card.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'tile-monogram';
    var logo = document.createElement('div');
    logo.className = 'tile-monogram-logo';
    logo.textContent = app.title || app.id;
    wrap.appendChild(logo);
    card.appendChild(wrap);
  }

  function sampleIconColor(itemObj, img) {
    try {
      var c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      var data = ctx.getImageData(0, 0, 16, 16).data;
      var r = 0, g = 0, b = 0, count = 0;
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 140) continue;
        // Skip near-white or near-black pixels when finding dominant accent
        var lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum > 240 || lum < 18) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (count > 8) {
        itemObj.rgb = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
        var rgb = itemObj.rgb;
        itemObj.cardEl.style.background = 'linear-gradient(145deg, rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ', 0.85) 0%, rgba(' +
          Math.max(10, Math.floor(rgb[0] * 0.32)) + ',' +
          Math.max(12, Math.floor(rgb[1] * 0.32)) + ',' +
          Math.max(22, Math.floor(rgb[2] * 0.38)) + ', 0.96) 100%)';
        if (items[focusedIndex] === itemObj && zone === 'grid') {
          updateAmbientGlow(itemObj.rgb);
        }
      }
    } catch (e) {}
  }

  function layoutGrid() {
    var m = metrics();
    items.forEach(function (it, idx) {
      it.el.style.width = m.tileW + 'px';
      it.el.style.height = m.tileH + 'px';
      it.el.style.left = tileLeft(idx, m) + 'px';
      it.el.style.top = tileTop(idx, m) + 'px';
      it.el.classList.toggle('is-dock', rowOf(idx) === 0);
    });

    var dockCount = Math.min(m.cols, items.length);
    if (dockCount > 0) {
      dockBandEl.style.display = 'block';
      dockBandEl.style.left = (tileLeft(0, m) - 26) + 'px';
      dockBandEl.style.top = (m.dockTop - 26) + 'px';
      dockBandEl.style.width = ((dockCount - 1) * m.cellW + m.tileW + 52) + 'px';
      dockBandEl.style.height = (m.tileH + 52) + 'px';
    } else {
      dockBandEl.style.display = 'none';
    }
  }

  // ---- Focus, Ambient Backlight & Hero Shelf -------------------------------------------------

  function updateAmbientGlow(rgb) {
    var c = rgb || [80, 130, 255];
    var nextIdx = 1 - ambientActive;
    var nextEl = ambientEls[nextIdx];
    var prevEl = ambientEls[ambientActive];

    nextEl.style.background =
      'radial-gradient(ellipse 1100px 680px at 50% 42%, rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ', 0.42) 0%, rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ', 0.14) 52%, transparent 80%)';
    nextEl.style.opacity = '1';
    prevEl.style.opacity = '0';
    ambientActive = nextIdx;
  }

  function updateHeroShelf(itemObj) {
    if (!state.showHeroShelf || !itemObj) {
      heroEl.classList.add('hidden-shelf');
      return;
    }
    var onFirstRow = rowOf(focusedIndex) === 0 && zone === 'grid';
    heroEl.classList.toggle('hidden-shelf', !onFirstRow);

    heroCategoryEl.textContent = movingState
      ? 'Moving Tile · Use Arrows & Press OK'
      : (rowOf(focusedIndex) === 0 ? 'Pinned in Dock · ' + itemObj.category : itemObj.category);
    heroTitleEl.textContent = itemObj.app.title;
    heroSubtitleEl.textContent = itemObj.subtitle;
    heroHintEl.textContent = movingState
      ? 'Press OK to drop here · Press BACK to cancel'
      : 'Press OK to launch · Hold OK for Options (Move / Hide)';
  }

  function focusTile(index, immediate) {
    if (!items.length) return;
    zone = 'grid';
    pillEls.forEach(function (p) { p.classList.remove('is-focused'); });

    focusedIndex = Math.max(0, Math.min(items.length - 1, index));
    var m = metrics();
    var targetItem = items[focusedIndex];

    items.forEach(function (it, idx) {
      it.el.classList.toggle('is-focused', idx === focusedIndex);
      it.el.classList.toggle('is-moving', Boolean(movingState && movingState.item === it));
    });

    // Scroll stage smoothly when moving down into the app grid
    var r = rowOf(focusedIndex);
    if (r === 0) {
      stageOffset = 0;
    } else {
      var topY = tileTop(focusedIndex, m);
      var desiredBottom = 940;
      if (topY + m.tileH - stageOffset > desiredBottom) {
        stageOffset = topY + m.tileH - desiredBottom;
      } else if (topY - stageOffset < 180) {
        stageOffset = Math.max(0, topY - 180);
      }
    }

    stageEl.style.transform = 'translate3d(0, ' + (-stageOffset) + 'px, 0)';
    topBarEl.classList.toggle('scrolled-away', stageOffset > 40);

    // Position the travelling Liquid Glass focus frame around the scaled card
    var pad = 12;
    var scaleW = Math.round(m.tileW * 1.09) + pad * 2;
    var scaleH = Math.round(m.tileH * 1.09) + pad * 2;
    var frameX = Math.round(tileLeft(focusedIndex, m) - (scaleW - m.tileW) / 2);
    var frameY = Math.round(tileTop(focusedIndex, m) - (scaleH - m.tileH) / 2);

    if (immediate) {
      glassFocusEl.style.transition = 'none';
    }
    glassFocusEl.style.width = scaleW + 'px';
    glassFocusEl.style.height = scaleH + 'px';
    glassFocusEl.style.transform = 'translate3d(' + frameX + 'px, ' + frameY + 'px, 0)';
    glassFocusEl.classList.add('visible');
    if (immediate) {
      void glassFocusEl.offsetWidth;
      glassFocusEl.style.transition = '';
    }

    updateAmbientGlow(targetItem.rgb);
    updateHeroShelf(targetItem);
  }

  function focusPill(idx) {
    zone = 'top';
    stageOffset = 0;
    stageEl.style.transform = 'translate3d(0, 0, 0)';
    topBarEl.classList.remove('scrolled-away');
    glassFocusEl.classList.remove('visible');
    items.forEach(function (it) { it.el.classList.remove('is-focused'); });

    pillIndex = (idx + pillEls.length) % pillEls.length;
    pillEls.forEach(function (el, i) {
      el.classList.toggle('is-focused', i === pillIndex);
    });
  }

  // ---- Tile Move / Reorder Mode --------------------------------------------------------------

  function startMovingTile() {
    if (!items[focusedIndex]) return;
    movingState = {
      item: items[focusedIndex],
      originalOrder: items.slice()
    };
    focusTile(focusedIndex);
    toast('Use arrows to move ' + movingState.item.app.title + ', then press OK');
  }

  function moveFocusedTileTo(newIndex) {
    if (!movingState) return;
    newIndex = Math.max(0, Math.min(items.length - 1, newIndex));
    if (newIndex === focusedIndex) return;
    var moved = items.splice(focusedIndex, 1)[0];
    items.splice(newIndex, 0, moved);
    layoutGrid();
    focusTile(newIndex);
  }

  function finishMoving(save) {
    if (!movingState) return;
    var title = movingState.item.app.title;
    if (!save) {
      items = movingState.originalOrder;
      focusedIndex = items.indexOf(movingState.item);
      layoutGrid();
      toast('Cancelled moving ' + title);
    } else {
      persistCurrentOrder();
      toast('Saved new position for ' + title);
    }
    movingState = null;
    focusTile(focusedIndex);
  }

  // ---- Hold-OK Tile Context Menu -------------------------------------------------------------

  function openTileContextMenu() {
    var current = items[focusedIndex];
    if (!current) return;
    zone = 'context';
    tileMenuTitleEl.textContent = current.app.title;
    tileMenuListEl.innerHTML = '';

    var actions = [
      {
        title: 'Open ' + current.app.title,
        desc: 'Launch application now',
        run: function () {
          closeTileContextMenu();
          launchApp(current.app.id, current.app.title);
        }
      },
      {
        title: 'Move / Reorder Tile',
        desc: 'Use arrow keys to place in Dock or Grid',
        run: function () {
          closeTileContextMenu();
          startMovingTile();
        }
      },
      {
        title: 'Hide from Home Screen (Debloat)',
        desc: 'Hide this app from your clean launcher (can be restored in Settings)',
        run: function () {
          if (items.length <= 1) {
            toast('Keep at least one app on Home');
            return;
          }
          state.hiddenIds.push(current.app.id);
          savePref('hiddenIds', state.hiddenIds);
          closeTileContextMenu();
          buildGrid();
          toast('Hid ' + current.app.title + ' from Home');
        }
      }
    ];

    contextRows = actions.map(function (act, idx) {
      var row = document.createElement('div');
      row.className = 'modal-row';
      row.innerHTML =
        '<div class="modal-row-left">' +
          '<div class="modal-row-title">' + escapeHtml(act.title) + '</div>' +
          '<div class="modal-row-desc">' + escapeHtml(act.desc) + '</div>' +
        '</div>';
      row.addEventListener('mouseenter', function () { focusContextRow(idx); });
      row.addEventListener('click', act.run);
      tileMenuListEl.appendChild(row);
      return { el: row, run: act.run };
    });

    tileMenuBackdropEl.classList.remove('hidden');
    focusContextRow(0);
  }

  function focusContextRow(idx) {
    if (!contextRows.length) return;
    contextFocusIndex = (idx + contextRows.length) % contextRows.length;
    contextRows.forEach(function (r, i) {
      r.el.classList.toggle('is-focused', i === contextFocusIndex);
    });
  }

  function closeTileContextMenu() {
    tileMenuBackdropEl.classList.add('hidden');
    contextRows = [];
    focusTile(focusedIndex);
  }

  // ---- Modal Panels (Inputs, Appearance, Settings/Debloat, Weather) --------------------------

  function openModal(title, subtitle, rowsConfig) {
    zone = 'modal';
    modalTitleEl.textContent = title;
    modalSubtitleEl.textContent = subtitle || '';
    modalBodyEl.innerHTML = '';

    modalRows = rowsConfig.map(function (cfg, idx) {
      var row = document.createElement('div');
      row.className = 'modal-row';
      row.innerHTML =
        '<div class="modal-row-left">' +
          '<div class="modal-row-title">' + escapeHtml(cfg.title) + '</div>' +
          (cfg.desc ? '<div class="modal-row-desc">' + escapeHtml(cfg.desc) + '</div>' : '') +
        '</div>' +
        (cfg.badge ? '<span class="modal-row-badge">' + escapeHtml(cfg.badge) + '</span>' : '');
      row.addEventListener('mouseenter', function () { focusModalRow(idx); });
      row.addEventListener('click', function () {
        if (cfg.run) cfg.run();
      });
      modalBodyEl.appendChild(row);
      return { el: row, run: cfg.run };
    });

    modalBackdropEl.classList.remove('hidden');
    focusModalRow(0);
  }

  function focusModalRow(idx) {
    if (!modalRows.length) return;
    modalFocusIndex = (idx + modalRows.length) % modalRows.length;
    modalRows.forEach(function (r, i) {
      var active = i === modalFocusIndex;
      r.el.classList.toggle('is-focused', active);
      if (active && r.el.scrollIntoView) {
        r.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function closeModal() {
    modalBackdropEl.classList.add('hidden');
    modalRows = [];
    focusTile(focusedIndex);
  }

  // 1. HDMI & Live TV Inputs Modal
  function openInputsModal() {
    var inputs = (window.TV_APPS && Array.isArray(window.TV_APPS.inputs)) ? window.TV_APPS.inputs : [];
    var rows = inputs.map(function (inp) {
      return {
        title: inp.label || inp.id || inp.appId,
        desc: 'Switch LG QNED83SRA display source to ' + (inp.label || inp.appId),
        badge: inp.connected === false ? 'Standby' : 'HDMI Input',
        run: function () {
          closeModal();
          launchApp(inp.appId, inp.label || inp.appId);
        }
      };
    });

    rows.push({
      title: 'Live TV (Broadcast / Antenna Tuner)',
      desc: 'Open LG Live TV tuner (`com.webos.app.livetv`)',
      badge: 'Tuner',
      run: function () {
        closeModal();
        launchApp('com.webos.app.livetv', 'Live TV');
      }
    });

    rows.push({
      title: 'LG Home Hub / Input Settings',
      desc: 'Open native LG input & device manager',
      badge: 'System',
      run: function () {
        closeModal();
        launchApp('com.webos.app.homeconnect', 'Home Hub');
      }
    });

    openModal('Inputs & Sources', 'Switch HDMI ports or open Live TV on your LG QNED83SRA', rows);
  }

  // 2. Appearance, Themes & Layout Modal
  function openThemesModal() {
    var rows = THEMES.map(function (th) {
      return {
        title: th.title,
        desc: th.id === 'oled-pitch'
          ? 'Pure pitch-black canvas with dynamic app-color backlight glow'
          : 'Frosted Liquid Glass over ' + th.title + ' backdrop',
        badge: state.theme === th.id ? 'Active' : 'Select',
        run: function () {
          state.theme = th.id;
          savePref('theme', state.theme);
          applyTheme();
          toast('Applied theme: ' + th.title);
          openThemesModal();
        }
      };
    });

    rows.push({
      title: 'Dock & Grid Columns: ' + state.columns + ' Apps per Row',
      desc: 'Cycle between 4, 5, 6, or 7 apps in the Liquid Glass Dock',
      badge: state.columns + ' Columns',
      run: function () {
        state.columns = state.columns >= 7 ? 4 : state.columns + 1;
        savePref('columns', state.columns);
        buildGrid();
        openThemesModal();
      }
    });

    rows.push({
      title: 'Hero Spotlight Banner: ' + (state.showHeroShelf ? 'Shown' : 'Compact Dock'),
      desc: 'Toggle the large featured app title & description shelf above the Dock',
      badge: state.showHeroShelf ? 'On' : 'Off',
      run: function () {
        state.showHeroShelf = !state.showHeroShelf;
        savePref('showHeroShelf', state.showHeroShelf);
        buildGrid();
        openThemesModal();
      }
    });

    rows.push({
      title: 'Start Drifting Clock Screensaver Now',
      desc: 'Launch the QNED burn-in safe ambient clock screensaver (auto-starts after ' + state.screensaverMinutes + ' min idle)',
      badge: 'Preview',
      run: function () {
        closeModal();
        startScreensaver();
      }
    });

    openModal('Appearance & Liquid Glass Themes', 'Customize your wallpaper, dock size, and ambient glass effects', rows);
  }

  // 3. Settings, LG Privacy/Ad Debloat Wizard & Home Helper Modal
  function openSettingsModal() {
    refreshHelperStatus();
    var hiddenCount = (state.hiddenIds || []).length;

    var rows = [
      {
        title: 'LG Privacy & Ad-Blocker Setup Wizard (No-Root Debloat)',
        desc: 'Jump directly to LG Settings to turn off Home Promotion, Content Recommendations & Live Plus ACR tracking',
        badge: 'Debloat TV',
        run: function () {
          openDebloatWizardModal();
        }
      },
      {
        title: 'App Library & Hidden Bloatware (' + hiddenCount + ' hidden)',
        desc: 'View all installed TV apps, restore hidden apps, or hide LG bloatware',
        badge: 'Manage Apps',
        run: function () {
          openAppLibraryModal();
        }
      },
      {
        title: 'On-TV Home Button Helper (`com.local.nativehome`)',
        desc: 'Controls whether pressing the remote Home button opens Liquid Glass Home or LG Home (triple-press Home within 2s for emergency exit)',
        badge: homeControlEnabled ? 'Active' : 'Start / Configure',
        run: function () {
          openHomeHelperModal();
        }
      },
      {
        title: 'Developer Mode 999h Session Auto-Renewal',
        desc: 'Automatically extends LG Developer Mode session hourly while the TV is on so your launcher never expires',
        badge: renewalEnabled ? 'Enabled' : 'Enable Auto-Renew',
        run: function () {
          toggleDevModeRenewal();
        }
      },
      {
        title: 'Open Native LG System Settings',
        desc: 'Open picture (QNED MiniLED / Dolby Vision), sound, Wi-Fi, and general TV settings',
        badge: 'LG Settings',
        run: function () {
          closeModal();
          launchApp('com.palm.app.settings', 'LG Settings');
        }
      },
      {
        title: 'Visit Stock LG Home Screen Once',
        desc: 'Temporarily open LG webOS Home without disabling your custom launcher',
        badge: 'Open LG Home',
        run: function () {
          closeModal();
          visitStockLGHome();
        }
      },
      {
        title: 'Reset App Order to Default',
        desc: 'Restore the default 6-app streaming dock order',
        badge: 'Reset',
        run: function () {
          state.orderedIds = null;
          savePref('orderedIds', null);
          buildGrid();
          closeModal();
          toast('Restored default dock app order');
        }
      }
    ];

    openModal('Settings, Debloat & Home Control', 'Manage LG QNED83SRA ad-blocking, hidden bloatware, and Home button routing', rows);
  }

  function openDebloatWizardModal() {
    var rows = [
      {
        title: 'Step 1: Disable LG "Home Promotion" & "Content Recommendation"',
        desc: 'Opens LG Settings → General → System → Additional Settings → Home Settings. Turn OFF both toggles.',
        badge: 'Open Settings',
        run: function () {
          closeModal();
          luna('luna://com.webos.applicationManager/launch', {
            id: 'com.palm.app.settings',
            params: { target: 'general' }
          });
        }
      },
      {
        title: 'Step 2: Disable "Live Plus" ACR Screen Tracking & Ad Tracking',
        desc: 'Opens LG Settings → Support → Privacy & Terms → User Agreements. Untick Viewing Information & Interest-Based Ads.',
        badge: 'Open Privacy',
        run: function () {
          closeModal();
          luna('luna://com.webos.applicationManager/launch', {
            id: 'com.palm.app.settings',
            params: { target: 'support' }
          });
        }
      },
      {
        title: 'Step 3: Block LG Ad & Telemetry Servers via Network DNS',
        desc: 'In LG Network → Wi-Fi Connection → Advanced → Edit DNS: set 94.140.14.14 (AdGuard DNS) to block lgad.cjpowercast.com & ad.lgappstv.com.',
        badge: 'Open Network',
        run: function () {
          closeModal();
          luna('luna://com.webos.applicationManager/launch', {
            id: 'com.palm.app.settings',
            params: { target: 'network' }
          });
        }
      },
      {
        title: 'Step 4: Hide Preloaded LG Bloatware Apps in Launcher',
        desc: 'Hide LG Channels, Shopping, Web Browser, User Guide, Alerts & Promo tiles from Home',
        badge: 'Apply Cleanup',
        run: function () {
          var bloat = (window.CONFIG && CONFIG.hiddenApps) || [];
          bloat.forEach(function (id) {
            if (state.hiddenIds.indexOf(id) === -1) state.hiddenIds.push(id);
          });
          savePref('hiddenIds', state.hiddenIds);
          buildGrid();
          toast('All LG bloatware apps hidden from Home!');
          openSettingsModal();
        }
      },
      {
        title: '← Back to Settings',
        desc: 'Return to main settings menu',
        badge: 'Back',
        run: function () { openSettingsModal(); }
      }
    ];
    openModal('LG QNED83SRA No-Root Debloat Wizard', 'Strip ads, ACR tracking, and preloaded clutter without rooting your TV', rows);
  }

  function openAppLibraryModal() {
    var all = allCatalogApps();
    var rows = all.filter(function (a) {
      return a.id !== 'com.gathin.tvhome' && a.id !== 'com.local.nativehome';
    }).map(function (app) {
      var isHidden = state.hiddenIds.indexOf(app.id) !== -1;
      return {
        title: app.title || app.id,
        desc: 'App ID: ' + app.id,
        badge: isHidden ? 'Hidden (Click to Restore)' : 'Visible on Home',
        run: function () {
          var idx = state.hiddenIds.indexOf(app.id);
          if (idx !== -1) {
            state.hiddenIds.splice(idx, 1);
            toast('Restored ' + app.title + ' to Home');
          } else {
            state.hiddenIds.push(app.id);
            toast('Hid ' + app.title + ' from Home');
          }
          savePref('hiddenIds', state.hiddenIds);
          buildGrid();
          openAppLibraryModal();
        }
      };
    });

    rows.unshift({
      title: '← Back to Settings',
      desc: 'Return to main settings menu',
      badge: 'Back',
      run: function () { openSettingsModal(); }
    });

    openModal('App Library & Bloatware Filter', 'Click any app to toggle visibility on your Liquid Glass Home screen', rows);
  }

  function openHomeHelperModal() {
    var rows = [
      {
        title: 'Start / Resume On-TV Home Helper',
        desc: 'Launches `com.local.nativehome` so pressing Home on your LG Magic Remote opens Liquid Glass Home',
        badge: 'Start Helper',
        run: function () {
          luna('luna://com.webos.applicationManager/launch', {
            id: 'com.local.nativehome',
            params: { nativeHomeStart: true }
          }, function (res) {
            homeControlEnabled = true;
            toast(res && res.returnValue ? 'Home Helper started!' : 'Requested Home Helper launch');
          });
        }
      },
      {
        title: 'Enable Home Button Redirection',
        desc: 'Route Home button and app-exit back to Liquid Glass Home',
        badge: homeControlEnabled ? 'Enabled' : 'Enable',
        run: function () {
          luna('luna://com.gathin.tvhome.renewal/setHomeControl', { enabled: true }, function () {
            homeControlEnabled = true;
            toast('Home button routed to Liquid Glass Home');
            openHomeHelperModal();
          });
        }
      },
      {
        title: 'Pause Home Button Redirection (Use Stock LG Home)',
        desc: 'Temporarily let the Home button open LG webOS Home (or press Home 3x quickly at any time)',
        badge: !homeControlEnabled ? 'Paused' : 'Pause',
        run: function () {
          luna('luna://com.gathin.tvhome.renewal/setHomeControl', { enabled: false }, function () {
            homeControlEnabled = false;
            toast('Home button paused — returns to LG Home');
            openHomeHelperModal();
          });
        }
      },
      {
        title: '← Back to Settings',
        desc: 'Return to main settings menu',
        badge: 'Back',
        run: function () { openSettingsModal(); }
      }
    ];
    openModal('On-TV Home Button Helper', 'No-Root Home key interception via `com.local.nativehome`', rows);
  }

  function refreshHelperStatus() {
    luna('luna://com.local.nativehome.service/status', {}, function (r) {
      if (r && typeof r.running === 'boolean') helperRunning = r.running;
    });
    luna('luna://com.gathin.tvhome.renewal/homeStatus', {}, function (r) {
      if (r && typeof r.enabled === 'boolean') homeControlEnabled = r.enabled;
    });
    luna('luna://com.gathin.tvhome.renewal/status', {}, function (r) {
      if (r && r.state && typeof r.state.enabled === 'boolean') renewalEnabled = r.state.enabled;
    });
  }

  function toggleDevModeRenewal() {
    var method = renewalEnabled ? 'disable' : 'enable';
    luna('luna://com.gathin.tvhome.renewal/' + method, {}, function (res) {
      renewalEnabled = !renewalEnabled;
      toast(renewalEnabled
        ? 'Developer Mode Auto-Renewal enabled (checks hourly)'
        : 'Developer Mode Auto-Renewal disabled');
      openSettingsModal();
    });
  }

  function visitStockLGHome() {
    luna('luna://com.gathin.tvhome.renewal/openLGHome', {}, function (res) {
      if (!res || res.returnValue === false) {
        launchApp('com.webos.app.home', 'LG Home');
      }
    });
  }

  // ---- Theme & Wallpaper Engine --------------------------------------------------------------

  function applyTheme() {
    var th = THEMES.find(function (t) { return t.id === state.theme; }) || THEMES[0];
    surfaceEl.style.backgroundColor = th.baseBg;
    if (th.id === 'oled-pitch') {
      wallpaperEl.style.backgroundImage = 'none';
      wallpaperEl.style.opacity = '0';
    } else if (th.id === 'custom' && state.customWallpaperData) {
      wallpaperEl.style.backgroundImage = 'url("' + state.customWallpaperData + '")';
      wallpaperEl.style.opacity = '1';
    } else {
      var wp = th.wallpaper === 'custom' ? 'wallpapers/aurora.jpg' : th.wallpaper;
      wallpaperEl.style.backgroundImage = 'url("' + wp + '")';
      wallpaperEl.style.opacity = '1';
    }
    scrimEl.style.opacity = String(th.scrimOpacity || 0.6);
  }

  // ---- Clock, Greeting, Live Weather & Network Pill ------------------------------------------

  function updateClock() {
    var now = new Date();
    var h24 = now.getHours();
    var mins = String(now.getMinutes()).padStart(2, '0');
    var h12 = h24 % 12 || 12;
    var period = h24 < 12 ? 'AM' : 'PM';

    $('clockTime').textContent = h12 + ':' + mins;
    $('clockPeriod').textContent = period;
    $('ssTime').textContent = h12 + ':' + mins;

    var dateStr = DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
    $('clockDate').textContent = dateStr;
    $('ssDate').textContent = dateStr;

    var greet = h24 < 5 ? 'Good night' : h24 < 12 ? 'Good morning' : h24 < 17 ? 'Good afternoon' : h24 < 22 ? 'Good evening' : 'Good night';
    if (state.greetingName) greet += ', ' + state.greetingName;
    $('greetingText').textContent = greet;
  }

  function updateNetworkStatus() {
    luna('luna://com.palm.connectionmanager/getStatus', {}, function (res) {
      if (!res || !res.returnValue) return;
      var wifi = res.wifi || {};
      var wired = res.wired || {};
      if (wired.state === 'connected') {
        $('wifiLabel').textContent = 'Ethernet';
      } else if (wifi.state === 'connected') {
        $('wifiLabel').textContent = wifi.ssid || 'Wi-Fi';
      } else {
        $('wifiLabel').textContent = 'Offline';
      }
    });
  }

  var WEATHER_CODES = {
    0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Rime Fog', 51: 'Light Drizzle', 53: 'Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 71: 'Snow',
    80: 'Rain Showers', 95: 'Thunderstorm'
  };

  function fetchLiveWeather() {
    if (!state.weatherEnabled) return;
    var lat = (window.CONFIG && CONFIG.weatherLat) || 37.7749;
    var lon = (window.CONFIG && CONFIG.weatherLon) || -122.4194;

    function loadMeteo(la, lo) {
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(la) +
                '&longitude=' + encodeURIComponent(lo) + '&current_weather=true';
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.current_weather) return;
          var temp = Math.round(data.current_weather.temperature) + '°C';
          var cond = WEATHER_CODES[data.current_weather.weathercode] || 'Clear';
          $('weatherTemp').textContent = temp;
          $('weatherCond').textContent = cond;
          $('ssWeather').textContent = temp + ' · ' + cond;
        })
        .catch(function () {});
    }

    if (window.CONFIG && CONFIG.weatherLat && CONFIG.weatherLon) {
      loadMeteo(lat, lon);
    } else {
      fetch('https://ipwho.is/')
        .then(function (r) { return r.json(); })
        .then(function (loc) {
          if (loc && loc.latitude && loc.longitude) {
            loadMeteo(loc.latitude, loc.longitude);
          } else {
            loadMeteo(lat, lon);
          }
        })
        .catch(function () { loadMeteo(lat, lon); });
    }
  }

  // ---- QNED / OLED Burn-in Drifting Clock Screensaver ----------------------------------------

  function startScreensaver() {
    screensaverActive = true;
    zone = 'screensaver';
    screensaverEl.classList.remove('hidden');
    driftScreensaver();
  }

  function stopScreensaver() {
    if (!screensaverActive) return;
    screensaverActive = false;
    screensaverEl.classList.add('hidden');
    focusTile(focusedIndex);
  }

  function driftScreensaver() {
    if (!screensaverActive) return;
    var dx = Math.round((Math.random() - 0.5) * 320);
    var dy = Math.round((Math.random() - 0.5) * 180);
    var currentItem = items[focusedIndex];
    var rgb = (currentItem && currentItem.rgb) ? currentItem.rgb : [90, 140, 255];

    screensaverDrifterEl.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0)';
    screensaverGlowEl.style.background = 'radial-gradient(circle, rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ', 0.55) 0%, transparent 70%)';
    screensaverGlowEl.style.transform = 'translate3d(' + (500 + dx * 0.7) + 'px, ' + (120 + dy * 0.7) + 'px, 0)';
  }

  // ---- Top Pill Actions ----------------------------------------------------------------------

  function activatePill(idx) {
    if (idx === 0) {
      fetchLiveWeather();
      toast('Refreshed live Open-Meteo weather');
    } else if (idx === 1) {
      openInputsModal();
    } else if (idx === 2) {
      launchApp('com.palm.app.settings', 'Network Settings', { target: 'network' });
    } else if (idx === 3) {
      openThemesModal();
    } else if (idx === 4) {
      openSettingsModal();
    }
  }

  pillEls.forEach(function (el, idx) {
    el.addEventListener('mouseenter', function () {
      if (zone === 'grid' || zone === 'top') focusPill(idx);
    });
    el.addEventListener('click', function () {
      focusPill(idx);
      activatePill(idx);
    });
  });

  // ---- Remote Control & Keyboard Input Handler -----------------------------------------------

  document.addEventListener('keydown', function (e) {
    lastActivityAt = Date.now();
    var code = e.keyCode;

    if (screensaverActive) {
      e.preventDefault();
      stopScreensaver();
      return;
    }

    // Context menu navigation
    if (zone === 'context') {
      e.preventDefault();
      if (code === KEY.UP || code === KEY.LEFT) focusContextRow(contextFocusIndex - 1);
      else if (code === KEY.DOWN || code === KEY.RIGHT) focusContextRow(contextFocusIndex + 1);
      else if (code === KEY.OK && contextRows[contextFocusIndex]) contextRows[contextFocusIndex].run();
      else if (code === KEY.BACK || code === KEY.ESC) closeTileContextMenu();
      return;
    }

    // Modal navigation
    if (zone === 'modal') {
      e.preventDefault();
      if (code === KEY.UP || code === KEY.LEFT) focusModalRow(modalFocusIndex - 1);
      else if (code === KEY.DOWN || code === KEY.RIGHT) focusModalRow(modalFocusIndex + 1);
      else if (code === KEY.OK && modalRows[modalFocusIndex]) modalRows[modalFocusIndex].run();
      else if (code === KEY.BACK || code === KEY.ESC) closeModal();
      return;
    }

    // Top bar pill navigation
    if (zone === 'top') {
      if (code === KEY.LEFT) { e.preventDefault(); focusPill(pillIndex - 1); }
      else if (code === KEY.RIGHT) { e.preventDefault(); focusPill(pillIndex + 1); }
      else if (code === KEY.DOWN) { e.preventDefault(); focusTile(focusedIndex); }
      else if (code === KEY.OK) { e.preventDefault(); activatePill(pillIndex); }
      else if (code === KEY.BACK || code === KEY.ESC) { e.preventDefault(); focusTile(focusedIndex); }
      return;
    }

    // Grid & Dock navigation
    var cols = state.columns;
    if (code === KEY.LEFT) {
      e.preventDefault();
      if (movingState) moveFocusedTileTo(focusedIndex - 1);
      else if (focusedIndex > 0) focusTile(focusedIndex - 1);
    } else if (code === KEY.RIGHT) {
      e.preventDefault();
      if (movingState) moveFocusedTileTo(focusedIndex + 1);
      else if (focusedIndex < items.length - 1) focusTile(focusedIndex + 1);
    } else if (code === KEY.UP) {
      e.preventDefault();
      if (movingState) {
        moveFocusedTileTo(focusedIndex - cols);
      } else if (rowOf(focusedIndex) === 0) {
        focusPill(pillIndex);
      } else {
        focusTile(Math.max(0, focusedIndex - cols));
      }
    } else if (code === KEY.DOWN) {
      e.preventDefault();
      if (movingState) {
        moveFocusedTileTo(focusedIndex + cols);
      } else if (focusedIndex + cols < items.length) {
        focusTile(focusedIndex + cols);
      } else if (rowOf(focusedIndex) < rowOf(items.length - 1)) {
        focusTile(items.length - 1);
      }
    } else if (code === KEY.OK) {
      e.preventDefault();
      if (movingState) {
        finishMoving(true);
        return;
      }
      if (!e.repeat && !okHoldTimer) {
        okDownTime = Date.now();
        okHoldTriggered = false;
        okHoldTimer = setTimeout(function () {
          okHoldTimer = null;
          okHoldTriggered = true;
          openTileContextMenu();
        }, 550);
      }
    } else if (code === KEY.BACK || code === KEY.ESC) {
      e.preventDefault();
      if (movingState) {
        finishMoving(false);
      } else if (focusedIndex >= cols) {
        focusTile(focusedIndex % cols);
      }
    } else if (code === KEY.RED) {
      openInputsModal();
    } else if (code === KEY.GREEN) {
      openThemesModal();
    } else if (code === KEY.YELLOW) {
      openAppLibraryModal();
    } else if (code === KEY.BLUE) {
      openSettingsModal();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.keyCode === KEY.OK) {
      if (okHoldTimer) {
        clearTimeout(okHoldTimer);
        okHoldTimer = null;
        if (!okHoldTriggered && zone === 'grid' && !movingState && items[focusedIndex]) {
          launchApp(items[focusedIndex].app.id, items[focusedIndex].app.title);
        }
      }
    }
  });

  // ---- Responsive Scaling for Desktop Preview ------------------------------------------------

  function fitViewportForPreview() {
    if (window.innerWidth < 1920 || window.innerHeight < 1080) {
      var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      document.body.style.transform = 'scale(' + scale.toFixed(4) + ')';
    } else {
      document.body.style.transform = '';
    }
  }

  window.addEventListener('resize', fitViewportForPreview);

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Initialization & Background Timers ----------------------------------------------------

  // Expose live update hooks for the Windows Web Dashboard preview iframe
  window.LiquidGlassLauncher = {
    reloadConfig: function (newCfg) {
      if (newCfg.columns) state.columns = Number(newCfg.columns);
      if (newCfg.theme) state.theme = newCfg.theme;
      if (typeof newCfg.greetingName === 'string') state.greetingName = newCfg.greetingName;
      if (typeof newCfg.showHeroShelf === 'boolean') state.showHeroShelf = newCfg.showHeroShelf;
      if (Array.isArray(newCfg.hiddenApps)) state.hiddenIds = newCfg.hiddenApps.slice();
      if (Array.isArray(newCfg.dockApps)) state.orderedIds = newCfg.dockApps.slice();
      if (typeof newCfg.customWallpaperData === 'string') {
        state.customWallpaperData = newCfg.customWallpaperData;
        savePref('customWallpaperData', state.customWallpaperData);
      }
      applyTheme();
      updateClock();
      buildGrid();
    },
    triggerScreensaver: startScreensaver,
    openDebloatWizard: openDebloatWizardModal
  };

  fitViewportForPreview();
  applyTheme();
  updateClock();
  buildGrid();
  updateNetworkStatus();
  fetchLiveWeather();
  refreshHelperStatus();

  setInterval(updateClock, 10000);
  setInterval(updateNetworkStatus, 30000);
  setInterval(fetchLiveWeather, 15 * 60 * 1000);
  setInterval(function () {
    if (screensaverActive) {
      driftScreensaver();
    } else if (state.screensaverMinutes > 0 && Date.now() - lastActivityAt > state.screensaverMinutes * 60 * 1000) {
      startScreensaver();
    }
  }, 9000);
})();

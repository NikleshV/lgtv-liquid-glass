# CleanYourTV · Liquid Glass Edition for LG QNED83SRA (webOS No-Root)

A complete, self-contained **No-Root Developer Mode** customization suite and **Apple TV-style Frosted Liquid Glass Launcher** designed for your **LG QNED83SRA** running LG webOS—built to run locally on your **Windows PC** on the same Wi-Fi network.

---

## What's Included

1. **Frosted Liquid Glass Home (`com.gathin.tvhome`)**:
   - **5/6-App Liquid Glass Dock + Scrollable App Grid**: Specular glass cards with a single spring-animated floating focus frame.
   - **Dynamic App-Color Ambient Backlight**: Samples the focused app's artwork color and crossfades a dual-layer ambient glow behind the dock.
   - **Hero Spotlight Shelf**: Displays the focused app's title, category badge, and description above the dock.
   - **Frosted Top Status Pills**: Live **Open-Meteo Weather**, **HDMI Input Switcher** (HDMI 1–4 & Live TV), **Wi-Fi / Ethernet** status, **Appearance & Themes** (Northern Aurora, Alpine Dusk, Cosmos Nebula, Nordic Pines, QNED Pitch Black, or Custom Photo), and **Settings & Debloat Wizard**.
   - **QNED / OLED Burn-in Safe Drifting Clock Screensaver**: Automatically activates on idle with a drifting Outfit clock and ambient glow.
   - **Hold-OK Context Menu**: Hold **OK** on any app tile with your LG Magic Remote to **Move/Reorder** or **Hide** bloatware apps directly on the TV.

2. **On-TV Home Button Helper (`com.local.nativehome`) + Auto-Renewal Service (`com.gathin.tvhome.renewal`)**:
   - Routes the LG Magic Remote's **Home button** to your Liquid Glass Home screen **even when your Windows PC is turned off**.
   - **Emergency Exit to Stock LG Home**: Press the **Home button 3 times within 2 seconds** at any time to pause the helper and return to stock LG Home.
   - **Developer Mode 999h Auto-Renewal**: Automatically extends your LG Developer Mode session hourly while the TV is on.

3. **3-Layer LG webOS No-Root Debloat Suite**:
   - **Layer 1 (App Bloatware Filter)**: Automatically hides preloaded LG clutter (`LG Channels`, `Shopping`, `Web Browser`, `User Guide`, `Sports Alert`, `Art Gallery`, `Promos`) from your Home screen.
   - **Layer 2 (One-Click Privacy & Ad Settings Jump)**: Remotely opens the exact LG Settings menus on your TV to turn off **Home Promotion**, **Content Recommendation**, and **Live Plus ACR Screen Tracking**.
   - **Layer 3 (Network Ad-Block DNS)**: Guides and jumps to your TV's Network DNS settings to block `ad.lgappstv.com` and `lgad.cjpowercast.com` via AdGuard DNS (`94.140.14.14`).

4. **Windows Web Dashboard Studio (`studio_server.py`) & One-Click PowerShell Script (`install.ps1`)**:
   - Interactive 1920×1080 live preview of your TV right in your browser, complete with a virtual LG Magic Remote, theme switcher, custom wallpaper uploader, and one-click TV deployer.

---

## Quick Start on Your Windows PC

### Step 1: Prepare Developer Mode on Your LG QNED83SRA
1. Open the **Developer Mode** app on your TV (installed from the LG Content Store and signed in with your free LG Developer account).
2. Ensure **Dev Mode Status** is **ON** and **Key Server** is **ON**.
3. Note the **IP Address** (e.g., `192.168.1.50`) and the 6-character **Passphrase** shown on the TV screen. Keep the Developer Mode screen open during the first connection.

### Step 2: Launch the Studio or Run One-Click Install on Windows
Make sure you have **Python 3.9+** installed on Windows ([python.org](https://www.python.org/downloads/windows/)).

**Option A — Interactive Web Dashboard Studio (Recommended):**
Double-click `start-studio.bat` or run in PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
This opens **`http://localhost:8780`** in your browser where you can:
- Preview and test your Liquid Glass launcher in real time
- Customize your 6-app dock, themes, greeting name, and upload custom wallpapers
- Enter your TV's IP and Passphrase and click **"One-Click Install Launcher + On-TV Home Helper"**
- Use the **Debloat LG TV** tab to jump straight to LG's Privacy & Ad settings on your TV

**Option B — Direct Command-Line Install in PowerShell:**
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TvHost 192.168.1.50 -Passphrase ABC123
```

**Option C — Restore Stock LG Home (Uninstall):**
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Restore -TvHost 192.168.1.50
```

---

## Everyday Remote Controls on Your LG QNED83SRA

| Remote Action | What It Does |
|---|---|
| **Home Button (1 press)** | Opens **Liquid Glass Home** (handled by the on-TV Home Helper, no PC needed) |
| **Home Button (3 presses within 2s)** | Emergency exit: stops Home Helper and opens stock **LG Home** |
| **Hold Number Key `1`** | Bind Quick Access on your LG remote while Liquid Glass Home is open for instant 1-key launch |
| **OK (Short Press)** | Launches the focused app or opens the selected top-bar pill |
| **OK (Hold ~0.6s on a Tile)** | Opens the **Tile Options Menu** to **Move/Reorder** or **Hide** an app |
| **Up from Dock** | Moves focus to the **Frosted Top Status Bar** (Weather, Inputs, Wi-Fi, Appearance, Settings) |
| **Down from Dock** | Smoothly scrolls into your full **App Grid** |
| **Red / Green / Yellow / Blue Keys** | Shortcuts for **Inputs** (Red), **Themes** (Green), **App Library** (Yellow), **Settings & Debloat** (Blue) |

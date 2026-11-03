# Storm Chaser VR — Public Deployment Guide

This is a **WebXR** game. It runs in the browser (Meta Quest, Pico, desktop) with **no app install**.

> ⚠️ **WebXR requires HTTPS** (or `localhost`). To share a public link, host it on a service that provides HTTPS.

---

## Option 1: GitHub Pages (free, public)

1. Create a new repository on GitHub (e.g. `storm-chaser-vr`).
2. Upload these files to the repo root:
   - `index.html`
   - `style.css`
   - `main.js`
   - Plus the Three.js vendor file: copy `webxr-fps/vendor/three.module.js` into your repo as `vendor/three.module.js`
     - And update the importmap in `index.html` to `"./vendor/three.module.js"`
3. In GitHub: **Settings → Pages** → Build source = **Deploy from a branch** → `main` → `/ (root)` → Save.
4. Your public URL: `https://<your-user>.github.io/storm-chaser-vr/`
5. Open on your Quest browser → it works in VR (HTTPS ✓).

### Fix the importmap for GitHub Pages

Change `index.html` importmap from:
```json
"three": "../webxr-fps/vendor/three.module.js"
```
to:
```json
"three": "./vendor/three.module.js"
```
And place `three.module.js` in a `vendor/` folder next to `index.html`.

---

## Option 2: Netlify Drop (fastest, no GitHub)

1. Go to [netlify.com](https://netlify.com) → log in.
2. Drag your `webxr-storm-chaser` folder onto **Netlify Drop**.
3. It gives you a public `https://...netlify.app` URL instantly.
4. HTTPS is automatic → WebXR works on Quest.

---

## Option 3: Vercel (free, public)

1. Push your files to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → Import the repo.
3. Deploy → public `https://...vercel.app` URL.
4. HTTPS automatic → WebXR works.

---

## Option 4: Itch.io (game-focused)

1. Create a game page on [itch.io](https://itch.io).
2. Upload an HTML export: zip `index.html`, `style.css`, `main.js`, `vendor/three.module.js`.
3. Set "This file will be played in the browser" → `index.html`.
4. Publish → public itch.io URL.

---

## Test locally first

Run the included PowerShell server:

```powershell
# In the webxr-storm-chaser folder
.\serve.ps1
```

Then open:
- Desktop: `http://localhost:8080`
- Quest headset: `http://<your-pc-ip>:8080` (works on same Wi-Fi; WebXR may warn about non-HTTPS on LAN, but localhost is fine)

---

## Controls

| Action | VR (Quest) | Desktop |
|--------|-----------|---------|
| Move | Left stick | WASD |
| Snap turn | Right stick | Mouse look |
| Enter / exit car | Trigger or Grip | E / click |
| Drive car | Left stick (throttle/steer) | WASD |
| Run | — | Shift |

---

## Features

- 4 tornado types: **Wedge, Multi-Vortex, Rope, Cone**
- Live wind system pushing cars
- Drivable storm chaser cars
- **In-car dashboard computer** showing wind speed (MPH), target tornado, distance
- VR + desktop modes in one build

---

## Files to publish

```
index.html
style.css
main.js
vendor/three.module.js   (copy from webxr-fps/vendor/)
```

That's it — no build step, no Unity, no APK. Just upload and share the HTTPS link.

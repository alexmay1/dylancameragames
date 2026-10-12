# Camera Games

Camera-controlled mini games that run in the browser (iPad / iPhone Safari, desktop Chrome). No app, no controllers: the front camera tracks your hands (MediaPipe Hand Landmarker) or body (MediaPipe Pose Landmarker).

**Games (21):** Bubble Pop, Fruit Slicer, Juggle (incl. unicycle mode), Whack-a-Mole, Rock Paper Scissors, Baseball, Tennis, Basketball, Bowling, Golf, Football, Ping-Pong, Air Hockey, Archery, Volleyball, Hockey Shootout, Jumping Jacks, Soccer, Boxing, Dodgeball, Skiing. There is also a Camera check screen with tracking tips.

## Run locally
```
python3 -m http.server 8000
```
Open http://localhost:8000/ (camera access needs `https://` or `localhost`).

## GitHub Pages
Settings → Pages → Source: *GitHub Actions* (or *Deploy from a branch*: `main` / root). The included workflow `.github/workflows/pages.yml` deploys the repo root. All asset paths are relative, so it works under `/dylancameragames/`.

## URL options
- `?touch=1` – play with mouse/finger instead of the camera (for testing).
- `?debug` – extra debug info.

The version label is shown at the bottom of the menu. Best scores are stored in `localStorage` (per origin).

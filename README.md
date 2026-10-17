# PanelCast — Barrier-Free Webtoon Publishing & Audio Reader Platform

**PanelCast** transforms vertical-scroll webtoon manuscripts into barrier-free, multi-voice audio editions for blind and low-vision readers. Built with **Google Gemini**, **Google Cloud Text-to-Speech**, and **Google Cloud (`Cloud Run`, `Firestore`, `Cloud Storage`, `Secret Manager`)**, PanelCast bridges the gap between webtoon creators on tight weekly deadlines and screen-reader users who need structured, spoiler-safe scene narration, expressive character voices, and verified sound effects.

- **Live Production Web App (`panelcast-web`)**: `https://panelcast-web-954098036508.asia-northeast3.run.app`
- **Live Accessible Reader (`ep_solo_max_newbie_02`)**: `https://panelcast-web-954098036508.asia-northeast3.run.app/read/ep_solo_max_newbie_02`
- **Live Customization Studio (`ep_solo_max_newbie_02`)**: `https://panelcast-web-954098036508.asia-northeast3.run.app/studio/ep_solo_max_newbie_02`
- **Private Worker Service (`panelcast-worker`)**: `https://panelcast-worker-954098036508.asia-northeast3.run.app`
- **GitHub Repository**: `https://github.com/froggy-hyun/PanelCast`

---

## Google DeepMind AI Hackathon

[![Google DeepMind AI Hackathon — October 16, 2026](docs/assets/google-deepmind-ai-hackathon.png)](https://cerebralvalley.ai/e/google-deepmind-ai-hackathon)

Built by **Sunghyun Choi (최성현)** for the [Google DeepMind AI Hackathon](https://cerebralvalley.ai/e/google-deepmind-ai-hackathon), hosted by Google DeepMind and AttentionX in Seoul.

### Build Time & Development Tools

| Item | Details |
| --- | --- |
| Official build window | **October 16, 2026, 11:20–15:20 KST (UTC+9)** |
| Total time | **4 hours / 240 minutes**, covering application development, bug fixing, and demo video production |
| Development environment | **Google Antigravity exclusively** for application implementation and debugging |
| Coding model | **Gemini 4 Argon**, provided for the hackathon, with **High** reasoning throughout application implementation and debugging |

The time above uses the build window in the [official event agenda](https://cerebralvalley.ai/e/google-deepmind-ai-hackathon), rather than separate measured durations for development, debugging, and video production. The full event ran from 10:00 to 17:00 KST. The Antigravity and High settings describe the development workflow, not the application's runtime model settings.

### Presentation & Submission Materials

- [Korean presentation — PDF](docs/presentation/PanelCast_KO.pdf)
- [English presentation — PDF](docs/presentation/PanelCast_EN.pdf)
- [Presentation and uploaded webtoon files — Google Drive](https://drive.google.com/drive/folders/1Ru-xn8OIYWym3qhSdjYwGiXs-mNFzAJX?usp=sharing)
- [Live application — Google Cloud Run](https://panelcast-web-954098036508.asia-northeast3.run.app/)

## Google Services Used by Feature

The following maps the repository's implementation and deployment configuration to each feature.

| Feature | Google service | How PanelCast uses it |
| --- | --- | --- |
| Webtoon analysis and accessible scripts | **Gemini API — Gemini 4 Argon** | Analyzes manuscript tiles to identify panels, reading order, characters, dialogue, scene descriptions, and sound cues. See [gemini.ts](src/lib/gemini.ts). |
| Character voices and bilingual narration | **Gemini API — Gemini TTS** | Synthesizes Korean and English narration and dialogue segment by segment with assigned character voices. The configured model IDs are `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`. See [gemini.ts](src/lib/gemini.ts). |
| Alternative speech synthesis | **Google Cloud Text-to-Speech — Neural2** | Provides Korean and English speech when Gemini TTS is unavailable, or when `PANELCAST_PREFER_CLOUD_NEURAL2_TTS=true`. Character profiles map to Neural2 voices with pitch and speaking-rate adjustments. |
| Web application and processing worker | **Google Cloud Run** | Hosts the reader, publisher desk, customization studio, and separate processing service in `asia-northeast3` (Seoul). |
| Episode and revision records | **Cloud Firestore** | Stores episode, revision, and task metadata. Large revision payloads are stored in Cloud Storage. See [store.ts](src/lib/store.ts). |
| Manuscripts, high-contrast images, and audio | **Google Cloud Storage** | Stores uploaded images, processed assets, and generated WAV files in a private bucket when cloud storage sync is enabled. See [store.ts](src/lib/store.ts). |
| Runtime API key configuration | **Google Cloud Secret Manager** | Supplies the Gemini API key to Cloud Run through the deployment's secret binding. |
| Container builds | **Google Cloud Build** | Builds the application container with `gcloud builds submit` before deployment to Cloud Run. |

**Implementation notes:** The current [task dispatcher](src/lib/tasks.ts) uses direct HTTP requests to the worker. Cloud Tasks appears in dependencies and configuration, but the dispatcher does not call the managed Cloud Tasks API. High-contrast webtoon images are generated with **Sharp** in [pipeline.ts](src/lib/pipeline.ts), while UI contrast is handled by the frontend; this feature does not call a Google image-generation model. The presentation PDFs are included as provided; this table describes the current source implementation.

---

## Key Capabilities

### 1. Dual Publishing Workflows for Webtoon Creators & Publishers
- **Path A — Auto Publish (`바로 등록`)**: Designed for creators right after a weekly manuscript deadline. A single upload slices long vertical strip manuscripts into overlapping analysis tiles, extracts panel boundaries and reading order via `gemini-4-argon`, reconciles the episode cast, assigns distinct Korean and English voices, matches verified sound effects (with voice-narration fallback when confidence is low), validates 100% of audio assets, and atomically publishes the episode.
- **Path B — Accessibility Customization (`접근성 커스텀`)**: Opens the **Studio Workbench (`/studio/[episodeId]`)** where creators or accessibility editors can:
  - Cast voices per character from an 8-voice pool (`Kore`, `Puck`, `Charon`, `Fenrir`, `Aoede`, `Zephyr`, `Leda`, `Orus`) with custom acting style prompts, speaking rate, and pitch hints.
  - Configure **Spoiler-Safe Speaker Masking (`unrevealedLabel` & `revealedAtPanelId`)** so mysterious characters are announced as *"Unidentified Voice"* (`정체불명의 목소리`) until the exact panel where their identity is revealed.
  - Merge duplicate character detections (`Merge Characters`).
  - Adjust per-cut hold times (`extraHoldMs`), dialogue pauses (`pauseAfterMs`), and sound effect cues (`sound_effect` vs. `voice_narration` fallback).
  - Run **Selective Regeneration (`inputHash` guard)**: only modified dialogue or voice segments are re-synthesized while unchanged audio assets are reused and stale worker outputs are rejected.
  - Edit a cloned draft revision (`cloneRevisionAsEditableDraft`) while readers continue listening to the currently published revision uninterrupted.

### 2. Barrier-Free Reader (`/read/[episodeId]`)
- **Sequential Cut & Segment Playback**: Plays each cut's sound cues and dialogue/narration segments strictly in order, waiting for every segment `ended` event plus `extraHoldMs` before advancing to the next cut.
- **Full Keyboard & Screen-Reader Operability**:
  - `Space`: Play / Pause sequential cut playback
  - `→` or `J`: Next cut (immediately cancels prior audio/timers and announces the new cut via `aria-live="polite"`)
  - `←` or `K`: Previous cut
  - `R`: Replay current cut from the beginning
  - `L`: Switch playback language between **Korean (`ko`)** and **English (`en`)** while preserving the current cut position
  - **Input Focus Guard**: All single-key shortcuts automatically pause when typing in the reader feedback form.
- **High-Contrast Reader & Webtoon Images**: A `Pretendard` interface with a one-click **High Contrast (`data-contrast="high"`)** mode that switches both the UI and the webtoon artwork to high-contrast versions generated with Sharp. Interactive controls use 44×44px minimum touch targets. Passes `@axe-core/playwright` WCAG 2.1 AA audits with zero critical or serious violations.

---

## System Architecture

```mermaid
flowchart LR
  subgraph Client["Accessible Web Client (Next.js 16 App Router)"]
    Home["Library & Publisher Desk (/)"]
    Studio["Customization Studio (/studio/[episodeId])"]
    Reader["Barrier-Free Reader (/read/[episodeId])"]
  end

  subgraph CloudRun["Google Cloud Run (asia-northeast3)"]
    WebSvc["panelcast-web (Public HTTP + Asset Proxy)"]
    WorkerSvc["panelcast-worker (Async Pipeline Worker)"]
  end

  subgraph GCP["Google Cloud & Gemini AI"]
    GeminiVision["Gemini 4 Argon (Multimodal Cut & Script Analysis)"]
    GeminiTTS["Gemini TTS (Character Voices & Narration)"]
    CloudTTS["Cloud Text-to-Speech Neural2 (Alternative Speech Synthesis)"]
    Firestore["Cloud Firestore Native (Episodes & Revisions)"]
    GCS["Private Cloud Storage (Manuscripts, Tiles, WAV Assets)"]
    Secrets["Secret Manager (panelcast-gemini-api-key)"]
  end

  Home --> WebSvc
  Studio --> WebSvc
  Reader --> WebSvc
  WebSvc --> Firestore
  WebSvc --> GCS
  WebSvc -->|HTTP task dispatch| WorkerSvc
  WorkerSvc --> GeminiVision
  WorkerSvc --> GeminiTTS
  WorkerSvc --> CloudTTS
  WorkerSvc --> Firestore
  WorkerSvc --> GCS
  Secrets -.-> WebSvc
  Secrets -.-> WorkerSvc
```

### Engineering Highlights
1. **Boundary-Preserving Overlap Tiling (`src/lib/tiling.ts`)**: Webtoon manuscripts are uploaded as 50–80 vertical strips (e.g., 60 strips × `690×1600px` = `96,000px` tall). PanelCast stitches and slices strips into overlapping vertical windows (`overlapPx = 400px`) so speech bubbles split across strip edges are never lost, then deduplicates overlapping detections via vertical IoU and normalized text similarity.
2. **Unlimited Cast Orchestration (`src/lib/cast.ts` & `src/lib/gemini.ts`)**: Instead of relying on a 2-speaker multi-speaker TTS call, PanelCast orchestrates individual per-segment single-voice synthesis calls across an 8-voice prebuilt pool and automatically differentiates overflow supporting characters via speaking rate, pitch, and style prompt modifiers.
3. **Private Manuscript & Audio Proxy (`src/app/api/assets/[...assetPath]/route.ts`)**: Raw webtoon manuscripts and generated audio are stored in a private GCS bucket (`publicAccessPrevention: enforced`). Public readers can stream only assets referenced by the currently `published` revision, while unpublished draft assets require an authenticated studio session.

---

## Featured Demo Episode

- **Title**: *Solo Max-Level Newbie — Ep. 02: Prologue* (`나 혼자 만렙 뉴비 — 02화. 서막`)
- **Episode ID**: `ep_solo_max_newbie_02` (`rev_ep_solo_max_newbie_02_v1`)
- **Source Manuscript**: 60 vertical JPEG strips (`01.jpg`–`60.jpg`, `690×1600px` each, `96,000px` total vertical height, `66.24 MP`, 25 overlapping vertical tiles)
- **Processed Output**: **42 narrative cuts/panels**, **104 dialogue & narration segments**, **19 distinct characters** with spoiler-safe speaker naming, **22 sound cues**, and **208 synthesized Korean (`ko`) + English (`en`) RIFF WAV audio tracks** (`status=published`, `valid=true`, `issues=0`).

---

## Local Development & Verification

### Prerequisites
- Node.js `>= 22.0.0`
- Google Cloud SDK (`gcloud`) authenticated against project `h2gdm-hack26icn-2669`

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and populate `GEMINI_API_KEY` and `PANELCAST_STUDIO_SECRET`:
```bash
cp .env.example .env
```

### 3. Run Unit & Pipeline Integration Suite (`T01`–`T18`)
```bash
npm test
```

### 4. Build & Start Production Server
```bash
npm run build
npm run start
```

### 5. Run Playwright E2E & Axe-Core WCAG 2.1 AA Suite
```bash
npm run test:e2e
```

---

## Google Cloud Run Deployment (`asia-northeast3`)

Both `panelcast-web` and `panelcast-worker` are deployed as container services in `asia-northeast3` (`Seoul`) with `GEMINI_API_KEY` mounted from Google Cloud Secret Manager (`panelcast-gemini-api-key`):

```bash
# Build container image with Cloud Build
gcloud builds submit --tag gcr.io/h2gdm-hack26icn-2669/panelcast:latest

# Deploy public web service
gcloud run deploy panelcast-web \
  --image gcr.io/h2gdm-hack26icn-2669/panelcast:latest \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=h2gdm-hack26icn-2669,GCP_REGION=asia-northeast3,GCS_PRIVATE_BUCKET=h2gdm-hack26icn-2669-panelcast-private,CLOUD_TASKS_QUEUE=panelcast-episode-queue,ENABLE_CLOUD_STORAGE_SYNC=true,PANELCAST_SERVICE_MODE=web" \
  --set-secrets="GEMINI_API_KEY=panelcast-gemini-api-key:latest"

# Deploy private async worker service
gcloud run deploy panelcast-worker \
  --image gcr.io/h2gdm-hack26icn-2669/panelcast:latest \
  --region asia-northeast3 \
  --no-allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=h2gdm-hack26icn-2669,GCP_REGION=asia-northeast3,GCS_PRIVATE_BUCKET=h2gdm-hack26icn-2669-panelcast-private,CLOUD_TASKS_QUEUE=panelcast-episode-queue,ENABLE_CLOUD_STORAGE_SYNC=true,PANELCAST_SERVICE_MODE=worker" \
  --set-secrets="GEMINI_API_KEY=panelcast-gemini-api-key:latest"
```
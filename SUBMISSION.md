# PanelCast — Hackathon Submission & 3-Minute Demo Script

## 1. Project Summary (English Submission Text)

### Tagline
**PanelCast**: An AI-powered barrier-free webtoon publishing studio and screen-reader audio platform that turns vertical-scroll comics into multi-voice, spoiler-safe audio editions in Korean and English.

### Live Deployment & Repository Links
- **Production Web Application (`panelcast-web`)**: `https://panelcast-web-954098036508.asia-northeast3.run.app`
- **Barrier-Free Reader (`Solo Max-Level Newbie — Ep. 02`)**: `https://panelcast-web-954098036508.asia-northeast3.run.app/read/ep_solo_max_newbie_02`
- **Accessibility Customization Studio**: `https://panelcast-web-954098036508.asia-northeast3.run.app/studio/ep_solo_max_newbie_02`
- **Private Async Worker (`panelcast-worker`)**: `https://panelcast-worker-954098036508.asia-northeast3.run.app`
- **GitHub Repository**: `https://github.com/froggy-hyun/PanelCast`

### The Problem
Webtoons are a visually driven medium built around long vertical-scroll canvases, dynamic panel layouts, expressive typography, and game-like system popups. For blind and low-vision readers, conventional OCR or screen readers fail completely:
1. Long vertical strips (`96,000px+` per episode) split speech bubbles across image file boundaries.
2. Visual action, facial expressions, and atmospheric transitions contain zero alt-text.
3. Reading raw dialogue without speaker attribution or with premature name reveals spoils plot twists.
4. Creators working under intense weekly deadlines lack the time and audio-production tooling to produce accessible editions manually.

### Our Solution
**PanelCast** embeds accessibility directly into the webtoon publishing workflow with two creator paths and a dedicated barrier-free reader:
- **One-Shot Auto Publish (`바로 등록`)**: Creators upload their raw manuscript strips (`01.jpg`..`60.jpg`, `96,000px` total vertical height) and click once. PanelCast builds overlapping vertical tiles, uses **Gemini 4 Argon (`gemini-4-argon`)** to detect cut boundaries (`42 panels`), write vivid Korean and English scene descriptions, attribute every dialogue bubble and system window (`104 segments`), reconcile the episode cast (`19 characters`), synthesize multi-character voices via **Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`, `208 WAV assets`)**, attach verified sound effects (`22 sound cues`), run an automated validation and self-correction gate, and publish atomically.
- **Accessibility Customization Studio (`접근성 커스텀`)**: When creators or editors want fine-grained direction, they open `/studio/[episodeId]` to customize character voice casting, spoiler-safe unrevealed aliases (`unrevealedLabel` + `revealedAtPanelId`), sound effect fallback modes, and cut hold timing—regenerating **only** the modified segments (`inputHash` guard) while keeping the live published edition untouched.
- **Barrier-Free Webtoon Reader (`/read/[episodeId]`)**: A WCAG 2.1 AA compliant, keyboard-first (`Space`, `←/K`, `→/J`, `R`, `L`) and screen-reader friendly (`aria-live="polite"`) reader that plays cuts sequentially in Korean or English and offers a high-contrast editorial reading view for low-vision users.

### Google AI & Google Cloud Technologies Used
- **Gemini 4 Argon (`gemini-4-argon`)**: Multimodal spatial and narrative analysis of overlapping vertical webtoon tiles with structured JSON schema output.
- **Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts` & `gemini-3.8-flash-lite-tts`)**: Expressive Korean and English character voice synthesis across a 12-voice pool, orchestrated per segment to support unlimited characters per episode.
- **Google Cloud Run (`asia-northeast3`)**: Hosts both `panelcast-web` (public Next.js editorial application and authenticated asset proxy) and `panelcast-worker` (private async pipeline worker).
- **Google Cloud Firestore (Native Mode)**: Stores episode catalog metadata, revision states, and idempotent task leases.
- **Google Cloud Storage (Private Bucket)**: Stores raw manuscript strips, overlap tiles, and synthesized RIFF WAV audio assets with `publicAccessPrevention: enforced`.
- **Google Cloud Tasks & Secret Manager**: Manages async episode processing queues (`panelcast-episode-queue`) and injects `panelcast-gemini-api-key` securely at runtime.

---

## 2. 3-Minute Live Demo Script (English)

### [0:00 – 0:35] The Accessibility Gap & Editorial Library (`/`)
- **Action**: Open the live Cloud Run URL (`/`). Toggle **High Contrast** mode on and off, then show the published catalog featuring *"Solo Max-Level Newbie — Ep. 02: Prologue"* (`나 혼자 만렙 뉴비 — 02화. 서막`), processed from 60 vertical JPEG strips (`96,000px` total height).
- **Narration**:
  > "Webtoons are read by hundreds of millions of people, yet they remain almost completely inaccessible to blind and low-vision readers. A single episode—like Episode 2 of *Solo Max-Level Newbie*—consists of 60 vertical strip images totaling 96,000 pixels in height, filled with visual action, system popups, and unattributed speech bubbles. PanelCast solves this at the point of publishing."

### [0:35 – 1:40] Barrier-Free Audio Reader & Live KO/EN Switching (`/read/ep_solo_max_newbie_02`)
- **Action**: Click **"배리어프리 오디오 리더로 감상하기" (Listen in Barrier-Free Reader)** to open `/read/ep_solo_max_newbie_02`.
  1. Press `Space` to start sequential playback of Cut 1. Let the scene description and character voice play.
  2. Press `→` (`ArrowRight`) three times rapidly to jump ahead to Cut 4. Point out that prior audio stops immediately without overlap and the screen-reader live region announces the new cut.
  3. Press `L` (or click **English Audio**) to switch the reader to English (`lang="en"`). Press `Space` to play the English narration and dialogue for the exact same cut.
- **Narration**:
  > "In the Barrier-Free Reader, every cut is presented as a synchronized sequence of visual scene narration, sound cues, and character dialogue. Blind readers navigate entirely by keyboard—`Space` to play, `ArrowRight` or `J` to jump cuts, and `R` to replay. Notice how skipping cuts rapidly cancels any in-flight audio cleanly. And with a single press of `L`, the entire episode switches from Korean to English multi-voice audio while staying on the exact same cut."

### [1:40 – 2:35] Creator Publishing Desk & Accessibility Customization Studio (`/studio/ep_solo_max_newbie_02`)
- **Action**: Return to `/` and unlock the **Creator & Publisher Manuscript Desk**, showing the two upload options: **Auto Publish (`바로 등록`)** and **Accessibility Customization (`접근성 커스텀`)**. Open `/studio/ep_solo_max_newbie_02`.
  1. Show the **Character Voice Casting & Spoiler Protection** cards. Highlight how a character can be masked with an `Unrevealed Alias` until a specific `Revealed At Cut` panel.
  2. Scroll to the **Cut-by-Cut Script & Timing Editor**, modify a dialogue line or delivery style in Cut 1, and click **"1. 커스텀 설정 저장" (Save Customizations)**.
  3. Click **"2. 변경된 대사만 선택 음성 합성" (Synthesize Changed Segments Only)** and point to the status banner showing that only the modified segment was synthesized while all unchanged segments were reused via `inputHash`.
  4. Click **"3. 검증 및 원자적 게시" (Validate & Atomic Publish)** to pass the 7-point validation checklist and update the live revision.
- **Narration**:
  > "For creators on a tight weekly deadline, Auto Publish handles the entire pipeline in one click. When a creator wants deeper direction, the Customization Studio lets them assign distinct Gemini voices across any number of characters, mask a character's true name until the exact reveal cut to prevent spoilers, and fine-tune dialogue or pacing. Thanks to content-addressed `inputHash` tracking, editing one line re-synthesizes only that segment in seconds, and Atomic Publish guarantees readers never encounter a half-finished revision."

### [2:35 – 3:00] Cloud Architecture & Closing
- **Action**: Show the validation checklist (`Valid: true`, 100% RIFF WAV verification) and Cloud Run service status.
- **Narration**:
  > "Powered by Gemini 4 Argon, Gemini 3.8 Flash TTS, and Google Cloud Run with Private Cloud Storage and Firestore, PanelCast turns accessibility from an expensive afterthought into a seamless part of webtoon publishing."

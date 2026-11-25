# Handover

給沒看過先前對話的人或編碼代理：應能只靠本檔與 README 執行、理解、修改與驗證這款遊戲。

## Status

可玩的 AR 雙手琴弦原型。全螢幕鏡像 webcam（無鏡頭時為單色背景；開啟鏡頭後背景透明，只畫實況與疊加層）、MediaPipe 風格綠骨紅點、彩色懸浮弦、音名／頻率／長度標籤、端點拖曳、撥弦鋼琴音色。介面為繁體中文。原始碼已公開於 https://github.com/wayneleong-byte/ar-hand-strings ，線上試玩 https://wayneleong-byte.github.io/ar-hand-strings/ 。

## What works, and how it was verified

Verified 2026-11-25 (Asia/Macau) on this box, with synthetic hands only (no real webcam):

- `npm test`: 16 tests passed (pitch inverse law, two-pinch create, drag-to-retune, path and body-pinch plucks, one-pointer drag fallback, GestureEngine pinch on Left and Right and both at once).
- `npm run build` and `tsc --noEmit` passed.
- `npm run capture`: bot created 3 strings (E4 / G#4 / C#6), plucked twice, then grabbed an endpoint and retuned E4 → B4. Mouse drag created a string; a cursor swipe plucked it (`pointerPlucks: 3`). `window.__app.createString` + `pluck` incremented `notes`. Longer strings had lower `rawHz`. No console errors. Screenshots in `captures/` were checked by eye.
- `npm run fps`: 20.1 fps, p95 66.7 ms at DPR 2, `glInvalid: 0`. This headless box does not appear to have a useful GPU (frame times sit on a 50 ms step), so the number is not a fair 60 fps check. The scene is a 2D canvas overlay and should be re-measured on a real GPU.
- `npm run loud`: p90 −27.8 dBFS, peak −16.5 dBFS (master gain 0.32).

## Not verified

- 真人、真實 webcam 的十分鐘試玩與閾值微調（此環境沒有鏡頭迴路）。若尚未實測，請不要宣稱「鏡頭下手感已調好」。
- 用耳朵聽音色是否自然（請在本機開聲試聽）。
- 真實手機、Safari、Firefox。

## Known problems and next steps

1. 真實鏡頭下 pinch 閾值可能要微調（先改 `PINCH_ON` / `PINCH_OFF`，再改 `GRAB_R`、`PLUCK_R`）。
2. 長度是以畫面寬 = 80 cm 估計，不是深度相機；手離鏡頭遠近會讓厘米讀數偏移，但音高仍穩定可分辨。
3. 若之後要把雙手拉弦／撥弦收成獨立 skill，出發點是 `src/string-gestures.ts` + `src/rules.ts` + `src/pitch.ts`。

## Tuning knobs

| Constant | File | What it does |
| --- | --- | --- |
| `PINCH_ON`, `PINCH_OFF` | `src/pinch.ts` | pinch 按下／放開閾值 |
| `GRAB_R`, `PLUCK_R`, `BODY_R` | `src/rules.ts` | 抓端點、劃弦、捏弦身的距離（畫面高度單位） |
| `VIEW_WIDTH_CM`, `REF_LEN_CM`, `REF_FREQ` | `src/pitch.ts` | 厘米校準與 49 cm → E4 |
| `MIN_LEN_CM` | `src/pitch.ts` | 短於此則不建弦 |
| master gain (`Sound.GAIN` = 0.32) | `src/audio.ts` | 整體音量 |

## Design decisions

- 從官方 `templates/game` starter 起步，保留鏡頭點擊啟動、滑鼠／觸控後備、`?bot=1`、測試鉤子與工具；規則、場景、聲音全部換掉。
- 畫面是 2D canvas 疊在鏡像鏡頭上（對齊參考截圖），不是 starter 的 three.js 黃昏場景，因此拿掉了 three.js。
- 不把參考截圖中的真實人臉當素材；無鏡頭時是單色背景，開啟鏡頭後背景透明。
- 套件現成雙手事件不夠用，故在 kit 之上自定拉弦／抓端點／撥弦，不改 `src/hand-gesture-kit/`。
- 頻率先依 f ∝ 1/L 連續計算，再就近對到十二平均律，標籤顯示標準音名與整數 Hz，與參考 UI 一致。不必複製參考圖上每一條弦的厘米數字（那些讀數本身也不嚴格滿足單一常數）。

## Gotchas

- 不要在引擎的 One Euro 平滑上再加一層。
- `tap` 在手指分開時才觸發；拉弦期間請讀連續的 `pinch` 與 pinch 點位置。
- `@mediapipe/tasks-vision` 必須釘在 1.1.0，與複製的 wasm 相符。
- 視窗小於 2 px 時略過繪製，避免 0×0 產生 NaN。
- 音訊與鏡頭都要從使用者點擊啟動。

## Progress log

- 2026-11-25：由 open-source-hands 遊戲 starter 做成懸浮琴弦原型；單元測試、build、capture、loud 已跑過。真實鏡頭尚未試。

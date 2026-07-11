# Design QA — Hilihili 首页改版

- Source visual truth: `C:\Users\Eray0\.codex\generated_images\019f4efb-d7e0-7e83-a8e8-9a2df3aa99f7\exec-a57c98f9-d66f-4eae-b8cb-b535d6985fb3.png`
- Implementation: `http://localhost:3100/`
- Implementation screenshot: unavailable; the in-app Browser timed out on every `Page.captureScreenshot` attempt, including a fresh tab, a viewport-only capture, a 640×360 clip, and a raw CDP capture.
- Intended comparison viewport: 1440×1024 desktop.
- Browser-observed viewport: 1280×720 desktop after the viewport override could not be retained.
- State: safe-demo homepage, first featured item selected, dark theme.

## Browser verification completed

- The page loaded successfully and exposed the expected semantic regions: `本次精选`, `继续观看`, and `逛逛媒体库`.
- Both visible `下一个精选` controls changed the featured item from `多分P交互演示` to `自带封面演示`.
- The unique `换一换` button completed its refresh cycle and returned to enabled state.
- The page DOM contains no play-count or public-audience metric labels.
- Console check found no runtime errors. One Next.js LCP image warning was observed; the hero image is already marked priority, but `ApiImage` still reports the framework warning in development.

## Full-view comparison evidence

Blocked. The source visual is available, but the Browser could not produce a rendered implementation screenshot. DOM structure and interactions are not a substitute for visual comparison.

## Focused-region comparison evidence

Blocked for the same reason. Attempts to capture the top 640×360 region also timed out.

## Fidelity surfaces

- Fonts and typography: implementation continues to use the project Geist stack; visual size, weight, wrapping, and optical comparison are blocked without a screenshot.
- Spacing and layout rhythm: intended section order and responsive grid contracts are present in the DOM; visual proportions and vertical rhythm remain unverified.
- Colors and visual tokens: implementation reuses `--background`, `--foreground`, and `--accent`; rendered contrast and opacity remain unverified.
- Image quality and asset fidelity: implementation uses real indexed media covers via `ApiImage`, not placeholders or CSS-drawn imagery; crop and sharpness remain unverified.
- Copy and content: roles are separated as `本次精选` (decision reduction), `继续观看` (resume), and `逛逛媒体库` (exploration). `本次精选` may label recent candidates as `最近入库 · 精选` without limiting the pool to recent items. No play-count concept is introduced.

## Findings

- [P1] Visual comparison evidence is missing.
  - Location: full homepage and focused hero region.
  - Evidence: source mock opened successfully; every implementation screenshot capture timed out.
  - Impact: layout fidelity, spacing, typography, image crop, and responsive polish cannot receive a passing visual judgment.
  - Fix: restore screenshot capture in the in-app Browser, then compare the rendered page and source at a matched viewport.

## Comparison history

1. Initial 1440×1024 viewport: full screenshot timed out.
2. Fresh tab and 1280×720 default viewport: full screenshot timed out.
3. Focused 640×360 clip: screenshot timed out.
4. Raw CDP `Page.captureScreenshot` with a 30-second timeout: timed out.
5. Hero preview was simplified from a large video preview to a static real cover image; DOM and page behavior remained healthy, but screenshot capture still timed out.

## Implementation checklist

- [x] Match the selected information architecture.
- [x] Add subtle previous/next and position controls for multiple featured items.
- [x] Allow recently indexed items to appear in the featured pool without making it a latest-only feed.
- [x] Make continue-watching compact.
- [x] Add an independent browse refresh action.
- [x] Avoid play counts and public-audience metrics.
- [x] Verify primary interactions and console errors.
- [ ] Capture and compare rendered visual evidence.

## Follow-up polish

None classified until the rendered comparison is available.

final result: blocked

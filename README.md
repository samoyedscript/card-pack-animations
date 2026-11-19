# Card Pack Animations

A small interactive demo of five silver foil packs, a directional rip, and a
single grey mystery card. Built with React, TypeScript, Vite, and Three.js.

## Run locally

Use Node.js 24 or newer and npm:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. No account, environment variables, backend, or
remote assets are needed. Both development and preview bind to loopback.
There is no hosting or deployment integration.

```sh
npm run typecheck
npm run build
npm run preview
```

The build is written to the ignored `dist/` directory. Preview runs at
**http://127.0.0.1:4173**.

## Controls

| Action | Pointer or touch | Keyboard |
| --- | --- | --- |
| Browse packs | Drag outside the front pack, or scroll | Left / Right |
| Rotate the front pack | Drag across it | Shift + Left / Right |
| Select a pack | Click or tap it | Enter / Space |
| Rip the wrapper | Drag from the starting dot to the right | Enter / Space on the tear control |
| Return to the carousel | Close button, or tap outside the revealed card | Escape |

Tab to the carousel before using its keyboard controls. A partial tear resets
when released. Every pack reveals the same card, with no random draws or stored
progress. If WebGL is unavailable, a CSS pack layout keeps opening usable.

The reveal waits 200 ms after the rip, introduces the white spotlight over
300 ms, then waits 200 ms before showing the decoded card. Timers, CSS animations,
and rendering pause while the tab is hidden. This animation demo intentionally
preserves full motion, including when the system requests reduced motion.

## Reuse the component

Copy `src/components/` and `src/effects/` into a React TypeScript project with
`react`, `react-dom`, and `three` installed. `PackExperience` imports its own CSS
and renders a full viewport stage. Mount one experience per page.

```tsx
import { PackExperience } from "./components/PackExperience";

<PackExperience
  packFront="/pack-front.svg"
  packBack="/pack-back.svg"
  card={{ image: "/card.svg", alt: "A mystery card" }}
/>
```

`src/index.ts` exports the component and `PackExperienceProps`. Pack textures
should have a width-to-height ratio of approximately 1.86:3.5. Cards use 5:7.
All three SVGs in `public/` are newly authored placeholders and may be replaced
with artwork you have permission to share. The spotlight and card tilt/glare
are original CSS effects.

## Test

```sh
npx playwright install chromium webkit
npm run build
npm test
```

Tests cover desktop Chromium, mobile Chromium, mobile WebKit, shared pack
geometry, carousel controls, interrupted/completed tears, reveal timing,
background pausing, repeated openings, image retry, and WebGL fallback.
Test reports and screenshots are ignored by Git.

## License

[MIT](LICENSE), including the placeholder artwork. See
[third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.


# Handoff: Start Workout Modal (Trbo)

## Overview
A modal shown when a user taps into a workout in Trbo (indoor cycling app). It shows the workout's profile as a bar chart, lets the user scale the workout's length with a custom slider, set their FTP, star/queue the workout, and start it.

## About the Design Files
The file in this bundle (`Start Workout Modal.dc.html`) is a **design reference built in HTML** — a working prototype showing the intended look, layout, and interaction behavior. It is not production code to paste into the app. Recreate this design in the app's existing environment (its actual component library / framework) using its established patterns. If you open the file directly in a browser it renders and is interactive (the custom slider can be dragged) — use that to check exact behavior.

## Fidelity
**High-fidelity.** Colors, type, spacing, and the custom slider interaction are final — implement pixel-accurately.

## Screens / Views

### Start Workout Modal (single screen)
**Purpose:** Preview a workout, optionally scale its duration, set FTP, then start/queue it.

**Layout:** Centered modal card, `max-width: 520px`, full width on mobile, `border-radius: 18px`, `padding: 20px`, dark background `#14171A`, `1px solid #31373F` border. Card scrolls internally if content exceeds `min(85vh, 700px)`.

Vertical stack, `gap`-free flex/margin layout in this order:
1. Header row: pain-mode icon (optional) + title, left; star + close buttons, right.
2. Description text.
3. Tag chips row (Pain / category / total duration / interval count).
4. Interval bar chart (84px tall, segmented).
5. "Adjust length" slider block (only if workout is scalable).
6. Start workout / Queue button row.
7. FTP input row (only if any interval is power-based).
8. Notes box (optional).
9. Interval list (scrollable, max-height 220px).
10. Footer actions (Edit/Delete for custom workouts, Save-as-new if scaled) — only when relevant.

### Component details

**Title row**
- Title: `Big Shoulders Display`, 700 weight, 24px, color `#E9ECEF`, letter-spacing 0.3px.
- Pain icon: red (`#FF4D4D`) skull-like outline icon, 18×18, next to an info "i" button that toggles a tooltip popover (`#242930` bg, 1px `#31373F` border, 8px radius, 11.5px Manrope text `#E9ECEF`).
- Star button: outline star, fills `#2FC5AE`-equivalent accent color when active (toggle).
- Close button: plain X icon, `#8B929B`.

**Description:** 13px, `#8B929B`.

**Tag chips:** 12px text `#8B929B`, `1px solid #31373F` border, `6px` radius, `3px 8px` padding. Pain chip is red-bordered/red text instead.

**Interval bar chart:** flex row of segments, each segment width = its % of total duration, height = intensity-driven (14–100% of the 84px box), background = a zone color (Recovery `#4A6FA5`, Endurance `#4FB8A6`, Tempo `#8FC93A`, Threshold `#C9F031`, VO2 Max `#FF9F40`, Anaerobic `#FF4D4D`, Free/rest = diagonal-stripe pattern on `#31373F`). Container: `#242930` bg, `#31373F` 1px border, 8px radius, overflow hidden, 1px dividers between segments.

**Adjust-length slider — the key custom component.** See "Slider Spec" below.

**Buttons row:** Primary "Start workout" — flex 2, solid accent fill, dark text `#14171A`, 700 weight 15px, 10px radius, play-triangle icon. Secondary "Queue" — flex 1, outlined by default, fills solid accent + dark text when active/queued.

**FTP row:** small gauge icon (accent-colored), "Your FTP" label (`#8B929B` 13px), numeric text input (`#242930` bg, `#31373F` border, 6px radius, `Space Grotesk` 14px), "watts" label.

**Notes box:** `#1D2126` bg, `#31373F` border, 8px radius, 12.5px `#8B929B` text, line-height 1.5.

**Interval list rows:** each row is a flex row, `#1D2126` bg, 6px radius, 6px×8px padding, 13px text: a 4px-wide colored bar (zone color) + label (`#E9ECEF`, truncates) + target text (`#8B929B`) + duration (`#8B929B`, right-aligned, 44px reserved).

**Footer row:** Edit (pencil icon) + Delete (trash icon, red) buttons for custom workouts; "Save as new" (disk icon) when the workout has been time-scaled.

## Slider Spec ("Adjust length") — build this as a genuinely custom control, not a native `<input type="range">`

**Header above the track:** label "ADJUST LENGTH" (11px, 700 weight, uppercase, letter-spacing 0.7px, `#8B929B`) left; live value on the right — `Space Grotesk`, 16px, 700 weight, color `#E9ECEF` normally, switches to the accent color while actively dragging.

**Track (skeuomorphic / inset "carved into the surface" look):**
- Hit area: full width, 13px tall (generous hit target even though the visible track is thinner).
- Visible track bar: 9px tall, fully pill-rounded (`border-radius: 5px`), background `linear-gradient(180deg, #2A2F36, #1A1D21)` (subtle top-to-bottom darkening).
- Track shadow gives it a pressed-in appearance: `inset 0 1px 3px rgba(0,0,0,0.55)` plus a faint bottom inner highlight `inset 0 -1px 0 rgba(255,255,255,0.04)` and a hairline top highlight `0 1px 0 rgba(255,255,255,0.03)`.
- Filled portion (left edge to thumb position): width = `(value − min) / (max − min) × 100%`, background is a left-to-right gradient from the theme's dark accent shade through its main shade to its light shade (see Theming), and it also carries its own inset shadow (`inset 0 2px 4px rgba(0,0,0,0.35)`, `inset 0 -1px 0 rgba(255,255,255,0.15)`) so the fill itself reads as a rounded bar sitting inside the groove, not a flat color swap.
- Tick marks at 60-minute intervals (60/120/180/240/300, skipping any below the floor value): thin 2px verticals, centered vertically on the track, height 4px (minor) or 6px (major, every 2 hours), fully contained within the 9px track height — never overflowing above/below it. Color: translucent dark (`rgba(20,23,26,0.3)` minor / `0.45` major) so they read as etched notches, not painted lines.
- A single marker line (2px, `#E9ECEF` at 40% opacity, 20px tall) shows the workout's *original* (unscaled) length position when the value has been scaled away from it.

**Thumb (raised glossy knob, per the reference screenshot supplied):**
- Diameter 13px at rest, 14px while actively dragging (thumb grows slightly on press for tactile feedback) — deliberately small/subtle relative to the track, not a large dominant knob.
- Circle, centered vertically and horizontally on the track at the current value's position (correct centering requires `box-sizing: border-box` once a border is added, otherwise the border pushes it off-center).
- Background: `radial-gradient(circle at 35% 25%, #ffffff, #d7dbe0 55%, #aeb4bb 100%)` — a light gray/white glossy sphere, regardless of the active accent theme (this stays neutral so it reads against any track color).
- 1px border `rgba(0,0,0,0.15)`.
- Depth via layered box-shadow: drop shadow below (`0 3px 6px rgba(0,0,0,0.5)` at rest, growing to `0 5px 10px rgba(0,0,0,0.55)` plus a soft accent-colored halo ring `0 0 0 6px rgba(<accent glow>,0.16)` while dragging) + an inset dark shadow at the bottom (`inset 0 -2px 3px rgba(0,0,0,0.25)`) + an inset light highlight at the top (`inset 0 1.5px 1px rgba(255,255,255,0.9)`) — together these make it read as a lit, domed physical knob rather than a flat disc.
- Transitions: position/left animates `0.18s cubic-bezier(.2,.7,.3,1)` when not dragging (snaps smoothly on click-to-position or reset); size transitions `0.1s ease`. While actively dragging, position tracks the pointer with no transition (instant/1:1 follow) — only re-enable the position transition on release.

**Interaction model:**
- Pointer-driven, not native `<input type="range">`: `pointerdown` on the track computes the value from `(pointerX − trackLeft) / trackWidth`, clamps to [0,1], maps to the value range, rounds to the nearest step (5-minute steps here), and calls `setPointerCapture` on the track element so subsequent `pointermove` continues to update even if the pointer leaves the element bounds; `pointerup`/`pointercancel` end the drag.
- Value range is dynamic per workout: minimum is a computed "floor" (the shortest this specific workout can be scaled down to), maximum is a fixed ceiling (360 minutes / 6 hours in this app). Labels below the track show the floor value and "6 hours".
- Below the track: floor label (left) and "6 hours" (right), 11px `#8B929B`.
- A "Reset to original length" text link (accent color, 12px, no background/border) appears under the slider only when the value has been scaled away from the workout's original length.

## Theming (accent color)
The design supports swapping a single accent hue used consistently across: slider fill/thumb glow, star fill, primary button background, queue button active state, FTP icon, "reset to original length" link. Reference values used in the prototype (each is a 3-stop family: dark / main / light, plus an RGB triple for glow alpha):
- Teal (default): dark `#1F8C7C`, main `#2FC5AE`, light `#6fe0cc`, glow rgb `47,197,174`
- Violet: dark `#6C4FD1`, main `#9B7EF5`, light `#c4b3fa`, glow rgb `155,126,245`
- Amber: dark `#c27d0e`, main `#F5A623`, light `#ffcf70`, glow rgb `245,166,35`
- Blue: dark `#2E6FB8`, main `#4FA8F5`, light `#8fc9fb`, glow rgb `79,168,245`

Implement as a single theme token/enum so switching it recolors every accent usage at once (the slider thumb itself stays neutral gray/white in all themes, per spec above).

## Interactions & Behavior
- Star toggle: outline ↔ filled accent, no animation needed beyond the icon fill swap.
- Queue toggle: outline button ↔ solid accent fill with dark text.
- Pain-mode info button: click toggles a small tooltip popover anchored above the button; no outside-click-to-close was implemented in the prototype but is recommended for production.
- Slider drag: see Slider Spec above — this is the primary interaction to get right.
- FTP field: numeric-only input (strip non-digits, max 4 chars while typing); on blur/change, clamp to [50, 600] and commit; invalid/empty input reverts to the last committed value.
- Scaling logic: changing the slider recomputes the interval list by proportionally stretching/compressing warmup, cooldown, and steady-state blocks, and by repeating interval blocks, to hit the target duration while preserving the workout's structure (repeat groups, warmup/cooldown, anchor efforts) — this logic already exists in the codebase's workout engine; the modal only needs to call it with the slider's live value and re-render the bar chart / interval list / total-duration label from the result.

## Design Tokens
- **Colors:** background `#14171A`, card border `#31373F`, secondary surface `#242930`, tertiary surface `#1D2126`, primary text `#E9ECEF`, secondary text `#8B929B`, danger `#FF4D4D`; zone colors listed above; accent family per Theming section.
- **Typography:** `Big Shoulders Display` (700/800) for the workout title, matching the rest of the app; `Manrope` (500/600/700) for body/UI text; `Space Grotesk` (600/700) for numeric readouts (slider value, FTP input). `Oswald` is loaded in the font link but no longer used on this screen — safe to drop from the `<link>` unless other screens still need it.
- **Radius scale:** 6px (chips), 8px (bar chart container, notes box, tooltip), 10px (buttons), 18px (card).
- **Shadows:** see Slider Spec for the track/thumb depth values; tooltip uses `0 4px 16px rgba(0,0,0,0.35)`.

## Assets
No image/icon assets — all icons are inline stroke-style SVGs (feather-icon style, 18–20px, `stroke-width: 2`, no fill except the star/play-triangle which fill solid).

## Files
- `Start Workout Modal.dc.html` — the full interactive prototype (open directly in a browser; the slider is fully functional there for reference).

---
name: impeccable-design
description: Premium frontend UI/UX design direction, design tokens, visual hierarchy, polished CSS, and motion design. Use when styling user interfaces, building landing pages, designing dashboards, or refining visual presentations to avoid generic "AI slop".
license: MIT
---

# Impeccable Design Skill

Guidelines and standards for crafting high-fidelity, polished, and distinctive frontend interfaces, avoiding the generic patterns and low-effort tropes common to AI-generated interfaces.

## 1. Visual Hierarchy & Typography
- Establish a deliberate typographic scale using system font stacks or high-quality web fonts (Inter, SF Pro, Geist, Plus Jakarta Sans).
- Distinct hierarchy: Primary headings (`h1`), secondary subtitles (`p.subtitle`), and crisp micro-copy for badges and metadata.
- Maintain consistent letter-spacing (negative tracking on large titles, positive tracking on all-caps micro-badges).

## 2. Color Systems & Design Tokens
- Define CSS custom properties (`--bg-primary`, `--bg-surface`, `--border-color`, `--accent`, `--primary`, `--text-primary`).
- Avoid muddy or oversaturated backgrounds; use subtle gradients, deep slate/zinc tones, and measured contrast ratios (meeting WCAG 2.1 AA standards).
- Use glassmorphism and backdrop filters (`backdrop-filter: blur(...)`) with tasteful borders (`rgba(255, 255, 255, 0.08)`).

## 3. Micro-Interactions & Feedback
- Interactive elements (buttons, links, inputs) must have explicit hover, active, focus, and disabled states.
- Always provide feedback on async operations (spinners, loading text, success states).
- Keep transitions snappy (150ms - 250ms with ease-out curves).

## 4. Mobile Responsiveness & Polish
- Mobile-first or fully fluid layouts using CSS Grid and Flexbox.
- Ensure touch targets are at least 44x44px on mobile devices.
- Prevent horizontal overflows and ensure readable padding on small screens.

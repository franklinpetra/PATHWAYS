# PATHWAYS Engine - Claude Code Operating Guide

## Philosophy & Core Rules
- **Universal User Model:** The user is a Person, not a Student[cite: 4]. Avoid deficit-based or juvenile language[cite: 2, 4].
- **Authorship Boundary:** The AI organizes, retrieves, compares, drafts, and scaffolds; the user decides[cite: 4]. AI inferences remain provisional until confirmed[cite: 2, 4].
- **Multi-Agent Backend (User-Invisible):** The user interacts only with a seamless conversational interface. Behind the scenes, three distinct roles run:
  1. *Dialogue Orchestrator:* Handles conversation tone, active feature guidance, and user-facing synthesis[cite: 2, 4].
  2. *Memory & State Agent:* Governs the `Conversational Mastery Record` and `context_item` state silently[cite: 2, 4].
  3. *Fact-Finder Agent:* Queries authoritative Washington sources and O*NET strictly; zero creative hallucination[cite: 2, 3, 4].
- **Anti-Fabrication:** Never invent deadlines, eligibility rules, wage projections, or slots[cite: 3, 4]. Sourced claims must show source and date[cite: 3, 4].
- **State Validation:** Model output never mutates the database directly[cite: 4]. An application-level schema/validation layer enforces permitted state transitions[cite: 4].

## Visual Language
- Mobile-first, sparse, elegant[cite: 3, 4]. Readers should get the answer in seconds: replies lead with a two-to-three sentence answer, and each headed section after it renders collapsed (`components/chat/MessageText.tsx`). Sources collapse to one "N verified sources" line.
- Palette "Evergreen & Dawn" (tokens in `app/globals.css`): warm paper background (`#F5F3EE`), evergreen ink type (`#14231C`), subtle borders (`#E3DFD6`). Forest (`#1B6040`) for primary actions, active text, and focus rings; leaf (`#6BBA16`) only for decoration, since it is too light for text; dawn amber (`#A8551A`) sparingly, for progress, wins, due dates, and "you are here". A faint dawn glow at the top of the page is the only ornament.
- Type: Instrument Serif for headlines (`font-display`, `.display`, `.display-sm`), Inter for everything else, Geist Mono for small metadata.
- Controls: pill-shaped buttons and inputs with subtle borders and flat fills, via the shared `btn`, `field`, `notice`, `badge`, and `eyebrow` classes.
- Logo: `components/brand/Logo.tsx` (mark image + forest wordmark), with a CSS fade-and-glide entrance on first load only.
- The workspace centers on Chat, with a compact "Your plan" (Next Steps, Recent Wins): a sidebar on wide screens, a fold-out panel under the title on phones. Any progress visual must stay personal and calm, never a gamified bar or thermometer.

## Tech Stack
- Framework: Next.js (App Router), React, TypeScript[cite: 4]
- Styling: Tailwind CSS[cite: 4]
- Database & Auth: PostgreSQL / Supabase[cite: 4]
- AI Orchestration: OpenRouter server-side abstraction (`OPENROUTER_API_KEY`)[cite: 4]

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
Triggering Build
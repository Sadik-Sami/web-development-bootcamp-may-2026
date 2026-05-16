# social.io Design System

## 1. Brand & Aesthetic Principles

- **Name:** Warm & Cohesive
- **Vibe:** Cozy, modern, refined, and immersive. Moving away from the sterile feel of corporate chat apps, leaning into a more personal, tactile, and warm experience.

## 2. Typography

- **Primary Font:** **Geist**
  - Exceptionally well-suited for high-density UI and chat applications, offering high legibility across varied message lengths.
- **Monospace Font:** **Geist Mono**
  - Used for code snippets, IDs, and tabular data within chat.
- **Scale Strategy:**
  - `text-sm` (14px): Timestamps, secondary labels, unread badges.
  - `text-base` (16px): Main chat messages, inputs, buttons.
  - `text-lg` to `text-2xl`: Headers, conversation titles, empty states.

## 3. Color System

A refined, cozy palette avoiding overused "tech blues." We are using a sophisticated **Warm Terracotta** and **Sage** aesthetic, combined with soft backgrounds to reduce eye strain.

### Light Mode Strategy

Soft, off-white backgrounds with warm gray text for comfortable, prolonged reading. Avoid pure stark whites and deep blacks.

- **Background (App):** `#F9F9F8` (Warm Off-White)
- **Background (Chat Surface):** `#FFFFFF` (Pure white for chat bubble contrast only)
- **Text (Primary):** `#27272A` (Zinc-800 - softer than pure black)
- **Text (Muted):** `#71717A` (Zinc-500)
- **Borders:** `#E4E4E7` (Zinc-200)

### Dark Mode Strategy

Soft dark charcoal. Avoiding `#000000` or extreme darks to prevent high-contrast eye fatigue.

- **Background (App):** `#1C1C1E` (Soft Dark Charcoal)
- **Background (Chat Surface):** `#27272A` (Zinc-800)
- **Text (Primary):** `#F4F4F5` (Zinc-100)
- **Text (Muted):** `#A1A1AA` (Zinc-400)
- **Borders:** `#3F3F46` (Zinc-700)

### Semantic Colors

- **Primary (Brand/Accent):** `#E07A5F` (Warm Terracotta) - Used for primary actions, send buttons, and active states.
- **Secondary (Accent):** `#81B29A` (Muted Sage Green) - Used for success states, online indicators, and subtle highlights.
- **Destructive/Error:** `#E63946` (Soft Crimson)
- **Warning:** `#F2CC8F` (Warm Sand/Yellow)

## 4. Layout & Responsiveness

- **Mobile-First Approach (< 1024px):** Single column view. Stacked navigation (bottom tab bar or hamburger menu).
- **Desktop (1024px+):** Expansive multi-pane layouts:
  - Left Panel: Navigation & Search (280px fixed).
  - Middle Panel: Active Conversation List (320px fixed).
  - Right Panel: Active Chat Area & Info Panel (Flexible remaining width).
- **Chat Layout:**
  - Sent messages: Right-aligned, primary color background, white text.
  - Received messages: Left-aligned, surface color background, primary text.

## 5. Motion & Micro-interactions

Built with **Framer Motion** and **Next.js App Router View Transitions**.

### Page & View Transitions

- **Navigation:** Use the `vercel-react-view-transitions` pattern for seamless, native-feeling page navigations (e.g., clicking a conversation smoothly morphs the view into the chat window, rather than a harsh reload).

### Message Popups & Feedback

- **New Message (In-chat):**
  - Spring-based slide-up and scale-in to feel lively but not distracting.
  - `initial={{ opacity: 0, y: 10, scale: 0.95 }}`
  - `animate={{ opacity: 1, y: 0, scale: 1 }}`
  - `transition={{ type: "spring", stiffness: 400, damping: 25 }}`
- **Toast Notifications (Out-of-chat):**
  - Slide in from top-right with a glassmorphism backdrop (`backdrop-blur-md bg-background/80`).
- **Hover States:**
  - Smooth background shifts (`transition-colors duration-200`).
  - Interactive elements (like conversation cards) use a subtle scale effect (`hover:scale-[1.01]`).

## 6. Form and Validation

- **React Hook Form** — form state, minimal re-renders
- **Zod** — schema validation
- **@hookform/resolvers** — connects them

## 7. Pre-Delivery Quality Checklist

- [ ] No emojis used as icons (use SVG icons from Lucide React).
- [ ] `cursor-pointer` applied to all clickable elements.
- [ ] Glassmorphism elements use proper backdrop-blur and semi-transparent backgrounds (`bg-background/80`).
- [ ] Focus rings are visible for keyboard navigation (`focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none`).
- [ ] `prefers-reduced-motion` is respected across all Framer Motion components.

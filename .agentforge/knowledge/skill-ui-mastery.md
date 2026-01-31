# 🎨 Distinctive Frontend Design

## The "AgentForge" Aesthetic
Eliminate generic, low-contrast, or overly-round "AI aesthetics". Focus on high-intent, professional, and crisp interfaces.

### 1. Typography & Hierarchy
- Use a maximum of two typefaces: one functional (Sans/Mono) and one distinctive (Display/Serif).
- Maintain rigorous vertical rhythm. Use a 4px or 8px grid system for all spacing.
- Contrast is a feature: use pure whites and deep blacks/grays for maximum intent.

### 2. Form & Shadow
- Avoid excessive rounded corners (softness is often weakness). Use tight `2pt` or `4pt` radii for a precision feel.
- Shadows should be layered and subtle, simulating real depth, not a generic "glow".
- Use "glassmorphism" sparingly: only for overlays that provide immediate context.

### 3. Interaction & Motion
- Motion should be functional (feedback/transition), never decorative.
- Use `ease-in-out` or custom cubic-beziers for a "weighty" feel.
- Hover states should provide a subtle "elevation" or shift, confirming precision.

### 4. Layout & Composable Design
- Build from the inside out: functional components first, layout second.
- Use CSS Grid for complex, non-linear layouts. 
- Embrace whitespace (negative space) as a structural element to reduce cognitive load.

## Implementation Standard
- **Tailwind+Radix**: Use Radix UI for accessibility and Tailwind for the visual layer.
- **Micro-animations**: Integrate Framer Motion for high-fidelity state transitions.
- **Accessibility**: ARIA labels are mandatory; screen reader flow is part of the design.

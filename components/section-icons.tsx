/**
 * One icon per thing this product does, used everywhere that thing appears.
 *
 * The owner asked for a specific icon per category rather than a number, and
 * the categories in the header tabs are the same categories as the sections
 * on the home page -- Quick Generate is Quick Generate in both. So there is
 * one vocabulary here and both places draw from it, because the same idea
 * wearing two different marks is worse than no mark at all.
 *
 * Inline SVG rather than an icon package: nine icons do not justify a
 * dependency, and `currentColor` plus a 24-unit viewBox means each one
 * inherits whatever colour and size the thing around it is using.
 *
 * Every icon is `aria-hidden`. They sit beside real text in every use, so
 * announcing them would make a screen reader read each item twice.
 */

type IconProps = { className?: string };

const base = (className?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: className ?? "h-4 w-4",
});

/** Start here: the thing runs. */
export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

/** Two ways to start: a free tool or the workspace. */
export function SplitIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 5h4l5 7 5-7h2" />
      <path d="M4 19h4l3.5-5" />
      <path d="M17 17l3-2-3-2" />
    </svg>
  );
}

/** The evidence loop: each stage feeds the next. */
export function LoopIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" />
      <path d="M4 20v-4h4" />
    </svg>
  );
}

/** Quick Generate: written fast, from the real page. */
export function BoltIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  );
}

/** Coverage Review: what the tests do and do not reach. */
export function ScanIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </svg>
  );
}

/** Release Review, and the trust model: nothing counts until a person says so. */
export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3 5 6v5.5c0 4.3 3 8.2 7 9.5 4-1.3 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9.2 12.2 2 2 3.6-3.9" />
    </svg>
  );
}

/** MCP, and works with your tools: it lives in the editor. */
export function CodeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m8.5 8.5-4 3.5 4 3.5" />
      <path d="m15.5 8.5 4 3.5-4 3.5" />
      <path d="m13.5 5-3 14" />
    </svg>
  );
}

/** Pricing. */
export function TagIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3.5 11.4V5a1.5 1.5 0 0 1 1.5-1.5h6.4a2 2 0 0 1 1.4.6l7 7a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0l-7-7a2 2 0 0 1-.6-1.4Z" />
      <path d="M7.5 7.5h.01" />
    </svg>
  );
}

/** Product: the whole of it. */
export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

/** Try it: the way on. */
export function ArrowIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** Every icon by name, so a caller can store a key instead of a component. */
export const SECTION_ICONS = {
  play: PlayIcon,
  split: SplitIcon,
  loop: LoopIcon,
  bolt: BoltIcon,
  scan: ScanIcon,
  shield: ShieldIcon,
  code: CodeIcon,
  tag: TagIcon,
  layers: LayersIcon,
  arrow: ArrowIcon,
} as const;

export type SectionIconName = keyof typeof SECTION_ICONS;

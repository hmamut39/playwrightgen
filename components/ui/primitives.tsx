import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Shared workspace primitives.
 *
 * The workspace themes each domain with its own accent — Requirements sky,
 * Test Cases violet, Repositories and automation cyan — and that is deliberate,
 * so these primitives take an `accent` rather than forcing one colour.
 *
 * What they do fix is real inconsistency underneath the theming: many inputs
 * carried no focus style whatsoever, which is a keyboard accessibility failure
 * rather than a cosmetic one, and several primary buttons had no hover state.
 * Every interactive primitive here has both.
 *
 * Tailwind resolves class names statically, so accents are looked up from a
 * literal map instead of being interpolated.
 */

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type Accent = "cyan" | "sky" | "violet";

const accentStyles = {
  cyan: {
    text: "text-cyan-700",
    focusBorder: "focus:border-cyan-500",
    ring: "focus-visible:ring-cyan-500/60",
    card: "border-cyan-200 bg-cyan-50/40",
  },
  sky: {
    text: "text-sky-700",
    focusBorder: "focus:border-sky-500",
    ring: "focus-visible:ring-sky-500/60",
    card: "border-sky-200 bg-sky-50/40",
  },
  violet: {
    text: "text-violet-700",
    focusBorder: "focus:border-violet-500",
    ring: "focus-visible:ring-violet-500/60",
    card: "border-violet-200 bg-violet-50/40",
  },
} as const satisfies Record<Accent, Record<string, string>>;

function focusRing(accent: Accent) {
  return cx(
    "outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
    accentStyles[accent].ring,
  );
}

function controlBase(accent: Accent) {
  return cx(
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900",
    "placeholder:text-slate-400 transition",
    accentStyles[accent].focusBorder,
    "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
    focusRing(accent),
  );
}

export function Eyebrow({
  children,
  accent = "cyan",
  className,
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
}) {
  return (
    <p
      className={cx(
        "text-xs font-semibold uppercase tracking-[0.16em]",
        accentStyles[accent].text,
        className,
      )}
    >
      {children}
    </p>
  );
}

export function PageTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1 className={cx("mt-2 text-3xl font-semibold tracking-tight text-slate-950", className)}>
      {children}
    </h1>
  );
}

export function SectionCard({
  children,
  className,
  tone = "default",
  accent = "cyan",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent";
  accent?: Accent;
}) {
  return (
    <section
      className={cx(
        "mt-8 rounded-3xl border p-5 sm:p-7",
        tone === "accent"
          ? accentStyles[accent].card
          : "border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cx("mt-2 text-xl font-semibold tracking-tight text-slate-950", className)}>
      {children}
    </h2>
  );
}

export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("mt-2 max-w-3xl text-sm leading-6 text-slate-600", className)}>
      {children}
    </p>
  );
}

export function FieldLabel({
  children,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label className={cx("block text-sm font-medium text-slate-800", className)} {...props}>
      {children}
    </label>
  );
}

export function TextInput({
  className,
  accent = "cyan",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { accent?: Accent }) {
  return <input className={cx(controlBase(accent), "mt-2", className)} {...props} />;
}

export function TextArea({
  className,
  accent = "cyan",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { accent?: Accent }) {
  return <textarea className={cx(controlBase(accent), "mt-2", className)} {...props} />;
}

export function SelectInput({
  className,
  children,
  accent = "cyan",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { accent?: Accent }) {
  return (
    <select className={cx(controlBase(accent), "mt-2", className)} {...props}>
      {children}
    </select>
  );
}

function buttonBase(accent: Accent) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
    "disabled:cursor-not-allowed disabled:opacity-50",
    focusRing(accent),
  );
}

export function PrimaryButton({
  className,
  children,
  accent = "cyan",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { accent?: Accent }) {
  return (
    <button
      className={cx(buttonBase(accent), "bg-slate-950 text-white hover:bg-slate-800", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  className,
  children,
  accent = "cyan",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { accent?: Accent }) {
  return (
    <button
      className={cx(
        buttonBase(accent),
        "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const badgeTones = {
  neutral: "bg-slate-100 text-slate-600",
  accent: "bg-cyan-50 text-cyan-800",
  positive: "bg-emerald-50 text-emerald-700",
  caution: "bg-amber-50 text-amber-800",
  critical: "bg-red-50 text-red-700",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Empty states must say what is missing and what to do next. A blank panel
 * reads as a broken page, and this product's whole claim is that missing
 * evidence stays explicit rather than being quietly rendered as zero.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto max-w-2xl py-8 text-center sm:py-12", className)}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

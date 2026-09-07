import Link from "next/link";

type ClerkAuthShellProps = Readonly<{
  children: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}>;

const capabilities = [
  "Requirements and test cases stay connected",
  "Automation versions remain reviewable",
  "Every workspace is isolated by organization",
] as const;

export function ClerkAuthShell({
  children,
  eyebrow,
  title,
  description,
}: ClerkAuthShellProps) {
  return (
    <main className="relative isolate min-h-[calc(100vh-14rem)] overflow-hidden bg-slate-950 px-4 py-12 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-[-12rem] right-[-8rem] h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:36px_36px]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="max-w-xl">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
            {eyebrow}
          </Link>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300 sm:text-lg">
            {description}
          </p>

          <div className="mt-8 space-y-3">
            {capabilities.map((capability) => (
              <div
                key={capability}
                className="flex items-center gap-3 text-sm text-slate-200"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-xs text-cyan-200">
                  ✓
                </span>
                {capability}
              </div>
            ))}
          </div>

          {/* Stacked on the narrowest screens. Three columns of label-plus-caption
              inside a phone's width leaves each about a hundred pixels, which
              breaks every caption onto three lines. */}
          <div className="mt-10 grid grid-cols-1 gap-3 border-t border-white/10 pt-6 text-xs text-slate-400 sm:grid-cols-3">
            <div><strong className="block text-lg text-white">AI</strong>Quality planning</div>
            <div><strong className="block text-lg text-white">V1.6</strong>Automation Studio</div>
            <div><strong className="block text-lg text-white">RBAC</strong>Tenant safe</div>
          </div>
        </section>

        <section className="flex justify-center lg:justify-end">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.07] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-5">
            <div className="flex min-h-[31rem] items-center justify-center rounded-[1.4rem] bg-white p-4 text-slate-950 sm:p-6">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * "Something wrong on this page?" in the footer, on every page.
 *
 * The only way to reach the author was a GitHub link on the About page, which
 * is outside the workspace, needs a GitHub account, and is public. Somebody
 * evaluating this for a week will not open a public issue about a page that
 * confused them; they close the tab, and the silence reads as approval.
 *
 * It sends the page path with the message because that is the fact every fix
 * in this product has started from: which page, and what it said. It sends
 * nothing else, and says so above the box -- a product asking companies to
 * trial it cannot also be quietly reading their screens.
 */
export function FeedbackLink() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [problem, setProblem] = useState("");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || state === "sending") return;
    setState("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, path: pathname }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!response.ok) {
        // The server's own words: it knows whether this was too long, too
        // soon, or unavailable, and "something went wrong" would throw that
        // away -- which is the fault this product keeps finding in itself.
        setProblem(body?.error ?? "That could not be sent just now.");
        setState("error");
        return;
      }
      setState("sent");
      setMessage("");
    } catch {
      setProblem("That could not be sent. Check your connection and try again.");
      setState("error");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="underline underline-offset-2 hover:text-black"
      >
        Something wrong on this page?
      </button>
    );
  }

  return (
    <div className="mx-auto mt-2 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-left">
      {state === "sent" ? (
        <div>
          <p className="text-sm font-semibold text-slate-900">Thank you.</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            That went straight to the person who builds this, with the page you were on.
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setState("idle");
            }}
            className="mt-3 text-sm font-medium text-cyan-800 underline underline-offset-2"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={send}>
          <label className="block text-sm font-medium text-slate-900" htmlFor="feedback-message">
            What went wrong on this page?
          </label>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Sent with the address of this page ({pathname}) and nothing else. Not a screenshot, not what is on the
            page, not what you do here.
          </p>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            maxLength={4000}
            required
            placeholder="What you expected, and what you saw instead."
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          />
          {state === "error" ? (
            <p className="mt-2 text-sm text-red-700">{problem}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={state === "sending" || !message.trim()}
              className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-slate-600 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

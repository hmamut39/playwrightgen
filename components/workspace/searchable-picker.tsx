"use client";

import { useState, useTransition } from "react";

/**
 * Choosing one thing out of more than fits on a page.
 *
 * Three pickers used to render a list capped at a hundred, newest-changed
 * first, with nothing saying so. A project with a hundred and one requirements
 * simply could not link the hundred-and-first: it was not in the list, there
 * was no search, and no message admitted that anything had been left out. The
 * Test Run form was worse -- it read a page of test cases and then kept the
 * approved ones, so a team whose recent work was all drafts was offered nothing
 * to run while approved tests sat just beyond the cap.
 *
 * So the list here is openly a sample, the count is stated, and the search runs
 * in the database rather than over whatever happened to be fetched. Anything
 * already chosen stays on screen even when a later search does not match it,
 * because a selection that disappears while you look for the next one is how
 * people submit half a form without noticing.
 */

export type PickerOption = {
  id: string;
  label: string;
  /** Status, version, anything that tells two similar titles apart. */
  hint?: string;
};

export function SearchablePicker({
  name,
  options,
  total,
  search,
  multiple = false,
  placeholder,
  emptyLabel,
  defaultSelectedId,
}: {
  /** The form field name each chosen id is submitted under. */
  name: string;
  /** The first page, shown before anyone searches. */
  options: PickerOption[];
  /** How many exist in total, so the sample can say what it is. */
  total: number;
  search: (query: string) => Promise<PickerOption[]>;
  multiple?: boolean;
  placeholder: string;
  emptyLabel: string;
  defaultSelectedId?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(options);
  const [chosen, setChosen] = useState<PickerOption[]>(() => {
    const preselected = options.find((option) => option.id === defaultSelectedId);
    return preselected ? [preselected] : [];
  });
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function run(next: string) {
    setQuery(next);
    startTransition(async () => {
      try {
        setResults(await search(next));
        setFailed(false);
      } catch {
        // A search that cannot reach the server leaves the last results in
        // place and says so, rather than blanking the list as though nothing
        // matched.
        setFailed(true);
      }
    });
  }

  function toggle(option: PickerOption, selected: boolean) {
    setChosen((current) => {
      if (!selected) return current.filter((item) => item.id !== option.id);
      if (multiple) {
        return current.some((item) => item.id === option.id) ? current : [...current, option];
      }
      return [option];
    });
  }

  const chosenIds = new Set(chosen.map((option) => option.id));
  // Chosen items first, then results that are not already shown above.
  const listed = [...chosen, ...results.filter((option) => !chosenIds.has(option.id))];

  return (
    <div className="grid gap-2">
      <input
        type="search"
        value={query}
        onChange={(event) => run(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60"
      />

      {listed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
          {query ? `Nothing matches “${query}”.` : emptyLabel}
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {listed.map((option) => {
            const selected = chosenIds.has(option.id);
            return (
              <li key={option.id} className="border-b border-slate-100 last:border-b-0">
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm transition hover:bg-slate-50">
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={name}
                    value={option.id}
                    checked={selected}
                    onChange={(event) => toggle(option, event.target.checked)}
                    className="mt-1 shrink-0"
                  />
                  <span className="min-w-0">
                    {option.label}
                    {option.hint ? (
                      <span className="ml-2 text-xs text-slate-400">{option.hint}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs leading-5 text-slate-400" aria-live="polite">
        {failed
          ? "That search could not be run. These are the results from before it."
          : pending
            ? "Searching…"
            : query
              ? // Chosen items stay listed even when the search does not match
                // them, so the count has to say which rows it is counting.
                `${results.length} match${results.length === 1 ? "" : "es"}.` +
                (chosen.filter((option) => !results.some((result) => result.id === option.id)).length
                  ? ` Your ${
                      chosen.filter((option) => !results.some((result) => result.id === option.id)).length === 1 ? "choice is" : "choices are"
                    } listed above.`
                  : "")
              : total > options.length
                ? `Showing ${options.length} of ${total}, most recently changed first. Type to find any of the rest.`
                : `${total} in this project.`}
      </p>
    </div>
  );
}

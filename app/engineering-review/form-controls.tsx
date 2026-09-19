"use client";

import type { KeyboardEvent } from "react";

/** The inputs the Release Review form is built from. */

export function FieldLabel({
    htmlFor,
    label,
    required = false,
    optional = false,
}: {
    htmlFor: string;
    label: string;
    required?: boolean;
    optional?: boolean;
}) {
    return (
        <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-slate-700">
            {label}{" "}
            {required && (
                <span className="text-red-600" aria-label="required">*</span>
            )}
            {optional && (
                <span className="font-normal text-slate-500">(Optional)</span>
            )}
        </label>
    );
}

export function CompactInput({
    id,
    label,
    value,
    onChange,
    placeholder,
    optional = false,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    optional?: boolean;
}) {
    return (
        <div>
            <FieldLabel htmlFor={id} label={label} optional={optional} />
            <input
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
        </div>
    );
}

export function MultiSelectChips({
    label,
    options,
    selected,
    onChange,
}: {
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
}) {
    const toggle = (option: string) => {
        onChange(
            selected.includes(option)
                ? selected.filter((item) => item !== option)
                : [...selected, option]
        );
    };

    return (
        <fieldset>
            <legend className="text-sm font-semibold text-slate-800">{label}</legend>
            {selected.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label={`Selected ${label}`}>
                    {selected.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => toggle(item)}
                            aria-label={`Remove ${item}`}
                            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                            {item} <span aria-hidden="true">×</span>
                        </button>
                    ))}
                </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                {options
                    .filter((option) => !selected.includes(option))
                    .map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => toggle(option)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                            + {option}
                        </button>
                    ))}
            </div>
        </fieldset>
    );
}

export function TagInput({
    id,
    label,
    tags,
    draft,
    onDraftChange,
    onChange,
    placeholder,
}: {
    id: string;
    label: string;
    tags: string[];
    draft: string;
    onDraftChange: (value: string) => void;
    onChange: (tags: string[]) => void;
    placeholder: string;
}) {
    const commitDraft = () => {
        const additions = draft
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

        if (additions.length === 0) return;

        const next = [...tags];
        for (const addition of additions) {
            if (!next.some((item) => item.toLowerCase() === addition.toLowerCase())) {
                next.push(addition);
            }
        }
        onChange(next);
        onDraftChange("");
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
        }
        if (event.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
        }
    };

    return (
        <div>
            <FieldLabel htmlFor={id} label={label} />
            <div className="rounded-xl border border-slate-300 bg-white p-2 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100">
                {tags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {tags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => onChange(tags.filter((item) => item !== tag))}
                                aria-label={`Remove ${tag}`}
                                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                                {tag} <span aria-hidden="true">×</span>
                            </button>
                        ))}
                    </div>
                )}
                <input
                    id={id}
                    value={draft}
                    onChange={(event) => {
                        onDraftChange(event.target.value);
                        if (event.target.value.endsWith(",")) {
                            const additions = event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean);
                            if (additions.length > 0) {
                                onChange([...tags, ...additions.filter((item) => !tags.includes(item))]);
                                onDraftChange("");
                            }
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={commitDraft}
                    placeholder={placeholder}
                    className="w-full border-0 px-2 py-1.5 text-sm outline-none"
                />
            </div>
        </div>
    );
}

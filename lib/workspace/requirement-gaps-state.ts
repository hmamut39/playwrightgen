/**
 * The shape of the gaps panel's state, and its empty value.
 *
 * It lives here rather than in the panel because both sides need it: the
 * panel to start from, and the server action to answer with. A value imported
 * from a `"use client"` module into a server component is not that value —
 * it is a client reference the bundler substitutes — so spreading it there
 * produced an object with none of these fields, and the panel crashed the
 * whole requirement page on `state.criteria.filter`. Every failure the panel
 * was meant to report in a sentence did that instead: no acceptance
 * criteria, no approved test linked yet, or a spent AI allowance.
 */
export type GapsState = {
  status: "idle" | "read" | "error";
  criteria: Array<{ criterion: string; covered: boolean; coveredBy: string[]; reason: string }>;
  notInTheRequirement: string[];
  message: string;
};

export const initialGapsState: GapsState = {
  status: "idle",
  criteria: [],
  notInTheRequirement: [],
  message: "",
};

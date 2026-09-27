import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import {
  requirementFromTicket,
  RequirementFromTicketError,
  type RequirementFromTicket,
} from "@/lib/ai/requirement-from-ticket";
import { reserveOrganizationAiRequest } from "@/lib/operations/organization-ai-guard";

/**
 * Reading a ticket into the shape this product keeps.
 *
 * The result is a suggestion on a form, never a record. Nothing is created
 * until a person presses save, and nothing counts until somebody approves it
 * -- which is the same rule every other AI surface here follows, and the
 * reason a wrong reading costs a moment rather than becoming evidence.
 */

export class RequirementDraftingError extends Error {
  constructor(readonly code: "empty_ticket" | "not_behaviour" | "unavailable") {
    super(code);
    this.name = "RequirementDraftingError";
  }
}

export type DraftedRequirement = {
  title: string;
  description: string;
  acceptanceCriteria: string;
  externalReference: string;
  /** What the ticket left open, for the person to settle before approving. */
  assumptions: string[];
};

/** Joined one per line, which is how the form and the reviewers read them. */
function asLines(values: readonly string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join("\n");
}

export async function draftRequirementFromTicket(
  input: { orgSlug?: string; projectId: string; ticket: string },
  dependencies?: WorkspaceContextDependencies & {
    read?: (value: { ticket: string; projectName?: string }) => Promise<RequirementFromTicket>;
  },
): Promise<DraftedRequirement> {
  const projectId = z.string().uuid().parse(input.projectId);
  const ticket = input.ticket.trim();
  if (ticket.length < 20) throw new RequirementDraftingError("empty_ticket");

  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "requirement:create" },
    dependencies,
  );
  // Reading a ticket costs a request, like every other AI surface.
  await reserveOrganizationAiRequest({
    organizationId: workspace.organization.id,
    surface: "requirement-drafting",
  });

  let read: RequirementFromTicket;
  try {
    read = await (dependencies?.read ?? requirementFromTicket)({
      ticket,
      projectName: workspace.project?.name,
    });
  } catch (error) {
    if (error instanceof RequirementFromTicketError) throw new RequirementDraftingError("unavailable");
    throw error;
  }

  // A ticket that is not about product behaviour is said to be that, rather
  // than forced into a requirement somebody would later have to unpick.
  if (!read.isBehaviour || !read.title.trim()) {
    throw new RequirementDraftingError("not_behaviour");
  }

  return {
    title: read.title.trim().slice(0, 300),
    description: read.description.trim(),
    acceptanceCriteria: asLines(read.acceptanceCriteria),
    externalReference: read.externalReference.trim().slice(0, 500),
    assumptions: read.assumptions.map((assumption) => assumption.trim()).filter(Boolean).slice(0, 10),
  };
}

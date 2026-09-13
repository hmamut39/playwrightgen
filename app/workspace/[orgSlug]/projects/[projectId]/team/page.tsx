import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { InviteForm, type InviteState } from "@/components/workspace/invite-form";
import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { personName } from "@/lib/format/person-name";
import { assignProjectMember, removeProjectMember } from "@/lib/services/projects";
import {
  PROJECT_ROLE_LABEL,
  describeTeamError,
  getProjectTeam,
  inviteToProject,
  revokeProjectInvitation,
} from "@/lib/services/project-team";

/**
 * The team behind a project: who writes, who approves, who only reads.
 *
 * The review workflow depends on these roles, and until this page existed they
 * could not be set by anyone, so every workspace was one owner doing every job
 * -- the separation between the person who writes a test and the person who
 * approves it existed only in the database.
 */

/** Put in the URL as a code, never as text, so a crafted link cannot put words on this page. */
function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code).slice(0, 60)
    : "unknown";
}

const DUTIES = [
  {
    role: "Lead",
    does: "Everything a member does, plus approving or sending back other people's work and connecting repositories.",
  },
  {
    role: "Member",
    does: "Writes requirements and test cases, generates automation, records runs, and submits work for review.",
  },
  {
    role: "Viewer",
    does: "Reads everything and exports release reports. Changes nothing.",
  },
  {
    role: "Owner / Admin",
    does: "Full access to every project, and manages the team and billing.",
  },
];

export default async function ProjectTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { saved, error } = await searchParams;
  const team = await getProjectTeam({ orgSlug, projectId });
  const teamPath = `/workspace/${orgSlug}/projects/${projectId}/team`;

  async function changeRoleAction(formData: FormData) {
    "use server";
    const userId = String(formData.get("userId") ?? "");
    const role = String(formData.get("role") ?? "");
    let outcome = "saved=1";
    try {
      if (role === "NONE") {
        await removeProjectMember({ orgSlug, projectId, userId });
      } else if (role === "PROJECT_LEAD" || role === "MEMBER" || role === "VIEWER") {
        await assignProjectMember({ orgSlug, projectId, userId, role });
      }
    } catch (caught) {
      outcome = `error=${encodeURIComponent(errorCode(caught))}`;
    }
    revalidatePath(teamPath);
    redirect(`${teamPath}?${outcome}`);
  }

  async function inviteAction(_state: InviteState, formData: FormData): Promise<InviteState> {
    "use server";
    try {
      const sent = await inviteToProject({
        orgSlug,
        projectId,
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? ""),
      });
      revalidatePath(teamPath);
      return {
        status: "sent",
        message: `Invitation sent to ${sent.email}. They join this project as ${PROJECT_ROLE_LABEL[sent.role].toLowerCase()} as soon as they accept.`,
      };
    } catch (caught) {
      return { status: "error", message: describeTeamError(caught) };
    }
  }

  async function revokeAction(formData: FormData) {
    "use server";
    let outcome = "saved=1";
    try {
      await revokeProjectInvitation({
        orgSlug,
        projectId,
        invitationId: String(formData.get("invitationId") ?? ""),
      });
    } catch (caught) {
      outcome = `error=${encodeURIComponent(errorCode(caught))}`;
    }
    revalidatePath(teamPath);
    redirect(`${teamPath}?${outcome}`);
  }

  const leads = team.members.filter(
    (member) => member.projectRole === "PROJECT_LEAD" || member.hasOrganizationWideAccess,
  );

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Team</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Who works on {team.project.name}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Members write and submit; leads approve. Nobody approves their own
          submission while someone else could, so every approval is a second
          pair of eyes.
          {leads.length < 2
            ? " Right now only one person can approve here, so they can still approve their own work until a lead joins."
            : null}
        </p>
      </header>

      {saved ? (
        <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Saved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {describeTeamError({ code: error })}
        </p>
      ) : null}

      {team.canManage ? (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-slate-950">Invite someone</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            They get an email to join your workspace, and land in this project
            with the role you pick. No setup needed afterwards.
          </p>
          <InviteForm action={inviteAction} />

          {team.pendingInvitations.length > 0 ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-semibold text-slate-800">Waiting to accept</h3>
              <ul className="mt-3 divide-y divide-slate-100">
                {team.pendingInvitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{invitation.emailAddress}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {invitation.projectRole
                          ? PROJECT_ROLE_LABEL[invitation.projectRole]
                          : "Workspace only"}{" "}
                        · invited <LocalTime value={invitation.createdAt} style="date" />
                      </span>
                    </span>
                    <form action={revokeAction}>
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <PendingButton
                        pendingLabel="Revoking…"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Revoke
                      </PendingButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {team.invitationsUnavailable ? (
            <p className="mt-4 text-xs text-slate-500">
              Pending invitations could not be loaded just now.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4 sm:px-8">
          <h2 className="text-lg font-semibold text-slate-950">People</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {team.members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {personName(member.name)}
                  {member.isYou ? <span className="ml-2 text-xs font-normal text-slate-400">you</span> : null}
                </p>
                {member.email ? <p className="mt-0.5 text-xs text-slate-500">{member.email}</p> : null}
              </div>

              {member.hasOrganizationWideAccess ? (
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {member.organizationRole === "OWNER" ? "Owner" : "Admin"} · every project
                </span>
              ) : team.canManage ? (
                <form action={changeRoleAction} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={member.userId} />
                  <label className="sr-only" htmlFor={`role-${member.userId}`}>
                    Role for {personName(member.name)}
                  </label>
                  <select
                    id={`role-${member.userId}`}
                    name="role"
                    defaultValue={member.projectRole ?? "NONE"}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
                  >
                    <option value="PROJECT_LEAD">Lead</option>
                    <option value="MEMBER">Member</option>
                    <option value="VIEWER">Viewer</option>
                    <option value="NONE">No access</option>
                  </select>
                  <PendingButton
                    pendingLabel="Saving…"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    Save
                  </PendingButton>
                </form>
              ) : (
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {member.projectRole ? PROJECT_ROLE_LABEL[member.projectRole] : "No access"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-slate-950">Who does what</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {DUTIES.map((duty) => (
            <div key={duty.role} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="text-sm font-semibold text-slate-900">{duty.role}</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-600">{duty.does}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          The review path is the same for requirements, test cases and
          automation: <span className="font-medium text-slate-800">draft → submitted for review → approved</span>,
          or sent back to draft with changes requested. Every step is recorded
          with who did it and when, on the record itself and in Activity.
        </p>
      </section>
    </div>
  );
}

# GitHub Import and Isolated Runner Architecture

This document defines the V1.8 trust boundary. It is an implementation
contract, not evidence that remote execution is enabled.

> **Superseded for the first execution slice.** Tests now run in the customer's
> own GitHub Actions and report results back, so PlaywrightGen executes no
> repository code and the isolated-runner gates below are not on the critical
> path. See [`docs/EXECUTION_LOOP.md`](./EXECUTION_LOOP.md). The contract here
> still governs any future PlaywrightGen-operated runner, which remains
> unbuilt and disabled.

## GitHub App boundary

### Initial permissions

- Repository metadata: read (GitHub supplies this baseline).
- Repository contents: read.
- Events: `installation` and `installation_repositories` only.

The initial import does not request Actions, Checks, Deployments, Pull Requests,
Secrets, Workflows, or any repository write permission. A later pull-request
reporting milestone may add Checks write and the minimum pull-request event
subscription after a separate permission and abuse review.

### Credential lifecycle

The GitHub App ID and private key are server-only deployment secrets. The
webhook secret is separate. PlaywrightGen signs a short-lived app JWT only when
needed, exchanges it for an installation token restricted to the selected
repository and `contents:read`, and discards the token after the request. No
installation token is persisted or sent to a browser, runner, AI provider,
Activity record, or application log.

An Owner/Admin starts setup from an exact Workspace project. PlaywrightGen
signs a ten-minute state containing the local organization, project, actor, and
random nonce. The post-install redirect starts GitHub user authorization with
PKCE. The callback accepts the installation only after the current local actor
still has organization-manage permission, the state and PKCE verifier match,
GitHub confirms that user can access the installation, and App authentication
returns the same active installation with metadata/contents read only. The
transient user token is discarded immediately. This prevents the setup URL's
untrusted installation ID from becoming tenant authority.

The webhook boundary validates the exact raw body with HMAC-SHA256 before
parsing and stores only delivery identity, a payload digest, normalized event
metadata, and processing result. Installation suspension/removal and repository
access removal fail closed while historical imports remain immutable. Unknown
or unbound lifecycle events do not create tenant authority.

### Tenant ownership

1. An Organization Owner/Admin may bind a verified GitHub installation to the
   active PlaywrightGen Organization.
2. One external installation cannot be bound to multiple PlaywrightGen
   Organizations.
3. A Project Lead or Organization Owner/Admin may connect an accessible
   repository to an explicit project.
4. Every connection and import lookup includes `organizationId` and
   `projectId`; database composite foreign keys enforce the same boundary.
5. Installation suspension, removal, or repository-access removal disables
   new imports without deleting historical evidence.

### Import contract

An import resolves the selected ref to an exact commit, inventories the Git
tree, and fetches only bounded candidate text files required to classify
Playwright configuration and tests. The persisted snapshot contains:

- repository connection and exact commit SHA;
- requested source ref and parser version;
- status, start/completion time, actor, and safe failure code;
- candidate path, blob SHA, size, classified kind, and derived test count;
- aggregate configuration/spec/support-file counts.

Source bodies, credentials, `.env` files, GitHub tokens, raw API payloads, and
dependency archives are not persisted in the first slice. Duplicate requests
for the same repository, commit, and parser version return the existing import.
Truncated Git trees, oversized files, unsupported encodings, and provider
failures produce explicit incomplete or failed evidence rather than a trusted
result.

## Isolated runner contract

### Immutable job input

- Organization ID, project ID, repository connection ID, and repository import
  ID resolved by the control plane.
- Exact commit SHA; mutable branch names are never execution identity.
- Reviewed runner profile and allowlisted command shape.
- Browser/project selection, shard, retry, and timeout values within policy.
- Expiring job-scoped artifact upload credential and approved test-environment
  secret references, never raw platform credentials.

### Execution boundary

- One clean, ephemeral sandbox per attempt; no worker reuse between tenants.
- Non-root user, read-only base image, writable job scratch space only.
- CPU, memory, process, disk, output, and wall-clock limits.
- Default-deny egress with explicit target allowlisting and DNS rebinding
  defenses. No cloud metadata, private network, control-plane, database, or
  GitHub API access.
- Dependency installation uses a reviewed lockfile policy, lifecycle scripts
  disabled by default, registry allowlisting, size limits, and a disposable
  cache scoped below the tenant boundary.
- The command is assembled from typed fields; repository input never becomes a
  shell command. Interactive shells and arbitrary command overrides are denied.
- Cancellation terminates the process tree. Completion always destroys the
  sandbox and revokes job credentials.

### Evidence output

The runner emits a signed manifest plus bounded artifacts: Playwright JSON
results, traces, screenshots, videos when enabled, stdout/stderr, and runner
metadata. Artifact keys include tenant, project, job, and attempt identifiers.
The control plane verifies the manifest, declared sizes, checksums, job nonce,
and tenant/project binding before an idempotent transaction records results.
Raw logs are treated as untrusted and are never copied into Activity metadata.

### Required gates before enabling execution

- sandbox escape and network-isolation tests;
- malicious fixture corpus covering package scripts, forks, output floods,
  symlinks, archives, browser downloads, and cancellation;
- per-organization quotas, rate limits, concurrency limits, and spend limits;
- artifact encryption, retention, deletion, and access-control tests;
- safe observability and incident-response ownership;
- preview-environment end-to-end proof and explicit production approval.

Until these gates pass, Workspace may import and review repository evidence but
must not expose a Run action for remote repository code.

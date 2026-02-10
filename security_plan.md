Implementation Plan

Phase 1: Immediate Mitigations

1.1 Add Path Restrictions to File Tools

Files to modify:

- src/agents/pi-tools.read.ts
- src/agents/pi-tools.write.ts
- src/agents/pi-tools.edit.ts

// Add to config schema  
 const DEFAULT_BLOCKED_PATHS = [
"~/.ssh",
"~/.gnupg",
"~/.aws/credentials",
"~/.config/gcloud",
"/etc/shadow",
"/etc/sudoers",
"~/.openclaw/credentials",
];

function isPathBlocked(targetPath: string, blockedPaths: string[]): boolean {  
 const resolved = path.resolve(expandHome(targetPath));  
 return blockedPaths.some(blocked => {  
 const resolvedBlocked = path.resolve(expandHome(blocked));  
 return resolved.startsWith(resolvedBlocked) || resolved === resolvedBlocked;  
 });  
 }

1.2 Add Tool Usage Audit Logging

New file: src/security/tool-audit.ts

export type ToolAuditEntry = {  
 timestamp: number;  
 toolName: string;  
 sessionKey: string;  
 agentId: string;  
 parameters: Record<string, unknown>;  
 outcome: "success" | "denied" | "error";  
 durationMs: number;  
 };

export async function logToolUsage(entry: ToolAuditEntry): Promise<void>;  
 export async function getToolAuditLog(params: { since?: number }): Promise<ToolAuditEntry[]>;

1.3 Add Security Warnings

Files to modify:

- src/infra/exec-approvals.ts - Warn on "full" mode
- src/agents/sandbox/config.ts - Warn when sandbox disabled
- CLI startup - Warn on insecure configuration

Phase 2: Enhanced Protections

2.1 Workspace Isolation

Files to modify:

- src/agents/agent-scope.ts
- src/agents/pi-tools.\*.ts

Make file tools default to workspace directory only, require explicit permission for outside  
 access.

2.2 Command Categorization

New file: src/security/command-categories.ts

const DANGEROUS_COMMANDS = new Set([
"rm", "dd", "mkfs", "fdisk", "chmod 777",
"curl | sh", "wget | sh", "eval",
"sudo", "su", "pkill", "kill -9"
]);

const NETWORK_COMMANDS = new Set([
"curl", "wget", "nc", "nmap", "ssh", "scp"
]);

export function categorizeCommand(command: string): {  
 category: "safe" | "network" | "destructive" | "system";  
 requiresApproval: boolean;  
 };

2.3 Strengthen Subagent Restrictions

File: src/agents/pi-tools.policy.ts

const SUBAGENT*TOOL_DENY = [  
 // Current list plus:  
 "exec", // No shell access  
 "apply_patch", // No code modification  
 "elevated*\*", // No elevated operations  
 ];

const SUBAGENT_TOOL_ALLOW = [
"read", // Allow reading (with path restrictions)
"search", // Allow searching
"web_fetch", // Allow web fetching
];

Phase 3: Sandbox Improvements

3.1 Default Sandbox Mode

Files to modify:

- src/agents/sandbox/config.ts
- src/config/config.ts
- Documentation

Make sandbox enabled by default, require explicit opt-out.

3.2 Network Isolation

File: src/agents/sandbox/docker.ts

Default to --network none for sandbox containers, require explicit network access.

---

Files to Modify  
 ┌──────────┬────────────────────────────────────┬──────────────────────────────┐  
 │ Priority │ File │ Changes │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Critical │ src/agents/pi-tools.read.ts │ Add blocked paths check │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Critical │ src/agents/pi-tools.write.ts │ Add blocked paths check │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Critical │ src/agents/pi-tools.edit.ts │ Add blocked paths check │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ High │ src/security/tool-audit.ts │ NEW - Audit logging │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ High │ src/infra/exec-approvals.ts │ Add "full" mode warnings │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ High │ src/agents/pi-tools.policy.ts │ Expand subagent restrictions │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Medium │ src/security/command-categories.ts │ NEW - Command classification │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Medium │ src/agents/sandbox/config.ts │ Make sandbox default │  
 ├──────────┼────────────────────────────────────┼──────────────────────────────┤  
 │ Medium │ src/config/types.tools.ts │ Add blocked paths config │  
 └──────────┴────────────────────────────────────┴──────────────────────────────┘

---

Verification Steps

1.  Test Path Restrictions

# Should be blocked:

pnpm openclaw agent --message "read ~/.ssh/id_rsa"  
 pnpm openclaw agent --message "read /etc/shadow"

# Should work:

pnpm openclaw agent --message "read src/index.ts"

2.  Test Audit Logging

# Run some commands

pnpm openclaw agent --message "list files in current directory"

# Check audit log

pnpm openclaw security audit-log

3.  Test Subagent Restrictions

# Subagent should NOT be able to:

# - Execute arbitrary commands

# - Access files outside workspace

# - Modify system files

4.  Run Security Audit

pnpm openclaw security audit --deep

---

Configuration Options to Add

# openclaw.yaml additions

security:

# Block access to sensitive paths

blockedPaths:

- "~/.ssh"
- "~/.aws/credentials"
- "/etc/shadow"

# Restrict file operations to workspace

workspaceIsolation: true

# Require approval for all exec commands

execApprovalRequired: true

# Enable tool usage audit logging

auditLogging: true

# Warn on insecure configurations

warnOnInsecure: true

---

References

- Existing security audit: pnpm openclaw security audit
- Exec approvals config: ~/.openclaw/exec-approvals.json
- Sandbox config docs: docs/configuration.md

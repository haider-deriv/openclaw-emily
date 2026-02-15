import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { danger } from "../globals.js";
import { resolveRecruitingConfig } from "../recruiting/config.js";
import { CandidatePipelineService } from "../recruiting/pipeline.js";
import { defaultRuntime } from "../runtime.js";

type RecruitingCommonOpts = {
  json?: boolean;
};

function printOutput(value: unknown, asJson: boolean | undefined): void {
  if (asJson) {
    defaultRuntime.log(JSON.stringify(value, null, 2));
    return;
  }
  defaultRuntime.log(JSON.stringify(value, null, 2));
}

function ensureEnabled(): ReturnType<typeof loadConfig> {
  const cfg = loadConfig();
  const recruiting = resolveRecruitingConfig(cfg);
  if (!recruiting.enabled) {
    throw new Error(
      "Recruiting pipeline is disabled. Set tools.recruiting.enabled=true in openclaw config.",
    );
  }
  return cfg;
}

export function registerRecruitingCli(program: Command): void {
  const recruiting = program
    .command("recruiting")
    .description("Run and inspect the recruiting pipeline")
    .action(() => {
      recruiting.help({ error: true });
    });

  recruiting
    .command("run")
    .description("Run candidate pipeline for a role")
    .requiredOption("--role-key <key>", "Role key")
    .requiredOption("--role-title <title>", "Role title")
    .option("--keywords <query>", "Search keywords")
    .option("--role-keyword <keyword>", "Role keyword (repeatable)", collect, [])
    .option("--skill <skill>", "Skill keyword (repeatable)", collect, [])
    .option("--company <company>", "Company keyword (repeatable)", collect, [])
    .option("--location <location>", "Location filter")
    .option("--industry <industry>", "Industry filter")
    .option("--api <api>", "LinkedIn API mode: classic|recruiter|sales_navigator")
    .option("--account-id <id>", "LinkedIn account id")
    .option("--target-candidates <n>", "Target candidates per role")
    .option("--source-query-mode <mode>", "Source mode: default|broad", "default")
    .option("--evidence-query-mode <mode>", "Evidence mode: default|strict", "default")
    .option("--json", "Output JSON", false)
    .action(
      async (opts: {
        roleKey: string;
        roleTitle: string;
        keywords?: string;
        roleKeyword?: string[];
        skill?: string[];
        company?: string[];
        location?: string;
        industry?: string;
        api?: "classic" | "recruiter" | "sales_navigator";
        accountId?: string;
        targetCandidates?: string;
        sourceQueryMode?: "default" | "broad";
        evidenceQueryMode?: "default" | "strict";
        json?: boolean;
      }) => {
        try {
          const cfg = ensureEnabled();
          const service = new CandidatePipelineService(cfg);
          try {
            const targetCandidates = opts.targetCandidates
              ? Number.parseInt(opts.targetCandidates, 10)
              : undefined;
            const result = await service.run({
              role: {
                roleKey: opts.roleKey,
                roleTitle: opts.roleTitle,
                targetCandidates,
                search: {
                  api: opts.api,
                  keywords: opts.keywords,
                  role: (opts.roleKeyword ?? []).map((keyword) => ({ keywords: keyword })),
                  skills: (opts.skill ?? []).map((keyword) => ({ keywords: keyword })),
                  company: (opts.company ?? []).map((keyword) => ({ keywords: keyword })),
                  location: opts.location,
                  industry: opts.industry,
                  accountId: opts.accountId,
                },
              },
              sourceQueryMode: opts.sourceQueryMode,
              evidenceQueryMode: opts.evidenceQueryMode,
            });
            printOutput(result, opts.json);
          } finally {
            service.close();
          }
        } catch (err) {
          defaultRuntime.error(danger(String(err)));
          defaultRuntime.exit(1);
        }
      },
    );

  recruiting
    .command("status")
    .description("Show pipeline run status")
    .option("--run-id <id>", "Run id (omit to list recent runs)")
    .option("--json", "Output JSON", false)
    .action((opts: { runId?: string } & RecruitingCommonOpts) => {
      try {
        const cfg = ensureEnabled();
        const service = new CandidatePipelineService(cfg);
        try {
          const status = service.status(opts.runId);
          printOutput(status, opts.json);
        } finally {
          service.close();
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  recruiting
    .command("results")
    .description("Show ranked results for a run")
    .requiredOption("--run-id <id>", "Run id")
    .option("--limit <n>", "Result limit", "100")
    .option("--json", "Output JSON", false)
    .action((opts: { runId: string; limit: string } & RecruitingCommonOpts) => {
      try {
        const cfg = ensureEnabled();
        const service = new CandidatePipelineService(cfg);
        try {
          const limit = Number.parseInt(opts.limit, 10);
          const results = service.results(opts.runId, Number.isFinite(limit) ? limit : 100);
          printOutput(results, opts.json);
        } finally {
          service.close();
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  recruiting
    .command("candidate")
    .description("Show full candidate record")
    .argument("<id>", "Candidate id")
    .option("--json", "Output JSON", false)
    .action((id: string, opts: RecruitingCommonOpts) => {
      try {
        const cfg = ensureEnabled();
        const service = new CandidatePipelineService(cfg);
        try {
          const candidate = service.candidate(id);
          printOutput(candidate, opts.json);
        } finally {
          service.close();
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}

function collect(value: string, memo: string[]): string[] {
  const trimmed = value.trim();
  if (trimmed) {
    memo.push(trimmed);
  }
  return memo;
}

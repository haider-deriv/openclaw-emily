import type { OpenClawConfig } from "../config/config.js";
import type { CandidateEvidenceLink, CandidateSignal } from "./types.js";
import { createWebFetchTool } from "../agents/tools/web-fetch.js";
import { createWebSearchTool } from "../agents/tools/web-search.js";

type SearchHit = {
  title?: string;
  url: string;
  description?: string;
  siteName?: string;
  score?: number;
};

export type ExternalIdentityHints = {
  github?: { handle?: string; url?: string };
  x?: { handle?: string; url?: string };
  personalSite?: { url?: string };
};

export type ExternalEnrichment = {
  signals: CandidateSignal[];
  evidenceLinks: CandidateEvidenceLink[];
  identityHints: ExternalIdentityHints;
};

const SEARCH_CACHE = new Map<string, { expiresAt: number; value: SearchHit[] }>();
const FETCH_CACHE = new Map<string, { expiresAt: number; value: string }>();

const AI_NATIVE_KEYWORDS = ["codex", "claude code", "mcp", "agent", "agents", "autogen"];
const SHIPPING_KEYWORDS = [
  "shipped",
  "release",
  "launched",
  "production",
  "deployed",
  "commit",
  "pr",
];

function nowMs(): number {
  return Date.now();
}

function cleanupCache(): void {
  const now = nowMs();
  for (const [key, value] of SEARCH_CACHE.entries()) {
    if (value.expiresAt <= now) {
      SEARCH_CACHE.delete(key);
    }
  }
  for (const [key, value] of FETCH_CACHE.entries()) {
    if (value.expiresAt <= now) {
      FETCH_CACHE.delete(key);
    }
  }
}

function makeExaConfig(cfg: OpenClawConfig): OpenClawConfig {
  const tools = (cfg.tools as Record<string, unknown> | undefined) ?? {};
  const web = (tools.web as Record<string, unknown> | undefined) ?? {};
  const search = (web.search as Record<string, unknown> | undefined) ?? {};
  return {
    ...cfg,
    tools: {
      ...tools,
      web: {
        ...web,
        search: {
          ...search,
          provider: "exa",
        },
      },
    },
  } as OpenClawConfig;
}

function readSearchResults(details: unknown): SearchHit[] {
  if (!details || typeof details !== "object") {
    return [];
  }
  const results = (details as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return [];
  }
  const mapped: Array<SearchHit | null> = results.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const obj = entry as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url : "";
    if (!url) {
      return null;
    }
    return {
      title: typeof obj.title === "string" ? obj.title : undefined,
      url,
      description: typeof obj.description === "string" ? obj.description : undefined,
      siteName: typeof obj.siteName === "string" ? obj.siteName : undefined,
      score: typeof obj.score === "number" ? obj.score : undefined,
    };
  });
  return mapped.filter((entry): entry is SearchHit => entry !== null);
}

function readFetchContent(details: unknown): string {
  if (!details || typeof details !== "object") {
    return "";
  }
  const content = (details as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function extractHandle(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (!path) {
      return undefined;
    }
    return path.replace(/^@/, "");
  } catch {
    return undefined;
  }
}

async function searchExa(params: {
  cfg: OpenClawConfig;
  query: string;
  count: number;
  includeDomains?: string[];
  category?: "company" | "person";
}): Promise<SearchHit[]> {
  cleanupCache();
  const key = `${params.query}:${params.count}:${(params.includeDomains ?? []).join(",")}:${params.category ?? ""}`;
  const cached = SEARCH_CACHE.get(key);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.value;
  }

  const tool = createWebSearchTool({
    config: makeExaConfig(params.cfg),
    sandboxed: false,
  });
  if (!tool) {
    return [];
  }

  const result = await tool.execute("recruiting_search", {
    query: params.query,
    count: params.count,
    search_type: "deep",
    category: params.category ?? "person",
    include_domains: params.includeDomains,
  });
  const hits = readSearchResults(result.details);
  SEARCH_CACHE.set(key, {
    value: hits,
    expiresAt: nowMs() + 15 * 60 * 1000,
  });
  return hits;
}

async function fetchUrl(cfg: OpenClawConfig, url: string): Promise<string> {
  cleanupCache();
  const cached = FETCH_CACHE.get(url);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.value;
  }

  const tool = createWebFetchTool({
    config: cfg,
    sandboxed: false,
  });
  if (!tool) {
    return "";
  }

  const result = await tool.execute("recruiting_fetch", {
    url,
    extractMode: "text",
    maxChars: 8000,
  });
  const content = readFetchContent(result.details);
  FETCH_CACHE.set(url, {
    value: content,
    expiresAt: nowMs() + 60 * 60 * 1000,
  });
  return content;
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const matches = keywords.filter((keyword) => lower.includes(keyword)).length;
  if (matches === 0) {
    return 0;
  }
  return Math.min(1, matches / Math.max(2, keywords.length / 2));
}

function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function enrichExternalFootprint(params: {
  cfg: OpenClawConfig;
  evidenceQueryMode?: "default" | "strict";
  candidate: {
    name: string;
    headline?: string;
    currentCompany?: string;
    publicIdentifier?: string | null;
  };
}): Promise<ExternalEnrichment> {
  const strictEvidence = params.evidenceQueryMode === "strict";
  const baseQuery = [
    params.candidate.name,
    params.candidate.currentCompany,
    params.candidate.headline,
  ]
    .filter(Boolean)
    .join(" ");

  const [githubHits, socialHits, webHits, strictAiHits] = await Promise.all([
    searchExa({
      cfg: params.cfg,
      query: `${baseQuery} github`,
      count: 5,
      includeDomains: ["github.com"],
      category: "person",
    }),
    searchExa({
      cfg: params.cfg,
      query: `${baseQuery} x.com OR twitter.com`,
      count: 5,
      includeDomains: ["x.com", "twitter.com"],
      category: "person",
    }),
    searchExa({
      cfg: params.cfg,
      query: `${baseQuery} blog portfolio personal site`,
      count: 5,
      category: "person",
    }),
    strictEvidence
      ? searchExa({
          cfg: params.cfg,
          query: `${baseQuery} ("claude code" OR codex OR mcp OR agent tooling OR "model context protocol")`,
          count: 8,
          category: "person",
        })
      : Promise.resolve([]),
  ]);

  const evidenceLinks: CandidateEvidenceLink[] = [];
  const identityHints: ExternalIdentityHints = {};

  const github = githubHits.find((hit) => normalizeDomain(hit.url).includes("github.com"));
  if (github) {
    identityHints.github = {
      handle: extractHandle(github.url),
      url: github.url,
    };
    evidenceLinks.push({
      url: github.url,
      title: github.title,
      source: "exa.search",
      relevance: github.score,
    });
  }

  const xHit = socialHits.find((hit) => {
    const domain = normalizeDomain(hit.url);
    return domain.includes("x.com") || domain.includes("twitter.com");
  });
  if (xHit) {
    identityHints.x = {
      handle: extractHandle(xHit.url),
      url: xHit.url,
    };
    evidenceLinks.push({
      url: xHit.url,
      title: xHit.title,
      source: "exa.search",
      relevance: xHit.score,
    });
  }

  const personal = webHits.find((hit) => {
    const domain = normalizeDomain(hit.url);
    return domain && !domain.includes("linkedin.com") && !domain.includes("github.com");
  });
  if (personal) {
    identityHints.personalSite = {
      url: personal.url,
    };
    evidenceLinks.push({
      url: personal.url,
      title: personal.title,
      source: "exa.search",
      relevance: personal.score,
    });
  }

  if (strictEvidence) {
    for (const hit of strictAiHits) {
      evidenceLinks.push({
        url: hit.url,
        title: hit.title,
        source: "exa.search.strict",
        relevance: hit.score,
      });
    }
  }

  const seenUrls = new Set<string>();
  const dedupedEvidence: CandidateEvidenceLink[] = [];
  for (const link of evidenceLinks) {
    if (!link.url || seenUrls.has(link.url)) {
      continue;
    }
    seenUrls.add(link.url);
    dedupedEvidence.push(link);
  }

  const fetchedLinks = dedupedEvidence.slice(0, strictEvidence ? 5 : 3);
  const fetchedContent = await Promise.all(
    fetchedLinks.map(async (link) => ({
      link,
      content: await fetchUrl(params.cfg, link.url),
    })),
  );

  const signals: CandidateSignal[] = [];

  if (strictEvidence) {
    for (const hit of strictAiHits) {
      const snippet = `${hit.title ?? ""} ${hit.description ?? ""}`;
      const aiScore = keywordScore(snippet, AI_NATIVE_KEYWORDS);
      if (aiScore > 0) {
        signals.push({
          key: "ai_native_evidence",
          numericValue: Math.max(0.35, aiScore),
          source: "exa.search",
          details: { url: hit.url },
        });
      }
    }
  }

  for (const item of fetchedContent) {
    const aiScore = keywordScore(item.content, AI_NATIVE_KEYWORDS);
    const shipScore = keywordScore(item.content, SHIPPING_KEYWORDS);

    if (aiScore > 0) {
      signals.push({
        key: "ai_native_evidence",
        numericValue: aiScore,
        source: "web_fetch",
        details: { url: item.link.url },
      });
    }

    if (shipScore > 0) {
      signals.push({
        key: "builder_activity",
        numericValue: shipScore,
        source: "web_fetch",
        details: { url: item.link.url },
      });
    }
  }

  return {
    signals,
    evidenceLinks: dedupedEvidence,
    identityHints,
  };
}

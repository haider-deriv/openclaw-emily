/**
 * ElevenLabs Agents - JSON Storage
 *
 * Read/write conversations to a workspace JSON file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConversationStore,
  StoredConversation,
  ConversationDetails,
  StoredTranscriptEntry,
  StoredAnalysis,
  StoredMetadata,
} from "./types.js";

const STORE_FILENAME = "elevenlabs-conversations.json";

/** Retention period for conversations (7 days in milliseconds) */
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Get the store file path for a workspace directory.
 */
export function getStorePath(workspaceDir: string): string {
  return path.join(workspaceDir, STORE_FILENAME);
}

/**
 * Remove conversations older than the retention period.
 * Returns the cleaned store.
 */
function cleanupOldConversations(store: ConversationStore): ConversationStore {
  const now = Date.now();
  const cutoff = now - RETENTION_MS;

  const cleaned: Record<string, StoredConversation> = {};
  for (const [id, conv] of Object.entries(store.conversations)) {
    const initiatedAt = new Date(conv.initiated_at).getTime();
    if (initiatedAt >= cutoff) {
      cleaned[id] = conv;
    }
  }

  return { conversations: cleaned };
}

/**
 * Read the conversation store from disk.
 * Returns empty store if file doesn't exist.
 */
export async function readStore(workspaceDir: string): Promise<ConversationStore> {
  const storePath = getStorePath(workspaceDir);
  try {
    const content = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(content) as ConversationStore;
    return {
      conversations: parsed.conversations ?? {},
    };
  } catch (err) {
    // Return empty store if file doesn't exist or is invalid
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { conversations: {} };
    }
    // For parse errors, also return empty store
    return { conversations: {} };
  }
}

/**
 * Write the conversation store to disk.
 * Automatically cleans up conversations older than retention period.
 */
export async function writeStore(workspaceDir: string, store: ConversationStore): Promise<void> {
  const storePath = getStorePath(workspaceDir);
  // Cleanup old conversations before writing
  const cleanedStore = cleanupOldConversations(store);
  // Ensure directory exists
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(cleanedStore, null, 2), "utf-8");
}

/**
 * Get a single conversation from the store.
 */
export async function getStoredConversation(
  workspaceDir: string,
  conversationId: string,
): Promise<StoredConversationWithId | undefined> {
  const store = await readStore(workspaceDir);
  const conv = store.conversations[conversationId];
  if (!conv) {
    return undefined;
  }
  return { conversation_id: conversationId, ...conv };
}

/**
 * Save or update a conversation in the store.
 */
export async function saveConversation(
  workspaceDir: string,
  conversationId: string,
  conversation: StoredConversation,
): Promise<void> {
  const store = await readStore(workspaceDir);
  store.conversations[conversationId] = conversation;
  await writeStore(workspaceDir, store);
}

/**
 * Stored conversation with its ID (for list results).
 */
export type StoredConversationWithId = StoredConversation & {
  conversation_id: string;
};

/**
 * List conversations from the store with optional filters.
 */
export async function listStoredConversations(
  workspaceDir: string,
  params?: {
    status?: string;
    limit?: number;
  },
): Promise<StoredConversationWithId[]> {
  const store = await readStore(workspaceDir);
  let conversations: StoredConversationWithId[] = Object.entries(store.conversations).map(
    ([id, conv]) => ({
      conversation_id: id,
      ...conv,
    }),
  );

  // Filter by status if specified
  if (params?.status) {
    conversations = conversations.filter((c) => c.status === params.status);
  }

  // Sort by initiated_at descending (most recent first)
  conversations.sort((a, b) => {
    const dateA = new Date(a.initiated_at).getTime();
    const dateB = new Date(b.initiated_at).getTime();
    return dateB - dateA;
  });

  // Apply limit
  if (params?.limit && params.limit > 0) {
    conversations = conversations.slice(0, params.limit);
  }

  return conversations;
}

/**
 * Simplify transcript entries for storage (remove time_in_call_secs).
 */
function simplifyTranscript(
  transcript?: Array<{ role: "agent" | "user"; message: string; time_in_call_secs?: number }>,
): StoredTranscriptEntry[] | undefined {
  if (!transcript) {
    return undefined;
  }
  return transcript.map(({ role, message }) => ({ role, message }));
}

/**
 * Simplify analysis for storage (keep only essential fields).
 */
function simplifyAnalysis(analysis?: Record<string, unknown>): StoredAnalysis | undefined {
  if (!analysis) {
    return undefined;
  }
  return {
    evaluation_criteria_results_list: analysis.evaluation_criteria_results_list as unknown[],
    data_collection_results_list:
      analysis.data_collection_results_list as StoredAnalysis["data_collection_results_list"],
    call_successful: analysis.call_successful as string | undefined,
    transcript_summary: analysis.transcript_summary as string | undefined,
    call_summary_title: analysis.call_summary_title as string | undefined,
  };
}

/**
 * Simplify metadata for storage (keep only essential fields).
 */
function simplifyMetadata(metadata?: Record<string, unknown>): StoredMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  return {
    call_duration_secs: metadata.call_duration_secs as number | undefined,
    phone_call: metadata.phone_call as StoredMetadata["phone_call"],
    conversation_initiation_source: metadata.conversation_initiation_source as string | undefined,
    timezone: metadata.timezone as string | undefined,
    whatsapp: metadata.whatsapp,
  };
}

/**
 * Convert API ConversationDetails to StoredConversation format (simplified).
 */
export function conversationDetailsToStored(
  details: ConversationDetails,
  existingStored?: StoredConversation,
): StoredConversation {
  return {
    initiated_at: existingStored?.initiated_at ?? new Date().toISOString(),
    to_number: existingStored?.to_number ?? "",
    dynamic_variables: existingStored?.dynamic_variables,
    status: details.status,
    transcript: simplifyTranscript(details.transcript),
    analysis: simplifyAnalysis(details.analysis),
    metadata: simplifyMetadata(details.metadata),
  };
}

/**
 * Update a stored conversation with fresh API data.
 */
export async function updateConversationFromApi(
  workspaceDir: string,
  details: ConversationDetails,
): Promise<StoredConversationWithId> {
  const existing = await getStoredConversation(workspaceDir, details.conversation_id);
  const updated = conversationDetailsToStored(details, existing);
  await saveConversation(workspaceDir, details.conversation_id, updated);
  return { conversation_id: details.conversation_id, ...updated };
}

/**
 * Create initial stored conversation record when initiating a call.
 */
export function createInitialStoredConversation(params: {
  toNumber: string;
  dynamicVariables?: Record<string, string>;
}): StoredConversation {
  return {
    initiated_at: new Date().toISOString(),
    to_number: params.toNumber,
    dynamic_variables: params.dynamicVariables,
    status: "pending",
  };
}

/**
 * Delete a conversation from the store.
 */
export async function deleteConversation(
  workspaceDir: string,
  conversationId: string,
): Promise<boolean> {
  const store = await readStore(workspaceDir);
  if (store.conversations[conversationId]) {
    delete store.conversations[conversationId];
    await writeStore(workspaceDir, store);
    return true;
  }
  return false;
}

/**
 * Get the most recent completed conversation summary for a phone number.
 * Returns the transcript_summary from the most recent "done" conversation to this number.
 */
export async function getPreviousCallSummary(
  workspaceDir: string,
  toNumber: string,
): Promise<string | undefined> {
  const store = await readStore(workspaceDir);

  // Find all completed conversations to this number
  const conversations = Object.values(store.conversations)
    .filter((conv) => conv.to_number === toNumber && conv.status === "done")
    .toSorted((a, b) => {
      // Sort by initiated_at descending (most recent first)
      const dateA = new Date(a.initiated_at).getTime();
      const dateB = new Date(b.initiated_at).getTime();
      return dateB - dateA;
    });

  // Return the most recent summary if available
  const mostRecent = conversations[0];
  return mostRecent?.analysis?.transcript_summary;
}

/**
 * Webhook payload type (from ElevenLabs webhook).
 */
export type WebhookPayload = {
  conversationId: string;
  status: string;
  transcript?: Array<{ role: string; message: string }>;
  analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

/**
 * Save conversation data directly from webhook payload.
 * Merges with existing data (to preserve to_number, dynamic_variables from initiation).
 */
export async function saveConversationFromWebhook(
  workspaceDir: string,
  payload: WebhookPayload,
): Promise<StoredConversationWithId> {
  const existing = await getStoredConversation(workspaceDir, payload.conversationId);

  const updated: StoredConversation = {
    initiated_at: existing?.initiated_at ?? new Date().toISOString(),
    to_number: existing?.to_number ?? "",
    dynamic_variables: existing?.dynamic_variables,
    status: payload.status,
    transcript: payload.transcript?.map((t) => ({
      role: t.role as "agent" | "user",
      message: t.message,
    })),
    analysis: simplifyAnalysis(payload.analysis),
    metadata: simplifyMetadata(payload.metadata),
  };

  await saveConversation(workspaceDir, payload.conversationId, updated);
  return { conversation_id: payload.conversationId, ...updated };
}

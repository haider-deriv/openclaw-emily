/**
 * ElevenLabs Agents - JSON Storage
 *
 * Read/write conversations to a workspace JSON file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ConversationStore, StoredConversation, ConversationDetails } from "./types.js";

const STORE_FILENAME = "elevenlabs-conversations.json";

/**
 * Get the store file path for a workspace directory.
 */
export function getStorePath(workspaceDir: string): string {
  return path.join(workspaceDir, STORE_FILENAME);
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
 */
export async function writeStore(workspaceDir: string, store: ConversationStore): Promise<void> {
  const storePath = getStorePath(workspaceDir);
  // Ensure directory exists
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Get a single conversation from the store.
 */
export async function getStoredConversation(
  workspaceDir: string,
  conversationId: string,
): Promise<StoredConversation | undefined> {
  const store = await readStore(workspaceDir);
  return store.conversations[conversationId];
}

/**
 * Save or update a conversation in the store.
 */
export async function saveConversation(
  workspaceDir: string,
  conversation: StoredConversation,
): Promise<void> {
  const store = await readStore(workspaceDir);
  store.conversations[conversation.conversation_id] = conversation;
  await writeStore(workspaceDir, store);
}

/**
 * List conversations from the store with optional filters.
 */
export async function listStoredConversations(
  workspaceDir: string,
  params?: {
    status?: string;
    limit?: number;
  },
): Promise<StoredConversation[]> {
  const store = await readStore(workspaceDir);
  let conversations = Object.values(store.conversations);

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
 * Convert API ConversationDetails to StoredConversation format.
 */
export function conversationDetailsToStored(
  details: ConversationDetails,
  existingStored?: StoredConversation,
): StoredConversation {
  return {
    conversation_id: details.conversation_id,
    initiated_at: existingStored?.initiated_at ?? new Date().toISOString(),
    to_number: existingStored?.to_number ?? "",
    dynamic_variables: existingStored?.dynamic_variables,
    status: details.status,
    transcript: details.transcript,
    analysis: details.analysis,
    metadata: details.metadata,
    last_polled: new Date().toISOString(),
  };
}

/**
 * Update a stored conversation with fresh API data.
 */
export async function updateConversationFromApi(
  workspaceDir: string,
  details: ConversationDetails,
): Promise<StoredConversation> {
  const existing = await getStoredConversation(workspaceDir, details.conversation_id);
  const updated = conversationDetailsToStored(details, existing);
  await saveConversation(workspaceDir, updated);
  return updated;
}

/**
 * Create initial stored conversation record when initiating a call.
 */
export function createInitialStoredConversation(params: {
  conversationId: string;
  toNumber: string;
  dynamicVariables?: Record<string, string>;
}): StoredConversation {
  return {
    conversation_id: params.conversationId,
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

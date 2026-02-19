/**
 * LinkedIn Media Resolution
 *
 * Downloads media attachments from LinkedIn messages and saves them locally,
 * similar to how Slack handles media in src/slack/monitor/media.ts.
 */

import type {
  LinkedInMessageAttachment,
  LinkedInClientOptions,
} from "../../../src/linkedin/types.js";
import { downloadAttachment } from "../../../src/linkedin/client.js";
import { saveMediaBuffer } from "../../../src/media/store.js";
import { getLinkedInRuntime } from "./runtime.js";

export type LinkedInMediaResult = {
  path: string;
  contentType?: string;
  placeholder: string;
};

const MAX_LINKEDIN_MEDIA_FILES = 8;

/**
 * Resolve filename from attachment based on type.
 */
function resolveAttachmentFilename(attachment: LinkedInMessageAttachment): string | undefined {
  if (attachment.type === "file" && "file_name" in attachment) {
    return attachment.file_name;
  }
  return undefined;
}

/**
 * Resolve placeholder text for an attachment.
 */
function resolveAttachmentPlaceholder(attachment: LinkedInMessageAttachment): string {
  const filename = resolveAttachmentFilename(attachment);
  switch (attachment.type) {
    case "img":
      return filename ? `[LinkedIn image: ${filename}]` : "[LinkedIn image]";
    case "video":
      return filename ? `[LinkedIn video: ${filename}]` : "[LinkedIn video]";
    case "audio":
      return filename ? `[LinkedIn audio: ${filename}]` : "[LinkedIn audio]";
    case "file":
      return filename ? `[LinkedIn file: ${filename}]` : "[LinkedIn file]";
    default:
      return `[LinkedIn attachment: ${attachment.type}]`;
  }
}

/**
 * Check if an attachment type is downloadable.
 */
function isDownloadableAttachment(attachment: LinkedInMessageAttachment): boolean {
  // Skip linkedin_post and video_meeting as they don't have binary content to download
  return ["img", "video", "audio", "file"].includes(attachment.type);
}

/**
 * Sanitize chat ID for use as a directory name.
 * Removes/replaces characters that are unsafe for filesystem paths.
 */
function sanitizeChatId(chatId: string): string {
  // Replace unsafe characters with underscores, collapse multiple underscores
  return chatId
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64); // Limit length for filesystem safety
}

/**
 * Downloads all media attachments from a LinkedIn message and returns them as an array.
 * Files are saved to inbound/linkedin/{chatId}/ for organization by conversation.
 * Returns `null` when no attachments could be downloaded.
 */
export async function resolveLinkedInMedia(params: {
  attachments?: LinkedInMessageAttachment[];
  clientOpts: LinkedInClientOptions;
  messageId: string;
  chatId: string;
  maxBytes: number;
}): Promise<LinkedInMediaResult[] | null> {
  const runtime = getLinkedInRuntime();
  const attachments = params.attachments ?? [];

  if (attachments.length === 0) {
    return null;
  }

  // Filter to downloadable attachments and limit to max
  const downloadable = attachments.filter(isDownloadableAttachment);
  const limitedAttachments =
    downloadable.length > MAX_LINKEDIN_MEDIA_FILES
      ? downloadable.slice(0, MAX_LINKEDIN_MEDIA_FILES)
      : downloadable;

  const results: LinkedInMediaResult[] = [];

  // Build subdirectory path: inbound/linkedin/{sanitized_chat_id}
  const sanitizedChatId = sanitizeChatId(params.chatId);
  const subdir = `inbound/linkedin/${sanitizedChatId}`;

  for (const attachment of limitedAttachments) {
    // Skip unavailable attachments
    if (attachment.unavailable) {
      runtime.logging?.logVerbose?.(
        `linkedin: skipping unavailable attachment id=${attachment.id} type=${attachment.type}`,
      );
      continue;
    }

    try {
      // Download the attachment
      const { content, contentType } = await downloadAttachment(
        params.clientOpts,
        params.messageId,
        attachment.id,
      );

      // Check size before saving
      if (content.byteLength > params.maxBytes) {
        runtime.logging?.logVerbose?.(
          `linkedin: skipping attachment id=${attachment.id} - size ${content.byteLength} exceeds max ${params.maxBytes}`,
        );
        continue;
      }

      // Save to disk in linkedin-specific subdirectory
      const filename = resolveAttachmentFilename(attachment);
      const saved = await saveMediaBuffer(
        Buffer.from(content),
        contentType,
        subdir,
        params.maxBytes,
        filename,
      );

      results.push({
        path: saved.path,
        contentType: saved.contentType ?? contentType,
        placeholder: resolveAttachmentPlaceholder(attachment),
      });

      runtime.logging?.logVerbose?.(
        `linkedin: downloaded attachment id=${attachment.id} type=${attachment.type} path=${saved.path}`,
      );
    } catch (err) {
      runtime.logging?.logVerbose?.(
        `linkedin: media download failed for attachment id=${attachment.id} ` +
          `type=${attachment.type} error=${String(err)}`,
      );
      // Continue with next attachment on error
    }
  }

  return results.length > 0 ? results : null;
}

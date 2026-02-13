/**
 * ElevenLabs Agents - Webhook Handler
 *
 * Handles post-call webhooks from ElevenLabs with HMAC signature verification.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import type { ConversationDetails } from "./types.js";

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Parse the ElevenLabs-Signature header.
 * Tries multiple formats:
 * - t=<timestamp>,v1=<signature> (Stripe-style)
 * - timestamp=<timestamp>,signature=<signature>
 * - Just raw signature (no timestamp)
 */
function parseSignatureHeader(
  header: string,
): { timestamp: string | null; signature: string } | null {
  // Try format: t=<timestamp>,v1=<signature>
  const parts: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex > 0) {
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (key && value) {
        parts[key] = value;
      }
    }
  }

  // Try t/v0 format (ElevenLabs uses this)
  if (parts.t && parts.v0) {
    return { timestamp: parts.t, signature: parts.v0 };
  }

  // Try t/v1 format
  if (parts.t && parts.v1) {
    return { timestamp: parts.t, signature: parts.v1 };
  }

  // Try timestamp/signature format
  if (parts.timestamp && parts.signature) {
    return { timestamp: parts.timestamp, signature: parts.signature };
  }

  // Try v0/v1 without timestamp
  if (parts.v1) {
    return { timestamp: null, signature: parts.v1 };
  }
  if (parts.v0) {
    return { timestamp: null, signature: parts.v0 };
  }

  // Maybe it's just a raw signature (hex string)
  if (/^[a-f0-9]{64}$/i.test(header.trim())) {
    return { timestamp: null, signature: header.trim() };
  }

  return null;
}

/**
 * Validate ElevenLabs webhook signature using HMAC-SHA256.
 */
export function validateElevenLabsSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  console.log(`[elevenlabs-webhook] Parsing signature: "${signatureHeader}"`);

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    console.log(`[elevenlabs-webhook] Failed to parse signature header`);
    return { ok: false, reason: "Invalid signature header format" };
  }

  const { timestamp, signature } = parsed;
  console.log(
    `[elevenlabs-webhook] Parsed - timestamp: ${timestamp}, signature: ${signature.slice(0, 16)}...`,
  );

  // If we have a timestamp, validate it and include it in the signed payload
  if (timestamp) {
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (isNaN(timestampMs) || Math.abs(now - timestampMs) > fiveMinutes) {
      console.log(`[elevenlabs-webhook] Timestamp validation failed: ${timestamp}`);
      return { ok: false, reason: "Timestamp too old or invalid" };
    }

    // Compute expected signature: HMAC-SHA256(timestamp.rawBody)
    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    if (compareSignatures(expectedSignature, signature)) {
      return { ok: true };
    }
    console.log(`[elevenlabs-webhook] Signature mismatch with timestamp`);
  }

  // Try without timestamp (just HMAC of body)
  const expectedNoTimestamp = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (compareSignatures(expectedNoTimestamp, signature)) {
    console.log(`[elevenlabs-webhook] Signature matched without timestamp`);
    return { ok: true };
  }

  console.log(`[elevenlabs-webhook] Expected (no ts): ${expectedNoTimestamp.slice(0, 16)}...`);
  console.log(`[elevenlabs-webhook] Got: ${signature.slice(0, 16)}...`);

  return { ok: false, reason: "Signature mismatch" };
}

function compareSignatures(expected: string, actual: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(actual, "hex");
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

// =============================================================================
// Webhook Payload Types
// =============================================================================

export type ElevenLabsWebhookPayload = {
  type?: string;
  event_timestamp?: number;
  data?: {
    conversation_id?: string;
    agent_id?: string;
    status?: string;
    transcript?: Array<{
      role: "agent" | "user";
      message: string;
      time_in_call_secs?: number;
    }>;
    analysis?: Record<string, unknown>;
    metadata?: {
      call_duration_secs?: number;
      start_time_unix_secs?: number;
      end_time_unix_secs?: number;
      [key: string]: unknown;
    };
  };
  // Flat structure (alternative format)
  conversation_id?: string;
  agent_id?: string;
  status?: string;
  transcript?: Array<{
    role: "agent" | "user";
    message: string;
    time_in_call_secs?: number;
  }>;
  analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// Webhook Handler
// =============================================================================

export type ElevenLabsWebhookHandlerOptions = {
  webhookSecret: string;
  webhookPath: string;
  onWebhook: (payload: {
    conversationId: string;
    status: string;
    transcript?: Array<{ role: string; message: string }>;
    analysis?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
};

/**
 * Read raw body from request.
 */
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", reject);
  });
}

/**
 * Normalize webhook payload to consistent format.
 */
function normalizePayload(raw: ElevenLabsWebhookPayload): {
  conversationId: string;
  status: string;
  transcript?: Array<{ role: string; message: string }>;
  analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} | null {
  // Handle nested data structure
  const data = raw.data ?? raw;
  const conversationId = data.conversation_id;
  const status = data.status;

  if (!conversationId || typeof conversationId !== "string") {
    return null;
  }

  return {
    conversationId,
    status: typeof status === "string" ? status : "unknown",
    transcript: data.transcript?.map((t) => ({ role: t.role, message: t.message })),
    analysis: data.analysis,
    metadata: data.metadata,
  };
}

// =============================================================================
// Registry (similar to Slack pattern)
// =============================================================================

type RegisteredHandler = {
  path: string;
  secret: string;
  onWebhook: ElevenLabsWebhookHandlerOptions["onWebhook"];
};

let registeredHandler: RegisteredHandler | null = null;

/**
 * Register the ElevenLabs webhook handler.
 * Returns a cleanup function to unregister.
 */
export function registerElevenLabsWebhookHandler(
  opts: ElevenLabsWebhookHandlerOptions,
): () => void {
  registeredHandler = {
    path: opts.webhookPath,
    secret: opts.webhookSecret,
    onWebhook: opts.onWebhook,
  };
  return () => {
    registeredHandler = null;
  };
}

/**
 * Handle ElevenLabs webhook HTTP request.
 * Returns true if the request was handled (path matched), false otherwise.
 */
export async function handleElevenLabsWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!registeredHandler) {
    return false;
  }

  const { path: webhookPath, secret: webhookSecret, onWebhook } = registeredHandler;
  const maxBodyBytes = 1024 * 1024; // 1MB

  // Check path
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== webhookPath) {
    return false;
  }

  console.log(`[elevenlabs-webhook] Received`);

  // Only accept POST
  if (req.method !== "POST") {
    console.log(`[elevenlabs-webhook] Rejected: Method ${req.method} not allowed`);
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }

  // Get signature header
  const signatureHeader = req.headers["elevenlabs-signature"];
  if (!signatureHeader || typeof signatureHeader !== "string") {
    console.log("[elevenlabs-webhook] Rejected: Missing ElevenLabs-Signature header");
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing ElevenLabs-Signature header" }));
    return true;
  }

  // Read body
  let rawBody: string;
  try {
    rawBody = await readRawBody(req, maxBodyBytes);
  } catch (err) {
    console.log("[elevenlabs-webhook] Rejected: Payload too large");
    res.statusCode = 413;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Payload too large" }));
    return true;
  }

  // Verify signature
  const verification = validateElevenLabsSignature(rawBody, signatureHeader, webhookSecret);
  if (!verification.ok) {
    console.log(`[elevenlabs-webhook] Rejected: ${verification.reason}`);
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: verification.reason }));
    return true;
  }

  // Parse payload
  let payload: ElevenLabsWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ElevenLabsWebhookPayload;
  } catch {
    console.log("[elevenlabs-webhook] Rejected: Invalid JSON");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }

  // Normalize and validate
  const normalized = normalizePayload(payload);
  if (!normalized) {
    console.log("[elevenlabs-webhook] Rejected: Missing conversation_id in payload");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing conversation_id" }));
    return true;
  }

  console.log(
    `[elevenlabs-webhook] Valid webhook: ${normalized.conversationId} (${normalized.status})`,
  );

  // Respond immediately (ElevenLabs expects quick 200)
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));

  // Process webhook asynchronously (response already sent)
  Promise.resolve()
    .then(() => onWebhook(normalized))
    .catch((err) => {
      console.error("[elevenlabs-webhook] Handler error:", err);
    });

  return true;
}

/**
 * Create ElevenLabs webhook request handler for the gateway.
 * @deprecated Use registerElevenLabsWebhookHandler and handleElevenLabsWebhookRequest instead.
 */
export function createElevenLabsWebhookHandler(
  opts: ElevenLabsWebhookHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { webhookSecret, webhookPath, onWebhook } = opts;
  const maxBodyBytes = 1024 * 1024; // 1MB

  return async (req, res) => {
    // Check path
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== webhookPath) {
      return false;
    }

    // Only accept POST
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

    // Get signature header
    const signatureHeader = req.headers["elevenlabs-signature"];
    if (!signatureHeader || typeof signatureHeader !== "string") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing ElevenLabs-Signature header" }));
      return true;
    }

    // Read body
    let rawBody: string;
    try {
      rawBody = await readRawBody(req, maxBodyBytes);
    } catch (err) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Payload too large" }));
      return true;
    }

    // Verify signature
    const verification = validateElevenLabsSignature(rawBody, signatureHeader, webhookSecret);
    if (!verification.ok) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: verification.reason }));
      return true;
    }

    // Parse payload
    let payload: ElevenLabsWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as ElevenLabsWebhookPayload;
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }

    // Normalize and validate
    const normalized = normalizePayload(payload);
    if (!normalized) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing conversation_id" }));
      return true;
    }

    // Respond immediately (ElevenLabs expects quick 200)
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));

    // Process webhook asynchronously (response already sent)
    Promise.resolve()
      .then(() => onWebhook(normalized))
      .catch((err) => {
        console.error("[elevenlabs-webhook] Handler error:", err);
      });

    return true;
  };
}

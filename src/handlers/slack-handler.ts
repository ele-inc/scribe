/**
 * Slack bot event handler
 * Extracted from index.ts for better separation of concerns
 */

import { SlackEvent } from "../core/types.ts";
import { parseTranscriptionOptions } from "../utils/utils.ts";
import { textResponse, okResponse, badRequest } from "../utils/http-utils.ts";
import {
  extractMediaInfo
} from "../services/file-processor.ts";
import { createPlatformAdapter } from "../adapters/platform-adapter.ts";
import { TranscriptionProcessor, FileAttachment } from "../services/transcription-processor.ts";

// Set to track processed events (with size limit to prevent memory leak)
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

/**
 * Create adapter and processor for Slack events
 * Centralized helper to reduce duplication
 */
function createSlackProcessor(event: SlackEvent): {
  adapter: ReturnType<typeof createPlatformAdapter>;
  processor: TranscriptionProcessor;
} {
  const adapter = createPlatformAdapter("slack", {
    channelId: event.channel,
    threadTimestamp: event.ts,
  });

  const processor = new TranscriptionProcessor(adapter, {
    channelId: event.channel,
    timestamp: event.ts,
    userId: event.user,
  });

  return { adapter, processor };
}

/**
 * Handle Slack app mention events
 */
export async function handleAppMention(event: SlackEvent) {
  // Create unique event ID to prevent duplicates
  const eventId = `${event.channel}_${event.ts}_${event.user}`;

  if (processedEvents.has(eventId)) {
    console.log("Duplicate event detected, skipping:", eventId);
    return;
  }

  // Add event ID and maintain size limit
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_PROCESSED_EVENTS) {
    const firstKey = processedEvents.values().next().value;
    if (firstKey) processedEvents.delete(firstKey);
  }
  console.log("Processing new event:", eventId);

  // Parse transcription options from mention text
  const options = parseTranscriptionOptions(event.text);
  console.log("Parsed options:", options);

  // Check for cloud service URLs in the message
  const { cloudUrls } = extractMediaInfo(event.text || "");

  // Check if the mention includes files or cloud URLs
  if ((!event.files || event.files.length === 0) && cloudUrls.length === 0) {
    const { adapter } = createSlackProcessor(event);
    await adapter.sendUsageMessage();
    return;
  }

  // Create adapter and processor once
  const { processor } = createSlackProcessor(event);

  // Process cloud URLs and file attachments using the same processor
  const processPromises: Promise<void>[] = [];

  // Process cloud URLs
  if (cloudUrls.length > 0) {
    processPromises.push(
      processor.processTextInput(event.text || "", options)
        .catch(console.error)
    );
  }

  // Process regular Slack files
  if (event.files && event.files.length > 0) {
    const attachments: FileAttachment[] = event.files.map(file => ({
      url: file.url_private || "",
      filename: file.name,
      mimeType: file.mimetype,
      duration: file.duration,
    }));

    processPromises.push(
      processor.processAttachments(attachments, options)
        .catch(console.error)
    );
  }

  // Wait for all processing to complete, then cleanup
  Promise.all(processPromises)
    .finally(() => processor.cleanup());
}

/**
 * Handle Slack URL verification challenge
 */
export function handleUrlVerification(challenge: string): Response {
  return textResponse(challenge);
}

/**
 * Main Slack events handler
 */
export async function handleSlackEvents(req: Request): Promise<Response> {
  const bodyText = await req.text();
  const body = JSON.parse(bodyText);

  // Handle URL verification challenge
  if (body.type === "url_verification") {
    return handleUrlVerification(body.challenge);
  }

  // Handle events
  if (body.type === "event_callback") {
    const event = body.event;

    if (event.type !== "app_mention") {
      return okResponse();
    }

    // Process in background to respond quickly to Slack
    handleAppMention(event).catch(console.error);
    return okResponse();
  }

  return badRequest("Unknown event type");
}

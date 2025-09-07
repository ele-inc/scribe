/**
 * Slack bot event handler
 * Extracted from index.ts for better separation of concerns
 */

import { SlackEvent } from "./types.ts";
import { parseTranscriptionOptions } from "./utils.ts";
import { sendSlackMessage } from "./slack.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { textResponse, okResponse, badRequest } from "./http-utils.ts";
import { 
  processGoogleDriveFile, 
  extractMediaInfo, 
  isValidAudioVideoFile,
  formatOptionsText 
} from "./file-processor.ts";
import { createPlatformAdapter } from "./platform-adapter.ts";

// Set to track processed events (with size limit to prevent memory leak)
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

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

  // Check for Google Drive URLs in the message
  const { googleDriveUrls } = extractMediaInfo(event.text || "");

  // Check if the mention includes files or Google Drive URLs
  if ((!event.files || event.files.length === 0) && googleDriveUrls.length === 0) {
    const adapter = createPlatformAdapter("slack", {
      channelId: event.channel,
      threadTimestamp: event.ts,
    });
    await adapter.sendUsageMessage();
    return;
  }

  // Process Google Drive URLs first
  for (const driveUrl of googleDriveUrls) {
    const adapter = createPlatformAdapter("slack", {
      channelId: event.channel,
      threadTimestamp: event.ts,
    });

    // Process asynchronously without blocking response
    processGoogleDriveFile(driveUrl, {
      channelId: event.channel,
      timestamp: event.ts,
      userId: event.user,
      transcriptionOptions: options,
      platform: "slack",
    }).then(async (result) => {
      if (result.success && result.filename) {
        const processingMessage = `Google Driveファイル "${result.filename}" を受信しました。文字起こし中${formatOptionsText(options)}...`;
        await adapter.sendStatusMessage(processingMessage);
      } else if (!result.success && result.error !== "File is not a media file") {
        await adapter.sendErrorMessage(result.error || "Unknown error");
      }
    }).catch(console.error);
  }

    // Process regular Slack files
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        // Check if file is not audio or video
        if (!isValidAudioVideoFile(file.mimetype)) {
          await sendSlackMessage(
            event.channel,
            `ファイル "${file.name}" は音声または動画ファイルではありません。`,
            event.ts,
          );
          continue;
        }

        // Reply with file info including options
        const adapter = createPlatformAdapter("slack", {
          channelId: event.channel,
          threadTimestamp: event.ts,
        });
        
        const processingMessage = adapter.formatProcessingMessage(file.name, options);
        await adapter.sendStatusMessage(processingMessage);

        // Process transcription asynchronously without blocking response
        transcribeAudioFile({
          fileURL: file.url_private || "",
          fileType: file.mimetype || "",
          duration: file.duration || 0,
          channelId: event.channel,
          timestamp: event.ts,
          userId: event.user,
          options,
          filename: file.name,
        }).catch(console.error);
      }
    }
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

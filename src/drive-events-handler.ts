/**
 * Google Drive Events handler for Workspace Events via Eventarc
 */

import { getGoogleDriveFileMetadata, downloadGoogleDriveFileToPath } from "./googledrive.ts";
import { transcribeCore } from "./transcribe-core.ts";
import { isVideoFile, convertVideoToAudio } from "./utils.ts";
import { config } from "./config.ts";
import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";
import { okResponse, badRequest, textResponse } from "./http-utils.ts";

// CloudEvents structure from Eventarc
interface CloudEvent {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: string;
  data: {
    message: {
      data: string; // Base64 encoded Pub/Sub message
      messageId: string;
      publishTime: string;
    };
  };
}

// Workspace Events Drive payload structure
interface DriveEventPayload {
  eventType?: string;
  driveItem?: {
    driveItemId?: string;
    mimeType?: string;
    name?: string;
    driveId?: string;
    parentId?: string;
  };
  // Alternative field names (varies by tenant/version)
  resourceId?: string;
  fileId?: string;
  itemId?: string;
  parentFolderId?: string;
}

// Track processed events to prevent duplicates
const processedEvents = new Map<string, number>();
const MAX_PROCESSED_EVENTS = 1000;
const EVENT_TTL_MS = 3600000; // 1 hour

// Clean up old events periodically
function cleanupProcessedEvents() {
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_TTL_MS) {
      processedEvents.delete(eventId);
    }
  }
}

// Initialize Google Drive client
function initializeDriveClient() {
  if (!config.googlePrivateKey) {
    throw new Error("GOOGLE_PRIVATE_KEY environment variable is not set");
  }
  
  const formattedPrivateKey = config.googlePrivateKey.replace(/\\n/g, '\n');
  
  const auth = new JWT({
    email: config.googleClientEmail,
    key: formattedPrivateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: config.googleImpersonateEmail,
  });

  return google.drive({ version: "v3", auth });
}

// Upload transcript to Drive
async function uploadTranscriptToDrive(
  transcript: string,
  originalFileName: string,
  outputFolderId: string
): Promise<string> {
  const drive = initializeDriveClient();
  
  // Create filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const baseName = originalFileName.replace(/\.[^/.]+$/, '');
  const fileName = `${baseName}_transcript_${timestamp}.txt`;
  
  // Upload file
  const fileMetadata = {
    name: fileName,
    parents: [outputFolderId],
  };
  
  const media = {
    mimeType: 'text/plain',
    body: transcript,
  };
  
  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  
  console.log(`Transcript uploaded to Drive: ${response.data.webViewLink}`);
  return response.data.id || '';
}

// Extract file ID from various payload structures
function extractFileId(payload: any): string | null {
  // Log the payload structure for debugging
  console.log("Extracting fileId from payload keys:", Object.keys(payload));
  
  // Try various possible field paths
  const fileId = payload.driveItem?.driveItemId || 
         payload.resourceId || 
         payload.fileId || 
         payload.itemId ||
         payload.id ||
         payload.resource?.id ||
         payload.object?.id ||
         payload.file?.id ||
         null;
  
  console.log("Extracted fileId:", fileId);
  return fileId;
}

// Extract parent folder ID from payload
function extractParentId(payload: DriveEventPayload): string | null {
  return payload.driveItem?.parentId || 
         payload.parentFolderId || 
         null;
}

/**
 * Handle Drive Events from Eventarc
 */
export async function handleDriveEvents(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return badRequest("Method not allowed");
  }

  try {
    // Parse request body
    const body = await req.json();
    console.log("Received event body:", JSON.stringify(body));

    // Try different CloudEvent structures
    let messageData: string | undefined;
    
    // Standard CloudEvents structure
    if (body.data?.message?.data) {
      messageData = body.data.message.data;
      console.log("Found message in standard CloudEvents structure");
    }
    // Alternative: Direct Pub/Sub message
    else if (body.message?.data) {
      messageData = body.message.data;
      console.log("Found message in Pub/Sub structure");
    }
    // Alternative: Direct data field
    else if (body.data && typeof body.data === 'string') {
      messageData = body.data;
      console.log("Found message in direct data field");
    }
    
    if (!messageData) {
      console.log("No message data found in any expected location");
      console.log("Request headers:", [...req.headers.entries()]);
      return okResponse(); // ACK to prevent retry
    }

    // Decode base64 payload
    let payload: any;
    try {
      const decodedData = atob(messageData);
      payload = JSON.parse(decodedData);
      console.log("Decoded Drive event payload:", JSON.stringify(payload));
    } catch (e) {
      console.log("Failed to decode as base64, trying direct parse");
      try {
        payload = typeof messageData === 'string' ? JSON.parse(messageData) : messageData;
        console.log("Direct parsed payload:", JSON.stringify(payload));
      } catch (e2) {
        console.error("Failed to parse message data:", e2);
        return okResponse();
      }
    }

    // Extract file ID
    const fileId = extractFileId(payload);
    if (!fileId) {
      console.log("No file ID found in payload");
      return okResponse();
    }

    // Check for duplicate processing
    const eventKey = `${fileId}_${body.id || Date.now()}`;
    if (processedEvents.has(eventKey)) {
      console.log(`Duplicate event for file ${fileId}, skipping`);
      return okResponse();
    }

    // Mark as processed
    processedEvents.set(eventKey, Date.now());
    cleanupProcessedEvents();
    
    // Maintain size limit
    if (processedEvents.size > MAX_PROCESSED_EVENTS) {
      const firstKey = processedEvents.keys().next().value;
      if (firstKey) processedEvents.delete(firstKey);
    }

    // Get input/output folder IDs from environment
    const inputFolderId = Deno.env.get("DRIVE_INPUT_FOLDER_ID");
    const outputFolderId = Deno.env.get("DRIVE_OUTPUT_FOLDER_ID");
    
    if (!inputFolderId || !outputFolderId) {
      console.error("DRIVE_INPUT_FOLDER_ID or DRIVE_OUTPUT_FOLDER_ID not configured");
      return okResponse();
    }

    // Get file metadata from Drive API
    let metadata;
    try {
      metadata = await getGoogleDriveFileMetadata(fileId);
      console.log("File metadata:", {
        id: metadata.id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        size: metadata.size,
      });
    } catch (error) {
      console.error("Failed to get file metadata:", error);
      return okResponse(); // File might be deleted or inaccessible
    }

    // Check if it's a video or audio file
    if (!metadata.mimeType.startsWith('video/') && !metadata.mimeType.startsWith('audio/')) {
      console.log(`File ${metadata.name} is not a video/audio file (${metadata.mimeType}), skipping`);
      return okResponse();
    }

    // Verify parent folder matches (if we can get it from Drive API)
    // Note: This requires additional API call, optional for performance
    const drive = initializeDriveClient();
    try {
      const fileDetails = await drive.files.get({
        fileId: fileId,
        fields: 'parents',
        supportsAllDrives: true,
      });
      
      if (!fileDetails.data.parents?.includes(inputFolderId)) {
        console.log(`File ${metadata.name} is not in target folder, skipping`);
        return okResponse();
      }
    } catch (error) {
      console.error("Failed to check file parents:", error);
      // Continue anyway if we can't verify
    }

    // Process the media file
    console.log(`Processing ${metadata.mimeType.startsWith('video/') ? 'video' : 'audio'} file: ${metadata.name}`);
    
    // Create temporary directory and file path
    const tempDir = await Deno.makeTempDir();
    const tempPath = `${tempDir}/drive_${Date.now()}_${metadata.name}`;
    let audioPath: string | null = null;

    try {
      // Download file
      console.log("Downloading file from Drive...");
      await downloadGoogleDriveFileToPath(fileId, tempPath);
      
      // Convert video to audio if needed
      let processPath = tempPath;
      if (isVideoFile(metadata.mimeType)) {
        console.log("Converting video to audio...");
        audioPath = await convertVideoToAudio(tempPath);
        processPath = audioPath;
      }

      // Read file for transcription
      const fileData = await Deno.readFile(processPath);
      const mimeType = audioPath ? "audio/mpeg" : metadata.mimeType;

      // Transcribe with default options
      console.log("Starting transcription...");
      const result = await transcribeCore(fileData, mimeType, {
        diarize: true,
        showTimestamp: true,
        tagAudioEvents: true,
        numSpeakers: 2,
      });

      // Upload transcript to Drive
      console.log("Uploading transcript to Drive...");
      await uploadTranscriptToDrive(
        result.transcript,
        metadata.name,
        outputFolderId
      );

      console.log(`Successfully processed ${metadata.name}`);

    } finally {
      // Clean up temporary files
      console.log("Cleaning up temporary files...");
      if (audioPath) {
        await Deno.remove(audioPath).catch(() => {});
      }
      await Deno.remove(tempPath).catch(() => {});
      await Deno.remove(tempDir).catch(() => {});
    }

    return okResponse();

  } catch (error) {
    console.error("Error handling Drive event:", error);
    // Return 200 to prevent infinite retries for malformed events
    return okResponse();
  }
}
import {
  TranscriptionOptions,
  TranscriptionLog
} from "./types.ts";
import {
  getFileExtensionFromMime,
  createTranscriptionHeader,
  convertVideoToAudio,
  isVideoFile,
} from "../utils/utils.ts";
import { summarizeTranscript } from "../clients/openai-client.ts";
import { PlatformAdapter } from "../adapters/platform-adapter.ts";
import { transcribeCore } from "./transcribe-core.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";



export async function transcribeAudioFile({
  fileURL,
  fileType,
  duration,
  channelId,
  timestamp,
  userId,
  options,
  filename,
  isGoogleDrive,
  tempPath,
  adapter,
}: {
  fileURL: string;
  fileType: string;
  duration: number;
  channelId: string;
  timestamp: string;
  userId: string;
  options: TranscriptionOptions;
  filename?: string;
  isGoogleDrive?: boolean;
  tempPath?: string;
  adapter: PlatformAdapter;
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  const errorMsg: string | null = null;
  let tempFilePath: string | null = null;
  let audioFilePath: string | null = null;
  let originalVideoPath: string | null = null;
  const tempManager = new TempFileManager();

  console.log("fileURL", fileURL, "scribe called");
  console.log("fileType (MIME):", fileType);

  try {
    // Handle Google Drive files vs platform files
    if (isGoogleDrive && tempPath) {
      // File is already downloaded from cloud service
      tempFilePath = tempPath;
      console.log("Using cloud file temp path:", tempFilePath);
    } else {
      // Download from platform (Slack/Discord)
      const fileExtension = getFileExtensionFromMime(fileType);
      tempFilePath = await tempManager.createTempFile("audio", fileExtension);

      console.log("downloading file to temp path:", tempFilePath);
      await adapter.downloadFile(fileURL, tempFilePath);
    }

    // Check if the file is a video and convert to MP3 if needed
    if (isVideoFile(fileType)) {
      console.log("Detected video file, converting to MP3...");
      originalVideoPath = tempFilePath;
      audioFilePath = await convertVideoToAudio(tempFilePath);
      tempFilePath = audioFilePath;

      // Delete the original video file after conversion
      console.log("Deleting original video file:", originalVideoPath);
      await Deno.remove(originalVideoPath);
    }

    // Read file into memory
    const fileData = await Deno.readFile(tempFilePath);

    // Use the appropriate MIME type
    const mimeType = isVideoFile(fileType) ? "audio/mpeg" : fileType;

    // Call the core transcription function
    const result = await transcribeCore(fileData, mimeType, options);

    transcript = result.transcript;
    languageCode = result.languageCode;

    if (transcript) {

      // Add header with filename if provided
      const finalTranscript = filename
        ? createTranscriptionHeader(filename) + transcript
        : transcript;

      await adapter.uploadTranscript(finalTranscript, filename);
      if (options.summarize !== false) {
        try {
          const summary = await summarizeTranscript(finalTranscript);
          await adapter.sendSummary(summary);
        } catch (error) {
          console.error("Failed to generate or send transcript summary:", error);
        }
      } else {
        console.log("Summary generation skipped by --no-summarize option");
      }
    } else {
      console.log("No transcript generated, sending error message");
      await adapter.sendErrorMessage("文字起こしの生成に失敗しました。もう一度お試しください。");
    }
  } finally {
    // Clean up audio file if it was created from video conversion
    if (audioFilePath) {
      console.log("cleaning up converted audio file:", audioFilePath);
      await tempManager.cleanupFileAndDir(audioFilePath);
    }

    // Clean up original temp file if no audio conversion was done
    if (tempFilePath && !audioFilePath) {
      console.log("cleaning up temp file:", tempFilePath);
      await tempManager.cleanupFileAndDir(tempFilePath);
    }

    // Clean up all remaining temp files
    await tempManager.cleanupAll();
  }

  const logLine: TranscriptionLog = {
    file_type: fileType,
    duration,
    channel_id: channelId,
    message_ts: timestamp,
    user_id: userId,
    language_code: languageCode,
    error: errorMsg,
  };

  // Log transcription completion to console
  console.log("Transcription completed:", {
    ...logLine,
    transcriptLength: transcript ? transcript.length : 0,
    timestamp: new Date().toISOString()
  });
}

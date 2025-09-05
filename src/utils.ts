import { TranscriptionOptions } from "./types.ts";

// Re-export utilities from lib modules
export { formatTimestamp } from "./lib/time.ts";
export { getFileExtensionFromMime, isVideoMimeType } from "./lib/mime-types.ts";
export { extractSentences, groupBySpeaker } from "./lib/text-processing.ts";
export { parseTranscriptionOptions, generateOptionInfo } from "./lib/transcription-options.ts";
export { extractCloudUrls, detectCloudProvider } from "./lib/cloud-storage.ts";

// Import for local use
import { isVideoMimeType } from "./lib/mime-types.ts";





export const createTranscriptionHeader = (filename: string): string => {
  return `Original filename: ${filename}\n\n# Transcription Result\n\n`;
}



/**
 * 動画ファイルから音声(MP3)を抽出する
 * @param inputPath 入力動画ファイルのパス
 * @returns 変換された音声ファイルのパス
 */
export const convertVideoToAudio = async (
  inputPath: string
): Promise<string> => {
  const outputDir = await Deno.makeTempDir();
  try {
    // 元のファイル名を保持してmp3拡張子に変更
    const originalBaseName = inputPath.substring(inputPath.lastIndexOf('/') + 1, inputPath.lastIndexOf('.'));
    const outputPath = `${outputDir}/${originalBaseName}.mp3`;

    console.log(`Converting video to audio: ${inputPath} -> ${outputPath}`);

    // ffmpegコマンドで動画から音声を抽出
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", inputPath,
        "-vn",
        "-acodec", "mp3",
        "-ab", "128k",
        "-ar", "16000",
        "-y",
        outputPath
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await command.output();

    if (!success) {
      const errorText = new TextDecoder().decode(stderr);
      throw new Error(`ffmpeg failed: ${errorText}`);
    }

    console.log(`Audio extraction completed: ${outputPath}`);
    return outputPath;
  } catch (error) {
    // Clean up temp directory on error
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    throw new Error(`Failed to convert video to audio: ${error}`);
  }
};

/**
 * Check if a file is a video based on MIME type
 * @deprecated Use isVideoMimeType from lib/mime-types instead
 */
export const isVideoFile = isVideoMimeType;

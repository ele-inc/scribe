import { CloudFileMetadata } from "../services/cloud-service.ts";

const decoder = new TextDecoder();

let ytDlpStatus: "unknown" | "available" | "missing" = "unknown";
let ytDlpError: string | null = null;

async function ensureYtDlpAvailable(): Promise<void> {
  if (ytDlpStatus === "available") {
    return;
  }

  if (ytDlpStatus === "missing") {
    throw new Error(ytDlpError ?? "yt-dlp is not available");
  }

  try {
    const command = new Deno.Command("yt-dlp", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stderr } = await command.output();

    if (!success) {
      const errorText = decoder.decode(stderr).trim();
      ytDlpStatus = "missing";
      ytDlpError =
        `yt-dlp check failed. Please ensure yt-dlp is installed and accessible in PATH. ${errorText}`.trim();
      throw new Error(ytDlpError);
    }

    ytDlpStatus = "available";
  } catch (error) {
    ytDlpStatus = "missing";
    ytDlpError = `yt-dlp is not installed or not accessible. ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(ytDlpError);
  }
}

function createYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname.includes("youtube.com") || hostname === "youtu.be" || hostname.endsWith("youtube-nocookie.com");
  } catch {
    return false;
  }
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const id = parsed.pathname.replace(/^\//, "");
      return id || null;
    }

    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }

    const pathMatchers = [/^\/shorts\/([^/?]+)/, /^\/embed\/([^/?]+)/, /^\/live\/([^/?]+)/, /^\/v\/([^/?]+)/];

    for (const matcher of pathMatchers) {
      const pathMatch = parsed.pathname.match(matcher);
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function getYouTubeFileMetadata(videoId: string): Promise<CloudFileMetadata> {
  await ensureYtDlpAvailable();
  const url = createYouTubeWatchUrl(videoId);

  const command = new Deno.Command("yt-dlp", {
    args: ["--dump-json", "--skip-download", "--no-warnings", url],
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stdout, stderr } = await command.output();

  if (!success) {
    const errorText = decoder.decode(stderr).trim();
    throw new Error(`Failed to fetch YouTube metadata: ${errorText}`);
  }

  const stdoutText = decoder.decode(stdout).trim();

  if (!stdoutText) {
    throw new Error("Received empty metadata from yt-dlp");
  }

  let metadata: { id: string; title: string; duration?: number; filesize?: number; filesize_approx?: number };
  try {
    metadata = JSON.parse(stdoutText);
  } catch (error) {
    throw new Error(`Failed to parse YouTube metadata: ${error instanceof Error ? error.message : String(error)}`);
  }

  const sanitizedTitle = sanitizeFilename(metadata.title || videoId) || videoId;
  const filename = `${sanitizedTitle}.mp3`;

  const sizeValue = metadata.filesize ?? metadata.filesize_approx;

  return {
    id: metadata.id ?? videoId,
    filename,
    mimeType: "audio/mpeg",
    size: typeof sizeValue === "number" ? sizeValue : undefined,
  };
}

export async function downloadYouTubeAudioToPath(videoId: string, outputPath: string): Promise<void> {
  await ensureYtDlpAvailable();
  const url = createYouTubeWatchUrl(videoId);

  const command = new Deno.Command("yt-dlp", {
    args: [
      "-f",
      "bestaudio",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "192K",
      "--no-playlist",
      "-o",
      outputPath,
      url,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stderr } = await command.output();

  if (!success) {
    const errorText = decoder.decode(stderr).trim();
    throw new Error(`Failed to download audio from YouTube: ${errorText}`);
  }

  try {
    await Deno.stat(outputPath);
  } catch {
    throw new Error("YouTube audio download completed but output file was not found");
  }
}

import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";
import {
  TranscriptionOptions,
  WordItem,
} from "./types.ts";
import {
  formatTimestamp,
  extractSentences,
  groupBySpeaker,
} from "./utils.ts";
import { identifySpeakers, replaceSpeakerLabels } from "./openai-client.ts";
import { config } from "./config.ts";
import { GoogleDriveStreamer, parseGoogleDriveUrl } from "./googledrive-stream.ts";

const elevenlabs = new ElevenLabsClient({
  apiKey: config.elevenLabsApiKey,
});

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
}

/**
 * ストリームからBlobを作成（ElevenLabs APIの要件）
 * @param stream - 音声データのストリーム
 * @returns Blob
 */
async function streamToBlob(stream: ReadableStream<Uint8Array>): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  
  try {
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      totalSize += value.length;
      
      // 進捗表示（10MBごと）
      if (totalSize % (10 * 1024 * 1024) < value.length) {
        console.log(`Buffering audio: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      }
    }
    
    console.log(`Total audio size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    return new Blob(chunks, { type: "audio/mpeg" });
  } finally {
    reader.releaseLock();
  }
}

/**
 * ストリーミングベースの文字起こし処理
 * @param audioStream - 音声データのストリーム
 * @param options - 文字起こしオプション
 * @returns 文字起こし結果
 */
export async function transcribeStream(
  audioStream: ReadableStream<Uint8Array>,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  console.log("Converting stream to blob for ElevenLabs API...");
  
  // ElevenLabs APIはBlobを要求するため、ストリームをBlobに変換
  // ただし、これは音声ファイルのみ（動画は既に変換済み）
  const audioBlob = await streamToBlob(audioStream);
  
  console.log("Calling ElevenLabs API with audio blob...");
  
  // ElevenLabs APIを呼び出し
  const scribeResult = await elevenlabs.speechToText.convert({
    file: audioBlob,
    model_id: "scribe_v1",
    tag_audio_events: options.tagAudioEvents,
    diarize: options.diarize,
    language_code: "ja",
    ...(options.diarize && options.numSpeakers ? { num_speakers: options.numSpeakers } : {}),
  }, { timeoutInSeconds: 180 });

  const words: WordItem[] | undefined = (scribeResult as { words?: WordItem[] }).words;
  let transcript = "";

  // 文字起こし結果の処理（既存のロジックを再利用）
  if (options.diarize && Array.isArray(words) && words.length > 0) {
    const grouped = groupBySpeaker(words);
    transcript = grouped
      .map((u) => {
        const speakerLabel = typeof u.speaker === "number"
          ? `speaker_${u.speaker}`
          : `${u.speaker}`;
        if (options.showTimestamp) {
          return `${formatTimestamp(u.start)} ${speakerLabel}: ${u.text.trim()}`;
        } else {
          return `${speakerLabel}: ${u.text.trim()}`;
        }
      })
      .join("\n");
  } else if (!options.diarize && Array.isArray(words) && words.length > 0) {
    const sentences = extractSentences(words);
    transcript = sentences
      .map((s) => {
        if (options.showTimestamp) {
          return `${formatTimestamp(s.start)} ${s.text}`;
        } else {
          return s.text;
        }
      })
      .join("\n");
  } else {
    const plain = (scribeResult.text || "").trim();
    transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
  }

  // 話者名のマッピング（必要に応じて）
  if (options.diarize && options.speakerNames && options.speakerNames.length > 0 && transcript) {
    try {
      console.log("Identifying speakers with names:", options.speakerNames);
      const speakerMapping = await identifySpeakers(transcript, options.speakerNames);
      transcript = replaceSpeakerLabels(transcript, speakerMapping);
      console.log("Speaker labels replaced successfully");
    } catch (error) {
      console.error("Failed to identify speakers:", error);
    }
  }

  const languageCode = (scribeResult as { language_code?: string }).language_code || null;

  return {
    transcript,
    languageCode,
    words,
  };
}

/**
 * Google Driveファイルをストリーミングで文字起こし
 * @param driveUrl - Google DriveのURL
 * @param options - 文字起こしオプション
 * @returns 文字起こし結果
 */
export async function transcribeGoogleDriveStream(
  driveUrl: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  const fileId = parseGoogleDriveUrl(driveUrl);
  if (!fileId) {
    throw new Error("Invalid Google Drive URL");
  }

  const streamer = new GoogleDriveStreamer();
  
  // ファイルメタデータを取得
  const metadata = await streamer.getFileMetadata(fileId);
  console.log(`Processing: ${metadata.name} (${metadata.mimeType})`);
  
  let audioStream: ReadableStream<Uint8Array>;
  
  // ファイルタイプに応じて処理
  if (metadata.mimeType.startsWith("video/")) {
    console.log("Streaming video and converting to audio...");
    audioStream = await streamer.streamVideoToAudio(fileId);
  } else if (metadata.mimeType.startsWith("audio/")) {
    console.log("Streaming audio directly...");
    audioStream = await streamer.streamAudio(fileId);
  } else {
    throw new Error(`Unsupported file type: ${metadata.mimeType}`);
  }
  
  // ストリーミングで文字起こし
  return transcribeStream(audioStream, options);
}

/**
 * ローカルファイルをストリーミングで処理（動画の場合）
 * @param filePath - ローカルファイルのパス
 * @param options - 文字起こしオプション
 * @returns 文字起こし結果
 */
export async function transcribeLocalFileStream(
  filePath: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  // ファイル拡張子からMIMEタイプを判定
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const isVideo = ['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(extension);
  
  if (isVideo) {
    console.log("Converting local video to audio stream...");
    
    // ffmpegでストリーミング変換
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", filePath,           // 入力ファイル
        "-vn",                    // 動画トラックを無視
        "-acodec", "libmp3lame",  // MP3エンコーダー
        "-ab", "128k",            // ビットレート
        "-ar", "16000",           // サンプリングレート
        "-ac", "1",               // モノラル
        "-f", "mp3",              // 出力フォーマット
        "pipe:1"                  // 標準出力へ
      ],
      stdout: "piped",
      stderr: "piped",
    });
    
    const process = command.spawn();
    
    // エラーログを非同期で処理
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of process.stderr) {
        const text = decoder.decode(chunk);
        if (!text.includes("Error") && !text.includes("error")) {
          console.log("ffmpeg:", text.trim());
        }
      }
    })();
    
    return transcribeStream(process.stdout, options);
  } else {
    // 音声ファイルの場合は、ファイルをストリームとして読む
    console.log("Streaming audio file...");
    const file = await Deno.open(filePath, { read: true });
    const stream = file.readable;
    
    return transcribeStream(stream, options);
  }
}
/**
 * Transcription options utilities
 */

import type { TranscriptionOptions } from "../types/transcription.ts";

/**
 * Parse transcription options from text
 */
export function parseTranscriptionOptions(text: string = ""): TranscriptionOptions {
  const diarize = !text.includes("--no-diarize");

  // Parse num-speakers from command, or use default of 2 when diarize is enabled
  let numSpeakers: number | undefined;
  if (diarize) {
    const numSpeakersMatch = text.match(/--num-speakers\s+(\d+)/);
    if (numSpeakersMatch) {
      const parsed = parseInt(numSpeakersMatch[1], 10);
      numSpeakers = (parsed >= 1 && parsed <= 32) ? parsed : 2;
    } else {
      numSpeakers = 2; // Default to 2 speakers when diarize is true
    }
  }

  // Parse speaker names (supports both quoted and unquoted format)
  let speakerNames: string[] | undefined;
  const namesMatch = text.match(/--speaker-names\s+(?:"([^"]+)"|([^-]+?)(?:\s+--|\s*$))/);
  if (namesMatch) {
    const names = namesMatch[1] || namesMatch[2];
    // Split by both full-width and half-width comma
    speakerNames = names.trim().split(/[,，]/).map(name => name.trim());
  }

  return {
    diarize,
    showTimestamp: !text.includes("--no-timestamp"),
    tagAudioEvents: !text.includes("--no-audio-events"),
    ...(numSpeakers ? { numSpeakers } : {}),
    ...(speakerNames ? { speakerNames } : {}),
  };
}

/**
 * Generate option info text for display
 */
export function generateOptionInfo(options: TranscriptionOptions): string {
  const info: string[] = [];
  
  if (!options.diarize) {
    info.push("話者識別OFF");
  }
  
  if (!options.showTimestamp) {
    info.push("タイムスタンプOFF");
  }
  
  if (!options.tagAudioEvents) {
    info.push("音声イベントOFF");
  }
  
  if (options.diarize && options.numSpeakers && options.numSpeakers !== 2) {
    info.push(`話者数: ${options.numSpeakers}`);
  }
  
  if (options.speakerNames && options.speakerNames.length > 0) {
    info.push(`話者名: ${options.speakerNames.join(", ")}`);
  }
  
  return info.length > 0 ? ` (${info.join(", ")})` : "";
}

/**
 * Validate transcription options
 */
export function validateOptions(options: TranscriptionOptions): { 
  valid: boolean; 
  errors: string[] 
} {
  const errors: string[] = [];
  
  // Validate num speakers
  if (options.numSpeakers !== undefined) {
    if (options.numSpeakers < 1 || options.numSpeakers > 32) {
      errors.push("話者数は1-32の範囲で指定してください");
    }
  }
  
  // Validate speaker names
  if (options.speakerNames && options.numSpeakers) {
    if (options.speakerNames.length > options.numSpeakers) {
      errors.push(`話者名の数(${options.speakerNames.length})が話者数(${options.numSpeakers})を超えています`);
    }
  }
  
  // Check for conflicting options
  if (!options.diarize && options.speakerNames) {
    errors.push("話者名の指定には話者識別を有効にする必要があります");
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge default options with user options
 */
export function mergeWithDefaults(
  userOptions: Partial<TranscriptionOptions>
): TranscriptionOptions {
  const defaults: TranscriptionOptions = {
    diarize: true,
    showTimestamp: true,
    tagAudioEvents: true,
  };
  
  return { ...defaults, ...userOptions };
}
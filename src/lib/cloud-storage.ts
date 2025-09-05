/**
 * Unified cloud storage handling
 */

import type { DownloadedFile } from "../types/media.ts";
import { downloadGoogleDriveFile } from "../googledrive.ts";
import { downloadDropboxFile } from "../dropbox.ts";
import { isGoogleDriveUrl } from "../googledrive.ts";
import { isDropboxUrl } from "../dropbox.ts";
import { ExternalServiceError } from "../errors.ts";

export type CloudProvider = 'google-drive' | 'dropbox' | 'unknown';

export interface CloudFileInfo {
  provider: CloudProvider;
  url: string;
  fileId?: string;
  filename?: string;
}

/**
 * Detect cloud storage provider from URL
 */
export function detectCloudProvider(url: string): CloudProvider {
  if (isGoogleDriveUrl(url)) {
    return 'google-drive';
  }
  if (isDropboxUrl(url)) {
    return 'dropbox';
  }
  return 'unknown';
}

/**
 * Extract first cloud storage URL from text
 * Returns null if no cloud storage URL is found
 */
export function extractCloudUrl(text: string): CloudFileInfo | null {
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  const urls = text.match(urlPattern) || [];
  
  for (const url of urls) {
    const provider = detectCloudProvider(url);
    if (provider !== 'unknown') {
      return { provider, url };
    }
  }
  
  return null;
}

/**
 * Download file from cloud storage
 */
export async function downloadFromCloud(
  url: string,
  tempPath: string
): Promise<{ filename: string; mimeType?: string }> {
  const provider = detectCloudProvider(url);
  
  switch (provider) {
    case 'google-drive':
      return await downloadGoogleDriveFile(url, tempPath);
      
    case 'dropbox': {
      const result = await downloadDropboxFile(url, tempPath);
      // Dropbox doesn't always return mimeType, so we infer it
      const mimeType = inferMimeType(result.filename);
      return { ...result, mimeType };
    }
    
    default:
      throw new ExternalServiceError(
        'CloudStorage',
        `Unsupported cloud storage provider for URL: ${url}`,
        { url, provider }
      );
  }
}

/**
 * Check if URL is from supported cloud storage
 */
export function isSupportedCloudUrl(url: string): boolean {
  const provider = detectCloudProvider(url);
  return provider !== 'unknown';
}

/**
 * Get cloud provider display name
 */
export function getProviderDisplayName(provider: CloudProvider): string {
  switch (provider) {
    case 'google-drive':
      return 'Google Drive';
    case 'dropbox':
      return 'Dropbox';
    default:
      return 'Unknown';
  }
}

/**
 * Infer MIME type from filename
 */
function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  const mimeMap: Record<string, string> = {
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'webm': 'audio/webm',
    
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'wmv': 'video/x-ms-wmv',
    'mpg': 'video/mpeg',
    'mpeg': 'video/mpeg',
  };
  
  return mimeMap[ext || ''] || 'application/octet-stream';
}

/**
 * Validate cloud file for transcription
 */
export function isTranscribableCloudFile(mimeType: string): boolean {
  return mimeType.startsWith('audio/') || mimeType.startsWith('video/');
}

/**
 * Format cloud file info for display
 */
export function formatCloudFileInfo(info: {
  provider: CloudProvider;
  filename: string;
  mimeType?: string;
  size?: number;
}): string {
  const parts = [
    `${getProviderDisplayName(info.provider)}ファイル`,
    `"${info.filename}"`,
  ];
  
  if (info.size) {
    const sizeMB = (info.size / (1024 * 1024)).toFixed(2);
    parts.push(`(${sizeMB}MB)`);
  }
  
  return parts.join(' ');
}
/**
 * Dropbox client for downloading files
 * No authentication required for shared links
 */

// Types for Dropbox file handling
interface DropboxFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

// Parse Dropbox URL to extract download link
export function parseDropboxUrl(url: string): string | null {
  // Handle various Dropbox URL formats
  const patterns = [
    /dropbox\.com\/s\/([a-zA-Z0-9]+)/,           // Share link
    /dropbox\.com\/scl\/fi\/([a-zA-Z0-9]+)/,     // New share link format
    /dropbox\.com\/sh\/([a-zA-Z0-9]+)/,          // Folder share link
    /dl\.dropboxusercontent\.com\//,              // Direct download link
    /dropbox\.com\/.*\?dl=\d/,                   // Link with dl parameter
  ];

  for (const pattern of patterns) {
    if (pattern.test(url)) {
      // Convert share link to direct download link
      // Replace dl=0 with dl=1 to force download
      if (url.includes('?dl=0')) {
        return url.replace('?dl=0', '?dl=1');
      } else if (!url.includes('?dl=1') && !url.includes('dl.dropboxusercontent.com')) {
        // Add dl=1 if not present
        return url.includes('?') ? `${url}&dl=1` : `${url}?dl=1`;
      }
      return url;
    }
  }

  return null;
}

// Check if URL is a Dropbox URL
export function isDropboxUrl(url: string): boolean {
  return parseDropboxUrl(url) !== null;
}

// Get file metadata from Dropbox (limited without API key)
export function getDropboxFileMetadata(url: string): DropboxFileMetadata {
  // Extract filename from URL if possible
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  const filename = pathParts[pathParts.length - 1] || 'dropbox_file';

  // Since we don't have API access, we'll get limited metadata
  // The actual filename will be obtained from response headers during download
  return {
    id: extractDropboxFileId(url) || 'unknown',
    name: decodeURIComponent(filename),
    mimeType: 'application/octet-stream', // Will be updated from response headers
  };
}

// Extract file ID from Dropbox URL
function extractDropboxFileId(url: string): string | null {
  // Extract the file ID from various Dropbox URL formats
  const patterns = [
    /dropbox\.com\/s\/([a-zA-Z0-9]+)/,
    /dropbox\.com\/scl\/fi\/([a-zA-Z0-9]+)/,
    /dropbox\.com\/sh\/([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// Download Dropbox file to temporary path with streaming
export async function downloadDropboxFileToPath(
  url: string,
  tempPath: string,
): Promise<boolean> {
  const downloadUrl = parseDropboxUrl(url);

  if (!downloadUrl) {
    throw new Error("Invalid Dropbox URL");
  }

  try {
    const startTime = performance.now();

    console.log(`Starting Dropbox download from: ${downloadUrl}`);

    // Make request to Dropbox
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    // Get file metadata from headers
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    const contentDisposition = response.headers.get('content-disposition');

    // Extract filename from content-disposition header if available
    let filename = 'dropbox_file';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    const fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0;
    console.log(`Downloading: ${filename} (${fileSizeMB.toFixed(2)}MB, ${contentType})`);

    // Check if it's a media file
    const isMediaFile =
      contentType.toLowerCase().startsWith("audio/") ||
      contentType.toLowerCase().startsWith("video/") ||
      contentType === "application/octet-stream";  // Generic binary, could be media

    if (!isMediaFile) {
      console.log(`Skipping non-media file: ${filename} (${contentType})`);
      return false;
    }

    // Stream download to file
    const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
    const writer = file.writable.getWriter();

    let downloadedBytes = 0;
    let lastProgressTime = performance.now();

    try {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        await writer.write(value);
        downloadedBytes += value.length;

        // Log progress every second
        const currentTime = performance.now();
        if (currentTime - lastProgressTime > 1000) {
          const progress = contentLength ?
            (downloadedBytes / parseInt(contentLength) * 100).toFixed(1) : '?';
          const speed = (downloadedBytes / 1024 / 1024) / ((currentTime - startTime) / 1000);
          console.log(`Download progress: ${progress}% (${speed.toFixed(2)}MB/s)`);
          lastProgressTime = currentTime;
        }
      }
    } finally {
      await writer.close();
    }

    const downloadTime = (performance.now() - startTime) / 1000;
    const actualSizeMB = downloadedBytes / (1024 * 1024);
    console.log(`Download complete: ${actualSizeMB.toFixed(2)}MB in ${downloadTime.toFixed(2)}s (${(actualSizeMB / downloadTime).toFixed(2)}MB/s)`);

    return true;
  } catch (error) {
    const err = error as { message?: string };
    throw new Error(`Failed to download Dropbox file: ${err.message || 'Unknown error'}`);
  }
}

// Download Dropbox file and return metadata
export async function downloadDropboxFile(
  url: string,
  tempPath: string,
): Promise<{ filename: string; mimeType: string } | null> {
  // Get basic metadata
  const metadata = getDropboxFileMetadata(url);

  // Download file (returns false if skipped)
  const downloaded = await downloadDropboxFileToPath(url, tempPath);

  if (!downloaded) {
    return null;  // File was skipped (non-media)
  }

  return {
    filename: metadata.name,
    mimeType: metadata.mimeType,
  };
}
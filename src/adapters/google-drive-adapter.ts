/**
 * Adapter to use existing Google Drive code with CloudService interface
 */

import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import { 
  parseGoogleDriveUrl, 
  isGoogleDriveUrl,
  downloadGoogleDriveFileToPath,
  getGoogleDriveFileMetadata
} from "../clients/googledrive.ts";

export class GoogleDriveAdapter extends BaseCloudService {
  readonly name = "Google Drive";

  isValidUrl(url: string): boolean {
    return isGoogleDriveUrl(url);
  }

  extractFileId(url: string): string | null {
    return parseGoogleDriveUrl(url);
  }

  async getFileMetadata(fileId: string): Promise<CloudFileMetadata> {
    const metadata = await getGoogleDriveFileMetadata(fileId);
    return {
      id: fileId,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      size: metadata.size ? parseInt(metadata.size) : undefined,
    };
  }

  async downloadFile(fileId: string, tempPath: string): Promise<boolean> {
    // This already handles non-media file skipping
    return await downloadGoogleDriveFileToPath(fileId, tempPath);
  }
}
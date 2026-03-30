/**
 * VideoProcessor — handles MP4, MOV, M4V files.
 *
 * Metadata sources:
 *  - moov/mvhd  — creation / modification timestamps
 *  - moov/udta/meta/ilst — iTunes-style tags (title, artist, GPS, encoder…)
 *  - moov/udta  — QuickTime © text boxes
 *
 * Stripping strategy (no re-encoding needed):
 *  - Remove moov/udta box entirely
 *  - Zero creation_time / modification_time in mvhd and tkhd
 */

import { MetadataField, ProcessResult, BaseProcessor } from './base.js'
import { extractMoovMeta, stripMoovMeta } from './mp4boxes.js'

export class VideoProcessor extends BaseProcessor {
  supportedExtensions() {
    return ['.mp4', '.mov', '.m4v']
  }

  async extractMetadata(fileBytes, filename) {
    const result = new ProcessResult({ fileName: filename, fileType: 'Video' })
    const v = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)

    const entries = extractMoovMeta(v, filename)

    if (entries.length === 0) {
      result.warnings.push('No embedded metadata found in this video file.')
      return result
    }

    for (const { key, label, category, value } of entries) {
      result.metadata.push(new MetadataField({
        key, value, category, removable: true, sourceFile: filename, label,
      }))
    }

    return result
  }

  async stripMetadata(fileBytes, filename) {
    const v = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)
    const cleanBytes = stripMoovMeta(v)
    const stem = filename.replace(/\.[^.]+$/, '')
    const ext  = filename.match(/\.[^.]+$/)?.[0] ?? ''
    return { bytes: cleanBytes, filename: `${stem}_clean${ext}` }
  }
}

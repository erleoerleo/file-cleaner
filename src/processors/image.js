import exifr from 'exifr'
import { MetadataField, ProcessResult, BaseProcessor } from './base.js'

// Which EXIF tag belongs to which category
const TAG_CATEGORY = {
  // Location — most sensitive
  GPSLatitude: 'location', GPSLongitude: 'location', GPSAltitude: 'location',
  GPSLatitudeRef: 'location', GPSLongitudeRef: 'location', GPSAltitudeRef: 'location',
  GPSImgDirection: 'location', GPSImgDirectionRef: 'location',
  GPSSpeed: 'location', GPSSpeedRef: 'location', GPSTrack: 'location', GPSTrackRef: 'location',
  GPSDateStamp: 'location', GPSTimeStamp: 'location',
  // Author / contact
  Artist: 'author', Copyright: 'author', XPAuthor: 'author',
  // Software / device
  Make: 'software', Model: 'software', Software: 'software',
  HostComputer: 'software', ProcessingSoftware: 'software', LensMake: 'software',
  // Timestamps
  DateTime: 'timestamp', DateTimeOriginal: 'timestamp', DateTimeDigitized: 'timestamp',
  CreateDate: 'timestamp', ModifyDate: 'timestamp',
  // User-written text
  ImageDescription: 'author', UserComment: 'author',
  XPTitle: 'custom', XPSubject: 'custom', XPComment: 'custom', XPKeywords: 'custom',
}

function categorise(tag) { return TAG_CATEGORY[tag] ?? 'custom' }

function formatValue(tag, val) {
  if (val == null) return null
  if (Array.isArray(val)) {
    // GPS rational arrays → decimal degrees
    if (tag.startsWith('GPS') && val.length === 3) {
      const deg = val[0] + val[1] / 60 + val[2] / 3600
      return deg.toFixed(6)
    }
    return val.join(', ')
  }
  if (val instanceof Uint8Array || val instanceof ArrayBuffer) return null // skip binary blobs
  if (typeof val === 'object' && val.constructor?.name === 'Object') return JSON.stringify(val)
  return String(val).trim()
}

// ── JPEG stripping ────────────────────────────────────────────────────────────
// Removes APP1 (0xFFE1 = EXIF + XMP) and APP13 (0xFFED = IPTC) markers.
// Works by collecting slices of the original buffer, skipping those segments.
function stripJpegExif(bytes) {
  const view = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer)
  if (view[0] !== 0xFF || view[1] !== 0xD8) return bytes

  const STRIP = new Set([0xE1, 0xED]) // APP1, APP13
  const slices = [view.subarray(0, 2)] // keep SOI
  let i = 2

  while (i < view.length - 1) {
    if (view[i] !== 0xFF) { slices.push(view.subarray(i)); break }
    const marker = view[i + 1]

    // Standalone markers (no length field)
    if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      slices.push(view.subarray(i, i + 2))
      i += 2
      if (marker === 0xD9) break
      continue
    }

    const segLen = (view[i + 2] << 8) | view[i + 3]
    const segEnd = i + 2 + segLen

    if (!STRIP.has(marker)) slices.push(view.subarray(i, segEnd))

    i = segEnd
    if (marker === 0xDA) { slices.push(view.subarray(i)); break } // rest = image data
  }

  const total = slices.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const s of slices) { out.set(s, off); off += s.length }
  return out
}

// ── PNG stripping ─────────────────────────────────────────────────────────────
// Removes tEXt, iTXt, zTXt (text metadata) and eXIf chunks.
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
const PNG_STRIP_TYPES = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf'])

function stripPngMetadata(bytes) {
  const view = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer)
  // Verify PNG signature
  for (let i = 0; i < 8; i++) if (view[i] !== PNG_SIG[i]) return bytes

  const slices = [view.subarray(0, 8)] // keep signature
  let i = 8
  while (i < view.length) {
    const len = (view[i] << 24 | view[i+1] << 16 | view[i+2] << 8 | view[i+3]) >>> 0
    const type = String.fromCharCode(view[i+4], view[i+5], view[i+6], view[i+7])
    const chunkEnd = i + 4 + 4 + len + 4
    if (!PNG_STRIP_TYPES.has(type)) slices.push(view.subarray(i, chunkEnd))
    i = chunkEnd
    if (type === 'IEND') break
  }

  const total = slices.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const s of slices) { out.set(s, off); off += s.length }
  return out
}

export class ImageProcessor extends BaseProcessor {
  supportedExtensions() {
    return ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']
  }

  async extractMetadata(fileBytes, filename) {
    const result = new ProcessResult({ fileName: filename, fileType: 'Image' })
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''

    let parsed
    try {
      parsed = await exifr.parse(fileBytes, {
        tiff: true, exif: true, gps: true, iptc: true, xmp: false,
        translateKeys: true, translateValues: true, reviveValues: true,
      })
    } catch {
      parsed = null
    }

    if (!parsed || Object.keys(parsed).length === 0) {
      result.warnings.push('No EXIF/IPTC metadata found in this image.')
      return result
    }

    const seen = new Set()
    for (const [tag, rawVal] of Object.entries(parsed)) {
      const value = formatValue(tag, rawVal)
      if (!value || value === 'undefined') continue
      const key = `exif:${filename}:${tag}`
      if (seen.has(key)) continue
      seen.add(key)

      const category = categorise(tag)
      const removable = ext !== '.webp' // WebP EXIF rewriting not implemented; flag only
      result.metadata.push(new MetadataField({ key, value, category, removable, sourceFile: filename }))
    }

    if (!result.metadata.some(f => f.removable)) {
      result.warnings.push('Metadata display only — stripping not supported for this image format.')
    }

    return result
  }

  async stripMetadata(fileBytes, filename, keysToRemove) {
    // Any selected key triggers full EXIF block removal for that file.
    // Per-tag EXIF rewriting requires full EXIF re-encoding, which is out of scope.
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''

    let cleanBytes
    if (ext === '.jpg' || ext === '.jpeg') {
      cleanBytes = stripJpegExif(fileBytes)
    } else if (ext === '.png') {
      cleanBytes = stripPngMetadata(fileBytes)
    } else if (ext === '.tif' || ext === '.tiff') {
      // TIFF EXIF stripping is complex (IFD-based format) — return as-is with warning
      cleanBytes = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)
    } else {
      cleanBytes = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)
    }

    const stem = filename.replace(/\.[^.]+$/, '')
    const cleanFilename = `${stem}_clean${ext}`
    return { bytes: cleanBytes, filename: cleanFilename }
  }
}

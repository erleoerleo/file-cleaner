/**
 * AudioProcessor — handles MP3, FLAC, M4A files.
 *
 * MP3:  reads & strips ID3v2 (start) and ID3v1 (end) tags
 * FLAC: reads & strips VORBIS_COMMENT (block type 4) and PICTURE (block type 6)
 * M4A:  reuses MP4 box parsing (M4A is just MP4 with audio-only tracks)
 */

import { MetadataField, ProcessResult, BaseProcessor } from './base.js'
import { extractMoovMeta, stripMoovMeta } from './mp4boxes.js'

// ── ID3v2 helpers ─────────────────────────────────────────────────────────────

function readSyncsafe(v, i) {
  return ((v[i] & 0x7F) << 21) | ((v[i+1] & 0x7F) << 14) |
         ((v[i+2] & 0x7F) << 7) | (v[i+3] & 0x7F)
}

function u32be(v, i) { return ((v[i]<<24)|(v[i+1]<<16)|(v[i+2]<<8)|v[i+3])>>>0 }
function u32le(v, i) { return (v[i]|(v[i+1]<<8)|(v[i+2]<<16)|(v[i+3]<<24))>>>0 }

// ID3 frame ID → [human label, category]
const ID3_FRAMES = {
  TIT2: ['Title',              'custom'],
  TPE1: ['Lead artist',        'author'],
  TPE2: ['Album artist',       'author'],
  TCOM: ['Composer',           'author'],
  TENC: ['Encoded by',         'software'],
  TSSE: ['Encoder settings',   'software'],
  TXXX: ['User-defined text',  'custom'],
  COMM: ['Comment',            'custom'],
  TDRC: ['Recording date',     'timestamp'],
  TDRL: ['Release date',       'timestamp'],
  TOFN: ['Original filename',  'custom'],   // can leak file paths
  TOWN: ['File owner',         'author'],   // leaks name
  TCOP: ['Copyright',          'author'],
  TPUB: ['Publisher',          'author'],
  TOPE: ['Original artist',    'author'],
  TALB: ['Album',              'custom'],
  TRCK: ['Track number',       'custom'],
  TYER: ['Year',               'timestamp'],
}

function readId3Text(v, start, length) {
  if (length <= 1) return ''
  const enc = v[start]
  const data = v.subarray(start + 1, start + length)
  try {
    if (enc === 1 || enc === 2) return new TextDecoder('utf-16').decode(data).replace(/\0+$/, '').trim()
    if (enc === 3)              return new TextDecoder('utf-8').decode(data).replace(/\0+$/, '').trim()
    return new TextDecoder('latin1').decode(data).replace(/\0+$/, '').trim()
  } catch { return '' }
}

function parseId3v2(v) {
  if (v[0] !== 0x49 || v[1] !== 0x44 || v[2] !== 0x33) return null  // not "ID3"
  const version   = v[3]
  const flags     = v[5]
  const tagSize   = readSyncsafe(v, 6)   // does NOT include the 10-byte header
  const totalSize = tagSize + 10

  const frames = []
  let i = 10

  // Skip extended header if present
  if ((flags & 0x40) && i + 4 <= totalSize) {
    const extSize = version === 4 ? readSyncsafe(v, i) : u32be(v, i)
    i += extSize
  }

  while (i + 10 <= totalSize) {
    if (v[i] === 0) break                // padding
    const frameId   = String.fromCharCode(v[i], v[i+1], v[i+2], v[i+3])
    const frameSize = version === 4 ? readSyncsafe(v, i+4) : u32be(v, i+4)
    if (frameSize === 0 || i + 10 + frameSize > totalSize) { i += 10; continue }

    const info = ID3_FRAMES[frameId]
    if (info) {
      const text = readId3Text(v, i + 10, frameSize)
      if (text) frames.push({ id: frameId, label: info[0], category: info[1], value: text })
    }
    i += 10 + frameSize
  }

  return { version, totalSize, frames }
}

function stripMp3Tags(v) {
  let start = 0
  let end   = v.length

  // Remove ID3v2 from the start
  if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33) {
    start = readSyncsafe(v, 6) + 10
  }

  // Remove ID3v1 tag (128 bytes) from the end
  if (end - start >= 128 &&
      v[end-128] === 0x54 && v[end-127] === 0x41 && v[end-126] === 0x47) {
    end -= 128
  }

  return v.slice(start, end)
}

// ── FLAC helpers ──────────────────────────────────────────────────────────────

const FLAC_SIG = [0x66, 0x4C, 0x61, 0x43]   // "fLaC"

// VORBIS_COMMENT key → [human label, category]
const VORBIS_KEYS = {
  title:           ['Title',           'custom'],
  artist:          ['Artist',          'author'],
  album:           ['Album',           'custom'],
  date:            ['Date',            'timestamp'],
  comment:         ['Comment',         'custom'],
  description:     ['Description',     'custom'],
  copyright:       ['Copyright',       'author'],
  license:         ['License',         'author'],
  contact:         ['Contact',         'author'],
  encoded_by:      ['Encoded by',      'software'],
  encoder:         ['Encoder',         'software'],
  encoder_options: ['Encoder options', 'software'],
}

function parseFlacBlocks(v) {
  for (let i = 0; i < 4; i++) if (v[i] !== FLAC_SIG[i]) return null
  const blocks = []
  let i = 4
  while (i + 4 <= v.length) {
    const byte0  = v[i]
    const isLast = !!(byte0 & 0x80)
    const type   = byte0 & 0x7F
    const length = (v[i+1] << 16) | (v[i+2] << 8) | v[i+3]
    blocks.push({ type, isLast, start: i, length, dataStart: i + 4 })
    i += 4 + length
    if (isLast) break
  }
  return { blocks, audioStart: i }
}

function parseVorbisComment(v, start, length) {
  const end = start + length
  let i     = start
  const vendorLen = u32le(v, i); i += 4
  const vendor    = new TextDecoder().decode(v.subarray(i, i + vendorLen)); i += vendorLen
  const count     = u32le(v, i); i += 4

  const entries = []
  if (vendor) entries.push({ key: 'vendor_string', label: 'Encoder vendor', category: 'software', value: vendor })

  for (let c = 0; c < count && i < end; c++) {
    const len     = u32le(v, i); i += 4
    const comment = new TextDecoder().decode(v.subarray(i, i + len)); i += len
    const eq      = comment.indexOf('=')
    if (eq === -1) continue
    const key   = comment.slice(0, eq).toLowerCase()
    const value = comment.slice(eq + 1).trim()
    if (!value) continue
    const info = VORBIS_KEYS[key] ?? [key, 'custom']
    entries.push({ key, label: info[0], category: info[1], value })
  }
  return entries
}

function stripFlacMetadata(v) {
  const parsed = parseFlacBlocks(v)
  if (!parsed) return v

  // Block types to remove: 4 = VORBIS_COMMENT, 6 = PICTURE
  const keep = parsed.blocks.filter(b => b.type !== 4 && b.type !== 6)
  if (keep.length === parsed.blocks.length) return v  // nothing to strip

  const parts = [new Uint8Array(FLAC_SIG)]  // "fLaC" signature
  keep.forEach((block, idx) => {
    const isLast = idx === keep.length - 1
    const header = new Uint8Array(4)
    header[0] = (isLast ? 0x80 : 0x00) | (block.type & 0x7F)
    header[1] = (block.length >> 16) & 0xFF
    header[2] = (block.length >>  8) & 0xFF
    header[3] =  block.length        & 0xFF
    parts.push(header)
    parts.push(v.subarray(block.dataStart, block.dataStart + block.length))
  })
  parts.push(v.subarray(parsed.audioStart))  // raw audio data unchanged

  const total = parts.reduce((s, p) => s + p.length, 0)
  const out   = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// ── Main processor ────────────────────────────────────────────────────────────

export class AudioProcessor extends BaseProcessor {
  supportedExtensions() {
    return ['.mp3', '.flac', '.m4a']
  }

  async extractMetadata(fileBytes, filename) {
    const result = new ProcessResult({ fileName: filename, fileType: 'Audio' })
    const v   = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''

    if (ext === '.mp3') {
      const id3 = parseId3v2(v)

      if (!id3 || id3.frames.length === 0) {
        // Check for ID3v1 at the very end
        const hasV1 = v.length >= 128 &&
          v[v.length-128] === 0x54 && v[v.length-127] === 0x41 && v[v.length-126] === 0x47
        if (hasV1) {
          result.metadata.push(new MetadataField({
            key: `audio:${filename}:id3v1`, value: 'ID3v1 tag block present (title, artist may be embedded)',
            category: 'custom', removable: true, sourceFile: filename, label: 'ID3v1 tag',
          }))
        } else {
          result.warnings.push('No ID3 metadata found in this MP3 file.')
        }
        return result
      }

      for (const { id, label, category, value } of id3.frames) {
        result.metadata.push(new MetadataField({
          key: `audio:${filename}:${id}`, value, category,
          removable: true, sourceFile: filename, label,
        }))
      }

    } else if (ext === '.flac') {
      const parsed = parseFlacBlocks(v)
      if (!parsed) { result.warnings.push('Not a valid FLAC file.'); return result }

      for (const block of parsed.blocks) {
        if (block.type === 4) {
          for (const { key, label, category, value } of parseVorbisComment(v, block.dataStart, block.length)) {
            result.metadata.push(new MetadataField({
              key: `audio:${filename}:vc_${key}`, value, category,
              removable: true, sourceFile: filename, label,
            }))
          }
        } else if (block.type === 6) {
          result.metadata.push(new MetadataField({
            key: `audio:${filename}:picture`, value: 'Embedded cover art / picture block',
            category: 'custom', removable: true, sourceFile: filename, label: 'Embedded picture',
          }))
        }
      }

      if (result.metadata.length === 0) result.warnings.push('No metadata found in this FLAC file.')

    } else if (ext === '.m4a') {
      const entries = extractMoovMeta(v, filename)
      if (entries.length === 0) {
        result.warnings.push('No embedded metadata found in this M4A file.')
        return result
      }
      for (const { key, label, category, value } of entries) {
        result.metadata.push(new MetadataField({
          key, value, category, removable: true, sourceFile: filename, label,
        }))
      }
    }

    return result
  }

  async stripMetadata(fileBytes, filename) {
    const v   = new Uint8Array(fileBytes instanceof ArrayBuffer ? fileBytes : fileBytes.buffer)
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const stem = filename.replace(/\.[^.]+$/, '')

    let cleanBytes
    if      (ext === '.mp3')  cleanBytes = stripMp3Tags(v)
    else if (ext === '.flac') cleanBytes = stripFlacMetadata(v)
    else if (ext === '.m4a')  cleanBytes = stripMoovMeta(v)
    else                      cleanBytes = v

    return { bytes: cleanBytes, filename: `${stem}_clean${ext}` }
  }
}

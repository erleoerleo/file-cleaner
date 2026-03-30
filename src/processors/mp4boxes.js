/**
 * Shared MP4 / M4A / MOV box (atom) parsing utilities.
 * Used by both VideoProcessor and AudioProcessor since M4A is an MP4 container.
 *
 * MP4 structure: every box is  [4-byte size] [4-byte type] [data]
 * If size === 1 the real size is a subsequent 8-byte uint64.
 * If size === 0 the box extends to end of file.
 */

export function u32be(v, i) {
  return ((v[i] << 24) | (v[i+1] << 16) | (v[i+2] << 8) | v[i+3]) >>> 0
}

// 64-bit read — loses sub-millisecond precision for huge values, fine for dates
export function u64be(v, i) {
  return u32be(v, i) * 0x100000000 + u32be(v, i + 4)
}

export function str4(v, i) {
  return String.fromCharCode(v[i], v[i+1], v[i+2], v[i+3])
}

export function readUtf8(v, start, end) {
  return new TextDecoder().decode(v.subarray(start, end)).replace(/\0+$/, '').trim()
}

/**
 * Parse the immediate children of a byte range into box descriptors.
 * Returns [{ type, start, size, dataStart }]
 */
export function parseBoxes(v, start, end) {
  const boxes = []
  let i = start
  while (i + 8 <= end) {
    let size = u32be(v, i)
    const type = str4(v, i + 4)
    let headerSize = 8
    if (size === 1) {
      if (i + 16 > end) break
      size = u64be(v, i + 8)   // extended 64-bit size
      headerSize = 16
    } else if (size === 0) {
      size = end - i            // extends to end
    }
    if (size < headerSize || i + size > end + 1) break
    boxes.push({ type, start: i, size, dataStart: i + headerSize })
    i += size
  }
  return boxes
}

export function findBox(boxes, type) {
  return boxes.find(b => b.type === type)
}

// Seconds between MP4 epoch (1904-01-01) and Unix epoch (1970-01-01)
const MP4_EPOCH_OFFSET = 2082844800

export function mp4DateToString(secs) {
  if (!secs) return null
  try {
    return new Date((secs - MP4_EPOCH_OFFSET) * 1000)
      .toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  } catch { return null }
}

// iTunes metadata four-char-code → [human label, category]
export const ITUNES_TAGS = {
  '\u00a9nam': ['Title',             'custom'],
  '\u00a9ART': ['Artist',            'author'],
  '\u00a9alb': ['Album',             'custom'],
  '\u00a9cmt': ['Comment',           'custom'],
  '\u00a9day': ['Date',              'timestamp'],
  '\u00a9too': ['Encoder / software','software'],
  '\u00a9wrt': ['Writer',            'author'],
  '\u00a9aut': ['Author',            'author'],
  '\u00a9xyz': ['GPS location',      'location'],
  'aART':      ['Album artist',      'author'],
  'cprt':      ['Copyright',         'author'],
  'desc':      ['Description',       'custom'],
  'ldes':      ['Long description',  'custom'],
  'tvsh':      ['TV show name',      'custom'],
  'sonm':      ['Sort name',         'custom'],
}

/**
 * Parse an iTunes ilst box and return metadata entries.
 */
export function parseItunes(v, start, end) {
  const result = []
  for (const box of parseBoxes(v, start, end)) {
    const tagInfo = ITUNES_TAGS[box.type]
    if (!tagInfo) continue
    const inner = parseBoxes(v, box.dataStart, box.start + box.size)
    const dataBox = findBox(inner, 'data')
    if (!dataBox) continue
    // data box layout: 4-byte well-known-type + 4-byte locale + value
    if (dataBox.dataStart + 8 > dataBox.start + dataBox.size) continue
    const wkt = u32be(v, dataBox.dataStart) & 0xFF  // lower byte = type
    if (wkt !== 1) continue                          // only UTF-8 strings
    const val = readUtf8(v, dataBox.dataStart + 8, dataBox.start + dataBox.size)
    if (val) result.push({ label: tagInfo[0], category: tagInfo[1], value: val, boxType: box.type })
  }
  return result
}

/**
 * Extract timestamps + iTunes metadata from moov.
 * Returns [{ label, category, value, key }]
 */
export function extractMoovMeta(v, filename) {
  const topBoxes = parseBoxes(v, 0, v.length)
  const moov = findBox(topBoxes, 'moov')
  if (!moov) return []

  const moovBoxes = parseBoxes(v, moov.dataStart, moov.start + moov.size)
  const entries = []

  // Timestamps from mvhd (movie header)
  const mvhd = findBox(moovBoxes, 'mvhd')
  if (mvhd) {
    const ver = v[mvhd.dataStart]
    const off = mvhd.dataStart + 4
    const created  = ver === 1 ? u64be(v, off)     : u32be(v, off)
    const modified = ver === 1 ? u64be(v, off + 8) : u32be(v, off + 4)
    const c = mp4DateToString(created)
    const m = mp4DateToString(modified)
    if (c) entries.push({ key: `mp4:${filename}:creation_time`,     label: 'Creation time',     category: 'timestamp', value: c })
    if (m) entries.push({ key: `mp4:${filename}:modification_time`, label: 'Modification time', category: 'timestamp', value: m })
  }

  // iTunes metadata: moov → udta → meta → ilst
  const udta = findBox(moovBoxes, 'udta')
  if (udta) {
    const udtaBoxes = parseBoxes(v, udta.dataStart, udta.start + udta.size)
    const meta = findBox(udtaBoxes, 'meta')
    if (meta) {
      // meta has a 4-byte version/flags prefix before its children
      const metaBoxes = parseBoxes(v, meta.dataStart + 4, meta.start + meta.size)
      const ilst = findBox(metaBoxes, 'ilst')
      if (ilst) {
        for (const { label, category, value, boxType } of parseItunes(v, ilst.dataStart, ilst.start + ilst.size)) {
          entries.push({ key: `mp4:${filename}:${boxType}`, label, category, value })
        }
      }
    }
    // QuickTime-style © text boxes directly inside udta
    for (const box of udtaBoxes) {
      if (box.type.charCodeAt(0) === 0xA9 && !ITUNES_TAGS[box.type]) {
        // Layout: 2-byte length + 2-byte lang + text
        const val = readUtf8(v, box.dataStart + 4, box.start + box.size)
        if (val) entries.push({ key: `mp4:${filename}:qt_${box.type}`, label: `QuickTime ${box.type}`, category: 'custom', value: val })
      }
    }
  }

  return entries
}

/**
 * Rebuild the file with:
 *  - moov/udta removed entirely
 *  - creation_time / modification_time in mvhd and tkhd zeroed
 */
export function stripMoovMeta(v) {
  const topBoxes = parseBoxes(v, 0, v.length)
  const moov = findBox(topBoxes, 'moov')
  if (!moov) return v

  const moovBoxes = parseBoxes(v, moov.dataStart, moov.start + moov.size)

  // Build new moov children
  const moovParts = []
  for (const box of moovBoxes) {
    if (box.type === 'udta') continue   // drop user-data entirely

    let chunk = v.slice(box.start, box.start + box.size)  // Uint8Array copy

    if (box.type === 'mvhd' || box.type === 'tkhd') {
      // Zero out creation_time and modification_time
      const ver = chunk[box.dataStart - box.start]
      const tsOff = box.dataStart - box.start + 4
      const tsLen = ver === 1 ? 16 : 8    // two 8-byte or two 4-byte values
      for (let j = 0; j < tsLen; j++) chunk[tsOff + j] = 0
    }

    if (box.type === 'trak') {
      // Recurse into trak to zero tkhd timestamps
      chunk = zeroTkhdInTrak(v, box)
    }

    moovParts.push(chunk)
  }

  // Write new moov header with updated size
  const moovDataLen = moovParts.reduce((s, c) => s + c.length, 0)
  const newMoovSize = moovDataLen + 8
  const moovHeader = new Uint8Array(8)
  moovHeader[0] = (newMoovSize >>> 24) & 0xFF
  moovHeader[1] = (newMoovSize >>> 16) & 0xFF
  moovHeader[2] = (newMoovSize >>> 8)  & 0xFF
  moovHeader[3] =  newMoovSize         & 0xFF
  moovHeader.set([0x6D, 0x6F, 0x6F, 0x76], 4)  // 'moov'

  // Reassemble full file
  const parts = []
  for (const box of topBoxes) {
    if (box.type === 'moov') {
      parts.push(moovHeader, ...moovParts)
    } else {
      parts.push(v.subarray(box.start, box.start + box.size))
    }
  }

  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

function zeroTkhdInTrak(v, trakBox) {
  const trakData = v.slice(trakBox.start, trakBox.start + trakBox.size)
  const inner = parseBoxes(v, trakBox.dataStart, trakBox.start + trakBox.size)
  const tkhd = findBox(inner, 'tkhd')
  if (!tkhd) return trakData
  const ver = trakData[tkhd.start - trakBox.start + 8]  // +8 = past 4-byte size + 4-byte type
  const tsOff = tkhd.start - trakBox.start + 8 + 4
  const tsLen = ver === 1 ? 16 : 8
  for (let j = 0; j < tsLen; j++) trakData[tsOff + j] = 0
  return trakData
}

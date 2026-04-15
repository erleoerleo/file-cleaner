import JSZip from 'jszip'
import { MetadataField, ProcessResult, BaseProcessor } from './base.js'

// Mirrors _SENSITIVE_XML_PATHS in the Python reference implementation.
// Keys are stored using these original XPath strings so strip logic can reconstruct them.
const SENSITIVE_XML_PATHS = {
  author: [
    './/idCredit',
    './/citRespParty/rpIndName',
    './/citRespParty/rpOrgName',
    './/rpIndName',
    './/rpOrgName',
    './/editorSave',
    './/mdContact/rpIndName',
    './/mdContact/rpOrgName',
  ],
  software: [
    './/native',
    './/nativeDatasetFormat',
    './/distFormat/formatName',
    './/mdHrLv/ScopeCd',
  ],
  path: [
    './/linkage',
    './/onLineSrc/linkage',
    './/datasetUri',
    './/catFetTyps/featType/ftNm',
  ],
  timestamp: [
    './/mdDateSt',
    './/date',
    './/createDate',
    './/pubDate',
    './/reviseDate',
  ],
}

const DBF_SENSITIVE_PATTERN = /[/\\]|path|dir|file|user|author|custodian|operator|owner|contact|email/i

/**
 * Convert a Python-style ElementTree XPath ('.//foo' or './/foo/bar')
 * to a browser XPath that ignores namespace prefixes via local-name().
 */
function toBrowserXPath(pythonXPath) {
  const steps = pythonXPath.replace(/^\.\/\//, '').split('/')
  return './/' + steps.map(s => `*[local-name()="${s}"]`).join('/')
}

/** Evaluate an XPath and return all matching nodes. */
function xpathAll(doc, contextNode, xpath) {
  const result = doc.evaluate(xpath, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null)
  const nodes = []
  let node
  while ((node = result.iterateNext())) nodes.push(node)
  return nodes
}

function parseXmlMetadata(xmlText, sourceFile) {
  const fields = []
  let doc
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) return fields
  } catch {
    return fields
  }

  const seen = new Set()
  for (const [category, xpaths] of Object.entries(SENSITIVE_XML_PATHS)) {
    for (const pythonXPath of xpaths) {
      const browserXPath = toBrowserXPath(pythonXPath)
      let nodes
      try {
        nodes = xpathAll(doc, doc, browserXPath)
      } catch {
        continue
      }
      for (const node of nodes) {
        const text = (node.textContent || '').trim()
        if (!text) continue
        // Key encodes both source file and original xpath for strip logic
        const key = `xml:${sourceFile}:${pythonXPath}`
        if (!seen.has(key)) {
          seen.add(key)
          fields.push(new MetadataField({ key, value: text, category, removable: true, sourceFile }))
        }
      }
    }
  }
  return fields
}

/**
 * Clear text content of all nodes matched by the given keys inside xmlText.
 * Keys have format: xml:{sourceFile}:{pythonXPath}
 */
function scrubXml(xmlText, relevantKeys) {
  let doc
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) return xmlText
  } catch {
    return xmlText
  }

  for (const key of relevantKeys) {
    // key format: xml:{sourceFile}:{pythonXPath}
    // ZIP filenames never contain ':', so splitting on ':' is safe
    const parts = key.split(':')
    const xpath = parts.slice(2).join(':')
    const browserXPath = toBrowserXPath(xpath)
    try {
      const nodes = xpathAll(doc, doc, browserXPath)
      for (const node of nodes) node.textContent = ''
    } catch {
      // ignore xpath errors for individual keys
    }
  }

  return new XMLSerializer().serializeToString(doc)
}

/**
 * Parse all field descriptors from a DBF header.
 * DBF spec: field descriptors start at byte 32, each 32 bytes, terminated by 0x0D.
 * Returns [{ name, type, length, decimal }]
 */
function parseDbfFields(arrayBuffer) {
  const view = new Uint8Array(arrayBuffer)
  const dv = new DataView(arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer)
  const headerSize  = dv.getInt16(8, true)
  const recordSize  = dv.getInt16(10, true)
  const recordCount = dv.getInt32(4, true)

  const fields = []
  let offset = 32
  while (offset + 32 <= view.length && view[offset] !== 0x0D) {
    let name = ''
    for (let i = offset; i < offset + 11; i++) {
      if (view[i] === 0) break
      name += String.fromCharCode(view[i])
    }
    name = name.trim()
    if (name) {
      fields.push({
        name,
        type:    String.fromCharCode(view[offset + 11]),
        length:  view[offset + 16],
        decimal: view[offset + 17],
      })
    }
    offset += 32
  }

  // Read up to 200 records to collect sample values per field
  const dec = new TextDecoder('latin1')
  const samples = Object.fromEntries(fields.map(f => [f.name, new Set()]))
  const limit = Math.min(recordCount, 200)

  for (let r = 0; r < limit; r++) {
    const base = headerSize + r * recordSize
    if (view[base] === 0x2A) continue  // deleted record
    let fieldOffset = 1
    for (const f of fields) {
      const raw = dec.decode(view.subarray(base + fieldOffset, base + fieldOffset + f.length)).trim()
      if (raw) samples[f.name].add(raw)
      fieldOffset += f.length
    }
  }

  // Attach sorted unique sample values to each field descriptor
  for (const f of fields) {
    f.samples = [...samples[f.name]].slice(0, 8)
  }

  return fields
}

/**
 * Rewrite a DBF file removing the specified columns by name.
 * Rewrites both the header descriptors and every data record.
 */
function removeDbfColumns(arrayBuffer, columnsToRemove) {
  const removeSet = new Set(columnsToRemove.map(c => c.toUpperCase()))
  const view = new Uint8Array(arrayBuffer)
  const dv = new DataView(arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer)

  const recordCount  = dv.getInt32(4, true)
  const oldHeaderSize = dv.getInt16(8, true)
  const oldRecordSize = dv.getInt16(10, true)

  const allFields  = parseDbfFields(arrayBuffer)
  const keepFields = allFields.filter(f => !removeSet.has(f.name.toUpperCase()))

  const newHeaderSize = 32 + keepFields.length * 32 + 1  // +1 for 0x0D terminator
  const newRecordSize = 1 + keepFields.reduce((s, f) => s + f.length, 0)  // +1 for deletion flag
  const out = new Uint8Array(newHeaderSize + recordCount * newRecordSize)
  const outDv = new DataView(out.buffer)

  // Copy version + date bytes
  out[0] = view[0]; out[1] = view[1]; out[2] = view[2]; out[3] = view[3]
  outDv.setInt32(4,  recordCount,   true)
  outDv.setInt16(8,  newHeaderSize, true)
  outDv.setInt16(10, newRecordSize, true)

  // Write kept field descriptors
  const enc = new TextEncoder()
  keepFields.forEach((f, i) => {
    const base = 32 + i * 32
    const nameBytes = enc.encode(f.name)
    for (let j = 0; j < 11; j++) out[base + j] = nameBytes[j] ?? 0
    out[base + 11] = f.type.charCodeAt(0)
    out[base + 16] = f.length
    out[base + 17] = f.decimal
  })
  out[newHeaderSize - 1] = 0x0D  // terminator

  // Rewrite each record, skipping removed columns
  for (let r = 0; r < recordCount; r++) {
    const srcBase = oldHeaderSize + r * oldRecordSize
    const dstBase = newHeaderSize + r * newRecordSize
    out[dstBase] = view[srcBase]  // deletion flag

    let srcOff = 1, dstOff = 1
    for (const f of allFields) {
      if (!removeSet.has(f.name.toUpperCase())) {
        out.set(view.subarray(srcBase + srcOff, srcBase + srcOff + f.length), dstBase + dstOff)
        dstOff += f.length
      }
      srcOff += f.length
    }
  }

  return out
}

export class ShapefileProcessor extends BaseProcessor {
  supportedExtensions() {
    return ['.zip']
  }

  async extractMetadata(fileBytes, filename) {
    const result = new ProcessResult({ fileName: filename, fileType: 'Shapefile (ZIP)' })

    let zip
    try {
      zip = await JSZip.loadAsync(fileBytes)
    } catch {
      result.error = 'File is not a valid ZIP archive'
      return result
    }

    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir)
    const hasShp = names.some(n => n.toLowerCase().endsWith('.shp'))
    if (!hasShp) {
      result.error = 'ZIP does not appear to contain a shapefile (.shp)'
      return result
    }

    const prjByContent = {}

    for (const name of names) {
      const entry = zip.files[name]
      const lower = name.toLowerCase()

      if (lower.endsWith('.xml')) {
        const xmlText = await entry.async('string')
        const fields = parseXmlMetadata(xmlText, name)
        if (fields.length > 0) {
          result.metadata.push(...fields)
        } else {
          // Flag the empty/unparseable XML file itself as removable
          result.metadata.push(new MetadataField({
            key: `xml_file:${name}`,
            value: name,
            category: 'custom',
            removable: true,
            sourceFile: name,
          }))
        }
      } else if (lower.endsWith('.cpg')) {
        const text = (await entry.async('string')).trim()
        result.metadata.push(new MetadataField({
          key: `cpg:${name}`,
          value: text || '(empty)',
          category: 'custom',
          removable: false,
          sourceFile: name,
        }))
      } else if (lower.endsWith('.prj')) {
        const text = (await entry.async('string')).trim()
        if (!prjByContent[text]) prjByContent[text] = []
        prjByContent[text].push(name)
      } else if (lower.endsWith('.dbf')) {
        const buf = await entry.async('arraybuffer')
        const fields = parseDbfFields(buf)
        for (const { name: fieldName, samples } of fields) {
          const sensitive = DBF_SENSITIVE_PATTERN.test(fieldName)
          const preview = samples.length > 0 ? samples.join(', ') : '(empty)'
          result.metadata.push(new MetadataField({
            key: `dbf_field:${name}:${fieldName}`,
            value: preview,
            category: sensitive ? 'path' : 'custom',
            removable: true,
            sourceFile: name,
          }))
          if (sensitive) {
            result.warnings.push(
              `DBF column "${fieldName}" in ${name} may contain sensitive data.`
            )
          }
        }
      }
    }

    // Deduplicated .prj entries
    for (const [wkt, files] of Object.entries(prjByContent)) {
      const sourceLabel = files.length === 1
        ? files[0]
        : `${files[0]} (+${files.length - 1} identical)`
      result.metadata.push(new MetadataField({
        key: `prj:${sourceLabel}`,
        value: wkt,
        category: 'projection',
        removable: false,
        sourceFile: sourceLabel,
      }))
    }

    return result
  }

  async stripMetadata(fileBytes, filename, keysToRemove) {
    const keysSet = new Set(keysToRemove)
    const zipIn = await JSZip.loadAsync(fileBytes)
    const zipOut = new JSZip()

    for (const [name, entry] of Object.entries(zipIn.files)) {
      if (entry.dir) continue
      const lower = name.toLowerCase()

      // Drop entire XML file if flagged
      if (keysSet.has(`xml_file:${name}`)) continue

      let data
      if (lower.endsWith('.xml')) {
        const relevantKeys = [...keysSet].filter(k => k.startsWith(`xml:${name}:`))
        if (relevantKeys.length > 0) {
          const xmlText = await entry.async('string')
          data = scrubXml(xmlText, relevantKeys)
        } else {
          data = await entry.async('uint8array')
        }
      } else if (lower.endsWith('.dbf')) {
        const colsToRemove = [...keysSet]
          .filter(k => k.startsWith(`dbf_field:${name}:`))
          .map(k => k.split(':')[2])
        if (colsToRemove.length > 0) {
          const buf = await entry.async('arraybuffer')
          data = removeDbfColumns(buf, colsToRemove)
        } else {
          data = await entry.async('uint8array')
        }
      } else {
        data = await entry.async('uint8array')
      }

      // date: new Date(0) strips ZIP entry timestamps
      zipOut.file(name, data, { date: new Date(0) })
    }

    const outBytes = await zipOut.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const stem = filename.replace(/\.zip$/i, '')
    return { bytes: outBytes, filename: `${stem}_clean.zip` }
  }
}

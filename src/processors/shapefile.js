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

const DBF_SENSITIVE_PATTERN = /[/\\]|path|dir|file|user|author/i

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
 * Scan DBF header bytes for field names that look like paths or personal data.
 * DBF spec: field descriptors start at byte 32, each descriptor is 32 bytes,
 * terminated by 0x0D.
 */
function scanDbfFields(arrayBuffer) {
  const view = new Uint8Array(arrayBuffer)
  const sensitiveFields = []
  let offset = 32
  while (offset + 32 <= view.length && view[offset] !== 0x0D) {
    // Field name: bytes [offset, offset+11), null-terminated ASCII
    let name = ''
    for (let i = offset; i < offset + 11; i++) {
      if (view[i] === 0) break
      name += String.fromCharCode(view[i])
    }
    name = name.trim()
    if (name && DBF_SENSITIVE_PATTERN.test(name)) {
      sensitiveFields.push(name)
    }
    offset += 32
  }
  return sensitiveFields
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
        const sensitiveFields = scanDbfFields(buf)
        for (const fieldName of sensitiveFields) {
          result.metadata.push(new MetadataField({
            key: `dbf_field:${name}:${fieldName}`,
            value: fieldName,
            category: 'path',
            removable: false,
            sourceFile: name,
          }))
          result.warnings.push(
            `DBF column "${fieldName}" in ${name} may contain sensitive data — manual review recommended before sharing.`
          )
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

/**
 * Office Open XML processor — .docx, .xlsx, .pptx
 * All three formats are ZIP archives containing XML files.
 * Sensitive metadata lives in:
 *   docProps/core.xml  — Dublin Core: creator, lastModifiedBy, dates, title, etc.
 *   docProps/app.xml   — App properties: Application, AppVersion, Company, etc.
 */
import JSZip from 'jszip'
import { MetadataField, ProcessResult, BaseProcessor } from './base.js'

const FILE_TYPE_LABELS = {
  '.docx': 'Word Document',
  '.xlsx': 'Excel Workbook',
  '.pptx': 'PowerPoint Presentation',
}

// core.xml field definitions
// xpath is the local element name (namespace-agnostic traversal)
const CORE_FIELDS = [
  { tag: 'creator',         label: 'Creator',          category: 'author'    },
  { tag: 'lastModifiedBy',  label: 'Last Modified By', category: 'author'    },
  { tag: 'created',         label: 'Created',          category: 'timestamp' },
  { tag: 'modified',        label: 'Modified',         category: 'timestamp' },
  { tag: 'title',           label: 'Title',            category: 'custom'    },
  { tag: 'subject',         label: 'Subject',          category: 'custom'    },
  { tag: 'description',     label: 'Description',      category: 'custom'    },
  { tag: 'keywords',        label: 'Keywords',         category: 'custom'    },
  { tag: 'category',        label: 'Category',         category: 'custom'    },
  { tag: 'contentStatus',   label: 'Content Status',   category: 'custom'    },
]

// app.xml field definitions
const APP_FIELDS = [
  { tag: 'Application',  label: 'Application',  category: 'software' },
  { tag: 'AppVersion',   label: 'App Version',  category: 'software' },
  { tag: 'Company',      label: 'Company',      category: 'author'   },
  { tag: 'Manager',      label: 'Manager',      category: 'author'   },
  { tag: 'Template',     label: 'Template',     category: 'software' },
]

function parseXmlFields(xmlText, fieldDefs, sourceFile, keyPrefix) {
  const fields = []
  let doc
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) return fields
  } catch { return fields }

  for (const { tag, category } of fieldDefs) {
    // Namespace-agnostic: find element by local name
    const xpath = `.//*[local-name()="${tag}"]`
    let nodes
    try {
      const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null)
      nodes = []
      let n
      while ((n = result.iterateNext())) nodes.push(n)
    } catch { continue }

    for (const node of nodes) {
      const value = (node.textContent || '').trim()
      if (!value) continue
      fields.push(new MetadataField({
        key: `${keyPrefix}:${sourceFile}:${tag}`,
        value,
        category,
        removable: true,
        sourceFile,
      }))
      break // one entry per tag
    }
  }
  return fields
}

function scrubXmlFields(xmlText, keysToRemove, keyPrefix, sourceFile) {
  let doc
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) return xmlText
  } catch { return xmlText }

  for (const key of keysToRemove) {
    // key format: {keyPrefix}:{sourceFile}:{tag}
    const parts = key.split(':')
    const tag = parts[parts.length - 1]
    const xpath = `.//*[local-name()="${tag}"]`
    try {
      const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null)
      let node
      while ((node = result.iterateNext())) node.textContent = ''
    } catch { /* ignore */ }
  }

  return new XMLSerializer().serializeToString(doc)
}

export class OfficeProcessor extends BaseProcessor {
  supportedExtensions() { return ['.docx', '.xlsx', '.pptx'] }

  async extractMetadata(fileBytes, filename) {
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const result = new ProcessResult({
      fileName: filename,
      fileType: FILE_TYPE_LABELS[ext] ?? 'Office Document',
    })

    let zip
    try {
      zip = await JSZip.loadAsync(fileBytes)
    } catch {
      result.error = 'File is not a valid Office document (could not open as ZIP)'
      return result
    }

    const coreEntry = zip.files['docProps/core.xml']
    if (coreEntry) {
      const xml = await coreEntry.async('string')
      result.metadata.push(...parseXmlFields(xml, CORE_FIELDS, 'docProps/core.xml', 'core'))
    }

    const appEntry = zip.files['docProps/app.xml']
    if (appEntry) {
      const xml = await appEntry.async('string')
      result.metadata.push(...parseXmlFields(xml, APP_FIELDS, 'docProps/app.xml', 'app'))
    }

    if (!coreEntry && !appEntry) {
      result.error = 'No docProps found — this may not be a valid Office Open XML file'
    } else if (result.metadata.length === 0) {
      result.warnings.push('No document metadata found.')
    }

    return result
  }

  async stripMetadata(fileBytes, filename, keysToRemove) {
    const zip = await JSZip.loadAsync(fileBytes)
    const zipOut = new JSZip()

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue

      let data
      if (name === 'docProps/core.xml') {
        const relevant = keysToRemove.filter(k => k.startsWith('core:docProps/core.xml:'))
        data = relevant.length > 0
          ? scrubXmlFields(await entry.async('string'), relevant, 'core', 'docProps/core.xml')
          : await entry.async('uint8array')
      } else if (name === 'docProps/app.xml') {
        const relevant = keysToRemove.filter(k => k.startsWith('app:docProps/app.xml:'))
        data = relevant.length > 0
          ? scrubXmlFields(await entry.async('string'), relevant, 'app', 'docProps/app.xml')
          : await entry.async('uint8array')
      } else {
        data = await entry.async('uint8array')
      }

      zipOut.file(name, data, { date: new Date(0) })
    }

    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const stem = filename.slice(0, filename.length - ext.length)
    const outBytes = await zipOut.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    return { bytes: outBytes, filename: `${stem}_clean${ext}` }
  }
}

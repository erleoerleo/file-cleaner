import { PDFDocument } from 'pdf-lib'
import { MetadataField, ProcessResult, BaseProcessor } from './base.js'

// pdf-lib getter/setter pairs for the standard Info dictionary fields
const PDF_FIELDS = [
  { key: 'title',            label: 'Title',            get: d => d.getTitle(),            set: d => d.setTitle(''),            category: 'custom'     },
  { key: 'author',           label: 'Author',           get: d => d.getAuthor(),           set: d => d.setAuthor(''),           category: 'author'     },
  { key: 'subject',          label: 'Subject',          get: d => d.getSubject(),          set: d => d.setSubject(''),          category: 'custom'     },
  { key: 'keywords',         label: 'Keywords',         get: d => d.getKeywords(),         set: d => d.setKeywords(''),         category: 'custom'     },
  { key: 'creator',          label: 'Creator',          get: d => d.getCreator(),          set: d => d.setCreator(''),          category: 'software'   },
  { key: 'producer',         label: 'Producer',         get: d => d.getProducer(),         set: d => d.setProducer(''),         category: 'software'   },
  { key: 'creationDate',     label: 'Creation Date',    get: d => d.getCreationDate()?.toISOString?.(), set: d => d.setCreationDate(new Date(0)), category: 'timestamp' },
  { key: 'modificationDate', label: 'Modified Date',    get: d => d.getModificationDate()?.toISOString?.(), set: d => d.setModificationDate(new Date(0)), category: 'timestamp' },
]

export class PdfProcessor extends BaseProcessor {
  supportedExtensions() { return ['.pdf'] }

  async extractMetadata(fileBytes, filename) {
    const result = new ProcessResult({ fileName: filename, fileType: 'PDF' })

    let doc
    try {
      doc = await PDFDocument.load(fileBytes, { ignoreEncryption: true })
    } catch (err) {
      result.error = `Could not open PDF: ${err.message}`
      return result
    }

    for (const field of PDF_FIELDS) {
      let value
      try { value = field.get(doc) } catch { continue }
      if (!value && value !== 0) continue
      const strVal = String(value).trim()
      if (!strVal || strVal === 'Invalid Date') continue

      result.metadata.push(new MetadataField({
        key: `pdf:${filename}:${field.key}`,
        value: strVal,
        category: field.category,
        removable: true,
        sourceFile: filename,
      }))
    }

    if (result.metadata.length === 0) {
      result.warnings.push('No document metadata found in this PDF.')
    }

    return result
  }

  async stripMetadata(fileBytes, filename, keysToRemove) {
    const keysSet = new Set(keysToRemove)
    const doc = await PDFDocument.load(fileBytes, { ignoreEncryption: true })

    for (const field of PDF_FIELDS) {
      const key = `pdf:${filename}:${field.key}`
      if (keysSet.has(key)) {
        try { field.set(doc) } catch { /* ignore if field doesn't exist */ }
      }
    }

    const cleanBytes = await doc.save()
    const stem = filename.replace(/\.pdf$/i, '')
    return { bytes: cleanBytes, filename: `${stem}_clean.pdf` }
  }
}

export class MetadataField {
  constructor({ key, value, category, removable = true, sourceFile = '', label = '' }) {
    this.key = key
    this.label = label || key   // human-readable name, falls back to key
    this.value = value
    this.category = category
    this.removable = removable
    this.sourceFile = sourceFile
  }
}

export class ProcessResult {
  constructor({ fileName, fileType }) {
    this.fileName = fileName
    this.fileType = fileType
    this.metadata = []
    this.warnings = []
    this.error = null
  }
}

export class BaseProcessor {
  /** @returns {string[]} */
  supportedExtensions() { throw new Error('Not implemented') }

  /** @returns {Promise<ProcessResult>} */
  async extractMetadata(_fileBytes, _filename) { throw new Error('Not implemented') }

  /** @returns {Promise<{ bytes: Uint8Array, filename: string }>} */
  async stripMetadata(_fileBytes, _filename, _keysToRemove) { throw new Error('Not implemented') }
}

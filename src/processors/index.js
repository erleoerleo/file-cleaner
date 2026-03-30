import { ShapefileProcessor } from './shapefile.js'
import { ImageProcessor } from './image.js'
import { PdfProcessor } from './pdf.js'
import { OfficeProcessor } from './office.js'

/**
 * Plugin registry. To add support for a new file type:
 *   1. Create src/processors/myformat.js extending BaseProcessor
 *   2. Add `new MyFormatProcessor()` to this array
 */
const PROCESSORS = [
  new ShapefileProcessor(),
  new ImageProcessor(),
  new PdfProcessor(),
  new OfficeProcessor(),
]

/** Returns the first processor that handles the given filename's extension, or null. */
export function getProcessor(filename) {
  const match = filename.toLowerCase().match(/(\.[^.]+)$/)
  const ext = match ? match[1] : ''
  return PROCESSORS.find(p => p.supportedExtensions().includes(ext)) ?? null
}

/** All accepted extensions across all processors, for file input accept attribute. */
export const ACCEPTED_EXTENSIONS = PROCESSORS.flatMap(p => p.supportedExtensions())

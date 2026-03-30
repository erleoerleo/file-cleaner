import { useRef, useState } from 'react'
import { ACCEPTED_EXTENSIONS } from '../processors/index.js'

export default function DropZone({ onFile }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }

  function handleChange(e) {
    const file = e.target.files[0]
    if (file) readFile(file)
    e.target.value = ''
  }

  function readFile(file) {
    const reader = new FileReader()
    reader.onload = (e) => onFile(file, e.target.result)
    reader.readAsArrayBuffer(file)
  }

  const acceptAttr = ACCEPTED_EXTENSIONS.join(',')
  const formatsLine = [
    'Shapefiles (.zip)',
    'Images (.jpg .png .tif)',
    'PDF',
    'Office (.docx .xlsx .pptx)',
    'Video (.mp4 .mov)',
    'Audio (.mp3 .flac .m4a)',
  ].join('  ·  ')

  return (
    <div
      className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <div className="dropzone__icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p className="dropzone__title">Drop a file here to scan for metadata</p>
      <p className="dropzone__subtitle">{formatsLine}</p>
      <p className="dropzone__subtitle" style={{ marginTop: 4, opacity: 0.6 }}>or click to browse</p>
    </div>
  )
}

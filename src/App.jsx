import { useState, useCallback, useRef } from 'react'
import DropZone from './components/DropZone.jsx'
import FilePanel from './components/FilePanel.jsx'
import MetadataPanel from './components/MetadataPanel.jsx'
import ActionBar from './components/ActionBar.jsx'
import { getProcessor } from './processors/index.js'

export default function App() {
  const [file, setFile] = useState(null)
  const [fileBytes, setFileBytes] = useState(null)
  const [result, setResult] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [status, setStatus] = useState('idle') // idle | processing | ready | cleaning
  const [workspaceDragOver, setWorkspaceDragOver] = useState(false)
  const dragCounter = useRef(0)

  const handleFile = useCallback(async (f, bytes) => {
    setFile(f)
    setFileBytes(bytes)
    setResult(null)
    setSelectedKeys(new Set())
    setStatus('processing')

    const processor = getProcessor(f.name)
    if (!processor) {
      setResult({ metadata: [], warnings: [], error: `Unsupported file type: ${f.name}` })
      setStatus('ready')
      return
    }

    try {
      const res = await processor.extractMetadata(bytes, f.name)
      setResult(res)
      // Auto-select all removable fields
      setSelectedKeys(new Set(res.metadata.filter(m => m.removable).map(m => m.key)))
    } catch (err) {
      setResult({ metadata: [], warnings: [], error: `Processing failed: ${err.message}` })
    }
    setStatus('ready')
  }, [])

  const toggleKey = useCallback((key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const selectAllRemovable = useCallback(() => {
    if (!result) return
    setSelectedKeys(new Set(result.metadata.filter(f => f.removable).map(f => f.key)))
  }, [result])

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), [])

  const handleClean = useCallback(async () => {
    if (!fileBytes || !file || selectedKeys.size === 0) return
    setStatus('cleaning')

    try {
      const processor = getProcessor(file.name)
      const { bytes, filename } = await processor.stripMetadata(
        fileBytes,
        file.name,
        [...selectedKeys]
      )
      // Trigger browser download
      const blob = new Blob([bytes], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Clean failed: ${err.message}`)
    }
    setStatus('ready')
  }, [fileBytes, file, selectedKeys])

  // hasFile ref so drag callbacks can read it without re-registering
  const hasFileRef = useRef(false)
  hasFileRef.current = file !== null

  const handleAppDragEnter = useCallback((e) => {
    if (!hasFileRef.current) return // landing page DropZone handles its own drag
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) setWorkspaceDragOver(true)
  }, [])

  const handleAppDragOver = useCallback((e) => {
    if (!hasFileRef.current) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault() // required to allow drop
  }, [])

  const handleAppDragLeave = useCallback((e) => {
    if (!hasFileRef.current) return
    dragCounter.current--
    if (dragCounter.current === 0) setWorkspaceDragOver(false)
  }, [])

  const handleAppDrop = useCallback((e) => {
    if (!hasFileRef.current) return
    e.preventDefault()
    dragCounter.current = 0
    setWorkspaceDragOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => handleFile(f, ev.target.result)
    reader.readAsArrayBuffer(f)
  }, [handleFile])

  const handleReset = useCallback(() => {
    setFile(null)
    setFileBytes(null)
    setResult(null)
    setSelectedKeys(new Set())
    setStatus('idle')
  }, [])

  const hasFile = file !== null

  return (
    <div
      className="app"
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={handleAppDrop}
    >
      {workspaceDragOver && (
        <div className="workspace-drop-overlay">
          <div className="workspace-drop-overlay__inner">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>Drop to load new file</p>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            <span>GIS Metadata Cleaner</span>
          </div>
          <div className="app-header__tagline">
            Strip sensitive metadata from shapefiles before sharing with Sodir or external parties
          </div>
        </div>
      </header>

      <main className="app-main">
        {!hasFile ? (
          <div className="landing">
            <DropZone onFile={handleFile} />
            <div className="landing__info">
              <div className="info-card">
                <div className="info-card__title">Supported formats</div>
                <ul>
                  <li><strong>Shapefiles</strong> — .zip with .shp .xml .dbf .prj</li>
                  <li><strong>Images</strong> — .jpg .jpeg .png .tif .tiff .webp</li>
                  <li><strong>PDF</strong> — .pdf</li>
                  <li><strong>Office</strong> — .docx .xlsx .pptx</li>
                </ul>
              </div>
              <div className="info-card">
                <div className="info-card__title">What gets detected</div>
                <ul>
                  <li>Author names and organisation names</li>
                  <li>GPS coordinates and location data</li>
                  <li>Internal file paths and network shares</li>
                  <li>Software version strings and tools</li>
                  <li>Creation and modification timestamps</li>
                </ul>
              </div>
              <div className="info-card">
                <div className="info-card__title">How it works</div>
                <ul>
                  <li>All processing happens in your browser</li>
                  <li>Files are never uploaded to any server</li>
                  <li>Review each field before removing</li>
                  <li>Download clean file when ready</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="workspace__left">
              <FilePanel
                file={file}
                result={result}
                status={status}
                onReset={handleReset}
              />
            </div>
            <div className="workspace__right">
              {status === 'processing' ? (
                <div className="loading-state">
                  <span className="spinner spinner--lg" />
                  <p>Scanning metadata…</p>
                </div>
              ) : (
                <MetadataPanel
                  result={result}
                  selectedKeys={selectedKeys}
                  onToggle={toggleKey}
                />
              )}
            </div>
          </div>
        )}
      </main>

      <ActionBar
        result={result}
        selectedKeys={selectedKeys}
        onSelectAllRemovable={selectAllRemovable}
        onClearSelection={clearSelection}
        onClean={handleClean}
        status={status}
      />
    </div>
  )
}

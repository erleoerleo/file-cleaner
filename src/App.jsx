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
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
            </svg>
            <span>File Cleaner</span>
          </div>
          <div className="app-header__tagline">
            Strip sensitive metadata from files before sharing with external parties — 100% in your browser
          </div>
          <a
            className="app-header__github"
            href="https://github.com/erleoerleo/file-cleaner"
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
          >
            {/* GitHub mark SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.185 6.839 9.504.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.339-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.026 2.747-1.026.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.337 4.695-4.566 4.944.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.579.688.481C19.138 20.203 22 16.447 22 12.021 22 6.484 17.523 2 12 2z" />
            </svg>
            <span>Open source</span>
          </a>
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

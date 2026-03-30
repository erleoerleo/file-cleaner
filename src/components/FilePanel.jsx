function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function FilePanel({ file, result, status, onReset }) {
  const removableCount = result
    ? result.metadata.filter(f => f.removable).length
    : 0
  const totalCount = result ? result.metadata.length : 0

  return (
    <div className="file-panel">
      <div className="file-panel__header">
        <div className="file-panel__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </div>
        <div className="file-panel__name" title={file.name}>{file.name}</div>
      </div>

      <div className="file-panel__meta">
        <div className="meta-row">
          <span className="meta-label">Size</span>
          <span className="meta-value">{formatBytes(file.size)}</span>
        </div>
        {result && !result.error && (
          <>
            <div className="meta-row">
              <span className="meta-label">Fields found</span>
              <span className="meta-value">{totalCount}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Removable</span>
              <span className="meta-value meta-value--highlight">{removableCount}</span>
            </div>
          </>
        )}
        <div className="meta-row">
          <span className="meta-label">Status</span>
          <span className={`status-badge status-badge--${status}`}>
            {status === 'processing' && 'Scanning…'}
            {status === 'ready' && (result?.error ? 'Error' : 'Ready')}
            {status === 'cleaning' && 'Cleaning…'}
          </span>
        </div>
      </div>

      {result?.error && (
        <div className="alert alert--error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {result.error}
        </div>
      )}

      {result?.warnings?.length > 0 && (
        <div className="warnings">
          <div className="warnings__title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Warnings ({result.warnings.length})
          </div>
          <ul className="warnings__list">
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <button className="btn btn--ghost btn--sm" onClick={onReset} style={{ marginTop: 'auto' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
        </svg>
        Process another file
      </button>
    </div>
  )
}

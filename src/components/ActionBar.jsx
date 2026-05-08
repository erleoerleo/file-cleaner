export default function ActionBar({ result, selectedKeys, onSelectAllRemovable, onClearSelection, onClean, status }) {
  if (!result || result.error) return null

  const removable = result.metadata.filter(f => f.removable)
  const keptCount = removable.filter(f => selectedKeys.has(f.key)).length
  const toRemoveCount = removable.length - keptCount
  const isCleaning = status === 'cleaning'

  return (
    <div className="action-bar">
      <div className="action-bar__left">
        <button className="btn btn--ghost btn--sm" onClick={onSelectAllRemovable} disabled={isCleaning || keptCount === removable.length}>
          Keep all
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onClearSelection} disabled={isCleaning || toRemoveCount === removable.length}>
          Remove all
        </button>
        {toRemoveCount > 0 && (
          <span className="selection-count">
            {toRemoveCount} field{toRemoveCount !== 1 ? 's' : ''} will be removed
          </span>
        )}
      </div>
      <div className="action-bar__right">
        <button
          className="btn btn--primary"
          onClick={onClean}
          disabled={toRemoveCount === 0 || isCleaning}
        >
          {isCleaning ? (
            <>
              <span className="spinner" />
              Cleaning…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Clean &amp; Download
            </>
          )}
        </button>
      </div>
    </div>
  )
}

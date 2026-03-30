import { useState } from 'react'

/** Derive a human-readable field name from the metadata key. */
function getFieldName(key) {
  if (key.startsWith('xml:')) {
    // xml:{sourceFile}:{xpath}  →  last segment of xpath
    const parts = key.split(':')
    const xpath = parts.slice(2).join(':')
    const segments = xpath.split('/')
    return segments[segments.length - 1]
  }
  if (key.startsWith('xml_file:')) return 'entire XML file'
  if (key.startsWith('cpg:')) return 'character encoding'
  if (key.startsWith('prj:')) return 'projection WKT'
  if (key.startsWith('dbf_field:')) {
    const parts = key.split(':')
    return `column: ${parts[parts.length - 1]}`
  }
  return key
}

export default function MetadataItem({ field, isSelected, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const fieldName = getFieldName(field.key)
  const isLong = field.value.length > 80
  const displayValue = isLong && !expanded
    ? field.value.slice(0, 80) + '…'
    : field.value

  // Derive short source label (basename of the path)
  const sourceName = field.sourceFile.split('/').pop().split('\\').pop()

  return (
    <div className={`metadata-item${isSelected ? ' metadata-item--selected' : ''}`}>
      <div className="metadata-item__check">
        {field.removable ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(field.key)}
            aria-label={`Remove ${fieldName}`}
          />
        ) : (
          <span className="lock-icon" title="Cannot be removed automatically">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
        )}
      </div>
      <div className="metadata-item__body">
        <div className="metadata-item__top">
          <span className="field-name">{fieldName}</span>
          <span className="source-badge" title={field.sourceFile}>{sourceName}</span>
        </div>
        <div className="metadata-item__value">
          <span className="field-value">{displayValue}</span>
          {isLong && (
            <button
              className="expand-btn"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? 'collapse' : 'expand'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

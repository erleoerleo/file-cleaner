import MetadataGroup from './MetadataGroup.jsx'

const CATEGORY_ORDER = ['author', 'location', 'path', 'software', 'timestamp', 'projection', 'custom']

export default function MetadataPanel({ result, selectedKeys, onToggle }) {
  if (!result || result.error) {
    return (
      <div className="metadata-panel metadata-panel--empty">
        <p>No metadata to display.</p>
      </div>
    )
  }

  if (result.metadata.length === 0) {
    return (
      <div className="metadata-panel metadata-panel--empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <p>No sensitive metadata detected.</p>
        <p className="hint">The ZIP appears clean — you can share it safely.</p>
      </div>
    )
  }

  // Group fields by category, preserving display order
  const grouped = {}
  for (const field of result.metadata) {
    if (!grouped[field.category]) grouped[field.category] = []
    grouped[field.category].push(field)
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter(c => grouped[c]),
    ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c)),
  ]

  return (
    <div className="metadata-panel">
      <div className="metadata-panel__scroll">
        {orderedCategories.map(category => (
          <MetadataGroup
            key={category}
            category={category}
            fields={grouped[category]}
            selectedKeys={selectedKeys}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

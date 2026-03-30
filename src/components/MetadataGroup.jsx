import { useState } from 'react'
import MetadataItem from './MetadataItem.jsx'

const CATEGORY_META = {
  author:     { label: 'Author / Contact',         color: 'var(--cat-author)',     icon: '👤' },
  location:   { label: 'GPS Location',             color: 'var(--cat-location)',   icon: '📍' },
  path:       { label: 'File Paths',               color: 'var(--cat-path)',       icon: '📁' },
  software:   { label: 'Software',                 color: 'var(--cat-software)',   icon: '💻' },
  timestamp:  { label: 'Timestamps',               color: 'var(--cat-timestamp)',  icon: '🕐' },
  projection: { label: 'Projection (read-only)',   color: 'var(--cat-projection)', icon: '🗺️' },
  custom:     { label: 'Other',                    color: 'var(--cat-custom)',     icon: '📄' },
}

export default function MetadataGroup({ category, fields, selectedKeys, onToggle }) {
  const [collapsed, setCollapsed] = useState(false)
  const meta = CATEGORY_META[category] || { label: category, color: 'var(--cat-custom)', icon: '•' }

  const removable = fields.filter(f => f.removable)
  const allSelected = removable.length > 0 && removable.every(f => selectedKeys.has(f.key))
  const someSelected = removable.some(f => selectedKeys.has(f.key))

  function handleGroupCheck(e) {
    e.stopPropagation()
    removable.forEach(f => {
      const shouldBeSelected = !allSelected
      const isSelected = selectedKeys.has(f.key)
      if (shouldBeSelected !== isSelected) onToggle(f.key)
    })
  }

  return (
    <div className="metadata-group">
      <div
        className="metadata-group__header"
        style={{ '--cat-color': meta.color }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="group-header-left">
          {removable.length > 0 && (
            <input
              type="checkbox"
              className="group-checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
              onChange={handleGroupCheck}
              onClick={e => e.stopPropagation()}
              aria-label={`Select all in ${meta.label}`}
            />
          )}
          <span className="group-icon">{meta.icon}</span>
          <span className="group-label">{meta.label}</span>
          <span className="group-count">{fields.length}</span>
        </div>
        <div className="group-header-right">
          {removable.length > 0 && (
            <span className="group-removable-hint">{removable.length} removable</span>
          )}
          <span className={`chevron${collapsed ? ' chevron--collapsed' : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="metadata-group__items">
          {fields.map(field => (
            <MetadataItem
              key={field.key}
              field={field}
              isSelected={selectedKeys.has(field.key)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

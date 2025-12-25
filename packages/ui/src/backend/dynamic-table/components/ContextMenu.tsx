'use client'

import React, { useEffect, useRef, useState } from 'react';
import '../styles/ContextMenu.css';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  onClose: () => void;
  onActionClick: (actionId: string) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
  actions,
  onClose,
  onActionClick,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    // Adjust position to keep menu within viewport
    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10;
    }

    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10;
    }

    setAdjustedPosition({ x, y });
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        zIndex: 9999,
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        minWidth: '180px',
        padding: '4px 0',
      }}
    >
      {actions.map((action, index) => {
        if (action.separator) {
          return (
            <div
              key={`separator-${index}`}
              style={{
                height: '1px',
                backgroundColor: '#e5e7eb',
                margin: '4px 0',
              }}
            />
          );
        }

        return (
          <button
            key={action.id}
            onClick={() => {
              if (!action.disabled) {
                onActionClick(action.id);
                onClose();
              }
            }}
            disabled={action.disabled}
            className="context-menu-item"
            style={{
              width: '100%',
              padding: '8px 16px',
              textAlign: 'left',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: action.disabled ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              color: action.disabled ? '#9ca3af' : '#374151',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!action.disabled) {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {action.icon && <span>{action.icon}</span>}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContextMenu;
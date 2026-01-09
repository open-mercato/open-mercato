import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Minimize2 } from 'lucide-react';

interface FullscreenOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  tableName?: string;
}

const FullscreenOverlay: React.FC<FullscreenOverlayProps> = ({
  isOpen,
  onClose,
  children,
  tableName,
}) => {
  // Handle ESC key to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const overlayContent = (
    <div className="dynamic-table-fullscreen-overlay">
      {/* Header with title and close button */}
      <div className="dynamic-table-fullscreen-header">
        <div className="dynamic-table-fullscreen-title">
          {tableName && <span>{tableName}</span>}
          <span className="dynamic-table-fullscreen-badge">Fullscreen</span>
        </div>
        <button
          onClick={onClose}
          className="dynamic-table-fullscreen-close"
          title="Exit fullscreen (Esc)"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      </div>

      {/* Table content */}
      <div className="dynamic-table-fullscreen-content">
        {children}
      </div>
    </div>
  );

  return createPortal(overlayContent, document.body);
};

export default FullscreenOverlay;

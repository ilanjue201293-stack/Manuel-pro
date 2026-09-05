"use client";

import type { ReactNode } from "react";

export default function Modal({ children, onClose, className = "" }: { children: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal-card ${className}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

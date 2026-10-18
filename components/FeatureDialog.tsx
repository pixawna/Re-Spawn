"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
export default function FeatureDialog({
  title,
  kicker,
  onClose,
  children,
  className = "",
}: {
  title: string;
  kicker: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`feature-dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="feature-heading">
        <div>
          <p className="feature-kicker">{kicker}</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="btn-ghost"
          onClick={onClose}
          aria-label={`Close ${kicker}`}
        >
          Close ×
        </button>
      </header>
      {children}
    </dialog>
  );
}

import React from 'react';
import { X } from 'lucide-react';

type Tone = 'primary' | 'ghost' | 'danger';
type Size = 'default' | 'compact';
export function FieldLineMark({ size = 32, className = '' }: { size?: number; className?: string }): React.JSX.Element {
  return <svg className={className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 12H35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3"/>
    <path d="M5 27H26L35 20" stroke="var(--fl-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M26 6V34" stroke="currentColor" strokeOpacity=".3" strokeWidth="1"/>
  </svg>;
}
export function FieldLineProgress({ planned, actual, label = 'Planned versus actual progress', className = '' }: {
  planned: number; actual: number; label?: string; className?: string
}): React.JSX.Element {
  const plan = Math.min(100, Math.max(0, Number.isFinite(planned) ? planned : 0));
  const done = Math.min(100, Math.max(0, Number.isFinite(actual) ? actual : 0));
  return <div className={`fl-variance ${className}`} role="img" aria-label={`${label}: planned ${plan.toFixed(1)}%, actual ${done.toFixed(1)}%, variance ${(done - plan).toFixed(1)} percentage points`}>
    <svg viewBox="0 0 100 27" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 8H100" stroke="var(--fl-hairline)" strokeWidth="2"/>
      <path d={`M0 8H${plan}`} stroke="var(--fl-text-muted)" strokeWidth="2" strokeDasharray="2 1.5"/>
      <path d="M0 19H100" stroke="var(--fl-hairline)" strokeWidth="3"/>
      <path d={`M0 19H${done}`} stroke="var(--fl-accent)" strokeWidth="4"/>
      <path d={`M${plan} 3V24`} stroke="var(--fl-text-muted)" strokeWidth=".6"/>
    </svg>
  </div>;
}
export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size }>(function Button({ tone = 'ghost', size = 'default', className = '', type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={`fl-button fl-button--${tone} fl-button--${size} ${className}`} {...props}/>;
});
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`fl-input ${className}`} {...props}/>;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...props }, ref) {
  return <select ref={ref} className={`fl-input ${className}`} {...props}/>;
});
export function Tabs({ children, label, className = '' }: { children: React.ReactNode; label: string; className?: string }) {
  return <div role="tablist" aria-label={label} className={`fl-tabs ${className}`}>{children}</div>;
}
export function StatusDot({ status, label }: { status: 'good' | 'risk' | 'late' | 'info'; label: string }) {
  return <span className="fl-status"><span aria-hidden="true" className={`fl-status__dot fl-status__dot--${status}`}/>{label}</span>;
}
export function Badge({ status, children }: { status: 'good' | 'risk' | 'late' | 'info'; children: React.ReactNode }) {
  return <span className={`fl-badge fl-badge--${status}`}>{children}</span>;
}
export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`fl-panel ${className}`}>{children}</section>;
}
export function Table({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="fl-table-scroller" tabIndex={0} role="region" aria-label={label}><table className="fl-table">{children}</table></div>;
}
/**
 * Keep keyboard focus inside an open modal, close it on Escape, and restore the
 * trigger's focus on unmount. This hook intentionally does not change form data.
 */
export function useDialogKeyboard(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement> {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    const first = focusable()[0] ?? dialogRef.current;
    first?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const start = items[0];
      const end = items[items.length - 1];
      if (!start || !end) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === start || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && (document.activeElement === end || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  return dialogRef;
}
export function Sheet({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useDialogKeyboard(open, onClose);
  if (!open) return null;
  return <div className="fl-sheet-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} className="fl-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header className="fl-sheet__header"><h2>{title}</h2><Button onClick={onClose} aria-label="Close"><X size={20}/></Button></header>{children}
    </div>
  </div>;
}
export function Skeleton({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return <div className={`fl-skeleton ${className}`} aria-label="Loading" role="status">{Array.from({ length: rows }, (_, i) => <span key={i} className="fl-skeleton__row"/>)}</div>;
}
export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return <div className="fl-empty"><p>{message}</p>{action}</div>;
}
export function Toast({ message, kind = 'info' }: { message: string; kind?: 'info' | 'good' | 'risk' | 'late' }) {
  return <div className={`fl-toast fl-toast--${kind}`} role={kind === 'late' ? 'alert' : 'status'}>{message}</div>;
}

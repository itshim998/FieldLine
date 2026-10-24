import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Button, FieldLineMark, FieldLineProgress, Sheet, StatusDot, Table
} from '../src/components/ui/FieldLine.js';

afterEach(cleanup);

describe('FieldLine UI primitives', () => {
  it('exposes a real numeric planned-versus-actual comparison to screen readers', () => {
    const { container } = render(<FieldLineProgress planned={75} actual={50} label="Bridge A" />);
    expect(screen.getByRole('img', { name: /Bridge A: planned 75.0%, actual 50.0%, variance -25.0 percentage points/i })).toBeTruthy();
    expect(container.querySelector('path[d="M0 8H75"]')).toBeTruthy();
    expect(container.querySelector('path[d="M0 19H50"]')).toBeTruthy();
  });

  it('clamps out-of-range values and rejects non-finite percentages', () => {
    const { container } = render(<FieldLineProgress planned={140} actual={Number.NaN} />);
    expect(screen.getByRole('img', { name: /planned 100.0%, actual 0.0%, variance -100.0/i })).toBeTruthy();
    expect(container.querySelector('path[d="M0 8H100"]')).toBeTruthy();
    expect(container.querySelector('path[d="M0 19H0"]')).toBeTruthy();
  });

  it('keeps the decorative two-line mark hidden from assistive technology', () => {
    const { container } = render(<FieldLineMark size={36}/>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('36');
  });

  it('uses safe button defaults and passes through accessibility attributes', () => {
    const submit = vi.fn();
    render(<form onSubmit={event => { event.preventDefault(); submit(); }}><Button aria-label="Open reporting">Open</Button></form>);
    const button = screen.getByRole('button', { name: 'Open reporting' }) as HTMLButtonElement;
    expect(button.type).toBe('button');
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it('closes a sheet only when the backdrop, not its contents, is clicked', () => {
    const close = vi.fn();
    const { container } = render(<Sheet open title="Report progress" onClose={close}><button>Save progress</button></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Report progress' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector('.fl-sheet-backdrop')!);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('traps Tab within a sheet, closes on Escape and restores focus to the trigger', () => {
    const onClose = vi.fn();
    function Example() {
      const [open, setOpen] = React.useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open report</button>
        <Sheet open={open} title="Report progress" onClose={() => { onClose(); setOpen(false); }}>
          <button>Save progress</button>
        </Sheet>
      </>;
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open report' });
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save progress' });
    expect(document.activeElement).toBe(close);
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('communicates status in words, not only through colour', () => {
    const { container } = render(<StatusDot status="late" label="Delayed" />);
    expect(screen.getByText('Delayed')).toBeTruthy();
    expect(container.querySelector('.fl-status__dot--late')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('provides keyboard access to a horizontally scrolling activity table', () => {
    render(<Table label="Activity variances"><tbody><tr><td>ACT-01</td></tr></tbody></Table>);
    const region = screen.getByRole('region', { name: 'Activity variances' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('table')).toBeTruthy();
  });
});

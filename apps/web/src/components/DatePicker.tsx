import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState, type ForwardedRef, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { currentDateInputValue } from './Ui';
import { useAnimatedPresence } from './useAnimatedPresence';

function asIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseIsoDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function formatDateLabel(value: string) {
  const date = parseIsoDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}
function setRefValue(ref: ForwardedRef<HTMLInputElement>, value: HTMLInputElement | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const DatePicker = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function DatePicker(props, forwardedRef) {
  const {
    value, defaultValue, onChange, onBlur, disabled = false, name, id, min, max, required, title, className = '',
    autoFocus, placeholder, ...otherProps
  } = props;
  const controlId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const proxyRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(String(value ?? defaultValue ?? ''));
  const selectedValue = value !== undefined ? String(value ?? '') : internalValue;
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseIsoDate(String(value ?? defaultValue ?? '')) ?? new Date());
  const [position, setPosition] = useState({ top: 0, left: 0, width: 306 });
  const [focusedDate, setFocusedDate] = useState(String(value ?? defaultValue ?? currentDateInputValue()));
  const [invalid, setInvalid] = useState(false);
  const presence = useAnimatedPresence(open, 190);
  const ariaInvalid = invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  const selectedDate = parseIsoDate(selectedValue);
  const monthYear = `${viewDate.getFullYear()} 年 ${String(viewDate.getMonth() + 1).padStart(2, '0')} 月`;
  const todayValue = currentDateInputValue();
  const cells = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return { date, value: asIsoDate(date), inMonth: date.getMonth() === viewDate.getMonth() };
    });
  }, [viewDate]);

  useEffect(() => {
    if (!proxyRef.current) return;
    if (value !== undefined) {
      const nextValue = String(value ?? '');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(proxyRef.current, nextValue);
    } else setInternalValue(proxyRef.current.value || internalValue);
    // Keep React Hook Form's default value visible after it writes to the registered input ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, value]);

  const syncPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(306, window.innerWidth - 24);
    const approximateHeight = 360;
    const belowSpace = window.innerHeight - rect.bottom - 14;
    const maxTop = Math.max(12, window.innerHeight - approximateHeight - 12);
    const top = belowSpace >= approximateHeight
      ? Math.min(rect.bottom + 7, maxTop)
      : rect.top >= approximateHeight + 20
        ? Math.max(12, rect.top - approximateHeight - 7)
        : Math.max(12, Math.min(rect.bottom + 7, maxTop));
    setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
  }, []);

  useEffect(() => {
    if (!open) return;
    syncPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open || !presence.mounted) return;
    const frame = requestAnimationFrame(() => {
      const day = popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`);
      day?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, presence.mounted, focusedDate, viewDate]);

  function moveFocusBy(days: number) {
    const base = parseIsoDate(focusedDate) ?? selectedDate ?? new Date();
    let next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    // Never move the roving tab stop onto a disabled date: disabled buttons cannot receive
    // focus, which otherwise leaves keyboard users stranded after an Arrow/Home/End action.
    const direction = days < 0 ? -1 : 1;
    let attempts = 0;
    while (isDisabled(asIsoDate(next)) && attempts < 3660) {
      next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + direction);
      attempts += 1;
    }
    if (isDisabled(asIsoDate(next))) return;
    const nextValue = asIsoDate(next);
    setFocusedDate(nextValue);
    if (next.getMonth() !== viewDate.getMonth() || next.getFullYear() !== viewDate.getFullYear()) setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  function handleDayKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, cellValue: string) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocusBy(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveFocusBy(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocusBy(-7); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveFocusBy(7); }
    else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const date = parseIsoDate(cellValue) ?? new Date();
      const dayOffset = (date.getDay() + 6) % 7;
      moveFocusBy(event.key === 'Home' ? -dayOffset : 6 - dayOffset);
    } else if (event.key === 'PageUp') { event.preventDefault(); changeMonth(-1); }
    else if (event.key === 'PageDown') { event.preventDefault(); changeMonth(1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseDate(cellValue); }
  }

  function isDisabled(valueToCheck: string) {
    const minimum = min == null ? '' : String(min);
    const maximum = max == null ? '' : String(max);
    return Boolean((minimum && valueToCheck < minimum) || (maximum && valueToCheck > maximum));
  }

  function chooseDate(nextValue: string) {
    if (isDisabled(nextValue)) return;
    if (value === undefined) setInternalValue(nextValue);
    if (proxyRef.current) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(proxyRef.current, nextValue);
      proxyRef.current.dispatchEvent(new Event('input', { bubbles: true }));
      proxyRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setViewDate(parseIsoDate(nextValue) ?? new Date());
    setOpen(false);
    triggerRef.current?.focus();
    if (proxyRef.current && onBlur) onBlur({ target: proxyRef.current, currentTarget: proxyRef.current, type: 'blur' } as unknown as ReactFocusEvent<HTMLInputElement>);
  }

  function clearDate() {
    if (value === undefined) setInternalValue('');
    if (proxyRef.current) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(proxyRef.current, '');
      proxyRef.current.dispatchEvent(new Event('input', { bubbles: true }));
      proxyRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  const handleProxyRef = (element: HTMLInputElement | null) => {
    proxyRef.current = element;
    setRefValue(forwardedRef, element);
    if (element && autoFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  function changeMonth(delta: number) {
    setViewDate((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1));
    setFocusedDate((current) => { const date = parseIsoDate(current) ?? selectedDate ?? new Date(); const next = new Date(date.getFullYear(), date.getMonth() + delta, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + delta + 1, 0).getDate())); return asIsoDate(next); });
  }

  return <div ref={wrapperRef} className={`date-picker-control ${className}`.trim()} data-open={open ? 'true' : 'false'}>
    <input
      {...otherProps}
      type="date"
      ref={handleProxyRef}
      id={id ? `${id}-native` : undefined}
      name={name}
      defaultValue={defaultValue as string | undefined}
      min={min}
      max={max}
      required={Boolean(required)}
      tabIndex={-1}
      aria-hidden="true"
      className="date-picker-proxy"
      onChange={onChange}
      onBlur={onBlur}
      onFocus={() => triggerRef.current?.focus()}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}
    />
    <button
      ref={triggerRef}
      type="button"
      id={id}
      className={`date-picker-trigger ${ariaInvalid ? 'is-invalid' : ''}`}
      role="combobox"
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      aria-errormessage={props['aria-errormessage']}
      aria-invalid={ariaInvalid ? 'true' : undefined}
      aria-controls={open ? `date-picker-dialog-${controlId}` : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-required={required}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (disabled) return;
        const initial = selectedDate ?? new Date();
        setFocusedDate(asIsoDate(initial));
        setInvalid(false);
        setViewDate(new Date(initial.getFullYear(), initial.getMonth(), 1));
        setOpen((current) => !current);
        requestAnimationFrame(syncPosition);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          const initial = selectedDate ?? new Date();
          setFocusedDate(asIsoDate(initial));
          setViewDate(new Date(initial.getFullYear(), initial.getMonth(), 1));
          setOpen(true);
          requestAnimationFrame(syncPosition);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          if (!selectedDate) return;
          event.preventDefault();
          const next = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + (event.key === 'ArrowRight' ? 1 : -1));
          chooseDate(asIsoDate(next));
        }
      }}
      onBlur={() => {
        if (proxyRef.current && onBlur) onBlur({ target: proxyRef.current, currentTarget: proxyRef.current, type: 'blur' } as unknown as ReactFocusEvent<HTMLInputElement>);
      }}
    >
      <span className={`date-picker-value ${selectedValue ? '' : 'is-placeholder'}`}>{selectedValue ? formatDateLabel(selectedValue) : (placeholder ?? '选择日期')}</span>
      <CalendarDays size={15} className="date-picker-icon" />
    </button>
    {presence.mounted && createPortal(<section
      ref={popupRef}
      id={`date-picker-dialog-${controlId}`}
      className={`date-picker-popover ${presence.visible ? 'is-visible' : 'is-closing'}`}
      role="dialog"
      aria-label="日期选择器"
      style={{ top: position.top, left: position.left, width: position.width }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <header className="date-picker-header">
        <div className="date-picker-month-copy"><span className="date-picker-year">{viewDate.getFullYear()}</span><strong>{monthYear}</strong></div>
        <div className="date-picker-month-actions">
          <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button>
        </div>
      </header>
      <div className="date-picker-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="date-picker-days" role="group" aria-label="日期网格">
        {cells.map((cell) => {
          const selected = selectedValue === cell.value;
          const today = todayValue === cell.value;
          const unavailable = isDisabled(cell.value);
          return <button
            type="button"
            key={cell.value}
            data-date={cell.value}
            tabIndex={focusedDate === cell.value ? 0 : -1}
            onFocus={() => setFocusedDate(cell.value)}
            onKeyDown={(event) => handleDayKeyDown(event, cell.value)}
            className={`date-picker-day ${cell.inMonth ? '' : 'is-outside'} ${selected ? 'is-selected' : ''} ${today ? 'is-today' : ''}`}
            disabled={unavailable}
            aria-pressed={selected}
            aria-current={today ? "date" : undefined}
            aria-label={`${cell.date.getFullYear()}年${cell.date.getMonth() + 1}月${cell.date.getDate()}日`}
            onClick={() => chooseDate(cell.value)}
          >{cell.date.getDate()}</button>;
        })}
      </div>
      <footer className="date-picker-footer">
        <button type="button" className="date-picker-today" disabled={isDisabled(todayValue)} onClick={() => chooseDate(todayValue)}><span className="today-indicator" />今天</button>
        <div>
          {selectedValue && <button type="button" className="date-picker-clear" onClick={clearDate}><X size={13} />清除</button>}
          <button type="button" className="date-picker-confirm" onClick={() => { if (selectedValue) chooseDate(selectedValue); else setOpen(false); }}><Check size={13} />完成</button>
        </div>
      </footer>
    </section>, document.body)}
  </div>;
});

export default DatePicker;

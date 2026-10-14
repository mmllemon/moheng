import { Children, forwardRef, isValidElement, useCallback, useEffect, useMemo, useRef, useState, useId, type ForwardedRef, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAnimatedPresence } from './useAnimatedPresence';

type SelectOption = { value: string; label: string; disabled: boolean };
type OptionElementProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

function nodeText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
    return '';
  }).join('').trim();
}

function collectOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionElementProps>(child)) return;
    if (typeof child.type === 'string' && child.type.toLowerCase() === 'option') {
      const label = nodeText(child.props.children);
      options.push({ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) });
      return;
    }
    if (child.props.children) options.push(...collectOptions(child.props.children));
  });
  return options;
}

function setRefValue(ref: ForwardedRef<HTMLSelectElement>, value: HTMLSelectElement | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectField(props, forwardedRef) {
  const {
    children, value, defaultValue, onChange, onBlur, disabled = false, className = '', name,
    id, title, required, size: _size, autoFocus, ...otherProps
  } = props;
  const controlId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const proxyRef = useRef<HTMLSelectElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => collectOptions(children), [children]);
  const [internalValue, setInternalValue] = useState(String(value ?? defaultValue ?? options[0]?.value ?? ''));
  const selectedValue = value !== undefined ? String(value ?? '') : internalValue;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 220, maxHeight: 280 });
  const presence = useAnimatedPresence(open, 180);
  const visibleOptions = options.filter((option) => !filterText || option.label.toLocaleLowerCase().includes(filterText.toLocaleLowerCase()));
  const selectedOption = options.find((option) => option.value === selectedValue);

  const syncPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
    const maxHeight = Math.min(300, Math.max(180, window.innerHeight * 0.46));
    const belowSpace = window.innerHeight - rect.bottom - 12;
    const top = belowSpace >= Math.min(maxHeight, 220) || rect.top < maxHeight + 16
      ? Math.min(rect.bottom + 6, window.innerHeight - maxHeight - 12)
      : Math.max(12, rect.top - maxHeight - 6);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    setPosition({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy) return;
    if (value !== undefined) {
      const nextValue = String(value ?? '');
      if (proxy.value !== nextValue) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(proxy, nextValue);
      }
      return;
    }
    if (proxy.value !== internalValue) setInternalValue(proxy.value);
    // RHF writes defaultValues into the registered native select on ref attachment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, value]);

  useEffect(() => {
    if (!open) return;
    syncPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
      setFilterText('');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setFilterText(''); triggerRef.current?.focus(); }
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
    if (!presence.mounted || !visibleOptions.length) return;
    popupRef.current?.querySelector<HTMLElement>('.select-option.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, presence.mounted, visibleOptions.length]);

  function setNativeValue(nextValue: string) {
    const element = proxyRef.current;
    if (!element) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function choose(option: SelectOption) {
    if (option.disabled || disabled) return;
    if (value === undefined) setInternalValue(option.value);
    setNativeValue(option.value);
    setOpen(false);
    setFilterText('');
    setInvalid(false);
    triggerRef.current?.focus();
  }

  function openDropdown() {
    if (disabled) return;
    setFilterText('');
    const index = Math.max(0, options.findIndex((option) => option.value === selectedValue));
    setActiveIndex(index);
    setOpen(true);
    requestAnimationFrame(syncPosition);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); openDropdown(); return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => {
        if (!visibleOptions.length) return 0;
        const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % visibleOptions.length;
        return next;
      });
    } else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setActiveIndex(Math.max(0, visibleOptions.length - 1)); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const option = visibleOptions[activeIndex]; if (option) choose(option); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    else if (event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key)) {
      const found = visibleOptions.findIndex((option) => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (found >= 0) setActiveIndex(found);
    }
  }

  // Keep RHF's ref on the actual select. Focusing it after validation redirects to the visible trigger.
  const handleProxyRef = (element: HTMLSelectElement | null) => {
    proxyRef.current = element;
    setRefValue(forwardedRef, element);
    if (element && autoFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return <div ref={wrapperRef} className={`select-control ${className}`.trim()} data-open={open ? 'true' : 'false'}>
    <select
      {...otherProps}
      id={id}
      name={name}
      ref={handleProxyRef}
      defaultValue={defaultValue}
      required={Boolean(required)}
      aria-hidden="true"
      tabIndex={-1}
      className="select-control-proxy"
      onChange={onChange}
      onBlur={onBlur}
      onFocus={() => triggerRef.current?.focus()}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}
    >{children}</select>
    <button
      ref={triggerRef}
      type="button"
      id={id ? `${id}-trigger` : undefined}
      className={`select-control-trigger ${invalid || props['aria-invalid'] ? 'is-invalid' : ''}`}
      role="combobox"
      aria-label={props['aria-label']}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? `select-options-${controlId}` : undefined}
      aria-activedescendant={open && visibleOptions[activeIndex] ? `select-option-${controlId}-${activeIndex}` : undefined}
      aria-required={required}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      onClick={() => open ? setOpen(false) : openDropdown()}
      onKeyDown={handleTriggerKeyDown}
      onBlur={() => {
        if (proxyRef.current && onBlur) onBlur({ target: proxyRef.current, currentTarget: proxyRef.current, type: 'blur' } as unknown as ReactFocusEvent<HTMLSelectElement>);
      }}
    >
      <span className={`select-control-value ${selectedOption ? '' : 'is-placeholder'}`}>{selectedOption?.label ?? '请选择'}</span>
      <ChevronDown size={15} className={`select-control-chevron ${open ? 'is-open' : ''}`} />
    </button>
    {presence.mounted && createPortal(<div
      ref={popupRef}
      id={`select-options-${controlId}`}
      className={`select-popover ${presence.visible ? 'is-visible' : 'is-closing'}`}
      role="listbox"
      aria-label={props['aria-label'] ?? '下拉选项'}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.length > 7 && <div className="select-popover-search"><Search size={14} /><input aria-label="筛选下拉选项" role="combobox" aria-autocomplete="list" aria-controls={`select-options-${controlId}`} aria-expanded={open} aria-activedescendant={visibleOptions[activeIndex] ? `select-option-${controlId}-${activeIndex}` : undefined} value={filterText} onChange={(event) => { setFilterText(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => visibleOptions.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % visibleOptions.length : 0); } else if (event.key === 'Enter') { event.preventDefault(); const option = visibleOptions[activeIndex]; if (option) choose(option); } }} placeholder="筛选选项…" autoFocus /></div>}
      <div className="select-option-list">
        {visibleOptions.length ? visibleOptions.map((option, index) => <button
          type="button"
          role="option"
          aria-selected={option.value === selectedValue}
          id={`select-option-${controlId}-${index}`}
          key={`${option.value}-${index}`}
          disabled={option.disabled}
          className={`select-option ${option.value === selectedValue ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
        >
          <span className="select-option-label">{option.label}</span>
          {option.value === selectedValue && <Check size={15} />}
        </button>) : <div className="select-option-empty">没有匹配的选项</div>}
      </div>
    </div>, document.body)}
  </div>;
});

export default SelectField;

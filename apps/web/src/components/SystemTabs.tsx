type SystemTabItem = { id: string; label: string; count?: string | number; hint?: string };

export default function SystemTabs({ items, value, onChange, ariaLabel }: {
  items: SystemTabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return <nav className="sys-tabs" role="tablist" aria-label={ariaLabel}>
    {items.map((item) => <button
      key={item.id}
      type="button"
      role="tab"
      aria-selected={value === item.id}
      className={value === item.id ? 'is-active' : ''}
      onClick={() => onChange(item.id)}
      title={item.hint}
    >
      <span>{item.label}</span>
      {item.count !== undefined && <small>{item.count}</small>}
    </button>)}
  </nav>;
}

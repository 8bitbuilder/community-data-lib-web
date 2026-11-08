import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export type NotebookTab = 'steps' | 'data';

interface TabDef {
  id: NotebookTab;
  label: string;
  badge?: string;
  panel: ReactNode;
}

interface Props {
  active: NotebookTab;
  onChange: (tab: NotebookTab) => void;
  tabs: TabDef[];
}

/** WAI-ARIA tabs. Panels stay mounted (hidden) so cell editors keep their state. */
export default function NotebookTabs({ active, onChange, tabs }: Props) {
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onChange(tabs[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <div className="nb-tabs">
      <div className="nb-tablist" role="tablist" aria-label="Notebook view">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={`nb-tab${selected ? ' nb-tab--active' : ''}`}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {tab.label}
              {tab.badge && <span className="nb-tab-badge">{tab.badge}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="nb-tabpanel"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}

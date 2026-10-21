/**
 * Behavior for src/components/librarian/CountyPicker.astro: a combobox that searches
 * the embedded county list and stores the chosen GEOID in its hidden input.
 * Keyboard: arrows move, Enter picks, Escape closes.
 */

import { countyLabel, searchCounties, type CountyOption } from './portal';

export interface CountyPicker {
  /** The chosen county GEOID, or '' if none. */
  value(): string;
  /** Show a county as chosen (e.g. when editing an existing library). */
  set(geoid: string): void;
}

export function initCountyPicker(root: HTMLElement): CountyPicker {
  const options = JSON.parse(root.querySelector('[data-county-options]')?.textContent ?? '[]') as CountyOption[];
  const byId = new Map(options.map((o) => [o[0], o]));
  const search = root.querySelector('input[role="combobox"]') as HTMLInputElement;
  const list = root.querySelector('[role="listbox"]') as HTMLUListElement;
  const hidden = root.querySelector('[data-county-value]') as HTMLInputElement;
  const chosen = root.querySelector('[data-county-chosen]') as HTMLElement;
  let matches: CountyOption[] = [];
  let active = -1;

  function close() {
    list.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  }

  function render() {
    list.replaceChildren(
      ...matches.map((option, i) => {
        const item = document.createElement('li');
        item.id = `${list.id}-${option[0]}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === active));
        item.append(countyLabel(option));
        const fips = document.createElement('span');
        fips.className = 'county-fips';
        fips.textContent = option[0];
        item.append(fips);
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(option);
        });
        return item;
      })
    );
    const open = matches.length > 0;
    list.hidden = !open;
    search.setAttribute('aria-expanded', String(open));
    if (active >= 0) search.setAttribute('aria-activedescendant', `${list.id}-${matches[active][0]}`);
    else search.removeAttribute('aria-activedescendant');
  }

  function choose(option: CountyOption | undefined) {
    if (!option) return;
    hidden.value = option[0];
    search.value = countyLabel(option);
    chosen.textContent = `Chosen: ${countyLabel(option)} (Census code ${option[0]})`;
    close();
  }

  search.addEventListener('input', () => {
    hidden.value = '';
    chosen.textContent = '';
    matches = searchCounties(options, search.value);
    active = matches.length > 0 ? 0 : -1;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  });
  search.addEventListener('blur', close);

  return {
    value: () => hidden.value,
    set(geoid: string) {
      choose(byId.get(geoid));
    },
  };
}

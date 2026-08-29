/** @typedef {{ value: string, label?: string }} MultiSelectItem */

let openInstance = null;

/**
 * @param {HTMLElement} root
 * @param {{
 *   label: string,
 *   placeholder?: string,
 *   searchPlaceholder?: string,
 *   items?: MultiSelectItem[],
 *   onChange?: () => void,
 * }} options
 */
export function createMultiSelectDropdown(root, options) {
  const placeholder = options.placeholder ?? "Todos";
  const searchPlaceholder = options.searchPlaceholder ?? "Pesquisar…";
  /** @type {Set<string>} */
  let selected = new Set();
  /** @type {MultiSelectItem[]} */
  let items = options.items ?? [];
  let query = "";
  let isOpen = false;
  let focusedIndex = -1;

  root.classList.add("msd-root");
  root.innerHTML = `
    <button type="button" class="msd-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="msd-trigger-leading" aria-hidden="true"></span>
      <span class="msd-trigger-label"></span>
      <span class="msd-trigger-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="msd-panel" hidden>
      <div class="msd-search-wrap">
        <input
          type="search"
          class="msd-search"
          placeholder="${escapeAttr(searchPlaceholder)}"
          autocomplete="off"
          spellcheck="false"
          aria-label="Pesquisar ${escapeAttr(options.label)}"
        />
      </div>
      <ul class="msd-list" role="listbox" aria-multiselectable="true"></ul>
      <div class="msd-empty" hidden>Nenhum resultado</div>
    </div>
  `;

  const trigger = root.querySelector(".msd-trigger");
  const leading = root.querySelector(".msd-trigger-leading");
  const triggerLabel = root.querySelector(".msd-trigger-label");
  const panel = root.querySelector(".msd-panel");
  const searchInput = root.querySelector(".msd-search");
  const list = root.querySelector(".msd-list");
  const emptyEl = root.querySelector(".msd-empty");

  /** @param {MouseEvent} event */
  function onDocumentClick(event) {
    if (!root.contains(/** @type {Node} */ (event.target))) close();
  }

  function itemText(item) {
    return item.label ?? item.value;
  }

  function getFilteredItems() {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => itemText(item).toLowerCase().includes(q));
  }

  function updateTriggerLabel() {
    if (!selected.size) {
      triggerLabel.textContent = placeholder;
      leading.textContent = "";
      leading.hidden = true;
      return;
    }

    leading.hidden = false;
    leading.textContent = String(selected.size);

    if (selected.size === 1) {
      const value = [...selected][0];
      const item = items.find((entry) => entry.value === value);
      triggerLabel.textContent = item?.label ?? item?.value ?? value;
      return;
    }

    triggerLabel.textContent = `${selected.size} selecionados`;
  }

  function renderList() {
    const filtered = getFilteredItems();
    const hasResults = filtered.length > 0;

    list.hidden = !hasResults;
    emptyEl.hidden = hasResults;

    list.innerHTML = filtered
      .map((item, index) => {
        const checked = selected.has(item.value);
        const text = itemText(item);
        return `
          <li
            class="msd-option${checked ? " is-selected" : ""}${index === focusedIndex ? " is-focused" : ""}"
            role="option"
            aria-selected="${checked}"
            data-value="${escapeAttr(item.value)}"
            data-index="${index}"
            tabindex="-1"
          >
            <span class="msd-option-checkbox" aria-hidden="true">
              <input type="checkbox" tabindex="-1" ${checked ? "checked" : ""} />
            </span>
            <span class="msd-option-label" title="${escapeAttr(text)}">${escapeHtml(text)}</span>
          </li>
        `;
      })
      .join("");

    updateTriggerLabel();
  }

  function open() {
    if (isOpen) return;
    if (openInstance && openInstance !== api) openInstance.close();
    isOpen = true;
    openInstance = api;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    query = "";
    searchInput.value = "";
    focusedIndex = getFilteredItems().length ? 0 : -1;
    renderList();
    // Defer so the opening click does not immediately close the panel
    queueMicrotask(() => {
      if (!isOpen) return;
      document.addEventListener("click", onDocumentClick);
      // preventScroll: wide/tall panels must not scroll the sidebar sideways on focus
      searchInput.focus({ preventScroll: true });
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (openInstance === api) openInstance = null;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    focusedIndex = -1;
    query = "";
    searchInput.value = "";
    document.removeEventListener("click", onDocumentClick);
    renderList();
  }

  function toggleOpen() {
    if (isOpen) close();
    else open();
  }

  /** @param {number} index */
  function focusOption(index) {
    const filtered = getFilteredItems();
    if (!filtered.length) {
      focusedIndex = -1;
      renderList();
      searchInput.focus({ preventScroll: true });
      return;
    }
    focusedIndex = Math.max(0, Math.min(index, filtered.length - 1));
    renderList();
    const option = list.querySelector(`[data-index="${focusedIndex}"]`);
    if (option instanceof HTMLElement) {
      option.focus({ preventScroll: true });
      option.scrollIntoView({ block: "nearest" });
    }
  }

  /** @param {string} value */
  function toggleValue(value) {
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    renderList();
    options.onChange?.();
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleOpen();
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) open();
      else if (event.key === "ArrowDown") focusOption(focusedIndex >= 0 ? focusedIndex : 0);
    } else if (event.key === "Escape") {
      close();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!isOpen) open();
      query = event.key;
      searchInput.value = event.key;
      focusedIndex = getFilteredItems().length ? 0 : -1;
      renderList();
      searchInput.focus({ preventScroll: true });
    }
  });

  searchInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    focusedIndex = getFilteredItems().length ? 0 : -1;
    renderList();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(getFilteredItems().length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const filtered = getFilteredItems();
      if (filtered.length) {
        const index = focusedIndex >= 0 ? focusedIndex : 0;
        toggleValue(filtered[index].value);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        query = "";
        searchInput.value = "";
        focusedIndex = getFilteredItems().length ? 0 : -1;
        renderList();
      } else {
        close();
        trigger.focus({ preventScroll: true });
      }
    }
  });

  list.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = event.target.closest(".msd-option");
    if (!option) return;
    toggleValue(option.dataset.value || "");
  });

  list.addEventListener("keydown", (event) => {
    const filtered = getFilteredItems();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(focusedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (focusedIndex <= 0) {
        focusedIndex = -1;
        renderList();
        searchInput.focus({ preventScroll: true });
      } else {
        focusOption(focusedIndex - 1);
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const option = event.target.closest(".msd-option");
      if (option) toggleValue(option.dataset.value || "");
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus({ preventScroll: true });
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(filtered.length - 1);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      searchInput.focus({ preventScroll: true });
      query = searchInput.value + event.key;
      searchInput.value = query;
      focusedIndex = getFilteredItems().length ? 0 : -1;
      renderList();
    }
  });

  /** @param {MultiSelectItem[]} nextItems */
  function setItems(nextItems) {
    const valid = new Set(nextItems.map((item) => item.value));
    items = nextItems;
    selected = new Set([...selected].filter((value) => valid.has(value)));
    if (focusedIndex >= getFilteredItems().length) {
      focusedIndex = getFilteredItems().length ? 0 : -1;
    }
    renderList();
  }

  const api = {
    /** @returns {string[]} */
    getValues() {
      return [...selected];
    },
    setItems,
    clear() {
      selected.clear();
      query = "";
      searchInput.value = "";
      renderList();
      options.onChange?.();
    },
    close,
    destroy() {
      close();
      root.innerHTML = "";
      root.classList.remove("msd-root", "is-open");
    },
  };

  root.dataset.msdLabel = options.label;
  trigger.setAttribute("aria-label", options.label);
  panel.setAttribute("aria-label", `${options.label} — opções`);
  renderList();
  return api;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

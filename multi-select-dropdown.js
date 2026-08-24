/** @typedef {{ value: string, label?: string }} MultiSelectItem */

let openInstance = null;

/**
 * @param {HTMLElement} root
 * @param {{
 *   label: string,
 *   placeholder?: string,
 *   items?: MultiSelectItem[],
 *   onChange?: () => void,
 * }} options
 */
export function createMultiSelectDropdown(root, options) {
  const placeholder = options.placeholder ?? "Todos";
  /** @type {Set<string>} */
  let selected = new Set();
  /** @type {MultiSelectItem[]} */
  let items = options.items ?? [];
  let isOpen = false;
  let focusedIndex = -1;

  root.classList.add("msd-root");
  root.innerHTML = `
    <button type="button" class="msd-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="msd-trigger-leading" aria-hidden="true"></span>
      <span class="msd-trigger-label"></span>
      <span class="msd-trigger-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="msd-panel" role="listbox" aria-multiselectable="true" hidden>
      <ul class="msd-list"></ul>
    </div>
  `;

  const trigger = root.querySelector(".msd-trigger");
  const leading = root.querySelector(".msd-trigger-leading");
  const triggerLabel = root.querySelector(".msd-trigger-label");
  const panel = root.querySelector(".msd-panel");
  const list = root.querySelector(".msd-list");

  /** @param {MouseEvent} event */
  function onDocumentClick(event) {
    if (!root.contains(/** @type {Node} */ (event.target))) close();
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
    list.innerHTML = items
      .map((item, index) => {
        const checked = selected.has(item.value);
        const text = item.label ?? item.value;
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
    focusedIndex = items.length ? 0 : -1;
    renderList();
    document.addEventListener("click", onDocumentClick);
    if (focusedIndex >= 0) focusOption(focusedIndex);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (openInstance === api) openInstance = null;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    focusedIndex = -1;
    document.removeEventListener("click", onDocumentClick);
    renderList();
  }

  function toggleOpen() {
    if (isOpen) close();
    else open();
  }

  /** @param {number} index */
  function focusOption(index) {
    if (!items.length) return;
    focusedIndex = Math.max(0, Math.min(index, items.length - 1));
    renderList();
    const option = list.querySelector(`[data-index="${focusedIndex}"]`);
    if (option instanceof HTMLElement) option.focus();
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
    }
  });

  list.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = event.target.closest(".msd-option");
    if (!option) return;
    toggleValue(option.dataset.value || "");
  });

  list.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(focusedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(focusedIndex - 1);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const option = event.target.closest(".msd-option");
      if (option) toggleValue(option.dataset.value || "");
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(items.length - 1);
    }
  });

  /** @param {MultiSelectItem[]} nextItems */
  function setItems(nextItems) {
    const valid = new Set(nextItems.map((item) => item.value));
    items = nextItems;
    selected = new Set([...selected].filter((value) => valid.has(value)));
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

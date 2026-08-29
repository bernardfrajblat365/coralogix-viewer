const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

/**
 * Desktop sidebar shell inspired by shadcn/ui sidebar (collapsible=icon).
 *
 * @param {{
 *   wrapper: HTMLElement,
 *   sidebar: HTMLElement,
 *   trigger?: HTMLElement | null,
 *   rail?: HTMLElement | null,
 *   defaultOpen?: boolean,
 *   onOpenChange?: (open: boolean) => void,
 *   autoExpandRoots?: HTMLElement[],
 * }} options
 */
export function createSidebar(options) {
  const { wrapper, sidebar, trigger = null, rail = null } = options;
  let open = options.defaultOpen ?? readCookieOpen() ?? true;

  function sync() {
    const state = open ? "expanded" : "collapsed";
    wrapper.dataset.state = state;
    sidebar.dataset.state = state;
    sidebar.dataset.collapsible = state === "collapsed" ? "icon" : "";
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(open));
      trigger.dataset.state = state;
    }
  }

  function persist(value) {
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }

  function setOpen(value) {
    open = Boolean(value);
    sync();
    persist(open);
    options.onOpenChange?.(open);
  }

  function toggle() {
    setOpen(!open);
  }

  trigger?.addEventListener("click", toggle);
  rail?.addEventListener("click", toggle);

  window.addEventListener("keydown", (event) => {
    if (
      event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      toggle();
    }
  });

  for (const root of options.autoExpandRoots ?? []) {
    root.addEventListener("pointerdown", () => {
      if (!open) setOpen(true);
    });
  }

  sync();

  return {
    toggle,
    setOpen,
    get open() {
      return open;
    },
  };
}

/** @returns {boolean | null} */
function readCookieOpen() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=(true|false)(?:;|$)`),
  );
  if (!match) return null;
  return match[1] === "true";
}

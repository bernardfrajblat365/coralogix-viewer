/**
 * Switch toggle inspired by beui.dev/components/motion/switch (vanilla JS).
 *
 * @param {HTMLElement} root
 * @param {{
 *   checked?: boolean,
 *   onCheckedChange?: (checked: boolean) => void,
 *   disabled?: boolean,
 *   label?: string,
 *   ariaLabel?: string,
 * }} options
 */
export function createSwitch(root, options = {}) {
  let checked = options.checked ?? false;
  let disabled = options.disabled ?? false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.classList.add("switch-root");
  const trackId = `switch-${Math.random().toString(36).slice(2, 9)}`;
  root.innerHTML = `
    <button type="button" class="switch-track" role="switch" id="${trackId}">
      <div class="switch-thumb">
        <div class="switch-thumb-stretch"></div>
      </div>
    </button>
  `;

  const track = root.querySelector(".switch-track");
  const thumb = root.querySelector(".switch-thumb");
  const stretch = root.querySelector(".switch-thumb-stretch");
  /** @type {HTMLLabelElement | null} */
  let labelEl = null;

  if (options.label) {
    labelEl = document.createElement("label");
    labelEl.className = "switch-label";
    labelEl.htmlFor = trackId;
    labelEl.textContent = options.label;
    root.appendChild(labelEl);
  }

  let isPressed = false;
  let isPointer = false;

  function syncUi() {
    track.dataset.state = checked ? "checked" : "unchecked";
    track.setAttribute("aria-checked", String(checked));
    track.disabled = disabled;
    if (options.ariaLabel) track.setAttribute("aria-label", options.ariaLabel);
  }

  function setSquish(active) {
    if (reduceMotion || disabled || !isPointer) {
      thumb.classList.remove("is-squish");
      stretch.classList.remove("is-squish-checked", "is-squish-unchecked");
      return;
    }

    thumb.classList.toggle("is-squish", active);
    stretch.classList.toggle("is-squish-checked", active && checked);
    stretch.classList.toggle("is-squish-unchecked", active && !checked);
  }

  function runDisabledShake() {
    if (reduceMotion || !disabled || !isPressed || !stretch) return;
    stretch.animate(
      [
        { marginLeft: "0px" },
        { marginLeft: "-2px" },
        { marginLeft: "2px" },
        { marginLeft: "-1px" },
        { marginLeft: "0px" },
      ],
      { delay: 200, duration: 600, easing: "ease-in-out" },
    );
  }

  track.addEventListener("click", () => {
    if (disabled) return;
    checked = !checked;
    syncUi();
    options.onCheckedChange?.(checked);
  });

  track.addEventListener("pointerdown", (event) => {
    isPressed = true;
    isPointer = event.pointerType !== "";
    setSquish(true);
    runDisabledShake();
  });

  function releasePointer() {
    isPressed = false;
    setSquish(false);
  }

  track.addEventListener("pointerup", releasePointer);
  track.addEventListener("pointerleave", releasePointer);
  track.addEventListener("pointercancel", releasePointer);

  if (labelEl) {
    labelEl.addEventListener("click", () => {
      if (disabled) return;
      checked = !checked;
      syncUi();
      options.onCheckedChange?.(checked);
    });
  }

  syncUi();

  return {
    get checked() {
      return checked;
    },
    setChecked(value) {
      checked = Boolean(value);
      syncUi();
    },
    setDisabled(value) {
      disabled = Boolean(value);
      syncUi();
    },
  };
}

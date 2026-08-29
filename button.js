/** @typedef {"primary" | "secondary" | "ghost" | "outline"} ButtonVariant */
/** @typedef {"sm" | "md" | "lg" | "icon"} ButtonSize */

const VARIANT_CLASS = {
  primary: "motion-btn--primary",
  secondary: "motion-btn--secondary",
  ghost: "motion-btn--ghost",
  outline: "motion-btn--outline",
};

const SIZE_CLASS = {
  sm: "motion-btn--sm",
  md: "motion-btn--md",
  lg: "motion-btn--lg",
  icon: "motion-btn--icon",
};

/**
 * Button inspired by beui.dev/components/motion/button (vanilla JS).
 *
 * @param {HTMLElement} root
 * @param {{
 *   variant?: ButtonVariant,
 *   size?: ButtonSize,
 *   label?: string,
 *   disabled?: boolean,
 *   pressScale?: number,
 *   onClick?: (event: MouseEvent) => void,
 * }} options
 */
export function createButton(root, options = {}) {
  const variant = options.variant ?? "primary";
  const size = options.size ?? "md";
  const pressScale = options.pressScale ?? 0.93;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["motion-btn", VARIANT_CLASS[variant], SIZE_CLASS[size]].join(" ");
  button.textContent = options.label ?? "";
  button.disabled = options.disabled ?? false;
  button.style.setProperty("--motion-btn-press-scale", String(pressScale));

  if (!reduceMotion) {
    button.addEventListener("pointerdown", () => {
      if (button.disabled) return;
      button.classList.add("is-pressed");
    });

    const release = () => button.classList.remove("is-pressed");
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("pointercancel", release);
  }

  if (options.onClick) {
    button.addEventListener("click", options.onClick);
  }

  root.appendChild(button);

  return {
    button,
    setDisabled(value) {
      button.disabled = Boolean(value);
    },
    setLabel(text) {
      button.textContent = text;
    },
  };
}

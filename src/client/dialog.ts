import { message } from "./text.ts";

// The page renders one <dialog id="confirm-dialog">; both browser bundles share it.
export function confirmDialog(
  question: string,
  options: { confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const dialog = document.getElementById("confirm-dialog");
  if (!(dialog instanceof HTMLDialogElement)) return Promise.resolve(false);
  const text = dialog.querySelector("[data-dialog-message]");
  const accept = dialog.querySelector<HTMLButtonElement>("button[value=confirm]");
  if (text) text.textContent = question;
  if (accept) {
    accept.textContent = options.confirmLabel ?? message("confirmAction");
    accept.classList.toggle("danger-solid", options.danger ?? false);
    accept.classList.toggle("primary", !(options.danger ?? false));
  }
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
      once: true,
    });
  });
}

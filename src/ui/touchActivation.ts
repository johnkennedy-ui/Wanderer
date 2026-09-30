/**
 * Complete a touch action at primary pointer release, before an incidental
 * overlay can prevent the browser's paired synthetic click. Mouse and keyboard
 * activation continue through the ordinary click handler.
 */
export const attachTouchSafeActivation = (
  button: HTMLButtonElement,
  activate: () => void,
): (() => void) => {
  let suppressNextClick = false;
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0)
      return;
    suppressNextClick = true;
    activate();
    setTimeout(() => {
      suppressNextClick = false;
    }, 0);
  };
  const onClick = (): void => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    activate();
  };
  button.addEventListener("pointerup", onPointerUp);
  button.addEventListener("click", onClick);
  return () => {
    button.removeEventListener("pointerup", onPointerUp);
    button.removeEventListener("click", onClick);
  };
};

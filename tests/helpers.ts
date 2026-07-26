/**
 * jsdom has no layout engine, so `getBoundingClientRect` always returns zeros.
 * Every test that depends on geometry stubs it through here.
 */
export function stubRect(
  el: HTMLElement,
  box: { width: number; height: number; top?: number; left?: number },
): void {
  const top = box.top ?? 0;
  const left = box.left ?? 0;

  el.getBoundingClientRect = () =>
    ({
      width: box.width,
      height: box.height,
      top,
      left,
      right: left + box.width,
      bottom: top + box.height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Rect that follows whatever inline pixel width/height the element currently has. */
export function stubLiveRect(el: HTMLElement, fallback: { width: number; height: number }): void {
  const px = (value: string, fallbackValue: number) =>
    value.endsWith('px') ? parseFloat(value) : fallbackValue;

  el.getBoundingClientRect = () => {
    const width = px(el.style.width, fallback.width);
    const height = px(el.style.height, fallback.height);
    return {
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

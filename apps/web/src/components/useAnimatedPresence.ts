import { useEffect, useState } from 'react';

/** Keeps popovers mounted for a short exit transition instead of disappearing abruptly. */
export function useAnimatedPresence(open: boolean, duration = 180) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let timer: number | undefined;
    let frame: number | undefined;
    if (open) {
      setMounted(true);
      frame = window.requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), duration);
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [open, duration]);

  return { mounted, visible };
}

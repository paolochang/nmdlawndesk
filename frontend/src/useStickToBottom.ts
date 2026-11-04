import { useEffect, useRef, type DependencyList } from 'react';

const NEAR_BOTTOM_PX = 48;

/**
 * Keeps a scrolling list at its newest item when `deps` change, but only while
 * the reader is already near the bottom, so scrolling up to read is not undone.
 */
export function useStickToBottom<T extends HTMLElement>(deps: DependencyList) {
  const ref = useRef<T>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (atBottom.current) ref.current?.scrollTo({ top: ref.current.scrollHeight });
    // The caller's deps decide when new content arrived.
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return ref;
}

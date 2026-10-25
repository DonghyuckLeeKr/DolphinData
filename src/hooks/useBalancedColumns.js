import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseDashboardColumns } from '../utils/dashboardLayout';

// Measures each dashboard card and splits them into two columns of similar height.
// Heights are rounded to 20px so a ticking number or chart redraw never re-triggers layout.
export default function useBalancedColumns(cardIds) {
  const [heights, setHeights] = useState({});
  const previousRef = useRef(null);
  const observersRef = useRef(new Map());

  const refCallbacksRef = useRef(new Map());

  // One stable ref callback per card, so re-renders do not reattach observers every second.
  const measureRef = useCallback(id => {
    if (!refCallbacksRef.current.has(id)) {
      refCallbacksRef.current.set(id, element => {
        observersRef.current.get(id)?.disconnect();
        observersRef.current.delete(id);
        if (!element || typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(([entry]) => {
          const height = Math.round(entry.contentRect.height / 20) * 20;
          setHeights(previous => (previous[id] === height ? previous : { ...previous, [id]: height }));
        });
        observer.observe(element);
        observersRef.current.set(id, observer);
      });
    }
    return refCallbacksRef.current.get(id);
  }, []);

  useEffect(() => () => {
    observersRef.current.forEach(observer => observer.disconnect());
    observersRef.current.clear();
  }, []);

  const columns = chooseDashboardColumns(cardIds, heights, previousRef.current);
  previousRef.current = columns;
  return { columns, measureRef };
}

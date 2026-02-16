import { useEffect, useRef, useState } from "react";

export interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number; // Distance in pixels before triggering refresh (default: 80)
  resistance?: number; // Resistance factor for pull distance (default: 2.5)
}

export interface PullToRefreshState {
  isPulling: boolean;
  pullDistance: number;
  isRefreshing: boolean;
}

/**
 * Hook that implements pull-to-refresh gesture for touch devices.
 * Provides a familiar iPhone UX pattern for refreshing list views.
 */
export function usePullToRefresh<T extends HTMLElement = HTMLElement>(
  options: PullToRefreshOptions
): PullToRefreshState & { containerRef: React.RefObject<T> } {
  const { onRefresh, threshold = 80, resistance = 2.5 } = options;
  
  const containerRef = useRef<T>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const touchStartY = useRef(0);
  const initialScrollTop = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (event: TouchEvent): void => {
      // Only start if we're at the top of the scroll
      if (container.scrollTop === 0) {
        touchStartY.current = event.touches[0].clientY;
        initialScrollTop.current = container.scrollTop;
      }
    };

    const handleTouchMove = (event: TouchEvent): void => {
      if (isRefreshing) return;

      const currentY = event.touches[0].clientY;
      const deltaY = currentY - touchStartY.current;

      // Only allow pull down when at top
      if (container.scrollTop === 0 && deltaY > 0) {
        event.preventDefault();
        
        // Apply resistance to make pull feel natural
        const distance = deltaY / resistance;
        setPullDistance(distance);
        setIsPulling(true);
      }
    };

    const handleTouchEnd = async (): Promise<void> => {
      if (isRefreshing) return;

      if (pullDistance >= threshold) {
        setIsRefreshing(true);
        setPullDistance(threshold);
        
        try {
          await onRefresh();
        } finally {
          setTimeout(() => {
            setIsRefreshing(false);
            setPullDistance(0);
            setIsPulling(false);
          }, 300); // Small delay for visual feedback
        }
      } else {
        setPullDistance(0);
        setIsPulling(false);
      }

      touchStartY.current = 0;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pullDistance, threshold, resistance, onRefresh, isRefreshing]);

  return {
    containerRef,
    isPulling,
    pullDistance,
    isRefreshing
  };
}

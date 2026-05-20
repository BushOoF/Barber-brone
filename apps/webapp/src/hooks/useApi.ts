import { useEffect, useState, useCallback, useRef } from "react";

type Status = "idle" | "loading" | "success" | "error";

export interface UseApiOptions {
  /**
   * Re-run the fetcher when the document becomes visible again or the window
   * regains focus. Default true — so a Mini App that's been backgrounded picks
   * up server-side changes (e.g. admin updates prices) as soon as the user
   * returns to it.
   */
  revalidateOnFocus?: boolean;
}

export interface UseApi<T> {
  data: T | null;
  error: Error | null;
  status: Status;
  refetch: () => Promise<void>;
}

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], opts: UseApiOptions = {}): UseApi<T> {
  const { revalidateOnFocus = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setStatus((prev) => (prev === "success" ? prev : "loading"));
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setStatus("success");
    } catch (err) {
      setError(err as Error);
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  // Re-fetch when the tab regains visibility/focus so cached views catch up to
  // server-side changes (e.g. admin updating prices in another session).
  useEffect(() => {
    if (!revalidateOnFocus) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    const onFocus = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [revalidateOnFocus, run]);

  return { data, error, status, refetch: run };
}

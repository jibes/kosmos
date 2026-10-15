import { useCallback, useEffect, useState } from 'react';
import { isNative } from './native';
import { UpdateToast } from './UpdateToast';

export interface Toast {
  text: string;
  /** Buttons in the note: a choice to make now, gone with the note. */
  actions?: { label: string; run: () => void }[];
}

/** One short note at a time, gone after long enough to read it. */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback(
    (text: string, actions?: Toast['actions']) => setToast({ text, actions }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    // Long enough to read: a short note goes quickly, a sentence stays a while, a choice longer.
    const ms = Math.max(toast.actions ? 6000 : 2200, toast.text.length * 70);
    const id = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, [toast]);
  return { toast, showToast, dismiss: useCallback(() => setToast(null), []) };
}

/** The app's note and the web update offer, stacked in one place instead of on each other. */
export function Toasts({
  toast,
  dismiss,
  guiding,
}: {
  toast: Toast | null;
  dismiss: () => void;
  guiding: boolean;
}) {
  return (
    // Always there, so screen readers announce a note as it appears.
    <div className="toasts" role="status">
      {!isNative && <UpdateToast hidden={guiding} />}
      {toast && (
        <div className="toast surface">
          <span>{toast.text}</span>
          {toast.actions?.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                dismiss();
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

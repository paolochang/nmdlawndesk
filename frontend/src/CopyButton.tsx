import { useEffect, useState } from 'react';

/** Copies `text` to the clipboard and says so for a moment (owner request, build-plan §17). */
export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      className={`copy-btn ${className}`.trim()}
      disabled={!text}
      onClick={() => navigator.clipboard.writeText(text).then(() => setState('copied'), () => setState('failed'))}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}

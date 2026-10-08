import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import { HAND_TAG } from '@/lib/page-segments';
import { openVideo, type FrameCheck, type VideoSource } from '@/lib/video-processing';

export type PickedFrame = { dataUrl: string; width: number; height: number; timestamp: number; clarity: number; hand: number };

const THUMBS = 24;
// The picker also shows this much (seconds) either side of the page's own stretch: a hand or a
// wobble can split one page into two short views, and the clear moment may sit just outside.
const PAD = 0.75;
const pct = (value: number) => `${Math.round(value * 100)}%`;

// Lets the user look through every moment of one page's stretch of video and choose the frame to
// use: a strip of frames with their clarity and a hand tag, plus a slider for fine control.
export function FramePicker({
  file,
  range,
  current,
  eyebrow,
  heading,
  confirmLabel,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  file: Blob;
  range: { from: number; to: number };
  // The moment in use now (marked in the strip), if it came from this video.
  current: number | null;
  eyebrow: string;
  heading: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (frame: PickedFrame) => void;
}) {
  const sourceRef = useRef<VideoSource | null>(null);
  // Every seek goes through this queue: the scan and the user's picks share one video element.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const requestRef = useRef(0);
  const [checks, setChecks] = useState<FrameCheck[]>([]);
  const [scanned, setScanned] = useState(0);
  const [span, setSpan] = useState({ from: Math.max(0, range.from - PAD), to: range.to + PAD });
  const [time, setTime] = useState(current ?? range.from);
  const [preview, setPreview] = useState<PickedFrame | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const enqueue = <T,>(task: () => Promise<T>) => {
    const next = queueRef.current.then(task, task);
    queueRef.current = next.catch(() => undefined);
    return next;
  };

  const show = (timestamp: number) => {
    const request = ++requestRef.current;
    void enqueue(async () => {
      // A newer request is waiting: skip this one (the slider fires many).
      const source = sourceRef.current;
      if (!source || request !== requestRef.current) return;
      const image = await source.capture(timestamp);
      const { clarity, hand } = await source.check(timestamp);
      if (request === requestRef.current) setPreview({ ...image, timestamp, clarity, hand });
    }).catch(() => setLoadError('This moment of the video could not be read.'));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const source = await openVideo(file);
        if (cancelled) {
          source.close();
          return;
        }
        sourceRef.current = source;
        const wide = { from: Math.max(0, range.from - PAD), to: Math.min(source.duration, range.to + PAD) };
        setSpan(wide);
        show(current ?? range.from);
        const found = await enqueue(() => source.scan(wide.from, wide.to, THUMBS, (done) => !cancelled && setScanned(done)));
        if (!cancelled) setChecks(found);
      } catch {
        if (!cancelled) setLoadError('The video could not be opened again. Try choosing it from the start.');
      }
    })();
    return () => {
      cancelled = true;
      requestRef.current += 1;
      void queueRef.current.then(() => sourceRef.current?.close());
    };
    // The picker is opened for one page at a time and remounted for another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const choose = (timestamp: number) => {
    setTime(timestamp);
    show(timestamp);
  };

  const score = (check: FrameCheck) => check.clarity - 3 * check.hand;
  // Frames in the padding may already show the next page, so only the page's own stretch is
  // recommended; the padding is there for the user to look at.
  const inside = (check: FrameCheck) => check.timestamp >= range.from - 0.05 && check.timestamp <= range.to + 0.05;
  const ownChecks = checks.some(inside) ? checks.filter(inside) : checks;
  const clearest = ownChecks.length ? ownChecks.reduce((best, check) => (score(check) > score(best) ? check : best)) : null;
  const nearest = (target: number | null) =>
    target === null || !checks.length
      ? null
      : checks.reduce((best, check) => (Math.abs(check.timestamp - target) < Math.abs(best.timestamp - target) ? check : best));
  const inUse = nearest(current);
  const selected = nearest(time);
  const ready = preview !== null && Math.abs(preview.timestamp - time) < 1e-6;
  // A single frame cannot tell how much paper a hand hides (that needs its neighbours), so the
  // preview borrows the scanned strip's measure for the same moment.
  const near = preview ? nearest(preview.timestamp) : null;
  const previewHand = preview ? Math.max(preview.hand, near && Math.abs(near.timestamp - preview.timestamp) <= 0.12 ? near.hand : 0) : 0;

  return (
    <div className="recording-overlay picker-overlay" data-testid="modal-frame-picker">
      <div className="picker-modal" role="dialog" aria-modal="true" aria-labelledby="picker-heading">
        <div className="picker-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="picker-heading">{heading}</h2>
          </div>
          <button className="picker-close" onClick={onCancel} disabled={busy} aria-label="Close" data-testid="button-close-picker">
            <X size={17} />
          </button>
        </div>

        <div className="picker-preview">
          {preview ? <img src={preview.dataUrl} alt={`Frame at ${preview.timestamp.toFixed(1)} seconds`} /> : <LoaderCircle className="picker-spin" size={22} />}
          {preview && (
            <div className="picker-tags">
              <span className="frame-tag">{preview.timestamp.toFixed(2)} s · {pct(preview.clarity)} clarity</span>
              {previewHand >= HAND_TAG && <span className="frame-tag frame-tag-hand">hand in view</span>}
            </div>
          )}
          {busy && (
            <div className="patch-busy">
              <LoaderCircle size={22} />
              reading this frame…
            </div>
          )}
        </div>

        <label className="picker-slider">
          <span>{span.from.toFixed(1)} s</span>
          <input
            type="range"
            min={span.from}
            max={span.to}
            step={1 / 30}
            value={time}
            disabled={busy}
            onChange={(event) => choose(Number(event.target.value))}
            aria-label="Move through this page's part of the video"
            data-testid="slider-frame-time"
          />
          <span>{span.to.toFixed(1)} s</span>
        </label>

        <div className="picker-strip" aria-label="Frames of this page">
          {!checks.length && !loadError && <p className="picker-scanning">checking frames… {scanned ? `${scanned} looked at` : ''}</p>}
          {checks.map((check, index) => (
            <button
              key={check.timestamp}
              className={`picker-thumb${check === selected ? ' picker-thumb-selected' : ''}${inside(check) ? '' : ' picker-thumb-outside'}`}
              onClick={() => choose(check.timestamp)}
              disabled={busy}
              aria-label={`Frame at ${check.timestamp.toFixed(1)} seconds, ${pct(check.clarity)} clarity${check.hand >= HAND_TAG ? ', hand in view' : ''}`}
              data-testid={`picker-thumb-${index + 1}`}
            >
              <img src={check.thumb} alt="" />
              <span className="picker-thumb-meta">
                {pct(check.clarity)}
                {check.hand >= HAND_TAG && <span className="picker-hand-dot" title="hand in view" />}
              </span>
              {check === clearest && <span className="picker-badge">clearest</span>}
              {check === inUse && check !== clearest && <span className="picker-badge picker-badge-quiet">in use</span>}
            </button>
          ))}
        </div>

        {(loadError || error) && <p className="patch-error picker-error" role="alert">{loadError ?? error}</p>}

        <div className="recording-actions">
          <button className="button button-quiet" onClick={onCancel} disabled={busy} data-testid="button-cancel-picker">keep the current one</button>
          <button
            className="button button-primary"
            onClick={() => preview && onConfirm({ ...preview, hand: previewHand })}
            disabled={!ready || busy}
            data-testid="button-use-frame"
          >
            <Check size={16} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

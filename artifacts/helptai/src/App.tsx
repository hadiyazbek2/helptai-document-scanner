import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleStop,
  FileText,
  Film,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  Presentation,
  ScanLine,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { downloadDocx, downloadPdf, downloadPptx } from '@/lib/export';
import type { ProcessDocumentResult, ProcessPageResult, Usage } from '@helptai/api-client-react';
import { FramePicker, type PickedFrame } from '@/components/frame-picker';
import { PageReplica } from '@/components/page-replica';
import { applyPatch, buildDoc, type Doc, type Page } from '@/lib/doc-model';
import { prepareImage } from '@/lib/image';
import { HAND_TAG } from '@/lib/page-segments';
import { selectVideoFrames, type SelectedFrame, type SelectionStats } from '@/lib/video-processing';

type View = 'home' | 'frames' | 'processing' | 'review' | 'patch';

// Which model and key answered each request, and how long it took. Shown while developing; set
// VITE_SHOW_DEV_INFO=false to hide it (or =true to show it in a production build).
const SHOW_DEV_INFO = import.meta.env.VITE_SHOW_DEV_INFO ? import.meta.env.VITE_SHOW_DEV_INFO === 'true' : import.meta.env.DEV;
type RequestInfo = { label: string; usage: Usage };

function DevInfo({ requests }: { requests: RequestInfo[] }) {
  if (!SHOW_DEV_INFO || !requests.length) return null;
  const n = (value: number) => value.toLocaleString('en-US');
  return (
    <details className="dev-info" open data-testid="panel-dev-info">
      <summary>developer info</summary>
      {requests.map(({ label, usage }, index) => (
        <div className="dev-info-request" key={index}>
          <strong>{label}</strong>
          <span>
            {usage.model} · key {usage.keyIndex ?? '?'} · {usage.seconds !== undefined ? `${usage.seconds.toFixed(1)} s` : '–'} · tokens in {n(usage.inputTokens)} / out {n(usage.outputTokens)} / thinking {n(usage.thinkingTokens)}
          </span>
          {usage.attempts && usage.attempts.length > 1 && (
            <span className="dev-info-tries">
              tries: {usage.attempts.map((a) => `${a.model.replace(/^gemini-/, '')} key ${a.key} ${a.outcome} ${a.seconds.toFixed(1)} s`).join(' → ')}
            </span>
          )}
        </div>
      ))}
    </details>
  );
}
type ToastTone = 'sage' | 'amber';
function Mark() {
  return (
    <span className="mark" aria-label="helptai mark" data-testid="brand-mark">
      <svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <rect x="32" y="18" width="46" height="60" rx="4" stroke="currentColor" strokeWidth="3" />
        <rect x="41" y="34" width="26" height="3" rx="1.5" fill="currentColor" />
        <rect x="41" y="45" width="26" height="3" rx="1.5" fill="currentColor" />
        <rect x="41" y="56" width="18" height="3" rx="1.5" fill="currentColor" />
        <circle cx="22" cy="26" r="3" fill="currentColor" />
        <circle cx="22" cy="38" r="3" fill="currentColor" />
        <circle cx="22" cy="50" r="3" fill="currentColor" />
        <circle cx="22" cy="62" r="3" fill="currentColor" />
        <circle cx="22" cy="74" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}

function BrandHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className="topbar">
      <button className="quiet-link" onClick={onReset} data-testid="button-reset-home" aria-label="Return to home">
        <Mark />
        <span className="brand-wordmark">help<span>tai</span></span>
      </button>
      <button className="quiet-link" onClick={onReset} data-testid="button-start-over">
        <ScanLine size={15} />
        start over
      </button>
    </header>
  );
}

function Toast({ message, tone }: { message: string; tone: ToastTone }) {
  return (
    <div className="toast-message" data-testid="status-toast" role="status">
      {tone === 'sage' ? <Check size={16} color="#55724f" /> : <Sparkles size={16} color="#93602e" />}
      <span>{message}</span>
    </div>
  );
}

function HomeView({
  onCamera,
  onFile,
  recentName,
}: {
  onCamera: () => void;
  onFile: (file: File) => void;
  recentName: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <section className="hero" data-testid="section-landing-hero">
        <span className="eyebrow">a patient scanning companion</span>
        <h1>One scroll.<br /><em>A clean document.</em></h1>
        <p className="hero-copy">
          Record yourself moving through a bound book or document. helptai finds the clearest frame for every page and gives you one calm next step when a page needs attention.
        </p>
      </section>

      <section className="capture-layout" aria-label="Start a document">
        <div className="capture-card" data-testid="card-start-capture">
          <div className="capture-card-inner">
            <div>
              <span className="eyebrow" style={{ color: 'rgba(247,243,236,.76)' }}>begin here</span>
              <h2>Show us the pages, not the perfect footage.</h2>
              <p>A single continuous video is enough. Keep moving at an easy pace.</p>
            </div>
            <div className="capture-actions">
              <button className="button button-light" onClick={onCamera} data-testid="button-start-camera">
                <Video size={16} />
                record with camera
              </button>
              <button className="button button-primary" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-video">
                <Upload size={16} />
                choose a video
              </button>
              <input
                ref={fileInputRef}
                className="hidden-input"
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                  event.target.value = '';
                }}
                data-testid="input-video-file"
              />
            </div>
          </div>
        </div>

        <div className="mini-steps" data-testid="card-how-it-works">
          <div className="step-item"><span className="step-no">01</span><span>Capture the whole thing in one pass.</span></div>
          <div className="step-item"><span className="step-no">02</span><span>We find, sort, and straighten pages.</span></div>
          <div className="step-item"><span className="step-no">03</span><span>Review one gentle flag, then export.</span></div>
        </div>
      </section>

      <section className="recent-section" aria-labelledby="recent-heading">
        <div className="section-heading">
          <h2 className="section-title" id="recent-heading">recently made</h2>
          <span className="section-kicker">kept on this device</span>
        </div>
        {recentName ? (
          <div className="recent-card" data-testid="card-recent-document">
            <div className="recent-icon"><FileText size={17} /></div>
            <div className="recent-meta">
              <div className="recent-name" data-testid="text-recent-document-name">{recentName}</div>
              <div className="recent-time">just now · 12 pages</div>
            </div>
            <span className="status-done" data-testid="status-recent-ready">ready</span>
          </div>
        ) : (
          <div className="recent-card" data-testid="empty-recent-documents">
            <div className="recent-icon"><FolderOpen size={17} /></div>
            <div className="recent-meta">
              <div className="recent-name">your next document will live here</div>
              <div className="recent-time">nothing saved yet</div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function ProcessingView({
  documentName,
  status,
  error,
  onRetry,
  onReset,
}: {
  documentName: string;
  status: string;
  error: string | null;
  onRetry: (() => void) | null;
  onReset: () => void;
}) {
  return (
    <main className="processing-shell" data-testid="view-processing">
      <div className="processing-orbit" aria-hidden="true">
        {error ? <X size={25} /> : <LoaderCircle size={25} />}
      </div>
      <span className="eyebrow">{error ? 'the capture needs another try' : 'quietly putting it in order'}</span>
      <h1>{error ? 'We could not finish.' : 'Finding the pages.'}</h1>
      <p>
        {error ?? 'helptai is looking for clear edges, readable text, and the natural order of your capture. You can leave this screen open.'}
      </p>
      <div className="progress-track" aria-label="Processing document" data-testid="progress-processing">
        <div className={`progress-fill${error ? ' progress-error' : ''}`} />
      </div>
      <span className="processing-note"><Film size={12} /> {status || documentName}</span>
      {error && (
        <div className="processing-error-actions">
          {onRetry && <button className="button button-primary" onClick={onRetry} data-testid="button-processing-retry">try again</button>}
          <button className="button button-quiet" style={{ marginTop: '1rem' }} onClick={onReset} data-testid="button-processing-reset">start over</button>
        </div>
      )}
    </main>
  );
}

function FrameReviewView({
  documentName,
  frames,
  stats,
  onPick,
  onContinue,
  onReset,
}: {
  documentName: string;
  frames: SelectedFrame[];
  stats: SelectionStats | null;
  // Opens the frame picker for one frame; missing when the video is no longer available.
  onPick: ((index: number) => void) | null;
  onContinue: () => void;
  onReset: () => void;
}) {
  const withHand = frames.filter((frame) => frame.hand >= HAND_TAG).length;
  return (
    <main className="frame-review-page" data-testid="view-frame-review">
      <div className="frame-review-header">
        <div>
          <span className="eyebrow">a clear look before reconstruction</span>
          <h1>These are the frames we kept.</h1>
          <p>
            helptai found where each page starts and ends, and kept the clearest frame of each, on this device. Nothing has been sent for text extraction yet.
            {withHand > 0 && onPick && ` ${withHand === 1 ? 'One frame has' : `${withHand} frames have`} a hand in view: tap “choose another frame” to look for a clearer one.`}
          </p>
        </div>
        <span className="frame-count" data-testid="text-selected-frame-count">{frames.length} best frames</span>
      </div>
      <div className="frame-review-grid" aria-label={`Best frames from ${documentName}`}>
        {frames.map((frame, index) => (
          <figure className="chosen-frame" key={`${frame.timestamp}-${index}`} data-testid={`selected-frame-${index + 1}`}>
            <img src={frame.dataUrl} alt={`Selected document frame ${index + 1}`} />
            {(frame.hand >= HAND_TAG || frame.picked) && (
              <div className="frame-tags">
                {frame.hand >= HAND_TAG && <span className="frame-tag frame-tag-hand" data-testid={`tag-hand-${index + 1}`}>hand in view</span>}
                {frame.picked && <span className="frame-tag frame-tag-picked">your choice</span>}
              </div>
            )}
            <figcaption>
              <strong>candidate {String(index + 1).padStart(2, '0')}</strong>
              <span>page view {String(frame.view + 1).padStart(2, '0')}{frame.extra ? ' · extra frame' : ''} · {frame.timestamp.toFixed(1)}s · {Math.round(frame.sharpness * 100)}% clarity</span>
              {onPick && (
                <button className="frame-change" onClick={() => onPick(index)} data-testid={`button-change-frame-${index + 1}`}>
                  choose another frame
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {stats && (
        <p className="frame-stats" data-testid="text-selection-stats">
          read a {stats.videoSeconds.toFixed(0)} s video ({stats.width}×{stats.height}) in {stats.seconds.toFixed(1)} s · {stats.samples} moments checked · {stats.views} page views · {stats.method}
        </p>
      )}
      <div className="frame-review-actions">
        <button className="button button-primary" onClick={onContinue} data-testid="button-continue-frame-review">
          <Sparkles size={16} />
          reconstruct from these frames
          <ArrowRight size={15} />
        </button>
        <button className="button button-quiet" onClick={onReset} data-testid="button-reset-frame-review">choose another video</button>
      </div>
    </main>
  );
}

function DocumentSheet({ page }: { page: Page | null }) {
  return (
    <div className="document-sheet" data-testid="preview-document-sheet">
      <div className="sheet-content">
        <div className="sheet-topline"><span>reconstructed page</span><span>page {String(page?.pageNumber ?? 1).padStart(2, '0')}{page?.retakes ? ' · retaken' : ''}</span></div>
        {page ? (
          <div className="page-compare">
            <div className="compare-pane">
              <p className="compare-label">your photo</p>
              <img className="sheet-image" src={page.image} alt={`Original photo of page ${page.pageNumber}`} />
            </div>
            <div className="compare-pane">
              <p className="compare-label">rebuilt page</p>
              <PageReplica page={page} />
            </div>
          </div>
        ) : null}
        {page?.text && (
          <details className="sheet-plain">
            <summary>plain text</summary>
            <p className="sheet-text">{page.text}</p>
          </details>
        )}
      </div>
      <span className="sheet-foot">helptai · reconstructed · {Math.round((page?.confidence ?? 0) * 100)}% confidence</span>
    </div>
  );
}

function ExportPanel({ onExport }: { onExport: (format: string) => void }) {
  return (
    <section className="export-panel" aria-labelledby="export-heading">
      <h2 id="export-heading">take it with you</h2>
      <div className="export-list">
        <button className="export-button" onClick={() => onExport('PDF')} data-testid="button-export-pdf">
          <span className="export-icon"><FileText size={16} /></span>
          <span className="export-copy"><span className="export-name">PDF</span><span className="export-desc">a tidy, fixed copy</span></span>
          <ChevronRight size={15} color="hsl(var(--muted-foreground))" />
        </button>
        <button className="export-button" onClick={() => onExport('Word')} data-testid="button-export-word">
          <span className="export-icon"><FileText size={16} /></span>
          <span className="export-copy"><span className="export-name">Word</span><span className="export-desc">keep editing the text</span></span>
          <ChevronRight size={15} color="hsl(var(--muted-foreground))" />
        </button>
        <button className="export-button" onClick={() => onExport('PowerPoint')} data-testid="button-export-powerpoint">
          <span className="export-icon"><Presentation size={16} /></span>
          <span className="export-copy"><span className="export-name">PowerPoint</span><span className="export-desc">one page per slide</span></span>
          <ChevronRight size={15} color="hsl(var(--muted-foreground))" />
        </button>
      </div>
    </section>
  );
}

function ReviewView({
  documentName,
  analysis,
  selectedPageNumber,
  onSelectPage,
  onPatch,
  onPickFrame,
  onExport,
  requests,
}: {
  documentName: string;
  analysis: Doc;
  selectedPageNumber: number;
  onSelectPage: (pageNumber: number) => void;
  onPatch: (pageNumber: number) => void;
  // Opens the frame picker for a page; missing when the video is no longer available.
  onPickFrame: ((pageNumber: number) => void) | null;
  onExport: (format: string) => void;
  requests: RequestInfo[];
}) {
  const selectedPage = analysis.pages.find((page) => page.pageNumber === selectedPageNumber) ?? analysis.pages[0] ?? null;
  const flagged = analysis.pages.filter((page) => page.status === 'needs-review');
  const retaken = analysis.pages.filter((page) => page.retakes > 0 && page.status !== 'needs-review');
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <main className="review-page" data-testid="view-review">
      <div className="review-header">
        <div>
          <span className="eyebrow">document ready</span>
          <h1>{documentName}</h1>
          <p>{analysis.pages.length} pages found · {analysis.selectedFrameCount} clear frames kept from your capture</p>
        </div>
        <span className="ready-badge" data-testid="status-document-ready"><Check size={13} /> ready</span>
      </div>
      <div className="review-grid">
        <div>
          <div className="thumb-strip" aria-label="Document pages">
            {analysis.pages.map((page) => (
              <button
                className={`thumb${page.pageNumber === selectedPage?.pageNumber ? ' current' : ''}${page.status === 'needs-review' ? ' thumb-flagged' : ''}${page.status === 'patched' ? ' thumb-patched' : ''}`}
                key={page.pageNumber}
                onClick={() => onSelectPage(page.pageNumber)}
                data-testid={`thumbnail-page-${page.pageNumber}`}
                aria-label={`Open page ${page.pageNumber}${page.status === 'needs-review' ? ', needs review' : page.status === 'patched' ? ', retaken' : ''}`}
              >
                <span>{pad(page.pageNumber)}</span>
              </button>
            ))}
          </div>
          <DocumentSheet page={selectedPage} />
          {selectedPage && (
            <div className="page-actions">
              {onPickFrame && selectedPage.video && (
                <button className="button button-quiet retake-selected" onClick={() => onPickFrame(selectedPage.pageNumber)} data-testid="button-pick-frame">
                  <Film size={15} />
                  choose another frame from the video
                </button>
              )}
              <button className="button button-quiet retake-selected" onClick={() => onPatch(selectedPage.pageNumber)} data-testid="button-retake-selected">
                <ImagePlus size={15} />
                retake page {pad(selectedPage.pageNumber)} with a new photo
              </button>
            </div>
          )}
        </div>
        <aside className="review-sidebar">
          <div className="flag-card" data-testid="card-flagged-page">
            <div className="flag-top">
              <span className={`flag-dot${flagged.length ? '' : ' flag-dot-clear'}`} />
              {flagged.length === 0 ? 'the capture looks complete' : flagged.length === 1 ? 'one page worth a closer look' : `${flagged.length} pages worth a closer look`}
            </div>
            {flagged.length > 0 ? (
              <ul className="flag-list">
                {flagged.map((page) => (
                  <li key={page.pageNumber} data-testid={`flagged-page-${page.pageNumber}`}>
                    <button className="flag-title" onClick={() => onSelectPage(page.pageNumber)}>Check page {pad(page.pageNumber)}</button>
                    <p>{page.reviewReason ?? 'The text was a little hard to read from the scroll.'}</p>
                    <button className="button button-primary" onClick={() => onPatch(page.pageNumber)} data-testid={`button-patch-page-${page.pageNumber}`}>
                      <ImagePlus size={16} />
                      {page.retakes ? 'try another photo' : 'retake this page'}
                      <ArrowRight size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <h2>{retaken.length ? 'All pages look good.' : 'No gaps found.'}</h2>
                <p>
                  {retaken.length
                    ? `Your new photo${retaken.length > 1 ? 's are' : ' is'} in place for page ${retaken.map((page) => pad(page.pageNumber)).join(', ')}.`
                    : 'Each selected frame was readable enough to include in the reconstructed document.'}
                </p>
              </>
            )}
            {retaken.length > 0 && <div className="status-done" data-testid="status-patch-complete"><Check size={14} /> retake added</div>}
          </div>
          <ExportPanel onExport={onExport} />
          <DevInfo requests={requests} />
        </aside>
      </div>
    </main>
  );
}

function PatchView({
  pageNumber,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  pageNumber: number;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (photo: Blob | string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<{ url: string; source: Blob | string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const label = String(pageNumber).padStart(2, '0');

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
  }, [cameraStream]);

  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream]);

  // Release the preview's object URL when it is replaced or the screen closes.
  useEffect(() => () => {
    if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const closeCamera = () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setCameraOpen(false);
  };

  const startCamera = async () => {
    setCameraError(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      setCameraStream(stream);
      setCameraOpen(true);
    } catch {
      setCameraError(true);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setPreview({ url: dataUrl, source: dataUrl });
    }
    closeCamera();
  };

  return (
    <main className="patch-page" data-testid="view-patch">
      <button className="back-button" onClick={onBack} disabled={busy} data-testid="button-back-review"><ArrowLeft size={14} /> back to document</button>
      <div className="patch-header">
        <span className="eyebrow">a small second look</span>
        <h1>Let’s make page {label} clearer.</h1>
        <p>Place the page flat in good light, then take a quick photo. This replaces only page {label} — the rest of your document stays in place.</p>
      </div>
      <div className="patch-preview" data-testid="preview-patch-photo">
        {cameraOpen ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" data-testid="video-patch-camera" />
        ) : preview ? (
          <img src={preview.url} alt={`Your replacement photo for page ${pageNumber}`} data-testid="img-patch-photo" />
        ) : (
          <div className="preview-placeholder"><BookOpen size={30} /><span>your page will appear here</span></div>
        )}
        {busy && (
          <div className="patch-busy" role="status" data-testid="status-patch-busy">
            <LoaderCircle size={22} />
            <span>rebuilding page {label}…</span>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden-input" />
      <div className="patch-controls">
        {cameraOpen ? (
          <>
            <button className="button button-primary" onClick={capture} data-testid="button-capture-patch"><CircleStop size={16} /> use this photo</button>
            <button className="button button-quiet" onClick={closeCamera} data-testid="button-cancel-patch-camera"><X size={16} /> cancel camera</button>
          </>
        ) : (
          <>
            <button className="button button-primary" onClick={startCamera} disabled={busy} data-testid="button-open-patch-camera"><Video size={16} /> take a photo</button>
            <button className="button button-outline" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="button-upload-patch"><Upload size={16} /> choose from photos</button>
            <input
              ref={inputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setPreview({ url: URL.createObjectURL(file), source: file });
                event.target.value = '';
              }}
              data-testid="input-patch-file"
            />
          </>
        )}
      </div>
      {preview && !cameraOpen && (
        <button className="button button-primary" style={{ width: '100%', marginTop: '.65rem' }} onClick={() => onSubmit(preview.source)} disabled={busy} data-testid="button-apply-patch">
          <Check size={16} /> {error ? 'try this photo again' : `use this photo for page ${label}`}
        </button>
      )}
      {error && <p className="patch-help patch-error" role="alert" data-testid="text-patch-error">{error}</p>}
      {cameraError && <p className="patch-help" data-testid="text-patch-camera-help">Camera access is not available here. You can choose a photo from your device instead.</p>}
      {!error && !cameraError && <p className="patch-help">The photo is sent to Gemini only when you tap “use this photo”.</p>}
    </main>
  );
}

function RecordingModal({
  videoRef,
  recording,
  onStart,
  onStop,
  onClose,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  return (
    <div className="recording-overlay" data-testid="modal-recording">
      <div className="recording-modal">
        <video ref={videoRef} className="recording-video" autoPlay muted playsInline data-testid="video-camera-preview" />
        <div className="recording-body">
          <h2>{recording ? 'Keep moving through the pages.' : 'Ready when you are.'}</h2>
          <p>{recording ? 'Move at a steady, easy pace. Stop when you reach the end.' : 'Keep the page edges in frame and let the camera follow your hand.'}</p>
          <div className="recording-actions">
            {!recording && <button className="button button-quiet" onClick={onClose} data-testid="button-close-camera">not now</button>}
            {recording ? (
              <button className="button button-primary" onClick={onStop} data-testid="button-stop-recording"><CircleStop size={16} /> finish capture</button>
            ) : (
              <button className="button button-primary" onClick={onStart} data-testid="button-begin-recording"><Video size={16} /> begin recording</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState<View>('home');
  const [documentName, setDocumentName] = useState('Untitled document');
  const [recentName, setRecentName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Doc | null>(null);
  const [selectedFrames, setSelectedFrames] = useState<SelectedFrame[]>([]);
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState(1);
  const [processingStatus, setProcessingStatus] = useState('Preparing your capture…');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<File | null>(null);
  const [patchTarget, setPatchTarget] = useState<number | null>(null);
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  // The frame picker: open for one candidate frame (before reconstruction) or for one page (after).
  const [picker, setPicker] = useState<{ kind: 'frame'; index: number } | { kind: 'page'; pageNumber: number } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Developer view: the Gemini requests made for this document, newest first.
  const [requests, setRequests] = useState<RequestInfo[]>([]);
  const noteRequest = (label: string, usage: Usage | undefined) => {
    if (usage) setRequests((list) => [{ label, usage }, ...list].slice(0, 6));
  };
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream, cameraOpen]);

  useEffect(() => () => {
    stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const beginProcessing = async (name: string, file: File) => {
    const cleanName = name.replace(/\.[^/.]+$/, '') || 'Untitled document';
    setLastCapture(file);
    setDocumentName(cleanName);
    setPatchTarget(null);
    setPatchError(null);
    setAnalysis(null);
    setSelectedFrames([]);
    setSelectedPageNumber(1);
    setProcessingError(null);
    setProcessingStatus('Opening the capture…');
    setView('processing');

    try {
      const frames = await selectVideoFrames(file, setProcessingStatus, { onStats: setSelectionStats });
      if (!frames.length) throw new Error('No clear page frames were found in this video.');
      setSelectedFrames(frames);
      setProcessingStatus(`${frames.length} clear frames are ready to review.`);
      setView('frames');
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : 'The document could not be processed.');
    }
  };

  const analyzeFrames = async () => {
    if (!selectedFrames.length) return;
    setProcessingError(null);
    setProcessingStatus(`Sending ${selectedFrames.length} clear frames for text extraction…`);
    setView('processing');

    try {
      const response = await fetch('/api/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentName, frames: selectedFrames }),
      });
      const payload = await response.json().catch(() => null) as (Partial<ProcessDocumentResult> & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'The document could not be analyzed.');
      }
      if (!payload?.pages?.length) {
        throw new Error('No reconstructed pages were returned for this capture.');
      }
      const result = buildDoc(documentName, payload as ProcessDocumentResult, selectedFrames);
      setRequests([]);
      noteRequest(`whole document · ${selectedFrames.length} frames`, payload.usage);
      setAnalysis(result);
      setSelectedPageNumber(result.pages.find((page) => page.status === 'needs-review')?.pageNumber ?? result.pages[0].pageNumber);
      setProcessingStatus('Document reconstructed.');
      setView('review');
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : 'The document could not be processed.');
    }
  };

  const handleFile = (file: File) => {
    void beginProcessing(file.name, file);
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setToast({ message: 'Camera access is not available here. Choose a video instead.', tone: 'amber' });
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      setStream(nextStream);
      setCameraOpen(true);
    } catch {
      setToast({ message: 'Camera access was paused. You can choose a video from this device instead.', tone: 'amber' });
    }
  };

  const beginRecording = () => {
    if (!stream) return;
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        const file = new File([blob], 'Camera capture.webm', { type: blob.type });
        stream?.getTracks().forEach((track) => track.stop());
        setStream(null);
        setRecording(false);
        setCameraOpen(false);
        void beginProcessing(file.name, file);
      };
      recorder.start();
      setRecording(true);
    } catch {
      setToast({ message: 'This browser cannot record here. Choose a video instead.', tone: 'amber' });
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const reset = () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraOpen(false);
    setRecording(false);
    setView('home');
    setRecentName(null);
    setAnalysis(null);
    setLastCapture(null);
    setSelectedFrames([]);
    setProcessingError(null);
    setProcessingStatus('Preparing your capture…');
    setSelectedPageNumber(1);
    setPatchTarget(null);
    setPatchBusy(false);
    setPatchError(null);
    setPicker(null);
  };

  const handleExport = (format: string) => {
    if (!analysis) return;
    try {
      if (format === 'PDF') downloadPdf(analysis);
      if (format === 'Word') downloadDocx(analysis);
      if (format === 'PowerPoint') downloadPptx(analysis);
      setToast({ message: `${format} file saved — all ${analysis.pages.length} pages are in it.`, tone: 'sage' });
    } catch {
      setToast({ message: `We couldn't prepare the ${format} file. Please try again.`, tone: 'amber' });
    }
  };

  const openPatch = (pageNumber: number) => {
    setSelectedPageNumber(pageNumber);
    setPatchTarget(pageNumber);
    setPatchError(null);
    setView('patch');
  };

  // Reads one page again from a new image (a retake photo, or another frame of the video) and swaps
  // the result in for that page.
  const rereadPage = async (doc: Doc, pageNumber: number, image: { dataUrl: string; width: number; height: number }, videoAt: number | null) => {
    const response = await fetch('/api/process-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentName, pageNumber, dataUrl: image.dataUrl }),
    });
    const payload = await response.json().catch(() => null) as (Partial<ProcessPageResult> & { error?: string }) | null;
    if (!response.ok) throw new Error(payload?.error || 'That image could not be analyzed. Please try again.');
    if (!payload?.page) throw new Error('No page was returned for that image. Please try again.');

    noteRequest(`page ${String(pageNumber).padStart(2, '0')} · ${videoAt === null ? 'retake photo' : 'frame from the video'}`, payload.usage);
    const next = applyPatch(doc, pageNumber, payload.page, image, videoAt);
    const page = next.pages.find((candidate) => candidate.pageNumber === pageNumber);
    setAnalysis(next);
    setSelectedPageNumber(pageNumber);
    const label = String(pageNumber).padStart(2, '0');
    setToast(page?.status === 'patched'
      ? { message: `Page ${label} has been refreshed.`, tone: 'sage' }
      : { message: `Page ${label} is updated, but is still a little hard to read. You can try another frame or photo.`, tone: 'amber' });
  };

  const submitPatch = async (photo: Blob | string) => {
    if (!analysis || patchTarget === null) return;
    setPatchBusy(true);
    setPatchError(null);
    try {
      await rereadPage(analysis, patchTarget, await prepareImage(photo), null);
      setPatchTarget(null);
      setView('review');
    } catch (error) {
      setPatchError(error instanceof Error ? error.message : 'That photo could not be analyzed. Please try again.');
    } finally {
      setPatchBusy(false);
    }
  };

  // The user chose another frame in the picker.
  const applyPickedFrame = async (frame: PickedFrame) => {
    if (!picker) return;
    if (picker.kind === 'frame') {
      // Before reconstruction: just swap the candidate; nothing is sent yet.
      setSelectedFrames((frames) => frames.map((old, index) => index === picker.index
        ? { ...old, dataUrl: frame.dataUrl, width: frame.width, height: frame.height, timestamp: frame.timestamp, sharpness: frame.clarity, hand: frame.hand, picked: true }
        : old));
      setPicker(null);
      return;
    }
    if (!analysis) return;
    setPickerBusy(true);
    setPickerError(null);
    try {
      await rereadPage(analysis, picker.pageNumber, frame, frame.timestamp);
      setPicker(null);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'That frame could not be analyzed. Please try again.');
    } finally {
      setPickerBusy(false);
    }
  };

  const openPicker = (target: NonNullable<typeof picker>) => {
    setPickerError(null);
    setPicker(target);
  };

  const pickerFrame = picker?.kind === 'frame' ? selectedFrames[picker.index] : null;
  const pickerPage = picker?.kind === 'page' ? analysis?.pages.find((page) => page.pageNumber === picker.pageNumber) ?? null : null;
  const pickerRange = pickerFrame?.range ?? (pickerPage?.video ? { from: pickerPage.video.from, to: pickerPage.video.to } : null);

  useEffect(() => {
    if (view === 'review') setRecentName(documentName);
  }, [view, documentName]);

  return (
    <div className="app-shell">
      <div className="page-wrap">
        <BrandHeader onReset={reset} />
        {view === 'home' && <HomeView onCamera={startCamera} onFile={handleFile} recentName={recentName} />}
        {view === 'frames' && (
          <FrameReviewView
            documentName={documentName}
            frames={selectedFrames}
            stats={selectionStats}
            onPick={lastCapture ? (index) => openPicker({ kind: 'frame', index }) : null}
            onContinue={analyzeFrames}
            onReset={reset}
          />
        )}
        {view === 'processing' && <ProcessingView documentName={documentName} status={processingStatus} error={processingError} onRetry={selectedFrames.length ? analyzeFrames : lastCapture ? () => void beginProcessing(lastCapture.name, lastCapture) : null} onReset={reset} />}
        {view === 'review' && analysis && <ReviewView documentName={documentName} analysis={analysis} selectedPageNumber={selectedPageNumber} onSelectPage={setSelectedPageNumber} onPatch={openPatch} onPickFrame={lastCapture ? (pageNumber) => openPicker({ kind: 'page', pageNumber }) : null} onExport={handleExport} requests={requests} />}
        {view === 'patch' && analysis && patchTarget !== null && (
          <PatchView
            key={patchTarget}
            pageNumber={patchTarget}
            busy={patchBusy}
            error={patchError}
            onBack={() => setView('review')}
            onSubmit={(photo) => void submitPatch(photo)}
          />
        )}
      </div>
      {cameraOpen && (
        <RecordingModal
          videoRef={videoRef}
          recording={recording}
          onStart={beginRecording}
          onStop={stopRecording}
          onClose={() => { stream?.getTracks().forEach((track) => track.stop()); setStream(null); setCameraOpen(false); }}
        />
      )}
      {picker && lastCapture && pickerRange && (
        <FramePicker
          key={picker.kind === 'frame' ? `frame-${picker.index}` : `page-${picker.pageNumber}`}
          file={lastCapture}
          range={pickerRange}
          current={pickerFrame?.timestamp ?? pickerPage?.video?.at ?? null}
          eyebrow={`${picker.kind === 'frame' ? `candidate ${String(picker.index + 1).padStart(2, '0')}` : `page ${String(picker.pageNumber).padStart(2, '0')}`} · ${pickerRange.from.toFixed(1)}–${pickerRange.to.toFixed(1)} s`}
          heading={pickerFrame ? 'Choose the clearest moment of this page.' : 'Choose a clearer frame for this page.'}
          confirmLabel={pickerFrame ? 'use this frame' : 'read this frame'}
          busy={pickerBusy}
          error={pickerError}
          onCancel={() => setPicker(null)}
          onConfirm={(frame) => void applyPickedFrame(frame)}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

export default App;
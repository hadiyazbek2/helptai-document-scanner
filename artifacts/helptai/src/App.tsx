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

type View = 'home' | 'processing' | 'review' | 'patch';
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

function ProcessingView({ documentName }: { documentName: string }) {
  return (
    <main className="processing-shell" data-testid="view-processing">
      <div className="processing-orbit" aria-hidden="true"><LoaderCircle size={25} /></div>
      <span className="eyebrow">quietly putting it in order</span>
      <h1>Finding the pages.</h1>
      <p>
        helptai is looking for clear edges, readable text, and the natural order of your capture. You can leave this screen open.
      </p>
      <div className="progress-track" aria-label="Processing document" data-testid="progress-processing">
        <div className="progress-fill" />
      </div>
      <span className="processing-note"><Film size={12} /> {documentName}</span>
    </main>
  );
}

function DocumentSheet() {
  return (
    <div className="document-sheet" data-testid="preview-document-sheet">
      <div className="sheet-lines" />
      <div className="sheet-content">
        <div className="sheet-topline"><span>field notes</span><span>page 04</span></div>
        <h2 className="sheet-heading">The shape of a thought, once it has room to settle</h2>
        <div className="sheet-rule" />
        <div className="fake-copy" aria-label="Reconstructed page preview">
          <i /><i /><i /><i /><i />
        </div>
        <div className="fake-copy" style={{ marginTop: '1.3rem' }}>
          <i style={{ width: '86%' }} /><i style={{ width: '94%' }} /><i style={{ width: '72%' }} />
        </div>
      </div>
      <span className="sheet-foot">helptai · reconstructed</span>
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
  patchDone,
  onPatch,
  onExport,
}: {
  documentName: string;
  patchDone: boolean;
  onPatch: () => void;
  onExport: (format: string) => void;
}) {
  return (
    <main className="review-page" data-testid="view-review">
      <div className="review-header">
        <div>
          <span className="eyebrow">document ready</span>
          <h1>{documentName}</h1>
          <p>12 pages found · ordered from your capture</p>
        </div>
        <span className="ready-badge" data-testid="status-document-ready"><Check size={13} /> ready</span>
      </div>
      <div className="review-grid">
        <div>
          <div className="thumb-strip" aria-label="Document pages">
            {[1, 2, 3].map((page) => <div className="thumb" key={page} data-testid={`thumbnail-page-${page}`}><span>{String(page).padStart(2, '0')}</span></div>)}
            <div className="thumb current" data-testid="thumbnail-page-4"><span>04</span></div>
            {[5, 6, 7].map((page) => <div className="thumb" key={page} data-testid={`thumbnail-page-${page}`}><span>{String(page).padStart(2, '0')}</span></div>)}
          </div>
          <DocumentSheet />
        </div>
        <aside className="review-sidebar">
          <div className="flag-card" data-testid="card-flagged-page">
            <div className="flag-top"><span className="flag-dot" /> one page worth a closer look</div>
            <h2>{patchDone ? 'Page 04 looks good.' : 'Check page 04'}</h2>
            <p>
              {patchDone
                ? 'Your new photo is in place. The page has been refreshed in the document.'
                : 'The text was a little hard to read from the scroll. A quick photo here will make the final document clearer.'}
            </p>
            {!patchDone && (
              <button className="button button-primary" onClick={onPatch} data-testid="button-patch-page">
                <ImagePlus size={16} />
                add a patch photo
                <ArrowRight size={15} />
              </button>
            )}
            {patchDone && <div className="status-done" data-testid="status-patch-complete"><Check size={14} /> patch added</div>}
          </div>
          <ExportPanel onExport={onExport} />
        </aside>
      </div>
    </main>
  );
}

function PatchView({
  onBack,
  onPatchComplete,
  patchImage,
  onPatchImage,
}: {
  onBack: () => void;
  onPatchComplete: () => void;
  patchImage: string | null;
  onPatchImage: (image: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [patchCameraOpen, setPatchCameraOpen] = useState(false);
  const [patchStream, setPatchStream] = useState<MediaStream | null>(null);
  const [patchError, setPatchError] = useState(false);

  useEffect(() => {
    if (videoRef.current && patchStream) videoRef.current.srcObject = patchStream;
  }, [patchStream]);

  useEffect(() => () => patchStream?.getTracks().forEach((track) => track.stop()), [patchStream]);

  const usePatchFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onPatchImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const startPatchCamera = async () => {
    setPatchError(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPatchError(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      setPatchStream(stream);
      setPatchCameraOpen(true);
    } catch {
      setPatchError(true);
    }
  };

  const capturePatch = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      onPatchImage(canvas.toDataURL('image/jpeg', .86));
    }
    patchStream?.getTracks().forEach((track) => track.stop());
    setPatchStream(null);
    setPatchCameraOpen(false);
  };

  return (
    <main className="patch-page" data-testid="view-patch">
      <button className="back-button" onClick={onBack} data-testid="button-back-review"><ArrowLeft size={14} /> back to document</button>
      <div className="patch-header">
        <span className="eyebrow">a small second look</span>
        <h1>Let’s make page 04 clearer.</h1>
        <p>Place the page flat in good light, then take a quick photo. This replaces only the flagged page — the rest of your document stays in place.</p>
      </div>
      <div className="patch-preview" data-testid="preview-patch-photo">
        {patchCameraOpen ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" data-testid="video-patch-camera" />
        ) : patchImage ? (
          <img src={patchImage} alt="Your replacement photo for page 04" data-testid="img-patch-photo" />
        ) : (
          <div className="preview-placeholder"><BookOpen size={30} /><span>your page will appear here</span></div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden-input" />
      <div className="patch-controls">
        {patchCameraOpen ? (
          <>
            <button className="button button-primary" onClick={capturePatch} data-testid="button-capture-patch"><CircleStop size={16} /> use this photo</button>
            <button className="button button-quiet" onClick={() => { patchStream?.getTracks().forEach((track) => track.stop()); setPatchStream(null); setPatchCameraOpen(false); }} data-testid="button-cancel-patch-camera"><X size={16} /> cancel camera</button>
          </>
        ) : (
          <>
            <button className="button button-primary" onClick={startPatchCamera} data-testid="button-open-patch-camera"><Video size={16} /> take a photo</button>
            <button className="button button-outline" onClick={() => inputRef.current?.click()} data-testid="button-upload-patch"><Upload size={16} /> choose from photos</button>
            <input
              ref={inputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) usePatchFile(file);
                event.target.value = '';
              }}
              data-testid="input-patch-file"
            />
          </>
        )}
      </div>
      {patchImage && !patchCameraOpen && (
        <button className="button button-primary" style={{ width: '100%', marginTop: '.65rem' }} onClick={onPatchComplete} data-testid="button-apply-patch">
          <Check size={16} /> add this page to the document
        </button>
      )}
      {patchError && <p className="patch-help" data-testid="text-patch-camera-help">Camera access is not available here. You can choose a photo from your device instead.</p>}
      {!patchError && <p className="patch-help">Nothing is uploaded until you choose to add the photo.</p>}
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
  const [patchDone, setPatchDone] = useState(false);
  const [patchImage, setPatchImage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const processingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream, cameraOpen]);

  useEffect(() => () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (processingTimerRef.current) window.clearTimeout(processingTimerRef.current);
  }, [stream]);

  useEffect(() => {
    if (view !== 'processing') return;
    processingTimerRef.current = window.setTimeout(() => setView('review'), 3300);
    return () => {
      if (processingTimerRef.current) window.clearTimeout(processingTimerRef.current);
    };
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const beginProcessing = (name: string) => {
    setDocumentName(name.replace(/\.[^/.]+$/, '') || 'Untitled document');
    setPatchDone(false);
    setPatchImage(null);
    setView('processing');
  };

  const handleFile = (file: File) => {
    beginProcessing(file.name);
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setToast({ message: 'Camera access is not available here. Choose a video instead.', tone: 'amber' });
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true });
      setStream(nextStream);
      setCameraOpen(true);
    } catch {
      setToast({ message: 'Camera access was paused. You can choose a video from this device instead.', tone: 'amber' });
    }
  };

  const beginRecording = () => {
    if (!stream) return;
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setToast({ message: 'This browser cannot record here. Choose a video instead.', tone: 'amber' });
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setRecording(false);
    setCameraOpen(false);
    beginProcessing('Camera capture');
  };

  const reset = () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraOpen(false);
    setRecording(false);
    setView('home');
    setRecentName(null);
    setPatchImage(null);
    setPatchDone(false);
  };

  const handleExport = (format: string) => {
    setToast({ message: `${format} export is ready to connect — your document is safely prepared.`, tone: 'sage' });
  };

  const finishPatch = () => {
    setPatchDone(true);
    setView('review');
    setToast({ message: 'Page 04 has been refreshed.', tone: 'sage' });
  };

  useEffect(() => {
    if (view === 'review') setRecentName(documentName);
  }, [view, documentName]);

  return (
    <div className="app-shell">
      <div className="page-wrap">
        <BrandHeader onReset={reset} />
        {view === 'home' && <HomeView onCamera={startCamera} onFile={handleFile} recentName={recentName} />}
        {view === 'processing' && <ProcessingView documentName={documentName} />}
        {view === 'review' && <ReviewView documentName={documentName} patchDone={patchDone} onPatch={() => setView('patch')} onExport={handleExport} />}
        {view === 'patch' && (
          <PatchView
            onBack={() => setView('review')}
            onPatchComplete={finishPatch}
            patchImage={patchImage}
            onPatchImage={setPatchImage}
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
      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

export default App;
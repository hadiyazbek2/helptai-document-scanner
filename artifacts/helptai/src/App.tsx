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
import { downloadDocx, downloadPdf, downloadPptx } from '@/lib/exports';
import { selectVideoFrames, type SelectedFrame } from '@/lib/video-processing';

type View = 'home' | 'processing' | 'review' | 'patch';
type ToastTone = 'sage' | 'amber';
type ReconstructedPage = {
  pageNumber: number;
  title: string;
  text: string;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
};
type DocumentAnalysis = {
  documentName: string;
  pages: ReconstructedPage[];
  selectedFrameCount: number;
  discardedFrameCount: number;
  processingNote: string;
};

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
  onReset,
}: {
  documentName: string;
  status: string;
  error: string | null;
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
      {error && <button className="button button-primary" style={{ marginTop: '1rem' }} onClick={onReset} data-testid="button-processing-reset">start over</button>}
    </main>
  );
}

function DocumentSheet({ page }: { page: ReconstructedPage | null }) {
  const textLines = (page?.text || 'No readable text was returned for this page.')
    .split(/\n+/)
    .filter(Boolean)
    .slice(0, 8);
  return (
    <div className="document-sheet" data-testid="preview-document-sheet">
      <div className="sheet-lines" />
      <div className="sheet-content">
        <div className="sheet-topline"><span>reconstructed page</span><span>page {String(page?.pageNumber ?? 1).padStart(2, '0')}</span></div>
        <h2 className="sheet-heading">{page?.title ?? 'Reconstructed document'}</h2>
        <div className="sheet-rule" />
        <div className="fake-copy" aria-label="Reconstructed page preview">
          {textLines.map((line, index) => <i key={`${line}-${index}`} style={{ width: `${Math.min(96, Math.max(32, 44 + (line.length % 52)))}%` }} />)}
        </div>
        <p className="sheet-text">{textLines.join(' ')}</p>
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
  patchDone,
  selectedPageNumber,
  onSelectPage,
  onPatch,
  onExport,
}: {
  documentName: string;
  analysis: DocumentAnalysis;
  patchDone: boolean;
  selectedPageNumber: number;
  onSelectPage: (pageNumber: number) => void;
  onPatch: () => void;
  onExport: (format: string) => void;
}) {
  const selectedPage = analysis.pages.find((page) => page.pageNumber === selectedPageNumber) ?? analysis.pages[0] ?? null;
  const flaggedPage = analysis.pages.find((page) => page.needsReview) ?? null;
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
                className={`thumb${page.pageNumber === selectedPage?.pageNumber ? ' current' : ''}${page.needsReview ? ' thumb-flagged' : ''}`}
                key={page.pageNumber}
                onClick={() => onSelectPage(page.pageNumber)}
                data-testid={`thumbnail-page-${page.pageNumber}`}
                aria-label={`Open page ${page.pageNumber}${page.needsReview ? ', needs review' : ''}`}
              >
                <span>{String(page.pageNumber).padStart(2, '0')}</span>
              </button>
            ))}
          </div>
          <DocumentSheet page={selectedPage} />
        </div>
        <aside className="review-sidebar">
          <div className="flag-card" data-testid="card-flagged-page">
            <div className="flag-top"><span className={`flag-dot${flaggedPage ? '' : ' flag-dot-clear'}`} /> {flaggedPage ? 'one page worth a closer look' : 'the capture looks complete'}</div>
            <h2>{patchDone ? `Page ${String(flaggedPage?.pageNumber ?? 1).padStart(2, '0')} looks good.` : flaggedPage ? `Check page ${String(flaggedPage.pageNumber).padStart(2, '0')}` : 'No gaps found.'}</h2>
            <p>
              {patchDone
                ? 'Your new photo is in place. The page has been refreshed in the document.'
                : flaggedPage
                  ? flaggedPage.reviewReason ?? 'The text was a little hard to read from the scroll.'
                  : 'Each selected frame was readable enough to include in the reconstructed document.'}
            </p>
            {!patchDone && flaggedPage && (
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
  pageNumber,
  onBack,
  onPatchComplete,
  patchImage,
  onPatchImage,
}: {
  pageNumber: number;
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
        <h1>Let’s make page {String(pageNumber).padStart(2, '0')} clearer.</h1>
        <p>Place the page flat in good light, then take a quick photo. This replaces only the flagged page — the rest of your document stays in place.</p>
      </div>
      <div className="patch-preview" data-testid="preview-patch-photo">
        {patchCameraOpen ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" data-testid="video-patch-camera" />
          ) : patchImage ? (
          <img src={patchImage} alt={`Your replacement photo for page ${pageNumber}`} data-testid="img-patch-photo" />
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
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState(1);
  const [processingStatus, setProcessingStatus] = useState('Preparing your capture…');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [patchDone, setPatchDone] = useState(false);
  const [patchImage, setPatchImage] = useState<string | null>(null);
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
    setDocumentName(cleanName);
    setPatchDone(false);
    setPatchImage(null);
    setAnalysis(null);
    setSelectedPageNumber(1);
    setProcessingError(null);
    setProcessingStatus('Opening the capture…');
    setView('processing');

    try {
      const frames = await selectVideoFrames(file, setProcessingStatus);
      if (!frames.length) throw new Error('No clear page frames were found in this video.');
      setProcessingStatus(`Sending ${frames.length} clear frames for text extraction…`);
      const response = await fetch('/api/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentName: cleanName, frames }),
      });
      const payload = await response.json().catch(() => null) as Partial<DocumentAnalysis> & { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'The document could not be analyzed.');
      }
      if (!payload?.pages?.length) {
        throw new Error('No reconstructed pages were returned for this capture.');
      }
      const result = payload as DocumentAnalysis;
      setAnalysis(result);
      setSelectedPageNumber(result.pages.find((page) => page.needsReview)?.pageNumber ?? result.pages[0].pageNumber);
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
    setProcessingError(null);
    setProcessingStatus('Preparing your capture…');
    setSelectedPageNumber(1);
    setPatchImage(null);
    setPatchDone(false);
  };

  const handleExport = (format: string) => {
    if (format === 'PDF') downloadPdf(documentName);
    if (format === 'Word') downloadDocx(documentName);
    if (format === 'PowerPoint') downloadPptx(documentName);
    setToast({ message: `${format} export downloaded — your document is safely prepared.`, tone: 'sage' });
  };

  const finishPatch = () => {
    setPatchDone(true);
    setView('review');
    setToast({ message: `Page ${String(selectedPageNumber).padStart(2, '0')} has been refreshed.`, tone: 'sage' });
  };

  const flaggedPage = analysis?.pages.find((page) => page.needsReview) ?? null;
  const openPatch = () => {
    if (flaggedPage) setSelectedPageNumber(flaggedPage.pageNumber);
    setView('patch');
  };

  useEffect(() => {
    if (view === 'review') setRecentName(documentName);
  }, [view, documentName]);

  return (
    <div className="app-shell">
      <div className="page-wrap">
        <BrandHeader onReset={reset} />
        {view === 'home' && <HomeView onCamera={startCamera} onFile={handleFile} recentName={recentName} />}
        {view === 'processing' && <ProcessingView documentName={documentName} status={processingStatus} error={processingError} onReset={reset} />}
        {view === 'review' && analysis && <ReviewView documentName={documentName} analysis={analysis} patchDone={patchDone} selectedPageNumber={selectedPageNumber} onSelectPage={setSelectedPageNumber} onPatch={openPatch} onExport={handleExport} />}
        {view === 'patch' && analysis && (
          <PatchView
            pageNumber={flaggedPage?.pageNumber ?? selectedPageNumber}
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
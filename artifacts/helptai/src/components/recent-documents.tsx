import { useState } from 'react';
import { Check, FileText, FolderOpen, Pencil, Trash2, X } from 'lucide-react';
import type { DocSummary } from '@/lib/doc-store';

const sizeLabel = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function whenLabel(time: number, now = Date.now()) {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(time);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `today ${clock}`;
  if (yesterday) return `yesterday ${clock}`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// The documents kept on this device, newest first: open one, rename it, free its video's space,
// or delete it.
export function RecentDocuments({
  docs,
  onOpen,
  onRename,
  onRemoveVideo,
  onDelete,
}: {
  // null while the list is loading.
  docs: DocSummary[] | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemoveVideo: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (docs !== null && !docs.length) {
    return (
      <div className="recent-card" data-testid="empty-recent-documents">
        <div className="recent-icon"><FolderOpen size={17} /></div>
        <div className="recent-meta">
          <div className="recent-name">your next document will live here</div>
          <div className="recent-time">nothing saved yet</div>
        </div>
      </div>
    );
  }

  return (
    <ul className="recent-list" aria-label="Documents on this device">
      {(docs ?? []).map((doc) => {
        const isEditing = editing?.id === doc.id;
        const saveName = () => {
          const name = editing?.name.trim();
          if (name && name !== doc.name) onRename(doc.id, name);
          setEditing(null);
        };
        return (
          <li className="recent-card recent-item" key={doc.id} data-testid={`card-document-${doc.id}`}>
            <button className="recent-open" onClick={() => onOpen(doc.id)} disabled={isEditing} aria-label={`Open ${doc.name}`} data-testid="button-open-document">
              {doc.thumb ? <img className="recent-thumb" src={doc.thumb} alt="" /> : <span className="recent-icon"><FileText size={17} /></span>}
            </button>
            <div className="recent-meta">
              {isEditing ? (
                <form
                  className="recent-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveName();
                  }}
                >
                  <input
                    autoFocus
                    value={editing.name}
                    maxLength={160}
                    onChange={(event) => setEditing({ id: doc.id, name: event.target.value })}
                    onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
                    aria-label="Document name"
                    data-testid="input-rename-document"
                  />
                  <button type="submit" className="recent-action" aria-label="Save name"><Check size={15} /></button>
                  <button type="button" className="recent-action" onClick={() => setEditing(null)} aria-label="Cancel rename"><X size={15} /></button>
                </form>
              ) : (
                <button className="recent-name recent-name-button" onClick={() => onOpen(doc.id)} data-testid="text-recent-document-name">{doc.name}</button>
              )}
              <div className="recent-time">
                {whenLabel(doc.updatedAt)} · {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                {doc.flaggedCount > 0 && <span className="recent-flag"> · {doc.flaggedCount} to check</span>}
                {' · '}{sizeLabel(doc.bytes)}
              </div>
              {confirming === doc.id ? (
                <div className="recent-confirm" role="group" aria-label={`Delete ${doc.name}?`}>
                  <span>delete this document?</span>
                  <button className="recent-link recent-link-strong" onClick={() => { setConfirming(null); onDelete(doc.id); }} data-testid="button-confirm-delete">delete</button>
                  <button className="recent-link" onClick={() => setConfirming(null)}>keep it</button>
                </div>
              ) : (
                !isEditing && (
                  <div className="recent-actions">
                    <button className="recent-link" onClick={() => setEditing({ id: doc.id, name: doc.name })} data-testid="button-rename-document"><Pencil size={12} /> rename</button>
                    {doc.hasVideo && (
                      <button className="recent-link" onClick={() => onRemoveVideo(doc.id)} title="The pages stay; choosing another frame from the video will no longer be possible." data-testid="button-remove-video">
                        remove video
                      </button>
                    )}
                    <button className="recent-link" onClick={() => setConfirming(doc.id)} data-testid="button-delete-document"><Trash2 size={12} /> delete</button>
                  </div>
                )
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

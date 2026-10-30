import { useId, useState, type DragEvent } from 'react';

export const UPLOAD_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls';

/** "Use my own file": a file picker plus a drop area. */
export default function UploadZone({
  expanded,
  onToggle,
  onFile,
  error,
}: {
  expanded: boolean;
  onToggle: () => void;
  onFile: (file: File) => void;
  error?: string;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div className="nb-upload">
      <button type="button" className="nb-btn" aria-expanded={expanded} onClick={onToggle}>
        Use my own file
      </button>
      {expanded && (
        <div
          className={`nb-dropzone${dragging ? ' nb-dropzone--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <label htmlFor={inputId}>Choose a CSV, TSV or Excel file, or drop it here.</label>
          <input
            id={inputId}
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
          <p className="nb-muted">The file stays in your browser; it isn&apos;t uploaded anywhere.</p>
          {error && (
            <p className="nb-error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

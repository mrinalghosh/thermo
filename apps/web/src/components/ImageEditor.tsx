import { useEffect, useState } from "react";

export function ImageEditor({
  image,
  onChange,
}: {
  image: ImageBitmap | null;
  onChange: (image: ImageBitmap | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File | undefined | null) => {
    if (!file) return;
    try {
      onChange(await createImageBitmap(file));
      setError(null);
    } catch {
      setError(`Couldn’t read ${file.name} as an image`);
    }
  };

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) void load(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <div className="editor">
      <label
        className={dragging ? "dropzone dragging" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void load(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept="image/*" onChange={(e) => void load(e.target.files?.[0])} hidden />
        {image ? `${image.width} × ${image.height} image loaded. Drop or paste to replace.` : "Drop, paste or click to choose an image"}
      </label>
      {error && <p className="error-text">{error}</p>}
      {image && (
        <button className="link" onClick={() => onChange(null)}>
          Remove image
        </button>
      )}
    </div>
  );
}

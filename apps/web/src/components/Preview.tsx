import { DPI } from "@thermo/mxw01";
import { previewRGBA, type Raster } from "@thermo/render";
import { useEffect, useRef } from "react";

const mm = (dots: number) => ((dots / DPI) * 25.4).toFixed(0);

export function Preview({ raster }: { raster: Raster | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !raster) return;
    canvas.width = raster.width;
    canvas.height = raster.height;
    const pixels = new ImageData(previewRGBA(raster) as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height);
    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  }, [raster]);

  if (!raster) return <div className="paper empty">Nothing to print yet</div>;

  return (
    <figure className="preview">
      <div className="paper">
        <canvas ref={canvasRef} />
      </div>
      <figcaption>
        {raster.width} × {raster.height} dots · {mm(raster.width)} × {mm(raster.height)} mm
      </figcaption>
    </figure>
  );
}

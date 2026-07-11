import React, { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import useImage from "use-image";
import { v4 as uuidv4 } from "uuid";
import {
  Plus,
  Trash2,
  Download,
  Image as ImageIcon,
  Grid3X3,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  RotateCw,
  Camera,
  MoveHorizontal,
  MoveVertical,
  Maximize,
  Undo2,
  Redo2,
} from "lucide-react";



interface ImageNode {
  id: string;
  url: string;
  x: number;
  y: number;
  cgX?: number; // center of gravity X (unscaled)
  cgY?: number; // center of gravity Y (unscaled)
  contentMinX?: number;
  contentMaxX?: number;
  contentMinY?: number;
  contentMaxY?: number;
  nonTransparentArea?: number;
  width?: number; // optionally override
  height?: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity?: number;
}

const LongPressButton = ({ onClick, children, className, disabled }: any) => {
  const timerRef = useRef<any>(null);
  const isPressing = useRef(false);

  const start = useCallback(
    (e: any) => {
      if (disabled) return;
      if (isPressing.current) return;
      isPressing.current = true;
      onClick();
      timerRef.current = setTimeout(function repeat() {
        if (isPressing.current) {
          onClick();
          timerRef.current = setTimeout(repeat, 30);
        }
      }, 400); // 400ms delay before continuous repeat
    },
    [onClick, disabled],
  );

  const stop = useCallback(() => {
    isPressing.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <button
      className={className}
      disabled={disabled}
      onPointerDown={(e) => {
        // Prevent element capture or drag to avoid weird behavior
        e.currentTarget.setPointerCapture(e.pointerId);
        start(e);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        stop();
      }}
      onPointerLeave={stop}
      onPointerCancel={stop}
      style={{ touchAction: "none", userSelect: "none" }}
    >
      {children}
    </button>
  );
};

function computeImageMetrics(img: HTMLImageElement): {
  cgX: number;
  cgY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  nonTransparentPixels: number;
} {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  if (img.width === 0 || img.height === 0) {
    return {
      cgX: 0,
      cgY: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      nonTransparentPixels: 0,
    };
  }
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return {
      cgX: img.width / 2,
      cgY: img.height / 2,
      minX: 0,
      maxX: img.width,
      minY: 0,
      maxY: img.height,
      nonTransparentPixels: 0,
    };

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;

  let sumX = 0;
  let sumY = 0;
  let sumAlpha = 0;
  let nonTransparentPixels = 0;

  let minX = img.width;
  let maxX = 0;
  let minY = img.height;
  let maxY = 0;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const alpha = data[idx + 3]; // alpha is 0-255
      if (alpha > 0) {
        sumX += x * alpha;
        sumY += y * alpha;
        sumAlpha += alpha;
        nonTransparentPixels++;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (sumAlpha === 0) {
    return {
      cgX: img.width / 2,
      cgY: img.height / 2,
      minX: 0,
      maxX: img.width,
      minY: 0,
      maxY: img.height,
      nonTransparentPixels: 0,
    };
  }

  return {
    cgX: sumX / sumAlpha,
    cgY: sumY / sumAlpha,
    minX,
    maxX: maxX + 1,
    minY,
    maxY: maxY + 1,
    nonTransparentPixels,
  };
}

function getCanvasBounds(
  contentMinX: number,
  contentMaxX: number,
  contentMinY: number,
  contentMaxY: number,
  cgX: number,
  cgY: number,
  rotation: number,
  scale: number,
  canvasX: number,
  canvasY: number,
) {
  const rotRad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  const corners = [
    { x: contentMinX, y: contentMinY },
    { x: contentMaxX, y: contentMinY },
    { x: contentMaxX, y: contentMaxY },
    { x: contentMinX, y: contentMaxY },
  ];

  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  for (const c of corners) {
    const dx = c.x - cgX;
    const dy = c.y - cgY;
    const rx = dx * scale * cos - dy * scale * sin;
    const ry = dx * scale * sin + dy * scale * cos;
    const ax = canvasX + rx;
    const ay = canvasY + ry;

    if (ax < minX) minX = ax;
    if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay;
    if (ay > maxY) maxY = ay;
  }

  return { minX, maxX, minY, maxY };
}

// Separate component for each image to handle useImage hook and Transformers properly
const URLImage = ({
  image,
  isSelected,
  onSelect,
  onChange,
  logicalSize,
}: {
  image: ImageNode;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: ImageNode) => void;
  logicalSize: number;
}) => {
  const [img] = useImage(image.url);
  const shapeRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      // Need to attach transformer manually
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  // Once image loads, set some default scale so it fits nicely
  useEffect(() => {
    if (img && image.scaleX === 1 && image.scaleY === 1 && !image.width) {
      // Fit to the longest edge of the canvas
      const metrics = computeImageMetrics(img);
      const contentCenterX = (metrics.minX + metrics.maxX) / 2;
      const contentCenterY = (metrics.minY + metrics.maxY) / 2;

      const PADDING = logicalSize * 0.025;
      const SAFE_MAX = logicalSize - PADDING;
      const SAFE_SIZE = SAFE_MAX - PADDING;

      const cWidth = metrics.maxX - metrics.minX;
      const cHeight = metrics.maxY - metrics.minY;
      const cMax = Math.max(cWidth, cHeight);

      const scale = cMax > 0 ? SAFE_SIZE / cMax : 1;

      const rotRad = (image.rotation * Math.PI) / 180;
      const dx = contentCenterX - metrics.cgX;
      const dy = contentCenterY - metrics.cgY;
      const dxCanvas = dx * scale * Math.cos(rotRad) - dy * scale * Math.sin(rotRad);
      const dyCanvas = dx * scale * Math.sin(rotRad) + dy * scale * Math.cos(rotRad);

      const newX = logicalSize / 2 - dxCanvas;
      const newY = logicalSize / 2 - dyCanvas;

      onChange({
        ...image,
        width: img.width,
        height: img.height,
        scaleX: scale,
        scaleY: scale,
        cgX: metrics.cgX,
        cgY: metrics.cgY,
        contentMinX: metrics.minX,
        contentMaxX: metrics.maxX,
        contentMinY: metrics.minY,
        contentMaxY: metrics.maxY,
        nonTransparentArea: metrics.nonTransparentPixels,
        x: newX,
        y: newY,
      });
    }
  }, [img]); // intentionally don't include all deps to only run on initial load

  return (
    <React.Fragment>
      <KonvaImage
        image={img}
        onClick={onSelect}
        onTap={onSelect}
        ref={shapeRef}
        x={image.x}
        y={image.y}
        offsetX={image.cgX ?? 0}
        offsetY={image.cgY ?? 0}
        width={image.width}
        height={image.height}
        rotation={image.rotation}
        scaleX={image.scaleX}
        scaleY={image.scaleY}
        opacity={image.opacity ?? 1}
        draggable
        onDragEnd={(e) => {
          onChange({
            ...image,
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={() => {
          // transformer is changing scale of the node
          // and NOT its width or height
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();

          onChange({
            ...image,
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            scaleX,
            scaleY,
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          centeredScaling={true}
          boundBoxFunc={(oldBox, newBox) => {
            // limit resize
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </React.Fragment>
  );
};

function useHistory<T>(initialPresent: T) {
  const [state, setState] = useState({
    past: [] as T[],
    present: initialPresent,
    future: [] as T[],
  });

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  const undo = useCallback(() => {
    setState((curr) => {
      if (curr.past.length === 0) return curr;
      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);
      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((curr) => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0];
      const newFuture = curr.future.slice(1);
      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  const lastActionTime = useRef<number>(0);

  const setPresent = useCallback((action: React.SetStateAction<T>) => {
    setState((curr) => {
      const nextPresent =
        typeof action === "function"
          ? (action as Function)(curr.present)
          : action;
      if (nextPresent === curr.present) return curr;

      const now = Date.now();
      const isRapid = now - lastActionTime.current < 400;
      lastActionTime.current = now;

      if (isRapid && curr.past.length > 0) {
        // Replace the current state but keep the past same
        return {
          past: curr.past,
          present: nextPresent,
          future: [],
        };
      }

      return {
        past: [...curr.past, curr.present].slice(-50),
        present: nextPresent,
        future: [],
      };
    });
  }, []);

  return { state: state.present, setPresent, undo, redo, canUndo, canRedo };
}

export default function App() {
  const {
    state: images,
    setPresent: setImages,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory<ImageNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [overlapPixels, setOverlapPixels] = useState<number>(0);
  const [canvasSize, setCanvasSize] = useState<number>(900);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg">("png");

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!stageRef.current || scale <= 0) return;
      try {
        if (stageRef.current.width() === 0 || stageRef.current.height() === 0)
          return;

        const stageClone = stageRef.current.clone();
        stageClone.width(canvasSize);
        stageClone.height(canvasSize);
        stageClone.scaleX(1);
        stageClone.scaleY(1);
        const transformers = stageClone.find('Transformer');
        transformers.forEach((tr: any) => tr.destroy());

        const canvas = stageClone.toCanvas({ pixelRatio: 1 });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
        const data = imageData.data;
        const PADDING = Math.floor(canvasSize * 0.025);

        let overlapCount = 0;
        for (let y = 0; y < canvasSize; y++) {
          for (let x = 0; x < canvasSize; x++) {
            if (
              x < PADDING ||
              x >= canvasSize - PADDING ||
              y < PADDING ||
              y >= canvasSize - PADDING
            ) {
              const alpha = data[(y * canvasSize + x) * 4 + 3];
              if (alpha > 10) {
                overlapCount++;
              }
            }
          }
        }
        setOverlapPixels(overlapCount);
      } catch (e) {
        console.error("Failed to calculate overlap pixels", e);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [images, scale, canvasSize]);

  // Responsive stage calculation
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        let newWidth = containerRef.current.offsetWidth;
        // On very wide screens, cap it at max-w-md
        if (newWidth > 448) newWidth = 448;
        setScale(newWidth / canvasSize);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [canvasSize]);

  const updateSelectedImage = useCallback(
    (updateFn: (img: ImageNode) => ImageNode) => {
      setImages((prev) =>
        prev.map((img) => (img.id === selectedId ? updateFn(img) : img)),
      );
    },
    [selectedId],
  );

  const moveUp = useCallback(
    () => updateSelectedImage((img) => ({ ...img, y: img.y - 1 })),
    [updateSelectedImage],
  );
  const moveDown = useCallback(
    () => updateSelectedImage((img) => ({ ...img, y: img.y + 1 })),
    [updateSelectedImage],
  );
  const moveLeft = useCallback(
    () => updateSelectedImage((img) => ({ ...img, x: img.x - 1 })),
    [updateSelectedImage],
  );
  const moveRight = useCallback(
    () => updateSelectedImage((img) => ({ ...img, x: img.x + 1 })),
    [updateSelectedImage],
  );
  const autoCenterX = useCallback(
    () =>
      updateSelectedImage((img) => {
        const contentMinX = img.contentMinX ?? 0;
        const contentMaxX = img.contentMaxX ?? img.width ?? 0;
        const contentCenterX = (contentMinX + contentMaxX) / 2;

        const contentMinY = img.contentMinY ?? 0;
        const contentMaxY = img.contentMaxY ?? img.height ?? 0;
        const contentCenterY = (contentMinY + contentMaxY) / 2;

        const rotRad = (img.rotation * Math.PI) / 180;
        const dx = contentCenterX - (img.cgX ?? 0);
        const dy = contentCenterY - (img.cgY ?? 0);

        const dxCanvas = dx * img.scaleX * Math.cos(rotRad) - dy * img.scaleY * Math.sin(rotRad);
        const newX = canvasSize / 2 - dxCanvas;

        return { ...img, x: newX };
      }),
    [updateSelectedImage, canvasSize],
  );
  const autoCenterY = useCallback(
    () =>
      updateSelectedImage((img) => {
        const contentMinX = img.contentMinX ?? 0;
        const contentMaxX = img.contentMaxX ?? img.width ?? 0;
        const contentCenterX = (contentMinX + contentMaxX) / 2;

        const contentMinY = img.contentMinY ?? 0;
        const contentMaxY = img.contentMaxY ?? img.height ?? 0;
        const contentCenterY = (contentMinY + contentMaxY) / 2;

        const rotRad = (img.rotation * Math.PI) / 180;
        const dx = contentCenterX - (img.cgX ?? 0);
        const dy = contentCenterY - (img.cgY ?? 0);

        const dyCanvas = dx * img.scaleX * Math.sin(rotRad) + dy * img.scaleY * Math.cos(rotRad);
        const newY = canvasSize / 2 - dyCanvas;

        return { ...img, y: newY };
      }),
    [updateSelectedImage, canvasSize],
  );
  const autoScale = useCallback(
    () =>
      updateSelectedImage((img) => {
        const contentMinX = img.contentMinX ?? 0;
        const contentMaxX = img.contentMaxX ?? img.width ?? canvasSize;
        const contentCenterX = (contentMinX + contentMaxX) / 2;

        const contentMinY = img.contentMinY ?? 0;
        const contentMaxY = img.contentMaxY ?? img.height ?? canvasSize;
        const contentCenterY = (contentMinY + contentMaxY) / 2;

        const PADDING = canvasSize * 0.025;
        const SAFE_MAX = canvasSize - PADDING;
        const SAFE_SIZE = SAFE_MAX - PADDING;

        const cWidth = contentMaxX - contentMinX;
        const cHeight = contentMaxY - contentMinY;
        const cMax = Math.max(cWidth, cHeight);

        const newScale = cMax > 0 ? SAFE_SIZE / cMax : 1;
        
        const rotRad = (img.rotation * Math.PI) / 180;
        const dx = contentCenterX - (img.cgX ?? 0);
        const dy = contentCenterY - (img.cgY ?? 0);
        const dxCanvas = dx * newScale * Math.cos(rotRad) - dy * newScale * Math.sin(rotRad);
        const dyCanvas = dx * newScale * Math.sin(rotRad) + dy * newScale * Math.cos(rotRad);

        const newX = canvasSize / 2 - dxCanvas;
        const newY = canvasSize / 2 - dyCanvas;

        return {
          ...img,
          x: newX,
          y: newY,
          scaleX: newScale,
          scaleY: newScale,
        };
      }),
    [updateSelectedImage, canvasSize],
  );
  const zoomIn = useCallback(
    () =>
      updateSelectedImage((img) => {
        const delta = img.width ? 1 / img.width : 0.01;
        return {
          ...img,
          scaleX: img.scaleX + delta,
          scaleY: img.scaleY + delta,
        };
      }),
    [updateSelectedImage],
  );
  const zoomOut = useCallback(
    () =>
      updateSelectedImage((img) => {
        const delta = img.width ? 1 / img.width : 0.01;
        return {
          ...img,
          scaleX: Math.max(0.001, img.scaleX - delta),
          scaleY: Math.max(0.001, img.scaleY - delta),
        };
      }),
    [updateSelectedImage],
  );
  const rotateLeft = useCallback(
    () =>
      updateSelectedImage((img) => ({ ...img, rotation: img.rotation - 1 })),
    [updateSelectedImage],
  );
  const rotateRight = useCallback(
    () =>
      updateSelectedImage((img) => ({ ...img, rotation: img.rotation + 1 })),
    [updateSelectedImage],
  );
  const updateOpacity = useCallback(
    (opacity: number) => {
      updateSelectedImage((img) => ({ ...img, opacity }));
    },
    [updateSelectedImage],
  );

  const resetImage = useCallback(() => {
    updateSelectedImage((img) => {
      if (!img.width || !img.height) return img;
      const maxDim = Math.max(img.width, img.height);
      const scale = canvasSize / maxDim;
      return {
        ...img,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        opacity: 1,
        x: canvasSize / 2 - (img.width * scale) / 2,
        y: canvasSize / 2 - (img.height * scale) / 2,
      };
    });
  }, [updateSelectedImage, canvasSize]);

  const moveLayerUp = useCallback(() => {
    setImages((prev) => {
      if (!selectedId) return prev;
      const index = prev.findIndex((img) => img.id === selectedId);
      if (index === -1 || index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, [selectedId]);

  const moveLayerDown = useCallback(() => {
    setImages((prev) => {
      if (!selectedId) return prev;
      const index = prev.findIndex((img) => img.id === selectedId);
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, [selectedId]);

  const selectedImage = images.find((img) => img.id === selectedId);

  const checkDeselect = (e: any) => {
    // deselect when clicked on empty area
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      const newImage: ImageNode = {
        id: uuidv4(),
        url,
        x: canvasSize / 2, // Centering is handled in URLImage after load
        y: canvasSize / 2,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      };
      setImages((prev) => [...prev, newImage]);
      setSelectedId(newImage.id); // auto-select new image
    }
    // clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file) => {
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          const newImage: ImageNode = {
            id: uuidv4(),
            url,
            x: canvasSize / 2,
            y: canvasSize / 2,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          };
          setImages((prev) => {
            const next = [...prev, newImage];
            setSelectedId(newImage.id);
            return next;
          });
        }
      });
    }
  };

  const handleDelete = () => {
    if (selectedId) {
      setImages((prev) => prev.filter((img) => img.id !== selectedId));
      setSelectedId(null);
    }
  };

  const handleExportPNG = () => {
    if (!stageRef.current) return;

    // Temporarily deselect so transformer handles don't show up in export
    const wasSelected = selectedId;
    setSelectedId(null);

    setTimeout(() => {
      try {
        const dataURL = stageRef.current.toDataURL({
          pixelRatio: 1 / scale, // Scale back up to canvasSize
          mimeType: "image/png",
        });
        const link = document.createElement("a");
        link.download = `mobile-canvas-${canvasSize}x${canvasSize}-${Date.now()}.png`;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        console.error("Failed to export PNG", e);
      } finally {
        // Restore selection
        if (wasSelected) setSelectedId(wasSelected);
      }
    }, 50);
  };

  const handleExportJPG = () => {
    if (!stageRef.current) return;

    // Temporarily deselect so transformer handles don't show up in export
    const wasSelected = selectedId;
    setSelectedId(null);

    setTimeout(() => {
      try {
        const stageCanvas = stageRef.current.toCanvas({ pixelRatio: 1 / scale });
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvasSize;
        tempCanvas.height = canvasSize;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          // Set white background
          tempCtx.fillStyle = "#ffffff";
          tempCtx.fillRect(0, 0, canvasSize, canvasSize);
          
          // Draw the stage canvas onto the white canvas (scaled up to fit)
          tempCtx.drawImage(stageCanvas, 0, 0, canvasSize, canvasSize);
          
          const dataURL = tempCanvas.toDataURL("image/jpeg", 0.95);
          const link = document.createElement("a");
          link.download = `mobile-canvas-${canvasSize}x${canvasSize}-${Date.now()}.jpg`;
          link.href = dataURL;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } catch (e) {
        console.error("Failed to export JPG", e);
      } finally {
        // Restore selection
        if (wasSelected) setSelectedId(wasSelected);
      }
    }, 50);
  };

  const handleExport = () => {
    if (exportFormat === "png") {
      handleExportPNG();
    } else {
      handleExportJPG();
    }
  };

  const updateOccupancyRate = () => {
    let totalArea = 0;
    for (const img of images) {
      if (img.nonTransparentArea) {
        // Multiply by absolute scales in case they are negative (though rare here, area is positive)
        totalArea +=
          img.nonTransparentArea * Math.abs(img.scaleX) * Math.abs(img.scaleY);
      }
    }
    const canvasArea = canvasSize * canvasSize;
    return ((totalArea / canvasArea) * 100).toFixed(2);
  };

  const occupancyRate = updateOccupancyRate();

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-gray-50 text-gray-900 overflow-hidden font-sans">
      {/* Header */}
      <header className="flex-none h-16 border-b border-gray-200 bg-white px-4 flex items-center justify-between shadow-sm z-10 w-full relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <h1 className="text-sm sm:text-lg font-semibold tracking-tight text-gray-900 leading-none">
              Lumina
            </h1>
            {/* Canvas Size Selector */}
            <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
              <button
                onClick={() => setCanvasSize(900)}
                className={`px-2 py-0.5 text-[10px] sm:text-xs font-bold rounded transition-all ${
                  canvasSize === 900
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                900 × 900
              </button>
              <button
                onClick={() => setCanvasSize(1080)}
                className={`px-2 py-0.5 text-[10px] sm:text-xs font-bold rounded transition-all ${
                  canvasSize === 1080
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                1080 × 1080
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center">
          <div className="flex items-center gap-1 mr-2 sm:mr-4 border-r border-gray-200 pr-2 sm:pr-4">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-1.5 sm:p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo"
            >
              <Undo2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-1.5 sm:p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redo"
            >
              <Redo2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Format Selection (PNG / JPG Selection) */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200">
              <button
                onClick={() => setExportFormat("png")}
                className={`px-2 py-1 text-[10px] sm:text-xs font-semibold rounded transition-all ${
                  exportFormat === "png"
                    ? "bg-white text-gray-900 shadow-sm font-bold"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                PNG
              </button>
              <button
                onClick={() => setExportFormat("jpg")}
                className={`px-2 py-1 text-[10px] sm:text-xs font-semibold rounded transition-all ${
                  exportFormat === "jpg"
                    ? "bg-white text-gray-900 shadow-sm font-bold"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                JPG
              </button>
            </div>

            <button
              onClick={handleExport}
              className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] sm:text-xs font-semibold hover:bg-blue-500 shadow-md transition-all flex items-center gap-1 cursor-pointer"
              title={`${exportFormat.toUpperCase()} (${canvasSize}x${canvasSize}) をエクスポート`}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">エクスポート</span>
              <span>{canvasSize}px</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main
        className={`flex-grow flex overflow-hidden relative flex-col items-center justify-center bg-gray-100 p-4 transition-colors ${isDragging ? "bg-blue-50" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-blue-500/20 flex items-center justify-center pointer-events-none">
            <div className="bg-white px-6 py-4 rounded-xl shadow-xl flex items-center gap-3">
              <Plus className="w-8 h-8 text-blue-600" />
              <span className="text-lg font-bold text-gray-800">
                Drop images here
              </span>
            </div>
          </div>
        )}
        {/* Abstract Responsive Wrapper */}
        <div className="w-full max-w-md aspect-square relative shadow-lg flex items-center justify-center border border-gray-200">
          {/* Canvas Container with Checkerboard for transparency indication */}
          <div
            ref={containerRef}
            className="w-full h-full bg-checkerboard absolute inset-0"
          >
            {/* The actual Konva canvas */}
            <Stage
              ref={stageRef}
              width={canvasSize * scale}
              height={canvasSize * scale}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={checkDeselect}
              onTouchStart={checkDeselect}
            >
              <Layer>
                {images.map((img, i) => (
                  <URLImage
                    key={img.id}
                    image={img}
                    isSelected={img.id === selectedId}
                    onSelect={() => setSelectedId(img.id)}
                    onChange={(newAttrs) => {
                      const imgs = images.slice();
                      imgs[i] = newAttrs;
                      setImages(imgs);
                    }}
                    logicalSize={canvasSize}
                  />
                ))}
              </Layer>
            </Stage>

            {/* Grid Overlay */}
            {showGrid && (
              <div className="absolute inset-0 pointer-events-none z-10 w-full h-full">
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${canvasSize} ${canvasSize}`}
                  preserveAspectRatio="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <pattern
                      id="smallGrid"
                      width={canvasSize / 16}
                      height={canvasSize / 16}
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        width={canvasSize / 16}
                        height={canvasSize / 16}
                        fill="none"
                      />
                      <path
                        d={`M ${canvasSize / 16} 0 L 0 0 0 ${canvasSize / 16}`}
                        fill="none"
                        stroke="#a0b3b0"
                        strokeWidth="2"
                      />
                    </pattern>
                    <pattern
                      id="grid"
                      width={canvasSize / 4}
                      height={canvasSize / 4}
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        width={canvasSize / 4}
                        height={canvasSize / 4}
                        fill="url(#smallGrid)"
                      />
                      <path
                        d={`M ${canvasSize / 4} 0 L 0 0 0 ${canvasSize / 4}`}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="4"
                      />
                    </pattern>
                  </defs>
                  {/* Fill with grid pattern */}
                  <rect width="100%" height="100%" fill="url(#grid)" />
                  {/* Padding Overlay */}
                  <path
                    d={`M 0 0 H ${canvasSize} V ${canvasSize} H 0 Z M ${canvasSize * 0.025} ${canvasSize * 0.025} V ${canvasSize - canvasSize * 0.025} H ${canvasSize - canvasSize * 0.025} V ${canvasSize * 0.025} Z`}
                    fill="rgba(128, 128, 128, 0.3)"
                    fillRule="evenodd"
                  />
                  {/* Outer border for the grid */}
                  <rect
                    width="100%"
                    height="100%"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="8"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Canvas Info */}
        <div className="w-full max-w-md px-2 mt-2 flex flex-col gap-1 text-xs text-gray-500 font-medium tracking-wide">
          <div className="flex justify-between items-center">
            <span>Occupancy Rate</span>
            <span className="text-gray-700 bg-gray-200/60 px-2 py-0.5 rounded">
              {occupancyRate}%
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Padding Overlap Pixels</span>
            <span className="text-gray-700 bg-gray-200/60 px-2 py-0.5 rounded">
              {overlapPixels.toLocaleString()} px
            </span>
          </div>
        </div>

        {/* Layers Area */}
        <div className="w-full max-w-md px-4 mt-4 flex gap-2 overflow-x-auto hide-scrollbar">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setSelectedId(img.id)}
              className={`w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                selectedId === img.id
                  ? "border-blue-600 shadow-md scale-105"
                  : "border-gray-200 opacity-60 hover:opacity-100 hover:border-gray-400"
              }`}
            >
              <img
                src={img.url}
                alt={`Layer ${i}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>

        {/* Info Text / Contextual Toolbar */}
        <div className="mt-4 flex flex-col items-center justify-center w-full max-w-md px-4">
          {selectedImage ? (
            <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-4 shadow-sm w-full">
              {/* Top Row: Movement and Zoom */}
              <div className="flex justify-between items-center w-full">
                <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                  <LongPressButton
                    onClick={moveUp}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </LongPressButton>
                  <LongPressButton
                    onClick={moveDown}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </LongPressButton>
                  <LongPressButton
                    onClick={moveLeft}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </LongPressButton>
                  <LongPressButton
                    onClick={moveRight}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </LongPressButton>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={autoCenterX}
                    title="Center Horizontally"
                    className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center justify-center"
                  >
                    <MoveHorizontal className="w-5 h-5" />
                  </button>
                  <button
                    onClick={autoCenterY}
                    title="Center Vertically"
                    className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center justify-center"
                  >
                    <MoveVertical className="w-5 h-5" />
                  </button>
                  <button
                    onClick={autoScale}
                    title="Auto Scale"
                    className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center justify-center"
                  >
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                  <LongPressButton
                    onClick={zoomOut}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </LongPressButton>
                  <LongPressButton
                    onClick={zoomIn}
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </LongPressButton>
                </div>
              </div>

              {/* Bottom Row: Rotation and Opacity Sliders */}
              <div className="flex gap-4 items-center">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 leading-none">
                      Rotate
                    </span>
                    <span className="text-[10px] font-mono text-blue-600 leading-none">
                      {Math.round(selectedImage.rotation)}°
                    </span>
                  </div>
                  <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                    <LongPressButton
                      onClick={rotateLeft}
                      className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors flex-1 flex justify-center"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </LongPressButton>
                    <div className="w-px bg-gray-200 mx-1"></div>
                    <LongPressButton
                      onClick={rotateRight}
                      className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors flex-1 flex justify-center"
                    >
                      <RotateCw className="w-4 h-4" />
                    </LongPressButton>
                  </div>
                </div>

                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 leading-none">
                      Opacity
                    </span>
                    <span className="text-[10px] font-mono text-blue-600 leading-none">
                      {Math.round((selectedImage.opacity ?? 1) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedImage.opacity ?? 1}
                    onChange={(e) => updateOpacity(parseFloat(e.target.value))}
                    className="sleek-slider"
                  />
                </div>
              </div>

              {/* Action Row: Layers and Reset */}
              <div className="flex justify-between items-center w-full">
                <div className="flex gap-2">
                  <button
                    onClick={moveLayerDown}
                    className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors flex items-center gap-1"
                  >
                    <ArrowDown className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Back
                    </span>
                  </button>
                  <button
                    onClick={moveLayerUp}
                    className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors flex items-center gap-1"
                  >
                    <ArrowUp className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Front
                    </span>
                  </button>
                </div>
                <button
                  onClick={resetImage}
                  className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 transition-colors flex items-center gap-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Reset
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="h-14 flex items-center justify-center">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Active Workspace
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Bottom Toolbar */}
      <footer className="flex-none bg-white border-t border-gray-200 pb-safe z-10 w-full relative">
        <div className="flex h-24 w-full max-w-md mx-auto items-center justify-between px-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 group w-[60px]"
          >
            <div className="p-3 bg-gray-50 text-blue-600 rounded-xl shadow-inner group-hover:bg-gray-100 transition-colors border border-gray-200">
              <Plus className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-bold tracking-wider uppercase text-gray-500 group-hover:text-blue-600 transition-colors truncate w-full text-center">
              Add
            </span>
          </button>

          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 group w-[60px]"
          >
            <div className="p-3 bg-gray-50 text-blue-600 rounded-xl shadow-inner group-hover:bg-gray-100 transition-colors border border-gray-200">
              <ImageIcon className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-bold tracking-wider uppercase text-gray-500 group-hover:text-blue-600 transition-colors truncate w-full text-center">
              Image
            </span>
          </button>

          <div className="w-px h-10 bg-gray-200"></div>

          <button
            onClick={() => setShowGrid(!showGrid)}
            className="flex flex-col items-center justify-center gap-1.5 group w-[60px]"
          >
            <div
              className={`p-3 rounded-xl transition-colors border ${
                showGrid
                  ? "bg-gray-50 border-gray-300 text-gray-900 shadow-sm"
                  : "bg-transparent border-transparent text-gray-400 group-hover:bg-gray-50"
              }`}
            >
              <Grid3X3 className="w-6 h-6" />
            </div>
            <span
              className={`text-[9px] font-bold tracking-wider uppercase transition-colors truncate w-full text-center ${
                showGrid
                  ? "text-gray-900"
                  : "text-gray-400 group-hover:text-gray-900"
              }`}
            >
              Grid
            </span>
          </button>

          <div className="w-px h-10 bg-gray-200"></div>

          <button
            onClick={handleDelete}
            disabled={!selectedId}
            className={`flex flex-col items-center justify-center gap-1.5 group transition-colors w-[60px] ${
              selectedId
                ? "text-gray-900 cursor-pointer"
                : "text-gray-400 cursor-not-allowed"
            }`}
          >
            <div
              className={`p-3 rounded-xl transition-colors border ${
                selectedId
                  ? "bg-gray-50 hover:bg-gray-100 border-gray-300 text-gray-900 shadow-sm"
                  : "bg-transparent border-transparent text-gray-400"
              }`}
            >
              <Trash2 className="w-6 h-6" />
            </div>
            <span
              className={`text-[9px] font-bold tracking-wider uppercase transition-colors truncate w-full text-center ${
                selectedId
                  ? "text-gray-500 group-hover:text-gray-900"
                  : "text-gray-400"
              }`}
            >
              Delete
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}

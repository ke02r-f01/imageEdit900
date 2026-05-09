import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Trash2, Download, Image as ImageIcon, Grid3X3, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw, RotateCw } from 'lucide-react';

const LOGICAL_SIZE = 900;

interface ImageNode {
  id: string;
  url: string;
  x: number;
  y: number;
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

  const start = useCallback((e: any) => {
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
  }, [onClick, disabled]);

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
      style={{ touchAction: 'none', userSelect: 'none' }}
    >
      {children}
    </button>
  );
};

// Separate component for each image to handle useImage hook and Transformers properly
const URLImage = ({
  image,
  isSelected,
  onSelect,
  onChange,
}: {
  image: ImageNode;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: ImageNode) => void;
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
      const maxDim = Math.max(img.width, img.height);
      const scale = LOGICAL_SIZE / maxDim;
      
      onChange({
        ...image,
        width: img.width,
        height: img.height,
        scaleX: scale,
        scaleY: scale,
        // center it
        x: LOGICAL_SIZE / 2 - (img.width * scale) / 2,
        y: LOGICAL_SIZE / 2 - (img.height * scale) / 2,
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

export default function App() {
  const [images, setImages] = useState<ImageNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(1);

  // Responsive stage calculation
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        let newWidth = containerRef.current.offsetWidth;
        // On very wide screens, cap it at max-w-md
        if (newWidth > 448) newWidth = 448;
        setScale(newWidth / LOGICAL_SIZE);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const updateSelectedImage = useCallback((updateFn: (img: ImageNode) => ImageNode) => {
    setImages(prev => prev.map(img => img.id === selectedId ? updateFn(img) : img));
  }, [selectedId]);

  const moveUp = useCallback(() => updateSelectedImage(img => ({ ...img, y: img.y - 1 })), [updateSelectedImage]);
  const moveDown = useCallback(() => updateSelectedImage(img => ({ ...img, y: img.y + 1 })), [updateSelectedImage]);
  const moveLeft = useCallback(() => updateSelectedImage(img => ({ ...img, x: img.x - 1 })), [updateSelectedImage]);
  const moveRight = useCallback(() => updateSelectedImage(img => ({ ...img, x: img.x + 1 })), [updateSelectedImage]);
  const zoomIn = useCallback(() => updateSelectedImage(img => {
      const delta = img.width ? 1 / img.width : 0.01;
      return { ...img, scaleX: img.scaleX + delta, scaleY: img.scaleY + delta };
  }), [updateSelectedImage]);
  const zoomOut = useCallback(() => updateSelectedImage(img => {
      const delta = img.width ? 1 / img.width : 0.01;
      return { ...img, scaleX: Math.max(0.001, img.scaleX - delta), scaleY: Math.max(0.001, img.scaleY - delta) };
  }), [updateSelectedImage]);
  const rotateLeft = useCallback(() => updateSelectedImage(img => ({ ...img, rotation: img.rotation - 1 })), [updateSelectedImage]);
  const rotateRight = useCallback(() => updateSelectedImage(img => ({ ...img, rotation: img.rotation + 1 })), [updateSelectedImage]);
  const updateOpacity = useCallback((opacity: number) => {
    updateSelectedImage(img => ({ ...img, opacity }));
  }, [updateSelectedImage]);

  const resetImage = useCallback(() => {
    updateSelectedImage(img => {
      if (!img.width || !img.height) return img;
      const maxDim = Math.max(img.width, img.height);
      const scale = LOGICAL_SIZE / maxDim;
      return {
        ...img,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        opacity: 1,
        x: LOGICAL_SIZE / 2 - (img.width * scale) / 2,
        y: LOGICAL_SIZE / 2 - (img.height * scale) / 2,
      };
    });
  }, [updateSelectedImage]);

  const moveLayerUp = useCallback(() => {
    setImages(prev => {
      if (!selectedId) return prev;
      const index = prev.findIndex(img => img.id === selectedId);
      if (index === -1 || index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, [selectedId]);

  const moveLayerDown = useCallback(() => {
    setImages(prev => {
      if (!selectedId) return prev;
      const index = prev.findIndex(img => img.id === selectedId);
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, [selectedId]);

  const selectedImage = images.find(img => img.id === selectedId);

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
        x: LOGICAL_SIZE / 2, // Centering is handled in URLImage after load
        y: LOGICAL_SIZE / 2,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      };
      setImages((prev) => [...prev, newImage]);
      setSelectedId(newImage.id); // auto-select new image
    }
    // clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = () => {
    if (selectedId) {
      setImages((prev) => prev.filter((img) => img.id !== selectedId));
      setSelectedId(null);
    }
  };

  const handleExport = () => {
    if (!stageRef.current) return;
    
    // Temporarily deselect so transformer handles don't show up in export
    const wasSelected = selectedId;
    setSelectedId(null);

    setTimeout(() => {
      const dataURL = stageRef.current.toDataURL({
        pixelRatio: 1 / scale, // Scale back up to 900x900
        mimeType: 'image/png'
      });
      const link = document.createElement('a');
      link.download = `mobile-canvas-${Date.now()}.png`;
      link.href = dataURL;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Restore selection
      if (wasSelected) setSelectedId(wasSelected);
    }, 50);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-gray-50 text-gray-900 overflow-hidden font-sans">
      
      {/* Header */}
      <header className="flex-none h-16 border-b border-gray-200 bg-white px-4 flex items-center justify-between shadow-sm z-10 w-full relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">Lumina <span className="text-gray-500 font-normal ml-2 hidden sm:inline">900 × 900</span></h1>
        </div>
        <div className="flex items-center">
          <button 
            onClick={handleExport}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-500 shadow-lg shadow-blue-600/20 transition-colors flex items-center gap-2"
            aria-label="Export Image"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-grow flex overflow-hidden relative flex-col items-center justify-center bg-gray-100 p-4">
        
        {/* Abstract Responsive Wrapper */}
        <div className="w-full max-w-md aspect-square relative shadow-lg rounded-xl overflow-hidden flex items-center justify-center border border-gray-200">
          
          {/* Canvas Container with Checkerboard for transparency indication */}
          <div 
            ref={containerRef}
            className="w-full h-full bg-checkerboard absolute inset-0"
          >
            {/* The actual Konva canvas */}
            <Stage
              ref={stageRef}
              width={LOGICAL_SIZE * scale}
              height={LOGICAL_SIZE * scale}
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
                  />
                ))}
              </Layer>
            </Stage>

            {/* Grid Overlay */}
            {showGrid && (
              <div className="absolute inset-0 pointer-events-none z-10 w-full h-full">
                <svg width="100%" height="100%" viewBox={`0 0 ${LOGICAL_SIZE} ${LOGICAL_SIZE}`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="smallGrid" width={LOGICAL_SIZE/16} height={LOGICAL_SIZE/16} patternUnits="userSpaceOnUse">
                      <rect width={LOGICAL_SIZE/16} height={LOGICAL_SIZE/16} fill="none" />
                      <path d={`M ${LOGICAL_SIZE/16} 0 L 0 0 0 ${LOGICAL_SIZE/16}`} fill="none" stroke="#a0b3b0" strokeWidth="2" />
                    </pattern>
                    <pattern id="grid" width={LOGICAL_SIZE/4} height={LOGICAL_SIZE/4} patternUnits="userSpaceOnUse">
                      <rect width={LOGICAL_SIZE/4} height={LOGICAL_SIZE/4} fill="url(#smallGrid)" />
                      <path d={`M ${LOGICAL_SIZE/4} 0 L 0 0 0 ${LOGICAL_SIZE/4}`} fill="none" stroke="#3b82f6" strokeWidth="4" />
                    </pattern>
                  </defs>
                  {/* Fill with grid pattern */}
                  <rect width="100%" height="100%" fill="url(#grid)" />
                  {/* Outer border for the grid */}
                  <rect width="100%" height="100%" fill="none" stroke="#3b82f6" strokeWidth="8" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Info Text / Contextual Toolbar */}
        <div className="mt-4 flex flex-col items-center justify-center w-full max-w-md px-4">
          {selectedImage ? (
            <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-4 shadow-sm w-full">
              {/* Top Row: Movement and Zoom */}
              <div className="flex justify-between items-center w-full">
                <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                  <LongPressButton onClick={moveUp} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ChevronUp className="w-5 h-5"/></LongPressButton>
                  <LongPressButton onClick={moveDown} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ChevronDown className="w-5 h-5"/></LongPressButton>
                  <LongPressButton onClick={moveLeft} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ChevronLeft className="w-5 h-5"/></LongPressButton>
                  <LongPressButton onClick={moveRight} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ChevronRight className="w-5 h-5"/></LongPressButton>
                </div>
                <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                  <LongPressButton onClick={zoomOut} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ZoomOut className="w-5 h-5"/></LongPressButton>
                  <LongPressButton onClick={zoomIn} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"><ZoomIn className="w-5 h-5"/></LongPressButton>
                </div>
              </div>
              
              {/* Bottom Row: Rotation and Opacity Sliders */}
              <div className="flex gap-4 items-center">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 leading-none">Rotate</span>
                    <span className="text-[10px] font-mono text-blue-600 leading-none">{Math.round(selectedImage.rotation)}°</span>
                  </div>
                  <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-100">
                    <LongPressButton onClick={rotateLeft} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors flex-1 flex justify-center"><RotateCcw className="w-4 h-4"/></LongPressButton>
                    <div className="w-px bg-gray-200 mx-1"></div>
                    <LongPressButton onClick={rotateRight} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors flex-1 flex justify-center"><RotateCw className="w-4 h-4"/></LongPressButton>
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 leading-none">Opacity</span>
                    <span className="text-[10px] font-mono text-blue-600 leading-none">{Math.round((selectedImage.opacity ?? 1) * 100)}%</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.01" value={selectedImage.opacity ?? 1} onChange={(e) => updateOpacity(parseFloat(e.target.value))} className="sleek-slider" />
                </div>
              </div>

              {/* Action Row: Layers and Reset */}
              <div className="flex justify-between items-center w-full">
                <div className="flex gap-2">
                  <button onClick={moveLayerDown} className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors flex items-center gap-1">
                    <ArrowDown className="w-4 h-4"/>
                    <span className="text-[10px] font-bold uppercase tracking-wider">Back</span>
                  </button>
                  <button onClick={moveLayerUp} className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors flex items-center gap-1">
                    <ArrowUp className="w-4 h-4"/>
                    <span className="text-[10px] font-bold uppercase tracking-wider">Front</span>
                  </button>
                </div>
                <button onClick={resetImage} className="px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 transition-colors flex items-center gap-1">
                  <RotateCcw className="w-4 h-4"/>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Reset</span>
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
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Bottom Toolbar */}
      <footer className="flex-none bg-white border-t border-gray-200 pb-safe z-10 w-full relative">
        <div className="flex h-24 w-full max-w-md mx-auto items-center justify-center gap-8 px-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 group w-16"
          >
            <div className="p-3 bg-gray-50 text-blue-600 rounded-xl shadow-inner group-hover:bg-gray-100 transition-colors border border-gray-200">
              <Plus className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500 group-hover:text-blue-600 transition-colors">Add</span>
          </button>

          <div className="w-px h-10 bg-gray-200"></div>

          <button
            onClick={() => setShowGrid(!showGrid)}
            className="flex flex-col items-center justify-center gap-1.5 group w-16"
          >
            <div className={`p-3 rounded-xl transition-colors border ${
              showGrid 
                ? 'bg-gray-50 border-gray-300 text-gray-900 shadow-sm' 
                : 'bg-transparent border-transparent text-gray-400 group-hover:bg-gray-50'
            }`}>
              <Grid3X3 className="w-6 h-6" />
            </div>
            <span className={`text-[10px] font-bold tracking-wider uppercase transition-colors ${
              showGrid ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-900'
            }`}>Grid</span>
          </button>

          <div className="w-px h-10 bg-gray-200"></div>

          <button
            onClick={handleDelete}
            disabled={!selectedId}
            className={`flex flex-col items-center justify-center gap-1.5 group transition-colors w-16 ${
              selectedId ? 'text-gray-900 cursor-pointer' : 'text-gray-400 cursor-not-allowed'
            }`}
          >
            <div className={`p-3 rounded-xl transition-colors border ${
              selectedId 
                ? 'bg-gray-50 hover:bg-gray-100 border-gray-300 text-gray-900 shadow-sm' 
                : 'bg-transparent border-transparent text-gray-400'
            }`}>
              <Trash2 className="w-6 h-6" />
            </div>
            <span className={`text-[10px] font-bold tracking-wider uppercase transition-colors ${
              selectedId ? 'text-gray-500 group-hover:text-gray-900' : 'text-gray-400'
            }`}>Delete</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
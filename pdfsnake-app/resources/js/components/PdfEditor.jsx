import React, { useState } from 'react';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import PdfCanvasPreview, { PAPER_SIZES } from './PdfCanvasPreview';

export default function PdfEditor() {
  // --- File State ---
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfPages, setPdfPages] = useState([]);
  
  // --- General Layout State ---
  const [mode, setMode] = useState('grid'); // 'grid' | 'booklet'
  const [paperSizeKey, setPaperSizeKey] = useState('A3');
  const [customPaperWidth, setCustomPaperWidth] = useState('300');
  const [customPaperHeight, setCustomPaperHeight] = useState('300');
  const [orientation, setOrientation] = useState('landscape');
  
  // --- Grid Settings (mm) ---
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [gutterX, setGutterX] = useState(5); // khoảng cách cột
  const [gutterY, setGutterY] = useState(5); // khoảng cách hàng
  
  // --- Booklet Settings ---
  const [bookletBinding, setBookletBinding] = useState('left'); // 'left' | 'right'
  const [bookletCreep, setBookletCreep] = useState(0); // mm

  // --- Common Margins (mm) ---
  const [marginTop, setMarginTop] = useState(10);
  const [marginBottom, setMarginBottom] = useState(10);
  const [marginLeft, setMarginLeft] = useState(10);
  const [marginRight, setMarginRight] = useState(10);
  const [cropMarks, setCropMarks] = useState(true);

  // --- UI Control State ---
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const [totalSheets, setTotalSheets] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Ngăn chặn mặc định trình duyệt mở file khi kéo thả bên ngoài vùng tải lên
  React.useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  // Lấy kích thước thật dựa trên đơn vị mm
  const getPaperDimensions = () => {
    let width = 0;
    let height = 0;
    if (paperSizeKey === 'Custom') {
      width = parseFloat(customPaperWidth) || 300;
      height = parseFloat(customPaperHeight) || 300;
    } else {
      const size = PAPER_SIZES[paperSizeKey] || PAPER_SIZES.A3;
      width = size.width;
      height = size.height;
    }
    if (orientation === 'landscape') {
      return { width: Math.max(width, height), height: Math.min(width, height) };
    }
    return { width: Math.min(width, height), height: Math.max(width, height) };
  };

  // Reset về trang 0 nếu lật chế độ hoặc đổi lưới
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setCurrentSheetIndex(0);
  };

  // Tự động tối ưu số lượng trang con lên tờ in lớn (Auto-Optimize Layout)
  const handleAutoOptimize = () => {
    if (!pdfPages || pdfPages.length === 0) {
      return;
    }

    const firstPage = pdfPages[0];
    const MM_TO_POINTS = 72 / 25.4; // 1 mm = 2.8346 points
    const cardWidth = firstPage.width / MM_TO_POINTS; // Đổi sang mm
    const cardHeight = firstPage.height / MM_TO_POINTS; // Đổi sang mm

    const dim = getPaperDimensions(); // Chiều rộng & cao tờ in lớn (mm)

    // Tính phương án A: Card xếp nằm ngang bình thường
    const colsA = Math.floor((dim.width + gutterX) / (cardWidth + gutterX)) || 1;
    const rowsA = Math.floor((dim.height + gutterY) / (cardHeight + gutterY)) || 1;
    const totalA = colsA * rowsA;

    // Tính phương án B: Card xoay đứng 90 độ
    const colsB = Math.floor((dim.width + gutterX) / (cardHeight + gutterX)) || 1;
    const rowsB = Math.floor((dim.height + gutterY) / (cardWidth + gutterY)) || 1;
    const totalB = colsB * rowsB;

    let bestCols = colsA;
    let bestRows = rowsA;
    let bestCardW = cardWidth;
    let bestCardH = cardHeight;

    if (totalB > totalA) {
      bestCols = colsB;
      bestRows = rowsB;
      bestCardW = cardHeight;
      bestCardH = cardWidth;
      console.log('Chọn phương án tối ưu xoay card đứng để đạt số lượng tối đa.');
    }

    // Cập nhật số cột & số dòng tối ưu
    setCols(bestCols);
    setRows(bestRows);

    // Tính toán lại Margins để căn giữa khung in một cách hoàn mỹ
    const usedWidth = bestCols * bestCardW + (bestCols - 1) * gutterX;
    const usedHeight = bestRows * bestCardH + (bestRows - 1) * gutterY;

    const remainingWidth = Math.max(0, dim.width - usedWidth);
    const remainingHeight = Math.max(0, dim.height - usedHeight);

    // Chia đều lề trái/phải, trên/dưới
    const sideMargin = Math.round((remainingWidth / 2) * 10) / 10;
    const verticalMargin = Math.round((remainingHeight / 2) * 10) / 10;

    setMarginLeft(sideMargin);
    setMarginRight(sideMargin);
    setMarginTop(verticalMargin);
    setMarginBottom(verticalMargin);

    setSuccess(false);
    setError(null);
  };

  // Kích hoạt tự động tối ưu hóa khi người dùng tải PDF lên hoặc thay đổi khổ giấy/hướng xoay
  React.useEffect(() => {
    if (pdfPages && pdfPages.length > 0) {
      handleAutoOptimize();
    }
  }, [pdfPages, paperSizeKey, customPaperWidth, customPaperHeight, orientation]);

  // Sinh dữ liệu JSON các bước cho PDF Snake API V2
  // Tham khảo cấu trúc từ test_cards_step.json (đã hoạt động thành công)
  const generateStepsJson = () => {
    const dim = getPaperDimensions();
    const MM_TO_POINTS = 72 / 25.4; // 1 mm = 2.8346 points

    const paperWidthPt = dim.width * MM_TO_POINTS;
    const paperHeightPt = dim.height * MM_TO_POINTS;
    const leftMarginPt = marginLeft * MM_TO_POINTS;
    const topMarginPt = marginTop * MM_TO_POINTS;
    const rightMarginPt = marginRight * MM_TO_POINTS;
    const bottomMarginPt = marginBottom * MM_TO_POINTS;
    const gutterXPt = gutterX * MM_TO_POINTS;
    const gutterYPt = gutterY * MM_TO_POINTS;
    const lineLen = 28.34645669291339; // ~10mm crop mark length

    if (mode === 'grid') {
      return [
        {
          kind: 'Cards',
          paperWidth: paperWidthPt,
          paperHeight: paperHeightPt,
          leftMargin: leftMarginPt,
          topMargin: topMarginPt,
          verticalGutterWidth: gutterYPt,
          horizontalGutterWidth: gutterXPt,
          center: true,
          pageOrder: 'stepAndRepeat',
          doubleSided: false,
          repeat: 1,
          newStackOrder: true,
          cropMarks: cropMarks,
          marksInGutters: true,
          centerMarks: false,
          lineLength: lineLen,
          lineThickness: 1,
          lineDistance: 10,
          fourColorBlack: false,
          whiteBorder: false,
          bleeds: 'pullFromDoc',
          fixedBleedLeft: 14.4,
          fixedBleedTop: 14.4,
          direction: 'leftToRight',
          columns: parseInt(cols) || 1,
          rows: parseInt(rows) || 1,
          preserveAspectRatio: true,
          scale: true
        }
      ];
    } else {
      return [
        {
          kind: 'Booklet',
          paperWidth: paperWidthPt,
          paperHeight: paperHeightPt,
          leftMargin: leftMarginPt,
          topMargin: topMarginPt,
          rightMargin: rightMarginPt,
          bottomMargin: bottomMarginPt,
          binding: bookletBinding,
          creep: bookletCreep * MM_TO_POINTS,
          center: true,
          doubleSided: true,
          cropMarks: cropMarks,
          marksInGutters: false,
          centerMarks: false,
          lineLength: lineLen,
          lineThickness: 1,
          lineDistance: 10,
          fourColorBlack: false,
          whiteBorder: false,
          bleeds: 'pullFromDoc',
          fixedBleedLeft: 14.4,
          fixedBleedTop: 14.4,
          direction: 'leftToRight',
          preserveAspectRatio: true,
          scale: true
        }
      ];
    }
  };

  const handleDownload = async () => {
    if (!pdfFile) {
      setError('Vui lòng chọn file PDF để tiến hành xử lý!');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const pdfBytes = await pdfFile.arrayBuffer();
      const srcDoc = await PDFDocument.load(pdfBytes);
      const destDoc = await PDFDocument.create();

      const dim = getPaperDimensions();
      const MM_TO_POINTS = 72 / 25.4; // 1 mm = 2.8346 points

      const paperWidthPt = dim.width * MM_TO_POINTS;
      const paperHeightPt = dim.height * MM_TO_POINTS;
      const leftMarginPt = marginLeft * MM_TO_POINTS;
      const topMarginPt = marginTop * MM_TO_POINTS;
      const rightMarginPt = marginRight * MM_TO_POINTS;
      const bottomMarginPt = marginBottom * MM_TO_POINTS;
      const gutterXPt = gutterX * MM_TO_POINTS;
      const gutterYPt = gutterY * MM_TO_POINTS;
      const lineLen = 28.34645669291339; // ~10mm crop mark length

      const srcPages = srcDoc.getPages();
      const numSrcPages = srcPages.length;
      const embeddedPages = await destDoc.embedPages(srcPages);

      if (mode === 'grid') {
        const pagesPerSheet = cols * rows;
        let totalSheets = 1;

        if (numSrcPages <= 2) {
          totalSheets = numSrcPages;
        } else {
          totalSheets = Math.ceil(numSrcPages / pagesPerSheet);
        }

        // Tính toán kích thước ô lưới
        const printableWidth = dim.width - marginLeft - marginRight;
        const printableHeight = dim.height - marginTop - marginBottom;
        const cellWidth = ((printableWidth - (cols - 1) * gutterX) / cols) * MM_TO_POINTS;
        const cellHeight = ((printableHeight - (rows - 1) * gutterY) / rows) * MM_TO_POINTS;

        for (let s = 0; s < totalSheets; s++) {
          const destPage = destDoc.addPage([paperWidthPt, paperHeightPt]);
          
          // Trực quan hóa các ô lưới và vẽ trang
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              let pageIndex = 0;
              if (numSrcPages <= 2) {
                pageIndex = s;
              } else {
                pageIndex = s * pagesPerSheet + (r * cols + c);
              }

              if (pageIndex < embeddedPages.length) {
                const embeddedPage = embeddedPages[pageIndex];
                const cardW = embeddedPage.width;
                const cardH = embeddedPage.height;

                // Tọa độ góc dưới bên trái của ô trong hệ tọa độ PDF (gốc 0,0 ở góc dưới trái giấy)
                const cellLeft = leftMarginPt + c * (cellWidth + gutterXPt);
                const cellTopFromTop = topMarginPt + r * (cellHeight + gutterYPt);
                const cellBottom = paperHeightPt - cellTopFromTop - cellHeight;

                // Tỷ lệ co giãn
                let scaleFactor = 1.0;
                let drawW = cardW;
                let drawH = cardH;
                let offsetX = 0;
                let offsetY = 0;

                const cellAspect = cellWidth / cellHeight;
                const cardAspect = cardW / cardH;

                const shouldRotate = (cardAspect > 1 && cellAspect < 1) || (cardAspect < 1 && cellAspect > 1);
                const effectiveAspectRatio = shouldRotate ? (1 / cardAspect) : cardAspect;

                if (effectiveAspectRatio > cellAspect) {
                  drawW = cellWidth;
                  drawH = cellWidth / effectiveAspectRatio;
                  offsetY = (cellHeight - drawH) / 2;
                } else {
                  drawW = cellHeight * effectiveAspectRatio;
                  drawH = cellHeight;
                  offsetX = (cellWidth - drawW) / 2;
                }

                const x = cellLeft + offsetX;
                const y = cellBottom + offsetY;

                // Vẽ trang con
                if (shouldRotate) {
                  destPage.drawPage(embeddedPage, {
                    x: x + drawW,
                    y,
                    width: drawH,
                    height: drawW,
                    rotate: degrees(90),
                  });
                } else {
                  destPage.drawPage(embeddedPage, {
                    x,
                    y,
                    width: drawW,
                    height: drawH,
                  });
                }

                // Vẽ Crop Marks (Vạch cắt)
                if (cropMarks) {
                  const x1 = x;
                  const y1 = y;
                  const x2 = x + drawW;
                  const y2 = y + drawH;
                  const dist = 10; // Khoảng cách 10pt (~3.5mm) từ vạch cắt tới card
                  const thickness = 0.5;
                  const color = rgb(0.93, 0.27, 0.27); // Màu đỏ

                  // Góc dưới - trái
                  destPage.drawLine({ start: { x: x1 - dist - lineLen, y: y1 }, end: { x: x1 - dist, y: y1 }, thickness, color });
                  destPage.drawLine({ start: { x: x1, y: y1 - dist - lineLen }, end: { x: x1, y: y1 - dist }, thickness, color });

                  // Góc dưới - phải
                  destPage.drawLine({ start: { x: x2 + dist, y: y1 }, end: { x: x2 + dist + lineLen, y: y1 }, thickness, color });
                  destPage.drawLine({ start: { x: x2, y: y1 - dist - lineLen }, end: { x: x2, y: y1 - dist }, thickness, color });

                  // Góc trên - trái
                  destPage.drawLine({ start: { x: x1 - dist - lineLen, y: y2 }, end: { x: x1 - dist, y: y2 }, thickness, color });
                  destPage.drawLine({ start: { x: x1, y: y2 + dist }, end: { x: x1, y: y2 + dist + lineLen }, thickness, color });

                  // Góc trên - phải
                  destPage.drawLine({ start: { x: x2 + dist, y: y2 }, end: { x: x2 + dist + lineLen, y: y2 }, thickness, color });
                  destPage.drawLine({ start: { x: x2, y: y2 + dist }, end: { x: x2, y: y2 + dist + lineLen }, thickness, color });
                }
              }
            }
          }
        }
      } else {
        // Chế độ Booklet
        const docPages = embeddedPages.length;
        const bookletPagesCount = Math.ceil(docPages / 4) * 4;
        const totalSheets = bookletPagesCount / 2;

        const cellWidth = paperWidthPt / 2;
        const cellHeight = paperHeightPt;

        for (let s = 0; s < totalSheets; s++) {
          const destPage = destDoc.addPage([paperWidthPt, paperHeightPt]);
          const isBack = s % 2 !== 0;
          const signatureIndex = Math.floor(s / 2);

          const leftPageNum = isBack 
            ? (2 * signatureIndex + 2) 
            : (bookletPagesCount - 2 * signatureIndex);
          const rightPageNum = isBack 
            ? (bookletPagesCount - 2 * signatureIndex - 1) 
            : (2 * signatureIndex + 1);

          const pageIndices = [leftPageNum - 1, rightPageNum - 1];

          for (let c = 0; c < 2; c++) {
            const pageIndex = pageIndices[c];
            if (pageIndex < docPages) {
              const embeddedPage = embeddedPages[pageIndex];
              const cardW = embeddedPage.width;
              const cardH = embeddedPage.height;

              const cellLeft = c * cellWidth;
              const cellBottom = 0;

              const cellAspect = cellWidth / cellHeight;
              const cardAspect = cardW / cardH;
              let scaleFactor = 1.0;
              let drawW = cardW;
              let drawH = cardH;
              let offsetX = 0;
              let offsetY = 0;

              if (cardAspect > cellAspect) {
                scaleFactor = cellWidth / cardW;
                drawW = cellWidth;
                drawH = cardH * scaleFactor;
                offsetY = (cellHeight - drawH) / 2;
              } else {
                scaleFactor = cellHeight / cardH;
                drawW = cardW * scaleFactor;
                drawH = cellHeight;
                offsetX = (cellWidth - drawW) / 2;
              }

              destPage.drawPage(embeddedPage, {
                x: cellLeft + offsetX,
                y: cellBottom + offsetY,
                width: drawW,
                height: drawH,
              });
            }
          }
        }
      }

      // Lưu file và tải xuống
      const pdfBytesOutput = await destDoc.save();
      const blob = new Blob([pdfBytesOutput], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imposed_local_${pdfFile.name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Đã xảy ra lỗi trong quá trình tự dàn trang.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-900 text-slate-100 font-sans">
      
      {/* 1. Sidebar Control Panel */}
      <div className="w-full lg:w-96 bg-slate-850 border-b lg:border-b-0 lg:border-r border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto max-h-screen">
        
        {/* Logo / Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/20">
            🐍
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">PDF Imposer Editor</h1>
            <p className="text-xs text-slate-400">Thiết kế bởi Antigravity</p>
          </div>
        </div>

        <hr className="border-slate-850" />

        {/* Step 1: File Upload */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-slate-300">1. Tải lên file PDF gốc</label>
          <div className="relative border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer bg-slate-800/40 transition-colors">
            <input 
              type="file" 
              accept=".pdf" 
              onChange={(e) => {
                if (e.target.files[0]) {
                  setPdfFile(e.target.files[0]);
                  setCurrentSheetIndex(0);
                  setError(null);
                  setSuccess(false);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <span className="text-2xl mb-1">📄</span>
            <span className="text-xs text-slate-400 font-medium text-center">
              {pdfFile ? pdfFile.name : 'Nhấp hoặc kéo thả PDF vào đây'}
            </span>
          </div>
        </div>

        {/* Step 2: Imposition Mode */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-slate-300">2. Kiểu bình trang (Imposition)</label>
          <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => handleModeChange('grid')}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                mode === 'grid' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dàn lưới (Grid)
            </button>
            <button
              onClick={() => handleModeChange('booklet')}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                mode === 'booklet' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Làm sách (Booklet)
            </button>
          </div>
        </div>

        {/* Step 3: Paper Size Settings */}
        <div className="flex flex-col gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-800/50">
          <h3 className="text-sm font-bold text-indigo-400">Khổ giấy in thành phẩm</h3>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-medium">Khổ giấy</label>
            <select
              value={paperSizeKey}
              onChange={(e) => setPaperSizeKey(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {Object.keys(PAPER_SIZES).map((key) => (
                <option key={key} value={key}>{PAPER_SIZES[key].name}</option>
              ))}
            </select>
          </div>

          {paperSizeKey === 'Custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">Rộng (mm)</label>
                <input 
                  type="number" 
                  value={customPaperWidth}
                  onChange={(e) => setCustomPaperWidth(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">Cao (mm)</label>
                <input 
                  type="number" 
                  value={customPaperHeight}
                  onChange={(e) => setCustomPaperHeight(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-medium">Hướng khổ giấy</label>
            <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1 rounded-lg">
              <button
                onClick={() => setOrientation('portrait')}
                className={`py-1.5 text-xs rounded transition-all ${
                  orientation === 'portrait' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                Khổ đứng
              </button>
              <button
                onClick={() => setOrientation('landscape')}
                className={`py-1.5 text-xs rounded transition-all ${
                  orientation === 'landscape' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                Khổ ngang
              </button>
            </div>
          </div>
        </div>

        {/* Step 4: Mode Specific Settings */}
        {mode === 'grid' ? (
          <div className="flex flex-col gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-800/50">
            <h3 className="text-sm font-bold text-indigo-400">Cấu hình ô lưới (Grid)</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Số cột (Columns)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10"
                  value={cols}
                  onChange={(e) => {
                    setCols(Math.max(1, parseInt(e.target.value) || 1));
                    setCurrentSheetIndex(0);
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Số dòng (Rows)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10"
                  value={rows}
                  onChange={(e) => {
                    setRows(Math.max(1, parseInt(e.target.value) || 1));
                    setCurrentSheetIndex(0);
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Khoảng cách cột (mm)</label>
                <input 
                  type="number" 
                  min="0"
                  value={gutterX}
                  onChange={(e) => setGutterX(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Khoảng cách hàng (mm)</label>
                <input 
                  type="number" 
                  min="0"
                  value={gutterY}
                  onChange={(e) => setGutterY(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
            </div>

            {/* Nút Tối ưu hóa tự động */}
            <button
              type="button"
              onClick={handleAutoOptimize}
              disabled={!pdfFile}
              className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                pdfFile 
                  ? 'bg-indigo-650/40 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/30' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-transparent'
              }`}
            >
              <span>⚙️</span>
              <span>Tối ưu hóa bố cục tự động</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-800/50">
            <h3 className="text-sm font-bold text-indigo-400">Cấu hình gấp sách (Booklet)</h3>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Kiểu gáy sách (Binding)</label>
              <select
                value={bookletBinding}
                onChange={(e) => setBookletBinding(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none"
              >
                <option value="left">Mở bên Trái (Standard)</option>
                <option value="right">Mở bên Phải (Phù hợp tiếng Nhật/Ả rập)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Bù creep gáy sách (mm)</label>
              <input 
                type="number" 
                min="0"
                step="0.1"
                value={bookletCreep}
                onChange={(e) => setBookletCreep(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
              />
            </div>
          </div>
        )}

        {/* Step 5: Margins (mm) */}
        <div className="flex flex-col gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800/50">
          <h3 className="text-sm font-bold text-indigo-400">Lề chừa cắt tờ giấy (Margins)</h3>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Lề trên (Top)</label>
              <input 
                type="number" 
                value={marginTop}
                onChange={(e) => setMarginTop(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm text-slate-200"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Lề dưới (Bottom)</label>
              <input 
                type="number" 
                value={marginBottom}
                onChange={(e) => setMarginBottom(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm text-slate-200"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Lề trái (Left)</label>
              <input 
                type="number" 
                value={marginLeft}
                onChange={(e) => setMarginLeft(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm text-slate-200"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Lề phải (Right)</label>
              <input 
                type="number" 
                value={marginRight}
                onChange={(e) => setMarginRight(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* Step 6: Visual Marks */}
        <div className="flex items-center gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800/50">
          <input 
            type="checkbox" 
            id="cropMarks"
            checked={cropMarks}
            onChange={(e) => setCropMarks(e.target.checked)}
            className="w-4 h-4 text-indigo-600 bg-slate-800 border-slate-700 rounded focus:ring-indigo-500 focus:ring-2"
          />
          <label htmlFor="cropMarks" className="text-sm font-semibold text-slate-300 cursor-pointer select-none">
            Tự vẽ vạch cắt (Crop Marks)
          </label>
        </div>

      </div>

      {/* 2. Main Preview Workspace */}
      <div className="flex-1 flex flex-col p-8 gap-6 justify-between overflow-y-auto">
        
        {/* Workspace Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Khung làm việc chính</h2>
            <p className="text-sm text-slate-400">Xem trước sơ đồ in thời gian thực (WYSIWYG)</p>
          </div>
          
          <button
            onClick={handleDownload}
            disabled={loading || !pdfFile}
            className={`px-6 py-3.5 rounded-xl font-bold shadow-lg transition-all duration-150 flex items-center gap-2 ${
              loading || !pdfFile
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed shadow-none' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-500/20 active:scale-[0.98]'
            }`}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Đang bình trang file...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Xuất PDF Bình Trang & Tải về</span>
              </>
            )}
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-400 text-sm flex items-start gap-2">
            <span className="text-base">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-400 text-sm flex items-start gap-2">
            <span className="text-base">🎉</span>
            <span>Bình trang thành công! File thành phẩm đã tự động tải xuống.</span>
          </div>
        )}

        {/* Interactive Canvas Preview Component */}
        <div className="flex-1 flex items-center justify-center">
          <PdfCanvasPreview
            pdfFile={pdfFile}
            mode={mode}
            paperSizeKey={paperSizeKey}
            customPaperWidth={customPaperWidth}
            customPaperHeight={customPaperHeight}
            orientation={orientation}
            rows={rows}
            cols={cols}
            marginTop={marginTop}
            marginBottom={marginBottom}
            marginLeft={marginLeft}
            marginRight={marginRight}
            gutterX={gutterX}
            gutterY={gutterY}
            cropMarks={cropMarks}
            bookletBinding={bookletBinding}
            bookletCreep={bookletCreep}
            currentSheetIndex={currentSheetIndex}
            setCurrentSheetIndex={setCurrentSheetIndex}
            onTotalSheetsCalculated={setTotalSheets}
            onPdfLoaded={setPdfPages}
          />
        </div>

        {/* Prepress Instructions Footer */}
        <div className="border-t border-slate-800/80 pt-6 text-center text-xs text-slate-500 leading-relaxed">
          <p>
            Quy tắc bình trang PDF Snake được đồng bộ hóa. Giao diện trực quan tự động tính toán tọa độ theo hệ thống toạ độ điểm (Points).
          </p>
          <p className="mt-1">
            © 2026 PDF Imposer Pro. Hỗ trợ xuất file in công nghiệp chất lượng vector không nén.
          </p>
        </div>

      </div>
    </div>
  );
}
